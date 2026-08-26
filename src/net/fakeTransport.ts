import type { Transport } from './peer'

type Endpoint = Transport & {
  deliver(raw: unknown): void
  shut(): void
  link(peer: Endpoint): void
}

/**
 * Two Transports wired to each other, for testing room logic without WebRTC.
 *
 * Delivery is asynchronous via microtask and payloads are round-tripped
 * through JSON, matching a real data channel closely enough that ordering and
 * serialisation bugs still surface.
 */
export function linkedTransports(): [Transport, Transport] {
  const make = (): Endpoint => {
    const msgFns: Array<(raw: unknown) => void> = []
    const closeFns: Array<() => void> = []
    let closed = false
    let partner: Endpoint | null = null

    const self: Endpoint = {
      get isOpen() { return !closed },
      send(msg: unknown) {
        if (closed) return
        const copy: unknown = JSON.parse(JSON.stringify(msg))
        queueMicrotask(() => partner?.deliver(copy))
      },
      close() { self.shut(); partner?.shut() },
      onOpen(fn) { queueMicrotask(() => { if (!closed) fn() }) },
      onMessage(fn) { msgFns.push(fn) },
      onClose(fn) { closeFns.push(fn) },
      deliver(raw) { if (!closed) for (const fn of msgFns) fn(raw) },
      shut() {
        if (closed) return
        closed = true
        for (const fn of closeFns) fn()
      },
      link(p) { partner = p },
    }
    return self
  }

  const a = make()
  const b = make()
  a.link(b)
  b.link(a)
  return [a, b]
}
