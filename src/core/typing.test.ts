import { describe, it, expect } from 'vitest'
import { initTyping, applyKey, progressRatio, type TypingState } from './typing'

const type = (text: string, keys: string[]): TypingState =>
  keys.reduce(applyKey, initTyping(text))

describe('initTyping', () => {
  it('starts at zero, unblocked and unfinished', () => {
    const s = initTyping('ab')
    expect(s).toEqual({ text: 'ab', cursor: 0, blocked: null, errors: 0, finished: false })
  })

  it('treats empty text as immediately finished', () => {
    expect(initTyping('').finished).toBe(true)
  })
})

describe('applyKey — correct input', () => {
  it('advances the cursor on a correct character', () => {
    const s = type('cat', ['c', 'a'])
    expect(s.cursor).toBe(2)
    expect(s.errors).toBe(0)
    expect(s.blocked).toBeNull()
  })

  it('accepts spaces as ordinary characters', () => {
    expect(type('a b', ['a', ' ', 'b']).finished).toBe(true)
  })

  it('sets finished on the last character', () => {
    const s = type('hi', ['h', 'i'])
    expect(s.finished).toBe(true)
    expect(s.cursor).toBe(2)
  })
})

describe('applyKey — blocking on error', () => {
  it('blocks and counts an error on a wrong character', () => {
    const s = type('cat', ['c', 'x'])
    expect(s.cursor).toBe(1)
    expect(s.blocked).toBe('x')
    expect(s.errors).toBe(1)
  })

  it('refuses to advance while blocked, even on the correct character', () => {
    const s = type('cat', ['c', 'x', 'a'])
    expect(s.cursor).toBe(1)
    expect(s.blocked).toBe('x')
    expect(s.errors).toBe(2)
  })

  it('clears the block on Backspace and then accepts the correct character', () => {
    const s = type('cat', ['c', 'x', 'Backspace', 'a', 't'])
    expect(s.finished).toBe(true)
    expect(s.errors).toBe(1)
  })

  it('treats Backspace as a no-op when not blocked', () => {
    const s = type('cat', ['c', 'Backspace'])
    expect(s.cursor).toBe(1)
    expect(s.errors).toBe(0)
    expect(s.blocked).toBeNull()
  })
})

describe('applyKey — ignored keys', () => {
  it.each(['Shift', 'Tab', 'Enter', 'ArrowLeft', 'Control'])('ignores %s', (key) => {
    const before = type('cat', ['c'])
    expect(applyKey(before, key)).toEqual(before)
  })
})

describe('applyKey — after finishing', () => {
  it('ignores all further keys', () => {
    const done = type('hi', ['h', 'i'])
    expect(applyKey(done, 'x')).toEqual(done)
  })
})

describe('purity', () => {
  it('never mutates the input state', () => {
    const s = initTyping('cat')
    const snapshot = { ...s }
    applyKey(s, 'c')
    expect(s).toEqual(snapshot)
  })
})

describe('progressRatio', () => {
  it('reports 0, a midpoint, and 1', () => {
    expect(progressRatio(initTyping('abcd'))).toBe(0)
    expect(progressRatio(type('abcd', ['a', 'b']))).toBe(0.5)
    expect(progressRatio(type('abcd', ['a', 'b', 'c', 'd']))).toBe(1)
  })

  it('reports 1 for empty text rather than dividing by zero', () => {
    expect(progressRatio(initTyping(''))).toBe(1)
  })
})
