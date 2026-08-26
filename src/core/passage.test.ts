import { describe, it, expect } from 'vitest'
import { generatePassage, passageText } from './passage'
import { WORDS } from './wordlist'

describe('wordlist', () => {
  it('has exactly 1000 unique lowercase words', () => {
    expect(WORDS).toHaveLength(1000)
    expect(new Set(WORDS).size).toBe(1000)
    for (const w of WORDS) expect(w).toMatch(/^[a-z]+$/)
  })
})

describe('generatePassage', () => {
  it('is deterministic: the same seed yields the same words', () => {
    expect(generatePassage(42, 40)).toEqual(generatePassage(42, 40))
  })

  it('differs across seeds', () => {
    expect(generatePassage(1, 40)).not.toEqual(generatePassage(2, 40))
  })

  it('returns exactly wordCount words drawn from the list', () => {
    const p = generatePassage(7, 20)
    expect(p).toHaveLength(20)
    for (const w of p) expect(WORDS).toContain(w)
  })

  it('is a prefix-stable stream: a longer passage extends a shorter one', () => {
    // Guards against an implementation that seeds off wordCount. If two peers
    // ever disagree on wordCount, they should still share a common prefix
    // rather than diverging into unrelated text.
    expect(generatePassage(5, 60).slice(0, 20)).toEqual(generatePassage(5, 20))
  })
})

describe('passageText', () => {
  it('joins with single spaces and has no leading or trailing space', () => {
    const text = passageText(3, 10)
    expect(text).toBe(generatePassage(3, 10).join(' '))
    expect(text).not.toMatch(/^\s|\s$|\s\s/)
  })
})
