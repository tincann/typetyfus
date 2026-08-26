import { describe, it, expect } from 'vitest'
import { parseGuestMsg, parseHostMsg, type GuestMsg, type HostMsg } from './messages'

describe('parseGuestMsg', () => {
  const valid: GuestMsg[] = [
    { t: 'hello', nick: 'morten' },
    { t: 'ping', id: 3 },
    { t: 'progress', charIndex: 12, errors: 1 },
    { t: 'done', ms: 30000, wpm: 62.5, acc: 0.98 },
  ]

  it.each(valid)('accepts $t', (msg) => {
    expect(parseGuestMsg(structuredClone(msg))).toEqual(msg)
  })

  it.each([
    null, undefined, 42, 'hello', [],
    {},
    { t: 'nope' },
    { t: 'hello' },
    { t: 'hello', nick: 42 },
    { t: 'progress', charIndex: 'x', errors: 0 },
    { t: 'progress', charIndex: 1 },
    { t: 'done', ms: 1, wpm: 1 },
  ])('rejects %j', (raw) => {
    expect(parseGuestMsg(raw)).toBeNull()
  })

  it('rejects a nickname longer than 16 characters', () => {
    expect(parseGuestMsg({ t: 'hello', nick: 'x'.repeat(17) })).toBeNull()
  })

  it('rejects negative or non-finite numbers', () => {
    expect(parseGuestMsg({ t: 'progress', charIndex: -1, errors: 0 })).toBeNull()
    expect(parseGuestMsg({ t: 'progress', charIndex: NaN, errors: 0 })).toBeNull()
    expect(parseGuestMsg({ t: 'done', ms: Infinity, wpm: 1, acc: 1 })).toBeNull()
  })
})

describe('parseHostMsg', () => {
  const room: HostMsg = {
    t: 'room', seed: 7, wordCount: 40, phase: 'lobby',
    peers: [{ id: 'abc12345', nick: 'a', connected: true }], you: 'abc12345',
  }

  it.each<HostMsg>([
    room,
    { t: 'pong', id: 3 },
    { t: 'start', inMs: 3000 },
    { t: 'tick', p: [['abc12345', 10, 0]] },
    { t: 'peers', peers: [] },
    { t: 'done', id: 'abc12345', ms: 1, wpm: 2, acc: 1 },
    { t: 'reset', seed: 9, wordCount: 20 },
  ])('accepts $t', (msg) => {
    expect(parseHostMsg(structuredClone(msg))).toEqual(msg)
  })

  it('rejects an unknown phase', () => {
    expect(parseHostMsg({ ...room, phase: 'racing' })).toBeNull()
  })

  it('rejects a malformed peer entry', () => {
    expect(parseHostMsg({ ...room, peers: [{ id: 'a' }] })).toBeNull()
  })

  it('rejects a malformed tick tuple', () => {
    expect(parseHostMsg({ t: 'tick', p: [['a', 1]] })).toBeNull()
    expect(parseHostMsg({ t: 'tick', p: 'nope' })).toBeNull()
  })

  it('rejects a word count that is not an allowed option', () => {
    expect(parseHostMsg({ t: 'reset', seed: 1, wordCount: 41 })).toBeNull()
  })
})
