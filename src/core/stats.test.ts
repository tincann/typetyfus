import { describe, it, expect } from 'vitest'
import { wpm, accuracy } from './stats'

describe('wpm', () => {
  it('uses the standard 5-characters-per-word definition', () => {
    // 300 correct chars = 60 words, in 60s = 60 wpm
    expect(wpm(300, 60_000)).toBe(60)
  })

  it('scales with elapsed time', () => {
    expect(wpm(300, 30_000)).toBe(120)
  })

  it('rounds to one decimal', () => {
    expect(wpm(100, 37_000)).toBe(32.4)
  })

  it('returns 0 rather than Infinity for zero elapsed time', () => {
    expect(wpm(100, 0)).toBe(0)
    expect(wpm(100, -5)).toBe(0)
  })

  it('returns 0 for no correct characters', () => {
    expect(wpm(0, 10_000)).toBe(0)
  })
})

describe('accuracy', () => {
  it('is 1 when there are no errors', () => {
    expect(accuracy(100, 0)).toBe(1)
  })

  it('divides correct by total keystrokes', () => {
    expect(accuracy(90, 10)).toBe(0.9)
  })

  it('rounds to three decimals', () => {
    expect(accuracy(2, 1)).toBe(0.667)
  })

  it('returns 1 before any keystroke rather than NaN', () => {
    expect(accuracy(0, 0)).toBe(1)
  })

  it('is 0 when nothing was ever correct', () => {
    expect(accuracy(0, 5)).toBe(0)
  })
})
