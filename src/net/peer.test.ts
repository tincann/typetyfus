import { describe, it, expect, vi } from 'vitest'
import { waitForIceGathering, type IceGatheringSource } from './peer'

/** Minimal stand-in for the slice of RTCPeerConnection we depend on. */
function fakePc(initial: RTCIceGatheringState) {
  const listeners = new Map<string, Set<EventListener>>()
  let state = initial
  const emit = (type: string): void => {
    for (const fn of listeners.get(type) ?? []) fn(new Event(type))
  }
  return {
    get iceGatheringState() { return state },
    addEventListener: (t: string, fn: EventListener) => {
      const set = listeners.get(t) ?? new Set()
      set.add(fn)
      listeners.set(t, set)
    },
    removeEventListener: (t: string, fn: EventListener) => void listeners.get(t)?.delete(fn),
    /** Simulate a candidate arriving without gathering ever completing. */
    candidate() { emit('icecandidate') },
    settle() { state = 'complete'; emit('icegatheringstatechange') },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  } as unknown as IceGatheringSource & {
    candidate(): void
    settle(): void
    listenerCount(): number
  }
}

describe('waitForIceGathering', () => {
  it('resolves immediately when gathering is already complete', async () => {
    await expect(waitForIceGathering(fakePc('complete'), 2500)).resolves.toBeUndefined()
  })

  it('resolves when gathering completes before the timeout', async () => {
    const pc = fakePc('gathering')
    const pending = waitForIceGathering(pc, 2500)
    pc.settle()
    await expect(pending).resolves.toBeUndefined()
  })

  it('resolves after a quiet period once candidates stop arriving', async () => {
    // Measured behaviour: Chromium delivers host+srflx within ~20ms but never
    // flips iceGatheringState to 'complete'. Waiting the full cap would add
    // 2.5s of dead time to every join, so a quiet period ends the wait.
    vi.useFakeTimers()
    const pc = fakePc('gathering')
    const pending = waitForIceGathering(pc, 2500)
    pc.candidate()
    await vi.advanceTimersByTimeAsync(500)
    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('extends the quiet period when another candidate arrives', async () => {
    vi.useFakeTimers()
    const pc = fakePc('gathering')
    let done = false
    void waitForIceGathering(pc, 2500).then(() => { done = true })
    pc.candidate()
    await vi.advanceTimersByTimeAsync(300)
    pc.candidate()
    await vi.advanceTimersByTimeAsync(300)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(done).toBe(true)
    vi.useRealTimers()
  })

  it('resolves rather than rejecting when the hard cap fires with no candidates', async () => {
    // Timing out is normal, not exceptional: we send whatever we gathered.
    // Rejecting would strand a joiner who is merely on a slow network.
    vi.useFakeTimers()
    const pending = waitForIceGathering(fakePc('gathering'), 2500)
    await vi.advanceTimersByTimeAsync(2500)
    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('removes its listeners once settled', async () => {
    const pc = fakePc('gathering')
    const pending = waitForIceGathering(pc, 2500)
    pc.settle()
    await pending
    expect(pc.listenerCount()).toBe(0)
  })
})
