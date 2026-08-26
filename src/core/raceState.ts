import type { PeerId, Phase } from './ids'
import type { RaceResult } from './stats'

export const MAX_RACERS = 6

export type Racer = {
  id: PeerId
  nick: string
  connected: boolean
  charIndex: number
  errors: number
  result: RaceResult | null
}

export type RaceState = {
  phase: Phase
  seed: number
  wordCount: number
  racers: Racer[]
}

export type RaceEvent =
  | { t: 'join'; id: PeerId; nick: string }
  | { t: 'leave'; id: PeerId }
  | { t: 'progress'; id: PeerId; charIndex: number; errors: number }
  | { t: 'finish'; id: PeerId; result: RaceResult }
  | { t: 'countdown' }
  | { t: 'start' }
  | { t: 'reset'; seed: number; wordCount: number }

export function initRace(seed: number, wordCount: number): RaceState {
  return { phase: 'lobby', seed, wordCount, racers: [] }
}

/**
 * A race ends when everyone still connected has a result.
 *
 * Disconnected racers are excluded deliberately: waiting on someone whose
 * laptop closed would hang the race for everyone else.
 */
function settle(s: RaceState): RaceState {
  if (s.phase !== 'running') return s
  const live = s.racers.filter((r) => r.connected)
  const allDone = live.every((r) => r.result !== null)
  return allDone ? { ...s, phase: 'finished' } : s
}

function mapRacer(s: RaceState, id: PeerId, fn: (r: Racer) => Racer): RaceState | null {
  const i = s.racers.findIndex((r) => r.id === id)
  if (i === -1) return null
  const racers = [...s.racers]
  racers[i] = fn(racers[i]!)
  return { ...s, racers }
}

export function raceReducer(s: RaceState, e: RaceEvent): RaceState {
  switch (e.t) {
    case 'join': {
      if (s.racers.length >= MAX_RACERS) return s
      if (s.racers.some((r) => r.id === e.id)) return s
      return {
        ...s,
        racers: [
          ...s.racers,
          { id: e.id, nick: e.nick, connected: true, charIndex: 0, errors: 0, result: null },
        ],
      }
    }

    case 'leave': {
      const next = mapRacer(s, e.id, (r) => ({ ...r, connected: false }))
      return next === null ? s : settle(next)
    }

    case 'progress': {
      const target = s.racers.find((r) => r.id === e.id)
      if (target === undefined || target.result !== null) return s
      return mapRacer(s, e.id, (r) => ({ ...r, charIndex: e.charIndex, errors: e.errors })) ?? s
    }

    case 'finish': {
      const target = s.racers.find((r) => r.id === e.id)
      if (target === undefined || target.result !== null) return s
      const next = mapRacer(s, e.id, (r) => ({ ...r, result: e.result }))
      return next === null ? s : settle(next)
    }

    case 'countdown':
      return s.phase === 'lobby' ? { ...s, phase: 'countdown' } : s

    case 'start':
      return { ...s, phase: 'running' }

    case 'reset':
      return {
        phase: 'lobby',
        seed: e.seed,
        wordCount: e.wordCount,
        racers: s.racers
          .filter((r) => r.connected)
          .map((r) => ({ ...r, charIndex: 0, errors: 0, result: null })),
      }
  }
}

export function standings(s: RaceState): Racer[] {
  const rank = (r: Racer): number => (!r.connected ? 2 : r.result !== null ? 0 : 1)
  return [...s.racers].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    if (a.result !== null && b.result !== null) return a.result.ms - b.result.ms
    return b.charIndex - a.charIndex
  })
}
