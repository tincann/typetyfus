import { describe, it, expect } from 'vitest'
import { encodeSignal, decodeSignal, SignalDecodeError } from './sdp'

const SDP = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=candidate:1510613869 1 udp 2113937151 192.168.1.24 55555 typ host generation 0 network-cost 999
a=candidate:842163049 1 udp 1677729535 81.23.44.9 55555 typ srflx raddr 192.168.1.24 rport 55555 generation 0 network-cost 999
a=ice-ufrag:aB3d
a=ice-pwd:0123456789abcdef0123456789
a=ice-options:trickle
a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
`

describe('encodeSignal / decodeSignal', () => {
  it('round-trips an offer exactly', async () => {
    const desc = { type: 'offer' as const, sdp: SDP }
    expect(await decodeSignal(await encodeSignal(desc))).toEqual(desc)
  })

  it('round-trips an answer exactly', async () => {
    const desc = { type: 'answer' as const, sdp: SDP }
    expect(await decodeSignal(await encodeSignal(desc))).toEqual(desc)
  })

  it('produces URL- and chat-safe characters only', async () => {
    expect(await encodeSignal({ type: 'offer', sdp: SDP })).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('stays short enough to paste into a chat message', async () => {
    // The absolute bound is what the join UX actually depends on. A ratio
    // against the raw SDP is a poor proxy: base64 re-expands by 4/3, so a
    // short fixture compresses to a worse ratio than a real offer would.
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    expect(code.length).toBeLessThan(1500)
  })

  it('is smaller than the same payload base64-encoded without compression', async () => {
    // Guards against deflate silently becoming a no-op.
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    const uncompressed = btoa(JSON.stringify({ t: 'offer', s: SDP })).length
    expect(code.length).toBeLessThan(uncompressed)
  })

  it('rejects a code that is not base64url', async () => {
    await expect(decodeSignal('not valid!!')).rejects.toThrow(SignalDecodeError)
  })

  it('rejects base64url that does not inflate', async () => {
    await expect(decodeSignal('aGVsbG8')).rejects.toThrow(SignalDecodeError)
  })

  it('rejects an empty code', async () => {
    await expect(decodeSignal('')).rejects.toThrow(SignalDecodeError)
  })

  it('rejects inflated content with the wrong shape', async () => {
    // Valid deflate of valid JSON, but not a session description.
    const bogus = await encodeSignal({ type: 'offer', sdp: SDP })
    const tampered = bogus.slice(0, -4)
    await expect(decodeSignal(tampered)).rejects.toThrow(SignalDecodeError)
  })
})
