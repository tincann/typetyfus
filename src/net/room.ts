import type { Transport } from './peer'
import {
  parseGuestMsg, parseHostMsg, MAX_PEERS,
  type GuestMsg, type HostMsg, type PeerId, type PeerInfo,
} from './messages'
import { initRace, raceReducer, type RaceEvent, type RaceState } from '../core/raceState'
import type { RaceResult } from '../core/stats'

export const HOST_ID: PeerId = 'host'
export const TICK_MS = 100
export const COUNTDOWN_MS = 3000

export class RoomFullError extends Error {
  constructor() {
    super(`Room is full (${MAX_PEERS}/${MAX_PEERS}).`)
    this.name = 'RoomFullError'
  }
}

type Listener<T> = (v: T) => void

function emitter<T>() {
  const fns: Array<Listener<T>> = []
  return {
    on: (fn: Listener<T>): void => void fns.push(fn),
    emit: (v: T): void => { for (const fn of fns) fn(v) },
  }
}

// ---------------------------------------------------------------- host

export type HostDeps = {
  answerOffer(code: string): Promise<{ answerCode: string; transport: Transport }>
  mintId(): PeerId
  now(): number
  nick: string
  seed: number
  wordCount: number
}

export type HostRoom = {
  state(): RaceState
  /** Always HOST_ID. Present so the race screen can treat both room kinds alike. */
  selfId(): PeerId
  admit(offerCode: string): Promise<string>
  startRace(): void
  reset(seed: number, wordCount?: number): void
  report(charIndex: number, errors: number): void
  finish(r: RaceResult): void
  onChange(fn: Listener<RaceState>): void
  onStart(fn: Listener<number>): void
  dispose(): void
}

export function createHostRoom(deps: HostDeps): HostRoom {
  let state = raceReducer(initRace(deps.seed, deps.wordCount), {
    t: 'join', id: HOST_ID, nick: deps.nick,
  })
  const guests = new Map<PeerId, Transport>()
  const change = emitter<RaceState>()
  const start = emitter<number>()
  let dirty = false

  const timer = setInterval(() => {
    if (!dirty) return
    dirty = false
    broadcast({ t: 'tick', p: state.racers.map((r) => [r.id, r.charIndex, r.errors]) })
  }, TICK_MS)

  function apply(e: RaceEvent): void {
    const next = raceReducer(state, e)
    if (next === state) return
    state = next
    change.emit(state)
  }

  function broadcast(msg: HostMsg): void {
    for (const t of guests.values()) t.send(msg)
  }

  function roster(): PeerInfo[] {
    return state.racers.map((r) => ({ id: r.id, nick: r.nick, connected: r.connected }))
  }

  function announceRoster(): void {
    broadcast({ t: 'peers', peers: roster() })
  }

  function onGuestMessage(id: PeerId, transport: Transport, raw: unknown): void {
    const msg: GuestMsg | null = parseGuestMsg(raw)
    if (msg === null) return
    switch (msg.t) {
      case 'hello':
        apply({ t: 'join', id, nick: msg.nick })
        transport.send({
          t: 'room', seed: state.seed, wordCount: state.wordCount,
          phase: state.phase, peers: roster(), you: id,
        })
        announceRoster()
        break
      case 'ping':
        transport.send({ t: 'pong', id: msg.id })
        break
      case 'progress':
        apply({ t: 'progress', id, charIndex: msg.charIndex, errors: msg.errors })
        dirty = true
        break
      case 'done':
        apply({ t: 'finish', id, result: { ms: msg.ms, wpm: msg.wpm, acc: msg.acc } })
        broadcast({ t: 'done', id, ms: msg.ms, wpm: msg.wpm, acc: msg.acc })
        break
    }
  }

  return {
    state: () => state,
    selfId: () => HOST_ID,

    async admit(offerCode: string): Promise<string> {
      if (state.racers.filter((r) => r.connected).length >= MAX_PEERS) throw new RoomFullError()
      const { answerCode, transport } = await deps.answerOffer(offerCode)
      const id = deps.mintId()
      guests.set(id, transport)
      transport.onMessage((raw) => onGuestMessage(id, transport, raw))
      transport.onClose(() => {
        guests.delete(id)
        apply({ t: 'leave', id })
        announceRoster()
      })
      return answerCode
    },

    startRace(): void {
      apply({ t: 'countdown' })
      broadcast({ t: 'start', inMs: COUNTDOWN_MS })
      start.emit(COUNTDOWN_MS)
      setTimeout(() => apply({ t: 'start' }), COUNTDOWN_MS)
    },

    reset(seed: number, wordCount: number = state.wordCount): void {
      apply({ t: 'reset', seed, wordCount })
      broadcast({ t: 'reset', seed, wordCount })
    },

    report(charIndex: number, errors: number): void {
      apply({ t: 'progress', id: HOST_ID, charIndex, errors })
      dirty = true
    },

    finish(r: RaceResult): void {
      apply({ t: 'finish', id: HOST_ID, result: r })
      broadcast({ t: 'done', id: HOST_ID, ms: r.ms, wpm: r.wpm, acc: r.acc })
    },

    onChange: change.on,
    onStart: start.on,

    dispose(): void {
      clearInterval(timer)
      for (const t of guests.values()) t.close()
      guests.clear()
    },
  }
}

// --------------------------------------------------------------- guest

export type GuestDeps = { transport: Transport; nick: string; now(): number }

export type GuestRoom = {
  state(): RaceState
  selfId(): PeerId | null
  offsetMs(): number
  report(charIndex: number, errors: number): void
  finish(r: RaceResult): void
  onChange(fn: Listener<RaceState>): void
  onStart(fn: Listener<number>): void
  dispose(): void
}

const PING_ROUNDS = 5

export function createGuestRoom(deps: GuestDeps): GuestRoom {
  let state = initRace(0, 40)
  let self: PeerId | null = null
  let offset = 0
  const sent = new Map<number, number>()
  const change = emitter<RaceState>()
  const start = emitter<number>()

  function set(next: RaceState): void {
    if (next === state) return
    state = next
    change.emit(state)
  }

  /** Rebuild the roster wholesale — the host is authoritative about who is present. */
  function syncRoster(peers: PeerInfo[]): void {
    const byId = new Map(state.racers.map((r) => [r.id, r]))
    set({
      ...state,
      racers: peers.map((p) => {
        const prev = byId.get(p.id)
        return prev !== undefined
          ? { ...prev, nick: p.nick, connected: p.connected }
          : { ...p, charIndex: 0, errors: 0, result: null }
      }),
    })
  }

  deps.transport.onMessage((raw) => {
    const msg: HostMsg | null = parseHostMsg(raw)
    if (msg === null) return
    switch (msg.t) {
      case 'room':
        self = msg.you
        set({ ...state, seed: msg.seed, wordCount: msg.wordCount, phase: msg.phase })
        syncRoster(msg.peers)
        break
      case 'pong': {
        const at = sent.get(msg.id)
        if (at === undefined) return
        sent.delete(msg.id)
        // Keep the smallest sample: the least-delayed round trip is the least
        // polluted by queueing, so it is the best estimate of one-way delay.
        const half = (deps.now() - at) / 2
        offset = offset === 0 ? half : Math.min(offset, half)
        break
      }
      case 'peers':
        syncRoster(msg.peers)
        break
      case 'start': {
        set(raceReducer(state, { t: 'countdown' }))
        const inMs = Math.max(0, msg.inMs - offset)
        start.emit(inMs)
        setTimeout(() => set(raceReducer(state, { t: 'start' })), inMs)
        break
      }
      case 'tick':
        for (const [id, charIndex, errors] of msg.p) {
          if (id === self) continue
          set(raceReducer(state, { t: 'progress', id, charIndex, errors }))
        }
        break
      case 'done':
        set(raceReducer(state, {
          t: 'finish', id: msg.id, result: { ms: msg.ms, wpm: msg.wpm, acc: msg.acc },
        }))
        break
      case 'reset':
        set(raceReducer(state, { t: 'reset', seed: msg.seed, wordCount: msg.wordCount }))
        break
    }
  })

  deps.transport.onOpen(() => {
    deps.transport.send({ t: 'hello', nick: deps.nick })
    for (let i = 0; i < PING_ROUNDS; i++) {
      const id = i + 1
      sent.set(id, deps.now())
      deps.transport.send({ t: 'ping', id })
    }
  })

  deps.transport.onClose(() => {
    set({ ...state, phase: 'finished' })
  })

  return {
    state: () => state,
    selfId: () => self,
    offsetMs: () => offset,
    report(charIndex, errors) {
      if (self !== null) set(raceReducer(state, { t: 'progress', id: self, charIndex, errors }))
      deps.transport.send({ t: 'progress', charIndex, errors })
    },
    finish(r) {
      if (self !== null) set(raceReducer(state, { t: 'finish', id: self, result: r }))
      deps.transport.send({ t: 'done', ms: r.ms, wpm: r.wpm, acc: r.acc })
    },
    onChange: change.on,
    onStart: start.on,
    dispose: () => deps.transport.close(),
  }
}
