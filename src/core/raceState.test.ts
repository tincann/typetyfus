import { describe, it, expect } from 'vitest'
import { initRace, raceReducer, standings, type RaceState, type RaceEvent } from './raceState'
import type { RaceResult } from './stats'

const run = (s: RaceState, ...events: RaceEvent[]) => events.reduce(raceReducer, s)
const base = () => initRace(42, 40)
const res = (ms: number): RaceResult => ({ ms, wpm: 60, acc: 1 })
const join = (id: string, nick = id): RaceEvent => ({ t: 'join', id, nick })

describe('initRace', () => {
  it('starts in lobby with no racers', () => {
    expect(base()).toEqual({ phase: 'lobby', seed: 42, wordCount: 40, racers: [] })
  })
})

describe('join and leave', () => {
  it('adds a racer at zero progress', () => {
    const s = run(base(), join('a'))
    expect(s.racers).toEqual([
      { id: 'a', nick: 'a', connected: true, charIndex: 0, errors: 0, result: null },
    ])
  })

  it('ignores a duplicate id', () => {
    const s = run(base(), join('a'), join('a', 'other'))
    expect(s.racers).toHaveLength(1)
    expect(s.racers[0]!.nick).toBe('a')
  })

  it('refuses a 7th racer', () => {
    let s = base()
    for (let i = 0; i < 6; i++) s = raceReducer(s, join(`p${i}`))
    const full = raceReducer(s, join('p6'))
    expect(full.racers).toHaveLength(6)
    expect(full).toBe(s)
  })

  it('marks a leaver disconnected rather than removing them', () => {
    // Their partial progress still belongs on the results table.
    const s = run(base(), join('a'), { t: 'leave', id: 'a' })
    expect(s.racers[0]!.connected).toBe(false)
  })
})

describe('progress', () => {
  it('records the latest position', () => {
    const s = run(base(), join('a'), { t: 'progress', id: 'a', charIndex: 12, errors: 2 })
    expect(s.racers[0]).toMatchObject({ charIndex: 12, errors: 2 })
  })

  it('ignores progress from an unknown racer', () => {
    const s = run(base(), join('a'))
    expect(raceReducer(s, { t: 'progress', id: 'ghost', charIndex: 5, errors: 0 })).toBe(s)
  })

  it('ignores progress from a racer who already finished', () => {
    const s = run(base(), join('a'), { t: 'start' }, { t: 'finish', id: 'a', result: res(100) })
    expect(raceReducer(s, { t: 'progress', id: 'a', charIndex: 99, errors: 0 }).racers[0]!.charIndex)
      .toBe(0)
  })
})

describe('phase transitions', () => {
  it('goes lobby → countdown → running', () => {
    expect(run(base(), { t: 'countdown' }).phase).toBe('countdown')
    expect(run(base(), { t: 'countdown' }, { t: 'start' }).phase).toBe('running')
  })

  it('finishes when every connected racer has a result', () => {
    const s = run(base(), join('a'), join('b'), { t: 'start' },
      { t: 'finish', id: 'a', result: res(100) })
    expect(s.phase).toBe('running')
    expect(raceReducer(s, { t: 'finish', id: 'b', result: res(200) }).phase).toBe('finished')
  })

  it('does not wait for a disconnected racer', () => {
    const s = run(base(), join('a'), join('b'), { t: 'start' },
      { t: 'finish', id: 'a', result: res(100) }, { t: 'leave', id: 'b' })
    expect(s.phase).toBe('finished')
  })

  it('finishes when the last connected racer leaves', () => {
    // Nobody is left to wait for, so the race is over rather than stuck.
    const s = run(base(), join('a'), { t: 'start' }, { t: 'leave', id: 'a' })
    expect(s.phase).toBe('finished')
  })

  it('reset returns to lobby with a new seed and clears progress', () => {
    const s = run(base(), join('a'), { t: 'start' },
      { t: 'finish', id: 'a', result: res(100) }, { t: 'reset', seed: 9, wordCount: 20 })
    expect(s).toMatchObject({ phase: 'lobby', seed: 9, wordCount: 20 })
    expect(s.racers[0]).toMatchObject({ charIndex: 0, errors: 0, result: null, connected: true })
  })
})

describe('standings', () => {
  it('orders finishers by time, then leaders by progress, then the disconnected', () => {
    const s = run(base(), join('slow'), join('fast'), join('typing'), join('gone'),
      { t: 'start' },
      { t: 'finish', id: 'slow', result: res(9000) },
      { t: 'finish', id: 'fast', result: res(4000) },
      { t: 'progress', id: 'typing', charIndex: 30, errors: 0 },
      { t: 'leave', id: 'gone' })
    expect(standings(s).map((r) => r.id)).toEqual(['fast', 'slow', 'typing', 'gone'])
  })
})
