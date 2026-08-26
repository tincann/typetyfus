import { describe, it, expect } from 'vitest'
import { createStorage, type StorageLike } from './storage'
import type { RaceResult } from './stats'

function fakeBackend(seed: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

const result = (wpm: number): RaceResult => ({ ms: 30_000, wpm, acc: 1 })

describe('settings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(createStorage(fakeBackend()).loadSettings())
      .toEqual({ nick: '', wordCount: 40 })
  })

  it('round-trips saved settings', () => {
    const s = createStorage(fakeBackend())
    s.saveSettings({ nick: 'morten', wordCount: 60 })
    expect(s.loadSettings()).toEqual({ nick: 'morten', wordCount: 60 })
  })

  it('falls back to defaults on unparseable JSON', () => {
    const s = createStorage(fakeBackend({ 'tt:settings': '{not json' }))
    expect(s.loadSettings()).toEqual({ nick: '', wordCount: 40 })
  })

  it('rejects a word count that is not one of the allowed options', () => {
    const s = createStorage(fakeBackend({ 'tt:settings': '{"nick":"x","wordCount":9999}' }))
    expect(s.loadSettings().wordCount).toBe(40)
  })

  it('coerces a non-string nickname', () => {
    const s = createStorage(fakeBackend({ 'tt:settings': '{"nick":42,"wordCount":20}' }))
    expect(s.loadSettings()).toEqual({ nick: '', wordCount: 20 })
  })
})

describe('history', () => {
  it('is empty by default', () => {
    expect(createStorage(fakeBackend()).loadHistory()).toEqual([])
  })

  it('stores most recent first', () => {
    const s = createStorage(fakeBackend())
    s.pushResult(result(50))
    s.pushResult(result(60))
    expect(s.loadHistory().map((r) => r.wpm)).toEqual([60, 50])
  })

  it('keeps only the last 10 results', () => {
    const s = createStorage(fakeBackend())
    for (let i = 1; i <= 15; i++) s.pushResult(result(i))
    const wpms = s.loadHistory().map((r) => r.wpm)
    expect(wpms).toHaveLength(10)
    expect(wpms[0]).toBe(15)
    expect(wpms[9]).toBe(6)
  })

  it('returns the trimmed list from pushResult', () => {
    const s = createStorage(fakeBackend())
    expect(s.pushResult(result(1))).toHaveLength(1)
  })

  it('falls back to empty on corrupt history', () => {
    expect(createStorage(fakeBackend({ 'tt:history': '[[[' })).loadHistory()).toEqual([])
  })

  it('discards a stored history that is not an array', () => {
    expect(createStorage(fakeBackend({ 'tt:history': '{"a":1}' })).loadHistory()).toEqual([])
  })
})

describe('bestWpm', () => {
  it('is 0 with no history', () => {
    expect(createStorage(fakeBackend()).bestWpm()).toBe(0)
  })

  it('is the maximum across stored results', () => {
    const s = createStorage(fakeBackend())
    for (const w of [40, 75, 60]) s.pushResult(result(w))
    expect(s.bestWpm()).toBe(75)
  })
})

describe('a backend that throws', () => {
  it('does not propagate write failures', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded') },
    }
    const s = createStorage(hostile)
    expect(() => s.saveSettings({ nick: 'a', wordCount: 20 })).not.toThrow()
  })
})
