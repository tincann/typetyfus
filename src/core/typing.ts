export type TypingState = {
  readonly text: string
  /** Characters committed correctly. Committed text is immutable. */
  readonly cursor: number
  /** The wrong character currently blocking progress, or null. */
  readonly blocked: string | null
  /** Total rejected keystrokes across the whole attempt. */
  readonly errors: number
  readonly finished: boolean
}

export function initTyping(text: string): TypingState {
  return { text, cursor: 0, blocked: null, errors: 0, finished: text.length === 0 }
}

/** True for keys that represent a single typed character. */
function isPrintable(key: string): boolean {
  return [...key].length === 1
}

export function applyKey(s: TypingState, key: string): TypingState {
  if (s.finished) return s

  if (key === 'Backspace') {
    return s.blocked === null ? s : { ...s, blocked: null }
  }

  if (!isPrintable(key)) return s

  if (s.blocked !== null) {
    return { ...s, errors: s.errors + 1 }
  }

  if (key === s.text[s.cursor]) {
    const cursor = s.cursor + 1
    return { ...s, cursor, finished: cursor === s.text.length }
  }

  return { ...s, blocked: key, errors: s.errors + 1 }
}

export function progressRatio(s: TypingState): number {
  return s.text.length === 0 ? 1 : s.cursor / s.text.length
}
