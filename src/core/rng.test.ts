import { describe, it, expect } from 'vitest'
import { mulberry32 } from './rng'

describe('mulberry32', () => {
  it('produces an identical stream for the same seed', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const runA = Array.from({ length: 50 }, () => a())
    const runB = Array.from({ length: 50 }, () => b())
    expect(runA).toEqual(runB)
  })

  it('produces a different stream for a different seed', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(Array.from({ length: 20 }, () => a()))
      .not.toEqual(Array.from({ length: 20 }, () => b()))
  })

  it('stays within [0, 1)', () => {
    const r = mulberry32(999)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
