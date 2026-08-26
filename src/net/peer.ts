import { encodeSignal, decodeSignal } from './sdp'

/** Hard cap on gathering. Reached only when no candidate ever arrives. */
export const ICE_TIMEOUT_MS = 2500
/**
 * How long to wait after the last candidate before deciding gathering is done.
 *
 * Chromium was measured delivering host and srflx candidates within ~20ms and
 * then leaving `iceGatheringState` at 'gathering' indefinitely. Waiting for
 * 'complete' would add the full cap to every join, so a quiet period ends the
 * wait instead. 400ms is twenty times the observed arrival spread.
 */
export const ICE_QUIET_MS = 400
export const CONNECT_TIMEOUT_MS = 15_000

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export class ConnectTimeoutError extends Error {
  constructor() {
    super(
      "Couldn't establish a direct connection. This happens when both networks " +
      'block peer-to-peer traffic; a relay server would be needed, and this app ' +
      'deliberately has no server.',
    )
    this.name = 'ConnectTimeoutError'
  }
}

export interface Transport {
  send(msg: unknown): void
  close(): void
  readonly isOpen: boolean
  onOpen(fn: () => void): void
  onMessage(fn: (raw: unknown) => void): void
  onClose(fn: () => void): void
}

export type IceGatheringSource =
  Pick<RTCPeerConnection, 'iceGatheringState' | 'addEventListener' | 'removeEventListener'>

/**
 * Wait for ICE gathering to settle, then resolve.
 *
 * Manual signalling cannot deliver trickled candidates, so the code cannot be
 * produced until gathering settles. "Settled" means any of: the state reached
 * 'complete', no new candidate for ICE_QUIET_MS, or the hard cap elapsed.
 * None of these is an error — we emit the code with whatever we gathered.
 */
export function waitForIceGathering(
  pc: IceGatheringSource,
  timeoutMs: number,
  quietMs: number = ICE_QUIET_MS,
): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()

  return new Promise<void>((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined

    const done = (): void => {
      clearTimeout(cap)
      if (quiet !== undefined) clearTimeout(quiet)
      pc.removeEventListener('icegatheringstatechange', onChange)
      pc.removeEventListener('icecandidate', onCandidate)
      resolve()
    }

    const onChange = (): void => { if (pc.iceGatheringState === 'complete') done() }
    const onCandidate = (): void => {
      if (quiet !== undefined) clearTimeout(quiet)
      quiet = setTimeout(done, quietMs)
    }

    const cap = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
    pc.addEventListener('icecandidate', onCandidate)
  })
}

/**
 * Wrap a peer connection and its data channel behind Transport.
 *
 * The channel is supplied as a promise because the host does not have one yet
 * when it needs to hand back an answer code: `ondatachannel` cannot fire until
 * the guest applies that answer. Awaiting the channel before returning the code
 * would deadlock the handshake, so listeners are registered up front and
 * attached to the channel once it exists.
 */
function wrap(pc: RTCPeerConnection, channelPromise: Promise<RTCDataChannel>): Transport {
  const openFns: Array<() => void> = []
  const msgFns: Array<(raw: unknown) => void> = []
  const closeFns: Array<() => void> = []
  let channel: RTCDataChannel | null = null
  let closed = false

  // Armed when ICE starts checking, NOT when this wrapper is built. Manual
  // signalling means a human is copying codes into a chat app, which can take
  // minutes; a timer started at offer time would tear the connection down long
  // before the answer ever arrives.
  let fail: ReturnType<typeof setTimeout> | undefined
  function armTimeout(): void {
    if (fail !== undefined || closed) return
    fail = setTimeout(() => {
      if (channel?.readyState !== 'open') shutdown()
    }, CONNECT_TIMEOUT_MS)
  }

  function shutdown(): void {
    if (closed) return
    closed = true
    if (fail !== undefined) clearTimeout(fail)
    try { channel?.close(); pc.close() } catch { /* already gone */ }
    for (const fn of closeFns) fn()
  }

  function attach(ch: RTCDataChannel): void {
    channel = ch
    ch.addEventListener('open', () => {
      if (fail !== undefined) clearTimeout(fail)
      for (const fn of openFns) fn()
    })
    ch.addEventListener('close', shutdown)
    ch.addEventListener('message', (e) => {
      // A peer can send anything. Parse defensively; validation is messages.ts's job.
      let parsed: unknown
      try { parsed = JSON.parse(String(e.data)) } catch { return }
      for (const fn of msgFns) fn(parsed)
    })
    if (ch.readyState === 'open') {
      if (fail !== undefined) clearTimeout(fail)
      for (const fn of openFns) fn()
    }
  }

  void channelPromise.then(attach, shutdown)

  pc.addEventListener('iceconnectionstatechange', () => {
    // 'checking' is the moment both peers actually have each other's
    // descriptions and are attempting connectivity. That is when a stall
    // becomes meaningful, so that is when the timeout starts.
    if (pc.iceConnectionState === 'checking') armTimeout()
  })
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') shutdown()
  })

  return {
    get isOpen() { return !closed && channel?.readyState === 'open' },
    send(msg) { if (channel?.readyState === 'open') channel.send(JSON.stringify(msg)) },
    close: shutdown,
    onOpen(fn) {
      openFns.push(fn)
      if (channel?.readyState === 'open') fn()
    },
    onMessage(fn) { msgFns.push(fn) },
    onClose(fn) { closeFns.push(fn) },
  }
}

/** Guest side: create the offer, hand the code to a human, await the answer. */
export async function startOffer(): Promise<{
  offerCode: string
  transport: Transport
  acceptAnswer(answerCode: string): Promise<void>
}> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const channel = pc.createDataChannel('race', { ordered: true })
  await pc.setLocalDescription(await pc.createOffer())
  await waitForIceGathering(pc, ICE_TIMEOUT_MS)

  return {
    offerCode: await encodeSignal(pc.localDescription!),
    transport: wrap(pc, Promise.resolve(channel)),
    async acceptAnswer(answerCode: string): Promise<void> {
      await pc.setRemoteDescription(await decodeSignal(answerCode))
    },
  }
}

/** Host side: consume a guest's offer and produce the answer code. */
export async function answerOffer(offerCode: string): Promise<{
  answerCode: string
  transport: Transport
}> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const channelReady = new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener('datachannel', (e) => resolve(e.channel))
  })

  await pc.setRemoteDescription(await decodeSignal(offerCode))
  await pc.setLocalDescription(await pc.createAnswer())
  await waitForIceGathering(pc, ICE_TIMEOUT_MS)

  // Note the channel promise is passed through unawaited: awaiting it here
  // would deadlock, since the guest cannot open the channel until it receives
  // the answer code this function has not returned yet.
  return {
    answerCode: await encodeSignal(pc.localDescription!),
    transport: wrap(pc, channelReady),
  }
}
