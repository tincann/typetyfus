// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderResults } from './results'
import type { Racer } from '../../core/raceState'

const racer = (p: Partial<Racer> & { id: string }): Racer => ({
  nick: p.id, connected: true, charIndex: 0, errors: 0, result: null, ...p,
})

describe('renderResults', () => {
  it('lists finishers with position, wpm and accuracy', () => {
    const node = renderResults([
      racer({ id: 'a', result: { ms: 20_000, wpm: 70, acc: 0.98 } }),
      racer({ id: 'b', result: { ms: 30_000, wpm: 50, acc: 0.9 } }),
    ], 'a')
    const rows = [...node.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('70')
    expect(rows[0]!.textContent).toContain('98%')
  })

  it('highlights the local player', () => {
    const node = renderResults([racer({ id: 'a' }), racer({ id: 'b' })], 'b')
    const rows = [...node.querySelectorAll('tbody tr')]
    expect(rows[1]!.className).toContain('me')
    expect(rows[0]!.className).not.toContain('me')
  })

  it('shows a dash rather than a fake time for someone who did not finish', () => {
    const node = renderResults([racer({ id: 'a', charIndex: 12 })], 'a')
    expect(node.querySelector('tbody tr')!.textContent).toContain('—')
  })

  it('labels a disconnected racer', () => {
    const node = renderResults([racer({ id: 'a', connected: false })], 'z')
    expect(node.querySelector('tbody tr')!.textContent).toContain('left')
  })
})
