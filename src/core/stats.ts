export type RaceResult = { ms: number; wpm: number; acc: number }

const CHARS_PER_WORD = 5

/** Gross WPM: correct characters / 5, per minute. Rounded to one decimal. */
export function wpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || correctChars <= 0) return 0
  const words = correctChars / CHARS_PER_WORD
  const minutes = elapsedMs / 60_000
  return Math.round((words / minutes) * 10) / 10
}

/**
 * Correct keystrokes as a fraction of all keystrokes.
 *
 * Well-defined precisely because the input model blocks on errors: every
 * keystroke is either committed or rejected, with no third category.
 */
export function accuracy(correctChars: number, errors: number): number {
  const total = correctChars + errors
  if (total === 0) return 1
  return Math.round((correctChars / total) * 1000) / 1000
}
