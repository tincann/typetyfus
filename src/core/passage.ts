import { mulberry32 } from './rng'
import { WORDS } from './wordlist'

export const WORD_COUNTS = [20, 40, 60] as const
export const DEFAULT_WORD_COUNT = 40

/**
 * Deterministically draw `wordCount` words from WORDS for a given seed.
 *
 * The RNG is seeded from `seed` alone and never from `wordCount`, so passages
 * are prefix-stable: peers that briefly disagree on length still share text.
 */
export function generatePassage(seed: number, wordCount: number): string[] {
  const rand = mulberry32(seed)
  const out: string[] = []
  for (let i = 0; i < wordCount; i++) {
    out.push(WORDS[Math.floor(rand() * WORDS.length)]!)
  }
  return out
}

export function passageText(seed: number, wordCount: number): string {
  return generatePassage(seed, wordCount).join(' ')
}
