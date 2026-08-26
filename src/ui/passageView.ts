import { el } from './dom'
import type { TypingState } from '../core/typing'

/**
 * Render the passage as one span per character.
 *
 * `hidden` adds a class and nothing else. The markup is byte-identical either
 * way, so revealing the text on GO cannot shift layout by a single pixel.
 *
 * The text is present in the DOM even while hidden. This is a UX feature, not
 * a security control — devtools defeats it trivially, and that is acceptable.
 *
 * Spaces are emitted as-is and kept visible by `white-space: pre-wrap` on
 * `.passage`. A non-breaking space would also stay visible, but it removes the
 * only legal line-break point and forces words to split mid-word.
 */
export function renderPassage(state: TypingState, opts: { hidden: boolean }): HTMLElement {
  const spans = [...state.text].map((ch, i) => {
    let cls = 'ch'
    if (i < state.cursor) cls += ' done'
    else if (i === state.cursor) cls += state.blocked === null ? ' current' : ' current error'
    return el('span', { class: cls }, [ch])
  })
  return el('div', { class: `passage${opts.hidden ? ' hidden' : ''}` }, spans)
}
