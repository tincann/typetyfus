export class SignalDecodeError extends Error {
  constructor(cause?: unknown) {
    super("That doesn't look like a valid code. Check you copied all of it.")
    this.name = 'SignalDecodeError'
    this.cause = cause
  }
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as never)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): Uint8Array {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/**
 * Pack a session description into a string a human can paste into a chat.
 *
 * SDP is extremely repetitive, so deflate does most of the work; base64url
 * keeps the result safe in URLs, chat clients and shells.
 */
export async function encodeSignal(desc: RTCSessionDescriptionInit): Promise<string> {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp ?? '' })
  const deflated = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  return toBase64Url(deflated)
}

export async function decodeSignal(code: string): Promise<RTCSessionDescriptionInit> {
  const trimmed = code.trim()
  if (trimmed === '' || !/^[A-Za-z0-9_-]+$/.test(trimmed)) throw new SignalDecodeError()
  try {
    const inflated = await pipe(fromBase64Url(trimmed), new DecompressionStream('deflate-raw'))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(inflated))
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    const o = parsed as Record<string, unknown>
    if ((o['t'] !== 'offer' && o['t'] !== 'answer') || typeof o['s'] !== 'string') {
      throw new Error('wrong shape')
    }
    return { type: o['t'], sdp: o['s'] }
  } catch (cause) {
    throw new SignalDecodeError(cause)
  }
}
