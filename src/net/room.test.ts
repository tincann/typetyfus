import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createHostRoom, createGuestRoom, RoomFullError, TICK_MS, COUNTDOWN_MS, HOST_ID,
  type HostRoom,
} from './room'
import { linkedTransports } from './fakeTransport'
import type { Transport } from './peer'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * A host room whose answerOffer hands back a fresh linked pair each time, and
 * a helper to attach a guest to the far end. The SDP layer is bypassed
 * entirely — this exercises room logic, not WebRTC.
 */
function harness() {
  let ids = 0
  const guestSides: Transport[] = []

  const host: HostRoom = createHostRoom({
    answerOffer: async () => {
      const [hostSide, guestSide] = linkedTransports()
      guestSides.push(guestSide)
      return { answerCode: `ANSWER-${guestSides.length}`, transport: hostSide }
    },
    mintId: () => `g${++ids}`,
    now: () => 0,
    nick: 'hosty',
    seed: 42,
    wordCount: 40,
  })

  /** Admit a guest and return a GuestRoom bound to the other end. */
  async function join(nick: string) {
    const code = await host.admit('OFFER')
    const side = guestSides[guestSides.length - 1]!
    const guest = createGuestRoom({ transport: side, nick, now: () => 0 })
    await flush()
    return { guest, code, transport: side }
  }

  /** Admit a raw transport so tests can observe the wire directly. */
  async function joinRaw(nick: string) {
    await host.admit('OFFER')
    const side = guestSides[guestSides.length - 1]!
    const seen: unknown[] = []
    side.onMessage((m) => seen.push(m))
    side.send({ t: 'hello', nick })
    await flush()
    return { side, seen }
  }

  return { host, join, joinRaw }
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

describe('host room', () => {
  it('starts with only the host in the roster', () => {
    expect(harness().host.state().racers.map((r) => r.nick)).toEqual(['hosty'])
  })

  it('reports its own id as HOST_ID', () => {
    expect(harness().host.selfId()).toBe(HOST_ID)
  })

  it('returns the answer code from admit', async () => {
    const { host } = harness()
    expect(await host.admit('OFFER')).toBe('ANSWER-1')
  })

  it('adds the guest to the roster once it says hello', async () => {
    const h = harness()
    await h.join('morten')
    expect(h.host.state().racers.map((r) => r.nick)).toEqual(['hosty', 'morten'])
  })

  it('refuses a 7th participant', async () => {
    const h = harness()
    for (let i = 0; i < 5; i++) await h.join(`p${i}`)
    expect(h.host.state().racers).toHaveLength(6)
    await expect(h.host.admit('OFFER')).rejects.toThrow(RoomFullError)
  })
})

describe('guest room', () => {
  it('learns the seed and word count from the host', async () => {
    const { guest } = await harness().join('morten')
    expect(guest.state()).toMatchObject({ seed: 42, wordCount: 40 })
  })

  it('learns its own id', async () => {
    const { guest } = await harness().join('morten')
    expect(guest.selfId()).toBe('g1')
  })

  it('sees the whole roster including other guests', async () => {
    const h = harness()
    const { guest: a } = await h.join('a')
    await h.join('b')
    await flush()
    expect(a.state().racers.map((r) => r.nick).sort()).toEqual(['a', 'b', 'hosty'])
  })

  it('answers nothing and keeps working when sent a malformed message', async () => {
    const [hostSide, guestSide] = linkedTransports()
    const guest = createGuestRoom({ transport: guestSide, nick: 'a', now: () => 0 })
    expect(() => hostSide.send({ t: 'nonsense', boom: true })).not.toThrow()
    await flush()
    expect(guest.state().racers).toEqual([])
  })
})

describe('relaying', () => {
  it("propagates one guest's progress to another guest", async () => {
    const h = harness()
    const { guest: a } = await h.join('a')
    const { guest: b } = await h.join('b')
    h.host.startRace()
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 100)

    a.report(25, 1)
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)

    expect(b.state().racers.find((r) => r.id === a.selfId()))
      .toMatchObject({ charIndex: 25, errors: 1 })
  })

  it('batches every racer into one tick rather than a message each', async () => {
    const h = harness()
    const { guest: a } = await h.join('a')
    const raw = await h.joinRaw('b')
    h.host.startRace()
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 100)

    raw.seen.length = 0
    a.report(5, 0)
    h.host.report(7, 0)
    await vi.advanceTimersByTimeAsync(TICK_MS)

    const ticks = raw.seen.filter((m) => (m as { t: string }).t === 'tick')
    expect(ticks).toHaveLength(1)
    // One message carrying every racer, not one message per racer.
    expect((ticks[0] as { p: unknown[] }).p.length).toBe(h.host.state().racers.length)
  })

  it('propagates a finish to every peer', async () => {
    const h = harness()
    const { guest: a } = await h.join('a')
    const { guest: b } = await h.join('b')
    h.host.startRace()
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 100)

    a.finish({ ms: 12_000, wpm: 55, acc: 0.97 })
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)

    expect(b.state().racers.find((r) => r.id === a.selfId())?.result)
      .toEqual({ ms: 12_000, wpm: 55, acc: 0.97 })
  })
})

describe('starting together', () => {
  it('tells every guest to start', async () => {
    const h = harness()
    const { guest } = await h.join('a')
    const starts: number[] = []
    guest.onStart((inMs) => starts.push(inMs))
    h.host.startRace()
    await flush()
    expect(starts).toHaveLength(1)
    expect(starts[0]).toBeGreaterThan(0)
  })

  it('answers guest pings so a clock offset can be estimated', async () => {
    const h = harness()
    const raw = await h.joinRaw('a')
    raw.seen.length = 0
    raw.side.send({ t: 'ping', id: 99 })
    await flush()
    expect(raw.seen).toContainEqual({ t: 'pong', id: 99 })
  })
})

describe('disconnects', () => {
  it('marks a guest disconnected when its transport closes', async () => {
    const h = harness()
    const { guest } = await h.join('a')
    guest.dispose()
    await flush()
    expect(h.host.state().racers.find((r) => r.nick === 'a')?.connected).toBe(false)
  })

  it('leaves the guest with readable state when the host vanishes', async () => {
    const h = harness()
    const { guest } = await h.join('a')
    h.host.dispose()
    await flush()
    expect(guest.state().phase).toBe('finished')
    expect(guest.state().racers.length).toBeGreaterThan(0)
  })
})

describe('reset', () => {
  it('reseeds every guest', async () => {
    const h = harness()
    const { guest } = await h.join('a')
    h.host.reset(999, 20)
    await flush()
    expect(guest.state()).toMatchObject({ seed: 999, wordCount: 20, phase: 'lobby' })
  })
})
