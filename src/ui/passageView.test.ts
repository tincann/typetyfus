// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderPassage } from './passageView'
import { initTyping, applyKey } from '../core/typing'

const type = (text: string, keys: string[]) => keys.reduce(applyKey, initTyping(text))

describe('renderPassage', () => {
  it('renders one span per character', () => {
    const node = renderPassage(initTyping('cat'), { hidden: false })
    expect(node.querySelectorAll('span.ch')).toHaveLength(3)
  })

  it('marks typed characters done and the next one current', () => {
    const node = renderPassage(type('cat', ['c']), { hidden: false })
    const spans = [...node.querySelectorAll('span.ch')]
    expect(spans[0]!.className).toContain('done')
    expect(spans[1]!.className).toContain('current')
    expect(spans[2]!.className).not.toContain('current')
  })

  it('marks the current character as an error while blocked', () => {
    const node = renderPassage(type('cat', ['c', 'x']), { hidden: false })
    const spans = [...node.querySelectorAll('span.ch')]
    expect(spans[1]!.className).toContain('error')
  })

  it('renders a space as a real space, not a non-breaking one', () => {
    // A non-breaking space would keep the space visible but remove the only
    // legal line-break point, forcing words to split mid-word. `.passage` uses
    // white-space: pre-wrap to keep plain spaces visible instead.
    const node = renderPassage(initTyping('a b'), { hidden: false })
    expect([...node.querySelectorAll('span.ch')][1]!.textContent).toBe(' ')
  })

  it('hiding only toggles a class, leaving the markup identical', () => {
    // This is what guarantees zero layout shift when the text is revealed.
    const shown = renderPassage(initTyping('cat'), { hidden: false })
    const hidden = renderPassage(initTyping('cat'), { hidden: true })
    expect(hidden.classList.contains('hidden')).toBe(true)
    expect(shown.classList.contains('hidden')).toBe(false)
    expect(hidden.innerHTML).toBe(shown.innerHTML)
  })
})
