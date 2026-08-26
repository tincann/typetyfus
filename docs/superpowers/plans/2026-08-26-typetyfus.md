# typetyfus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeRacer-style typing trainer with peer-to-peer multiplayer rooms, shipped as pure static assets on GitHub Pages with no backend of any kind.

**Architecture:** A Vite + TypeScript SPA split into three layers. `core/` is pure logic (seeded passage generation, the blocking-input typing reducer, scoring, race state) with no DOM and no network, so it is fully unit-testable. `net/` owns the WebRTC star topology: guests create offers, the host answers, and connection descriptions are carried between humans as compressed base64url codes rather than through a signaling server. `ui/` is thin DOM that reads state and dispatches events.

**Tech Stack:** Vite 5, TypeScript 5 (strict), Vitest, Playwright, native `RTCPeerConnection`, native `CompressionStream('deflate-raw')`, GitHub Actions → GitHub Pages.

**Spec:** [docs/superpowers/specs/2026-08-26-typetyfus-design.md](../specs/2026-08-26-typetyfus-design.md)

## Global Constraints

- **Static assets only.** No server at runtime. No signaling server, no TURN relay, no database, no API calls.
- **`base: './'`** in `vite.config.ts`. Never hardcode the repo name. Relative paths only.
- **No client-side routing.** Screen changes are in-app state, never URL paths. Nothing may write to `history.pushState`.
- **`core/` never imports from `net/` or `ui/`.** This is enforced by review, and any violation is a rejected task.
- **TypeScript `strict: true`.** No `any` in committed code except where interfacing with untyped browser APIs, and there it must be narrowed immediately.
- **Room cap: 6 players including the host.** A 7th joiner is refused with "room is full (6/6)" and receives no answer code.
- **Node 22** (matches the local toolchain and the CI workflow).
- **No runtime dependencies.** `package.json` `dependencies` stays empty; everything ships from `devDependencies`. Compression uses the platform `CompressionStream`, not a library.
- **Word count options: 20 / 40 / 60, default 40.**
- **ICE gathering timeout: 2.5s. Connection open timeout: 15s.** Both are hard requirements, not suggestions.
- **Progress broadcast rate: 10 Hz**, batched into a single `tick` message.
- **Solo history: last 10 results** in `localStorage`.

### Deviation from the spec, flagged for the reviewer

The spec's section 4 module map describes `sdp.ts` as "prune SDP → deflate-raw → base64url". **This plan drops the pruning step.** Pruning SDP by hand risks removing a line some browser needs, and deflate already exploits the heavy repetition in SDP text. Task 6 measures the real compressed size against a live offer; pruning gets added only if that measurement says the code is too long to paste. Reintroducing it later is a localized change inside `sdp.ts` with the roundtrip tests already in place.

---

## File Structure

| File | Responsibility |
|---|---|
| `vite.config.ts` | Build config. `base: './'`, Vitest config. |
| `.github/workflows/deploy.yml` | Test-gated build and deploy to Pages. |
| `src/core/rng.ts` | `mulberry32` seeded PRNG. Nothing else. |
| `src/core/wordlist.ts` | The 1000-word array. Data only, no logic. |
| `src/core/passage.ts` | Deterministic passage generation from a seed. |
| `src/core/typing.ts` | Blocking-input reducer. The heart of the app. |
| `src/core/stats.ts` | WPM and accuracy arithmetic. |
| `src/core/raceState.ts` | Race lifecycle + roster reducer. |
| `src/core/storage.ts` | `localStorage` read/write for nickname, settings, history. |
| `src/net/messages.ts` | Wire types + runtime guards. Sole source of truth for the protocol. |
| `src/net/sdp.ts` | Session description ⇄ pasteable code. |
| `src/net/peer.ts` | One `RTCPeerConnection` + data channel behind a `Transport` interface. |
| `src/net/room.ts` | Star topology. Host fans out; guest talks only to the host. |
| `src/ui/screens/*.ts` | One file per screen. |
| `src/ui/app.ts` | Screen switching and shared layout. |
| `src/main.ts` | Wiring and bootstrap. |
| `spike/sdp-length.html` | Standalone page that measures real compressed offer length. |
| `tests/e2e/race.spec.ts` | Playwright two-context smoke test. |

---

## Task 1: Scaffold, build config, and Pages deploy

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/core/rng.ts`, `tests/setup.md`
- Create: `.github/workflows/deploy.yml`
- Test: `src/core/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mulberry32(seed: number): () => number` from `src/core/rng.ts` — returns a function yielding floats in `[0, 1)`. Task 2 consumes it.

- [ ] **Step 1: Initialize the project**

```bash
npm init -y
npm i -D vite typescript vitest @types/node
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

`base: './'` is a global constraint — relative asset paths must work at any Pages sub-path.

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Set scripts in `package.json`**

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

- [ ] **Step 5: Write the failing test for the PRNG**

Create `src/core/rng.test.ts`. The properties that matter: the same seed reproduces the same stream (this is what lets peers sync a passage from one integer), different seeds diverge, and output stays in range.

```ts
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
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `npx vitest run src/core/rng.test.ts`
Expected: FAIL — cannot resolve `./rng`.

- [ ] **Step 7: Implement `src/core/rng.ts`**

```ts
/**
 * Mulberry32: a small, fast, seedable PRNG.
 *
 * Chosen because peers must generate byte-identical passages from a single
 * shared integer. `Math.random()` cannot be seeded, so it is unusable here.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

- [ ] **Step 8: Run the test and confirm it passes**

Run: `npx vitest run src/core/rng.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Create a minimal `index.html` and `src/main.ts`**

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>typetyfus</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:

```ts
const app = document.querySelector<HTMLDivElement>('#app')
if (app) app.textContent = 'typetyfus'
```

- [ ] **Step 10: Verify the build produces static output**

Run: `npm run build`
Expected: type check passes, `dist/index.html` and `dist/assets/*` exist. Confirm asset paths in `dist/index.html` start with `./`, not `/` — if they start with `/`, `base` is wrong and Pages will 404.

- [ ] **Step 11: Write `.github/workflows/deploy.yml`**

Tests gate the deploy: a red test must not reach production.

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 12: Commit and push**

```bash
git add -A
git commit -m "feat: scaffold Vite + TS + Vitest, seeded PRNG, Pages deploy

base: './' so assets resolve at any Pages sub-path. Tests gate the deploy
so a red build cannot ship."
git push
```

- [ ] **Step 13: Confirm the deploy actually ran**

Run: `gh run watch` (or check the Actions tab). Expected: green, and the Pages URL serves the placeholder. If Pages source is not yet set to "GitHub Actions" in repo settings, the deploy job fails with a permissions error — that setting is manual and must be done once by the repo owner.

---

## Task 2: Word list and deterministic passage generation

**Files:**
- Create: `src/core/wordlist.ts`, `src/core/passage.ts`
- Test: `src/core/passage.test.ts`

**Interfaces:**
- Consumes: `mulberry32(seed: number): () => number` from Task 1.
- Produces:
  - `WORDS: readonly string[]` from `src/core/wordlist.ts` — exactly 1000 lowercase words, letters only.
  - `generatePassage(seed: number, wordCount: number): string[]`
  - `passageText(seed: number, wordCount: number): string` — the words joined by single spaces. Every later task treats this string as the canonical race text.
  - `WORD_COUNTS: readonly [20, 40, 60]` and `DEFAULT_WORD_COUNT = 40`.

- [ ] **Step 1: Write `src/core/wordlist.ts`**

Write out the full array of 1000 words. Any standard public-domain English word-frequency list is a fine source. Apply these rules in order, so the outcome is not a judgement call:

1. Lowercase everything.
2. Drop any entry that does not match `/^[a-z]+$/` — this removes contractions, hyphenates and proper nouns. Apostrophes and capitals would change typing difficulty in ways the scoring model does not account for, and they complicate the blocking-input character comparison.
3. Deduplicate.
4. If fewer than 1000 remain, keep taking the next most common words until there are exactly 1000. If more, truncate to the first 1000.

The test in Step 2 asserts exactly 1000 unique entries all matching `/^[a-z]+$/`, so the target is verifiable rather than approximate.

```ts
/**
 * The 1000 most common English words, lowercase and letters-only.
 *
 * Deliberately excludes apostrophes and capitals: the typing reducer compares
 * raw characters, and punctuation would change difficulty without the scoring
 * model accounting for it.
 */
export const WORDS: readonly string[] = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it',
  // ... continue to exactly 1000 entries
]
```

- [ ] **Step 2: Write the failing tests for passage generation**

Create `src/core/passage.test.ts`. Determinism across "peers" is the property the whole multiplayer sync rests on, so it is tested first and most heavily.

```ts
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
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/core/passage.test.ts`
Expected: FAIL — cannot resolve `./passage`.

- [ ] **Step 4: Implement `src/core/passage.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/core/passage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/wordlist.ts src/core/passage.ts src/core/passage.test.ts
git commit -m "feat: deterministic passage generation from a seed

Peers sync a race with a single integer instead of shipping text. The RNG
is seeded from the seed alone, never the word count, so passages are
prefix-stable if peers briefly disagree on length."
```

---

## Task 3: The blocking-input typing reducer

This is the heart of the app and the place most likely to harbour subtle bugs. It is a pure reducer with no DOM involvement so it can be tested exhaustively.

**Files:**
- Create: `src/core/typing.ts`
- Test: `src/core/typing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TypingState = { text: string; cursor: number; blocked: string | null; errors: number; finished: boolean }`
  - `initTyping(text: string): TypingState`
  - `applyKey(state: TypingState, key: string): TypingState` — pure; returns a new object, never mutates.
  - `progressRatio(state: TypingState): number` — `0..1`, used by the race progress bars.

**Semantics, decided here so they are not re-litigated during implementation:**

- `cursor` is the count of characters committed correctly. Committed text is immutable.
- A correct keystroke advances `cursor`. A wrong keystroke sets `blocked` to the offending character and increments `errors`; `cursor` does not move.
- While `blocked` is non-null, the only key that changes anything is `Backspace`, which clears `blocked`. Every other key increments `errors` and stays blocked.
- `Backspace` when not blocked is a no-op. TypeRacer allows backspacing within the current word; this plan does not, because immutable committed text makes `cursor` an unambiguous progress measure for the multiplayer bars, which is the whole reason the blocking model was chosen.
- Keys that are not single characters (`Shift`, `Tab`, `Enter`, arrows) are ignored entirely — no cursor movement, no error.
- `finished` becomes true when `cursor === text.length`. A finished state ignores all further keys.

- [ ] **Step 1: Write the failing tests**

Create `src/core/typing.test.ts`.

```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/core/typing.test.ts`
Expected: FAIL — cannot resolve `./typing`.

- [ ] **Step 3: Implement `src/core/typing.ts`**

```ts
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
```

Note `isPrintable` uses spread rather than `key.length === 1` so that astral-plane characters (emoji) count as one key rather than two code units. The word list is ASCII, so such a key is always wrong — but it must be counted as exactly one error, not two.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/core/typing.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/core/typing.ts src/core/typing.test.ts
git commit -m "feat: blocking-input typing reducer

Committed text is immutable, so cursor is an unambiguous progress measure
for the multiplayer bars. Backspace only clears an error block; it cannot
rewind committed characters."
```

---

## Task 4: Scoring

**Files:**
- Create: `src/core/stats.ts`
- Test: `src/core/stats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `wpm(correctChars: number, elapsedMs: number): number` — rounded to one decimal.
  - `accuracy(correctChars: number, errors: number): number` — `0..1`, rounded to three decimals.
  - `type RaceResult = { ms: number; wpm: number; acc: number }` — reused verbatim by Tasks 7, 9, 10 and 12.

- [ ] **Step 1: Write the failing tests**

Create `src/core/stats.test.ts`. The divide-by-zero cases matter: a race can end at 0ms if someone finishes a one-character passage instantly, and accuracy is undefined before the first keystroke.

```ts
import { describe, it, expect } from 'vitest'
import { wpm, accuracy } from './stats'

describe('wpm', () => {
  it('uses the standard 5-characters-per-word definition', () => {
    // 300 correct chars = 60 words, in 60s = 60 wpm
    expect(wpm(300, 60_000)).toBe(60)
  })

  it('scales with elapsed time', () => {
    expect(wpm(300, 30_000)).toBe(120)
  })

  it('rounds to one decimal', () => {
    expect(wpm(100, 37_000)).toBe(32.4)
  })

  it('returns 0 rather than Infinity for zero elapsed time', () => {
    expect(wpm(100, 0)).toBe(0)
    expect(wpm(100, -5)).toBe(0)
  })

  it('returns 0 for no correct characters', () => {
    expect(wpm(0, 10_000)).toBe(0)
  })
})

describe('accuracy', () => {
  it('is 1 when there are no errors', () => {
    expect(accuracy(100, 0)).toBe(1)
  })

  it('divides correct by total keystrokes', () => {
    expect(accuracy(90, 10)).toBe(0.9)
  })

  it('rounds to three decimals', () => {
    expect(accuracy(2, 1)).toBe(0.667)
  })

  it('returns 1 before any keystroke rather than NaN', () => {
    expect(accuracy(0, 0)).toBe(1)
  })

  it('is 0 when nothing was ever correct', () => {
    expect(accuracy(0, 5)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/core/stats.test.ts`
Expected: FAIL — cannot resolve `./stats`.

- [ ] **Step 3: Implement `src/core/stats.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/core/stats.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/stats.ts src/core/stats.test.ts
git commit -m "feat: WPM and accuracy scoring

Both guard their divide-by-zero cases: zero elapsed time and zero
keystrokes are reachable states, not theoretical ones."
```

---

## Task 5: Local persistence

**Files:**
- Create: `src/core/storage.ts`
- Test: `src/core/storage.test.ts`

**Interfaces:**
- Consumes: `RaceResult` from Task 4.
- Produces:
  - `type StorageLike = Pick<Storage, 'getItem' | 'setItem'>`
  - `type Settings = { nick: string; wordCount: number }`
  - `createStorage(backend: StorageLike): AppStorage`
  - `type AppStorage = { loadSettings(): Settings; saveSettings(s: Settings): void; loadHistory(): RaceResult[]; pushResult(r: RaceResult): RaceResult[]; bestWpm(): number }`

`createStorage` takes its backend as a parameter rather than reaching for `localStorage` directly. That keeps the module testable under the `node` Vitest environment with no jsdom dependency, and it means a private-mode browser that throws on `localStorage` access can be handled at one call site instead of everywhere.

- [ ] **Step 1: Write the failing tests**

Create `src/core/storage.test.ts`. Corrupt and hostile stored values are the interesting cases: `localStorage` is user-editable, and a thrown `JSON.parse` on boot would leave the app with a blank screen.

```ts
import { describe, it, expect } from 'vitest'
import { createStorage, type StorageLike } from './storage'
import type { RaceResult } from './stats'

function fakeBackend(seed: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

const result = (wpm: number): RaceResult => ({ ms: 30_000, wpm, acc: 1 })

describe('settings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(createStorage(fakeBackend()).loadSettings())
      .toEqual({ nick: '', wordCount: 40 })
  })

  it('round-trips saved settings', () => {
    const s = createStorage(fakeBackend())
    s.saveSettings({ nick: 'morten', wordCount: 60 })
    expect(s.loadSettings()).toEqual({ nick: 'morten', wordCount: 60 })
  })

  it('falls back to defaults on unparseable JSON', () => {
    const s = createStorage(fakeBackend({ 'tt:settings': '{not json' }))
    expect(s.loadSettings()).toEqual({ nick: '', wordCount: 40 })
  })

  it('rejects a word count that is not one of the allowed options', () => {
    const s = createStorage(fakeBackend({ 'tt:settings': '{"nick":"x","wordCount":9999}' }))
    expect(s.loadSettings().wordCount).toBe(40)
  })

  it('coerces a non-string nickname', () => {
    const s = createStorage(fakeBackend({ 'tt:settings': '{"nick":42,"wordCount":20}' }))
    expect(s.loadSettings()).toEqual({ nick: '', wordCount: 20 })
  })
})

describe('history', () => {
  it('is empty by default', () => {
    expect(createStorage(fakeBackend()).loadHistory()).toEqual([])
  })

  it('stores most recent first', () => {
    const s = createStorage(fakeBackend())
    s.pushResult(result(50))
    s.pushResult(result(60))
    expect(s.loadHistory().map((r) => r.wpm)).toEqual([60, 50])
  })

  it('keeps only the last 10 results', () => {
    const s = createStorage(fakeBackend())
    for (let i = 1; i <= 15; i++) s.pushResult(result(i))
    const wpms = s.loadHistory().map((r) => r.wpm)
    expect(wpms).toHaveLength(10)
    expect(wpms[0]).toBe(15)
    expect(wpms[9]).toBe(6)
  })

  it('returns the trimmed list from pushResult', () => {
    const s = createStorage(fakeBackend())
    expect(s.pushResult(result(1))).toHaveLength(1)
  })

  it('falls back to empty on corrupt history', () => {
    expect(createStorage(fakeBackend({ 'tt:history': '[[[' })).loadHistory()).toEqual([])
  })

  it('discards a stored history that is not an array', () => {
    expect(createStorage(fakeBackend({ 'tt:history': '{"a":1}' })).loadHistory()).toEqual([])
  })
})

describe('bestWpm', () => {
  it('is 0 with no history', () => {
    expect(createStorage(fakeBackend()).bestWpm()).toBe(0)
  })

  it('is the maximum across stored results', () => {
    const s = createStorage(fakeBackend())
    for (const w of [40, 75, 60]) s.pushResult(result(w))
    expect(s.bestWpm()).toBe(75)
  })
})

describe('a backend that throws', () => {
  it('does not propagate write failures', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded') },
    }
    const s = createStorage(hostile)
    expect(() => s.saveSettings({ nick: 'a', wordCount: 20 })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/core/storage.test.ts`
Expected: FAIL — cannot resolve `./storage`.

- [ ] **Step 3: Implement `src/core/storage.ts`**

```ts
import { DEFAULT_WORD_COUNT, WORD_COUNTS } from './passage'
import type { RaceResult } from './stats'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
export type Settings = { nick: string; wordCount: number }

export type AppStorage = {
  loadSettings(): Settings
  saveSettings(s: Settings): void
  loadHistory(): RaceResult[]
  pushResult(r: RaceResult): RaceResult[]
  bestWpm(): number
}

const SETTINGS_KEY = 'tt:settings'
const HISTORY_KEY = 'tt:history'
const HISTORY_LIMIT = 10

const DEFAULT_SETTINGS: Settings = { nick: '', wordCount: DEFAULT_WORD_COUNT }

/** localStorage is user-editable, so every read is treated as untrusted. */
function readJson(backend: StorageLike, key: string): unknown {
  try {
    const raw = backend.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function isRaceResult(v: unknown): v is RaceResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r['ms'] === 'number'
    && typeof r['wpm'] === 'number'
    && typeof r['acc'] === 'number'
}

export function createStorage(backend: StorageLike): AppStorage {
  function write(key: string, value: unknown): void {
    // Private browsing and quota limits both throw here. Losing a preference
    // is not worth breaking the app over.
    try {
      backend.setItem(key, JSON.stringify(value))
    } catch { /* ignore */ }
  }

  function loadHistory(): RaceResult[] {
    const raw = readJson(backend, HISTORY_KEY)
    return Array.isArray(raw) ? raw.filter(isRaceResult).slice(0, HISTORY_LIMIT) : []
  }

  return {
    loadSettings(): Settings {
      const raw = readJson(backend, SETTINGS_KEY)
      if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS
      const o = raw as Record<string, unknown>
      const wordCount = o['wordCount']
      return {
        nick: typeof o['nick'] === 'string' ? o['nick'] : '',
        wordCount: WORD_COUNTS.includes(wordCount as never)
          ? (wordCount as number)
          : DEFAULT_WORD_COUNT,
      }
    },

    saveSettings(s: Settings): void {
      write(SETTINGS_KEY, s)
    },

    loadHistory,

    pushResult(r: RaceResult): RaceResult[] {
      const next = [r, ...loadHistory()].slice(0, HISTORY_LIMIT)
      write(HISTORY_KEY, next)
      return next
    },

    bestWpm(): number {
      return loadHistory().reduce((best, r) => Math.max(best, r.wpm), 0)
    },
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/core/storage.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/storage.ts src/core/storage.test.ts
git commit -m "feat: localStorage persistence for settings and history

Backend is injected, so this tests under the node environment with no
jsdom. Every read is validated because localStorage is user-editable, and
writes swallow quota and private-mode failures rather than breaking boot."
```

---

## Task 6: Solo practice — the first playable, deployable build

At the end of this task the deployed site is a working single-player typing trainer. Everything after it is multiplayer.

**Files:**
- Create: `src/ui/dom.ts`, `src/ui/passageView.ts`, `src/ui/screens/home.ts`, `src/ui/screens/solo.ts`, `src/styles.css`
- Modify: `src/main.ts`, `index.html`
- Test: `src/ui/passageView.test.ts` (run under jsdom)

**Interfaces:**
- Consumes: `passageText`, `WORD_COUNTS`, `DEFAULT_WORD_COUNT` (Task 2); `initTyping`, `applyKey`, `progressRatio`, `TypingState` (Task 3); `wpm`, `accuracy`, `RaceResult` (Task 4); `createStorage` (Task 5).
- Produces:
  - `el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, children?: (Node | string)[]): HTMLElementTagNameMap[K]`
  - `renderPassage(state: TypingState, opts: { hidden: boolean }): HTMLElement` — the shared passage renderer, reused by the race screen in Task 13.
  - `mountHome(root: HTMLElement, deps: HomeDeps): void`
  - `mountSolo(root: HTMLElement, deps: SoloDeps): void`

- [ ] **Step 1: Add jsdom for DOM-level tests**

```bash
npm i -D jsdom
```

Then extend `vite.config.ts` so DOM tests opt in per-file while `core/` keeps running under plain node:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    environmentMatchGlobs: [['src/ui/**', 'jsdom']],
  },
})
```

- [ ] **Step 2: Write the failing test for the passage renderer**

Create `src/ui/passageView.test.ts`. What matters is that the three character classes are correct and that hiding never changes the markup — only a class — so layout cannot shift on reveal.

```ts
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

  it('renders a space as a non-breaking space so it stays visible', () => {
    const node = renderPassage(initTyping('a b'), { hidden: false })
    expect([...node.querySelectorAll('span.ch')][1]!.textContent).toBe(' ')
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
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/ui/passageView.test.ts`
Expected: FAIL — cannot resolve `./passageView`.

- [ ] **Step 4: Implement `src/ui/dom.ts` and `src/ui/passageView.ts`**

`src/ui/dom.ts`:

```ts
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...children)
  return node
}

export function clear(root: HTMLElement): void {
  root.replaceChildren()
}
```

`src/ui/passageView.ts`:

```ts
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
 */
export function renderPassage(state: TypingState, opts: { hidden: boolean }): HTMLElement {
  const spans = [...state.text].map((ch, i) => {
    let cls = 'ch'
    if (i < state.cursor) cls += ' done'
    else if (i === state.cursor) cls += state.blocked === null ? ' current' : ' current error'
    // A raw space collapses and cannot carry a visible cursor or error box.
    return el('span', { class: cls }, [ch === ' ' ? ' ' : ch])
  })
  return el('div', { class: `passage${opts.hidden ? ' hidden' : ''}` }, spans)
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/ui/passageView.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write `src/styles.css`**

The blur reveal lives here. `filter` and `opacity` are both GPU-composited, so the transition is cheap and does not trigger layout.

```css
:root {
  --bg: #14161a;
  --fg: #e6e8eb;
  --dim: #6b7280;
  --done: #7dd3a0;
  --error: #f0616d;
  --accent: #5b9dff;
  color-scheme: dark;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
  display: flex;
  justify-content: center;
  padding: 3rem 1rem;
}

#app { width: min(70ch, 100%); }

h1 { font-size: 1.5rem; letter-spacing: -0.02em; }

button {
  font: inherit;
  padding: 0.5rem 1rem;
  border: 1px solid var(--dim);
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
button:disabled { opacity: 0.4; cursor: default; }

input, textarea {
  font: inherit;
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--dim);
  border-radius: 6px;
  background: #1c1f24;
  color: var(--fg);
}
textarea { font-family: ui-monospace, monospace; font-size: 0.8rem; }

.passage {
  font: 1.3rem/1.9 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--dim);
  word-break: break-word;
  user-select: none;
  padding: 1.25rem;
  border-radius: 8px;
  background: #1c1f24;
  /* Both properties are composited, so revealing costs no layout work. */
  transition: filter 220ms ease, opacity 220ms ease;
}
.passage.hidden { filter: blur(10px); opacity: 0.35; }

.ch.done { color: var(--done); }
.ch.current { background: rgba(91, 157, 255, 0.35); border-radius: 2px; }
.ch.current.error { background: var(--error); color: #fff; }

.row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
.stats { display: flex; gap: 1.5rem; margin: 1rem 0; font-variant-numeric: tabular-nums; }
.stat b { display: block; font-size: 1.6rem; font-weight: 600; }
.stat span { color: var(--dim); font-size: 0.8rem; text-transform: uppercase; }
.countdown { font-size: 3rem; text-align: center; font-variant-numeric: tabular-nums; }
.muted { color: var(--dim); font-size: 0.9rem; }
```

Reference it from `index.html`:

```html
<link rel="stylesheet" href="/src/styles.css" />
```

- [ ] **Step 7: Implement `src/ui/screens/solo.ts`**

The countdown-then-reveal sequence is the whole point of the "hidden until GO" decision, so it lives in one readable block.

```ts
import { el, clear } from '../dom'
import { renderPassage } from '../passageView'
import { passageText } from '../../core/passage'
import { initTyping, applyKey, type TypingState } from '../../core/typing'
import { wpm, accuracy, type RaceResult } from '../../core/stats'
import type { AppStorage } from '../../core/storage'

export type SoloDeps = {
  storage: AppStorage
  wordCount: number
  onExit: () => void
}

const COUNTDOWN_FROM = 3

export function mountSolo(root: HTMLElement, deps: SoloDeps): void {
  const seed = Math.floor(Math.random() * 2 ** 31)
  const text = passageText(seed, deps.wordCount)

  let state: TypingState = initTyping(text)
  let startedAt: number | null = null
  let counting = COUNTDOWN_FROM
  let raf = 0
  let timer = 0

  const passageBox = el('div')
  const countdownBox = el('div', { class: 'countdown' })
  const wpmOut = el('b', {}, ['0'])
  const accOut = el('b', {}, ['100%'])
  const restart = el('button', {}, ['Restart'])
  const back = el('button', {}, ['Back'])

  function draw(): void {
    clear(passageBox)
    passageBox.append(renderPassage(state, { hidden: startedAt === null }))
    const elapsed = startedAt === null ? 0 : performance.now() - startedAt
    wpmOut.textContent = String(wpm(state.cursor, elapsed))
    accOut.textContent = `${Math.round(accuracy(state.cursor, state.errors) * 100)}%`
  }

  function tick(): void {
    if (state.finished) return
    draw()
    raf = requestAnimationFrame(tick)
  }

  function onKey(e: KeyboardEvent): void {
    if (startedAt === null || state.finished) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Space scrolls the page and Tab moves focus; neither is wanted mid-race.
    if (e.key === ' ' || e.key === 'Tab' || e.key === 'Backspace') e.preventDefault()
    const next = applyKey(state, e.key)
    if (next === state) return
    state = next
    if (state.finished) finish()
  }

  function finish(): void {
    cancelAnimationFrame(raf)
    const ms = performance.now() - (startedAt ?? performance.now())
    const result: RaceResult = {
      ms: Math.round(ms),
      wpm: wpm(state.cursor, ms),
      acc: accuracy(state.cursor, state.errors),
    }
    deps.storage.pushResult(result)
    draw()
    countdownBox.textContent = `${result.wpm} wpm · ${Math.round(result.acc * 100)}% accurate`
  }

  function startCountdown(): void {
    counting = COUNTDOWN_FROM
    countdownBox.textContent = String(counting)
    timer = window.setInterval(() => {
      counting -= 1
      if (counting > 0) {
        countdownBox.textContent = String(counting)
        return
      }
      window.clearInterval(timer)
      countdownBox.textContent = ''
      startedAt = performance.now()
      draw()
      tick()
    }, 1000)
  }

  function teardown(): void {
    window.clearInterval(timer)
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKey)
  }

  restart.addEventListener('click', () => {
    teardown()
    mountSolo(root, deps)
  })
  back.addEventListener('click', () => {
    teardown()
    deps.onExit()
  })
  window.addEventListener('keydown', onKey)

  clear(root)
  root.append(
    el('div', { class: 'stats' }, [
      el('div', { class: 'stat' }, [wpmOut, el('span', {}, ['wpm'])]),
      el('div', { class: 'stat' }, [accOut, el('span', {}, ['accuracy'])]),
    ]),
    countdownBox,
    passageBox,
    el('p', { class: 'muted' }, ['The text is hidden until the countdown ends.']),
    el('div', { class: 'row' }, [restart, back]),
  )

  draw()
  startCountdown()
}
```

- [ ] **Step 8: Implement `src/ui/screens/home.ts`**

```ts
import { el, clear } from '../dom'
import { WORD_COUNTS } from '../../core/passage'
import type { AppStorage } from '../../core/storage'

export type HomeDeps = {
  storage: AppStorage
  onSolo: (wordCount: number) => void
  onHost: (nick: string, wordCount: number) => void
  onJoin: (nick: string) => void
}

export function mountHome(root: HTMLElement, deps: HomeDeps): void {
  const settings = deps.storage.loadSettings()

  const nick = el('input', { placeholder: 'nickname', value: settings.nick, maxlength: '16' })
  const counts = el('div', { class: 'row' })
  let wordCount = settings.wordCount

  function persist(): void {
    deps.storage.saveSettings({ nick: nick.value.trim(), wordCount })
  }

  function renderCounts(): void {
    clear(counts)
    for (const n of WORD_COUNTS) {
      const b = el('button', n === wordCount ? { 'aria-pressed': 'true' } : {}, [`${n} words`])
      b.addEventListener('click', () => { wordCount = n; persist(); renderCounts() })
      counts.append(b)
    }
  }
  renderCounts()

  const solo = el('button', {}, ['Practice solo'])
  const host = el('button', {}, ['Create room'])
  const join = el('button', {}, ['Join a room'])

  solo.addEventListener('click', () => { persist(); deps.onSolo(wordCount) })
  host.addEventListener('click', () => { persist(); deps.onHost(nick.value.trim() || 'host', wordCount) })
  join.addEventListener('click', () => { persist(); deps.onJoin(nick.value.trim() || 'guest') })

  const history = deps.storage.loadHistory()
  const best = deps.storage.bestWpm()

  clear(root)
  root.append(
    el('h1', {}, ['typetyfus']),
    el('p', { class: 'muted' }, ['Type fast. The text stays hidden until GO.']),
    nick,
    counts,
    el('div', { class: 'row' }, [solo, host, join]),
    el('p', { class: 'muted' }, [
      best > 0
        ? `Best ${best} wpm · last ${history.length} race${history.length === 1 ? '' : 's'} saved`
        : 'No races yet.',
    ]),
  )
}
```

- [ ] **Step 9: Wire `src/main.ts`**

Host and join buttons are stubbed until Task 12. Screen changes are in-app state only — nothing touches the URL.

```ts
import './styles.css'
import { createStorage } from './core/storage'
import { mountHome } from './ui/screens/home'
import { mountSolo } from './ui/screens/solo'

const root = document.querySelector<HTMLDivElement>('#app')!
const storage = createStorage(localStorage)

function home(): void {
  mountHome(root, {
    storage,
    onSolo: (wordCount) => mountSolo(root, { storage, wordCount, onExit: home }),
    onHost: () => alert('Rooms arrive in a later task.'),
    onJoin: () => alert('Rooms arrive in a later task.'),
  })
}

home()
```

- [ ] **Step 10: Play it**

Run: `npm run dev`, open the printed URL. Verify by hand: the passage is blurred during the 3-2-1, sharpens on GO, a wrong key turns the current character red and refuses to advance, Backspace clears it, finishing shows WPM, and reloading Home shows the recorded best.

- [ ] **Step 11: Run the whole suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 12: Commit and push**

```bash
git add -A
git commit -m "feat: playable solo typing practice

First deployable build. Hiding the passage is a class toggle over identical
markup, so revealing on GO cannot shift layout."
git push
```

- [ ] **Step 13: Verify the deployed site**

Open the Pages URL. Confirm solo practice works there, not just locally — this is the first real check that `base: './'` resolves assets correctly under a repo sub-path.

---

## Task 7: Session descriptions ⇄ pasteable codes, and the size spike

The spec names this the one open risk. Do it before any join UI exists, because if a code turns out to be too long to paste the join flow changes shape.

**Files:**
- Create: `src/net/sdp.ts`, `spike/sdp-length.html`
- Test: `src/net/sdp.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `encodeSignal(desc: RTCSessionDescriptionInit): Promise<string>` — base64url, no padding.
  - `decodeSignal(code: string): Promise<RTCSessionDescriptionInit>` — throws `SignalDecodeError` on anything malformed.
  - `class SignalDecodeError extends Error`

- [ ] **Step 1: Write the failing tests**

Create `src/net/sdp.test.ts`. Node 22 ships `CompressionStream`, so these run headless with no browser. The fixture is a realistic data-channel-only offer; keep it representative rather than minimal, since the compression-ratio assertion is meaningless on a toy string.

```ts
import { describe, it, expect } from 'vitest'
import { encodeSignal, decodeSignal, SignalDecodeError } from './sdp'

const SDP = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=candidate:1510613869 1 udp 2113937151 192.168.1.24 55555 typ host generation 0 network-cost 999
a=candidate:842163049 1 udp 1677729535 81.23.44.9 55555 typ srflx raddr 192.168.1.24 rport 55555 generation 0 network-cost 999
a=ice-ufrag:aB3d
a=ice-pwd:0123456789abcdef0123456789
a=ice-options:trickle
a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
`

describe('encodeSignal / decodeSignal', () => {
  it('round-trips an offer exactly', async () => {
    const desc = { type: 'offer' as const, sdp: SDP }
    expect(await decodeSignal(await encodeSignal(desc))).toEqual(desc)
  })

  it('round-trips an answer exactly', async () => {
    const desc = { type: 'answer' as const, sdp: SDP }
    expect(await decodeSignal(await encodeSignal(desc))).toEqual(desc)
  })

  it('produces URL- and chat-safe characters only', async () => {
    expect(await encodeSignal({ type: 'offer', sdp: SDP })).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('compresses substantially — this is what makes the code pasteable', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: SDP })
    expect(code.length).toBeLessThan(SDP.length * 0.6)
  })

  it('rejects a code that is not base64url', async () => {
    await expect(decodeSignal('not valid!!')).rejects.toThrow(SignalDecodeError)
  })

  it('rejects base64url that does not inflate', async () => {
    await expect(decodeSignal('aGVsbG8')).rejects.toThrow(SignalDecodeError)
  })

  it('rejects an empty code', async () => {
    await expect(decodeSignal('')).rejects.toThrow(SignalDecodeError)
  })

  it('rejects inflated content with the wrong shape', async () => {
    // Valid deflate of valid JSON, but not a session description.
    const bogus = await encodeSignal({ type: 'offer', sdp: SDP })
    const tampered = bogus.slice(0, -4)
    await expect(decodeSignal(tampered)).rejects.toThrow(SignalDecodeError)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/net/sdp.test.ts`
Expected: FAIL — cannot resolve `./sdp`.

- [ ] **Step 3: Implement `src/net/sdp.ts`**

No SDP pruning — see the deviation note at the top of this plan. Compression alone is expected to be sufficient, and Step 6 measures whether that holds.

```ts
export class SignalDecodeError extends Error {
  constructor(cause?: unknown) {
    super("That doesn't look like a valid code. Check you copied all of it.")
    this.name = 'SignalDecodeError'
    this.cause = cause
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as never)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): Uint8Array {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/**
 * Pack a session description into a string a human can paste into a chat.
 *
 * SDP is extremely repetitive, so deflate does most of the work; base64url
 * keeps the result safe in URLs, chat clients and shells.
 */
export async function encodeSignal(desc: RTCSessionDescriptionInit): Promise<string> {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp ?? '' })
  const deflated = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  return toBase64Url(deflated)
}

export async function decodeSignal(code: string): Promise<RTCSessionDescriptionInit> {
  const trimmed = code.trim()
  if (trimmed === '' || !/^[A-Za-z0-9_-]+$/.test(trimmed)) throw new SignalDecodeError()
  try {
    const inflated = await pipe(fromBase64Url(trimmed), new DecompressionStream('deflate-raw'))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(inflated))
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    const o = parsed as Record<string, unknown>
    if ((o['t'] !== 'offer' && o['t'] !== 'answer') || typeof o['s'] !== 'string') {
      throw new Error('wrong shape')
    }
    return { type: o['t'], sdp: o['s'] }
  } catch (cause) {
    throw new SignalDecodeError(cause)
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/net/sdp.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write `spike/sdp-length.html`**

Unit tests use a fixture. This measures a *real* offer from a real browser against a real STUN server, which is the number the design actually depends on.

```html
<!doctype html>
<meta charset="utf-8" />
<title>SDP length spike</title>
<body style="font: 14px system-ui; padding: 2rem">
  <h1>SDP length spike</h1>
  <pre id="out">measuring…</pre>
  <textarea id="code" rows="6" style="width:100%"></textarea>
  <script type="module">
    import { encodeSignal } from '/src/net/sdp.ts'

    const out = document.querySelector('#out')
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pc.createDataChannel('race')
    await pc.setLocalDescription(await pc.createOffer())

    const t0 = performance.now()
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve()
      const done = () => { if (pc.iceGatheringState === 'complete') resolve() }
      pc.addEventListener('icegatheringstatechange', done)
      setTimeout(resolve, 2500)
    })
    const gatherMs = Math.round(performance.now() - t0)

    const sdp = pc.localDescription.sdp
    const code = await encodeSignal(pc.localDescription)
    const candidates = sdp.split('\n').filter((l) => l.startsWith('a=candidate')).length

    out.textContent = [
      `gathering:       ${gatherMs} ms (state: ${pc.iceGatheringState})`,
      `candidates:      ${candidates}`,
      `raw SDP:         ${sdp.length} chars`,
      `encoded code:    ${code.length} chars`,
      `ratio:           ${(code.length / sdp.length).toFixed(2)}`,
      ``,
      code.length <= 1500 ? 'PASTEABLE — design holds.' : 'TOO LONG — revisit the join flow.',
    ].join('\n')
    document.querySelector('#code').value = code
  </script>
</body>
```

- [ ] **Step 6: Run the spike and record the number**

Run `npm run dev`, open `/spike/sdp-length.html`. Record the encoded length and gathering time in the commit message.

**Decision gate:**
- **≤ 1500 chars:** the design holds. Continue to Task 8.
- **> 1500 chars:** stop and report before continuing. Mitigations in order of preference — prune `a=extmap`/`a=ice-options`/TCP host candidates in `sdp.ts` (localized, tests already cover the roundtrip), or drop `stun:` and rely on host candidates for LAN-only play, or split the code across two paste fields. Each changes the join UX, so this is a conversation, not a unilateral fix.

Also confirm gathering completes well inside 2.5s. If it routinely hits the timeout, the constant needs revisiting.

- [ ] **Step 7: Commit**

```bash
git add src/net/sdp.ts src/net/sdp.test.ts spike/sdp-length.html
git commit -m "feat: compress session descriptions into pasteable codes

deflate-raw + base64url via platform APIs, no dependency. Includes a spike
page measuring a real browser offer, since the fixture-based tests cannot
tell us whether a real code is pasteable.

Measured: <FILL IN> chars encoded, <FILL IN> ms gathering."
```

---

## Task 8: The wire protocol

`messages.ts` is the single source of truth for the protocol. Nothing else may parse a raw message.

**Files:**
- Create: `src/core/ids.ts`, `src/net/messages.ts`
- Test: `src/net/messages.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PeerId`, `Phase`, `PeerInfo` from `src/core/ids.ts` (re-exported by `messages.ts` for convenience), plus `GuestMsg` and `HostMsg` types, plus `parseGuestMsg(raw: unknown): GuestMsg | null` and `parseHostMsg(raw: unknown): HostMsg | null`. Both return `null` rather than throwing — a malformed message from a peer must be dropped, never allowed to crash a race in progress.

- [ ] **Step 1: Write the failing tests**

Create `src/net/messages.test.ts`. Peers are untrusted input, so hostile shapes get as much attention as valid ones.

```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/net/messages.test.ts`
Expected: FAIL — cannot resolve `./messages`.

- [ ] **Step 3: Implement `src/core/ids.ts`**

These three types are needed by both `core/raceState.ts` and `net/messages.ts`. They live in `core/` because the global constraint forbids `core/` importing from `net/` — defining them in `messages.ts` would invert that dependency.

```ts
export type PeerId = string
export type Phase = 'lobby' | 'countdown' | 'running' | 'finished'
export type PeerInfo = { id: PeerId; nick: string; connected: boolean }
```

- [ ] **Step 4: Implement `src/net/messages.ts`**

```ts
import { WORD_COUNTS } from '../core/passage'
import type { PeerId, Phase, PeerInfo } from '../core/ids'

export type { PeerId, Phase, PeerInfo }

export const MAX_NICK = 16
export const MAX_PEERS = 6

export type GuestMsg =
  | { t: 'hello'; nick: string }
  | { t: 'ping'; id: number }
  | { t: 'progress'; charIndex: number; errors: number }
  | { t: 'done'; ms: number; wpm: number; acc: number }

export type HostMsg =
  | { t: 'room'; seed: number; wordCount: number; phase: Phase; peers: PeerInfo[]; you: PeerId }
  | { t: 'pong'; id: number }
  | { t: 'start'; inMs: number }
  | { t: 'tick'; p: Array<[PeerId, number, number]> }
  | { t: 'peers'; peers: PeerInfo[] }
  | { t: 'done'; id: PeerId; ms: number; wpm: number; acc: number }
  | { t: 'reset'; seed: number; wordCount: number }

const PHASES: readonly string[] = ['lobby', 'countdown', 'running', 'finished']

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Finite and non-negative. Rejects NaN, Infinity and negatives in one place. */
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 32
const nick = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_NICK
const count = (v: unknown): v is number => WORD_COUNTS.includes(v as never)

function peerInfo(v: unknown): v is PeerInfo {
  const o = rec(v)
  return o !== null && id(o['id']) && nick(o['nick']) && typeof o['connected'] === 'boolean'
}

function peerList(v: unknown): v is PeerInfo[] {
  return Array.isArray(v) && v.length <= MAX_PEERS && v.every(peerInfo)
}

export function parseGuestMsg(raw: unknown): GuestMsg | null {
  const o = rec(raw)
  if (o === null) return null
  switch (o['t']) {
    case 'hello':
      return nick(o['nick']) ? { t: 'hello', nick: o['nick'] } : null
    case 'ping':
      return num(o['id']) ? { t: 'ping', id: o['id'] } : null
    case 'progress':
      return num(o['charIndex']) && num(o['errors'])
        ? { t: 'progress', charIndex: o['charIndex'], errors: o['errors'] }
        : null
    case 'done':
      return num(o['ms']) && num(o['wpm']) && num(o['acc'])
        ? { t: 'done', ms: o['ms'], wpm: o['wpm'], acc: o['acc'] }
        : null
    default:
      return null
  }
}

export function parseHostMsg(raw: unknown): HostMsg | null {
  const o = rec(raw)
  if (o === null) return null
  switch (o['t']) {
    case 'room':
      return num(o['seed']) && count(o['wordCount'])
        && typeof o['phase'] === 'string' && PHASES.includes(o['phase'])
        && peerList(o['peers']) && id(o['you'])
        ? { t: 'room', seed: o['seed'], wordCount: o['wordCount'],
            phase: o['phase'] as Phase, peers: o['peers'], you: o['you'] }
        : null
    case 'pong':
      return num(o['id']) ? { t: 'pong', id: o['id'] } : null
    case 'start':
      return num(o['inMs']) ? { t: 'start', inMs: o['inMs'] } : null
    case 'tick': {
      const p = o['p']
      if (!Array.isArray(p) || p.length > MAX_PEERS) return null
      const ok = p.every((e) => Array.isArray(e) && e.length === 3 && id(e[0]) && num(e[1]) && num(e[2]))
      return ok ? { t: 'tick', p: p as Array<[PeerId, number, number]> } : null
    }
    case 'peers':
      return peerList(o['peers']) ? { t: 'peers', peers: o['peers'] } : null
    case 'done':
      return id(o['id']) && num(o['ms']) && num(o['wpm']) && num(o['acc'])
        ? { t: 'done', id: o['id'], ms: o['ms'], wpm: o['wpm'], acc: o['acc'] }
        : null
    case 'reset':
      return num(o['seed']) && count(o['wordCount'])
        ? { t: 'reset', seed: o['seed'], wordCount: o['wordCount'] }
        : null
    default:
      return null
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/net/messages.test.ts`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add src/core/ids.ts src/net/messages.ts src/net/messages.test.ts
git commit -m "feat: wire protocol types and runtime guards

Parsers return null instead of throwing: a malformed message from a peer
must be dropped, never allowed to crash a race in progress."
```

---

## Task 9: The peer connection wrapper

Wraps one `RTCPeerConnection` plus its data channel behind a `Transport` interface, so `room.ts` in Task 11 can be tested with fake transports and never touches WebRTC directly.

**Files:**
- Create: `src/net/peer.ts`
- Test: `src/net/peer.test.ts`

**Interfaces:**
- Consumes: `encodeSignal`, `decodeSignal` (Task 7).
- Produces:
  - `interface Transport { send(msg: unknown): void; close(): void; readonly isOpen: boolean; onOpen(fn: () => void): void; onMessage(fn: (raw: unknown) => void): void; onClose(fn: () => void): void }`
  - `startOffer(): Promise<{ offerCode: string; transport: Transport; acceptAnswer(answerCode: string): Promise<void> }>` — the **guest** side.
  - `answerOffer(offerCode: string): Promise<{ answerCode: string; transport: Transport }>` — the **host** side.
  - `waitForIceGathering(pc: IceGatheringSource, timeoutMs: number): Promise<void>`
  - `type IceGatheringSource = Pick<RTCPeerConnection, 'iceGatheringState' | 'addEventListener' | 'removeEventListener'>`
  - `ICE_TIMEOUT_MS = 2500`, `CONNECT_TIMEOUT_MS = 15000`, `class ConnectTimeoutError extends Error`

`RTCPeerConnection` does not exist in Node, so only `waitForIceGathering` is unit-tested here — hence it takes a narrow structural type rather than a concrete `RTCPeerConnection`. The full handshake is covered by the Playwright test in Task 14.

- [ ] **Step 1: Write the failing tests**

Create `src/net/peer.test.ts`.

```ts
import { describe, it, expect, vi } from 'vitest'
import { waitForIceGathering, type IceGatheringSource } from './peer'

/** Minimal stand-in for the slice of RTCPeerConnection we depend on. */
function fakePc(initial: RTCIceGatheringState): IceGatheringSource & { settle(): void } {
  const listeners = new Set<EventListenerOrEventListenerObject>()
  let state = initial
  return {
    get iceGatheringState() { return state },
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
    settle() {
      state = 'complete'
      for (const fn of listeners) (fn as EventListener)(new Event('icegatheringstatechange'))
    },
  } as IceGatheringSource & { settle(): void }
}

describe('waitForIceGathering', () => {
  it('resolves immediately when gathering is already complete', async () => {
    await expect(waitForIceGathering(fakePc('complete'), 2500)).resolves.toBeUndefined()
  })

  it('resolves when gathering completes before the timeout', async () => {
    const pc = fakePc('gathering')
    const pending = waitForIceGathering(pc, 2500)
    pc.settle()
    await expect(pending).resolves.toBeUndefined()
  })

  it('resolves rather than rejecting when the timeout fires', async () => {
    // Timing out is normal, not exceptional: we send whatever candidates we
    // gathered. Rejecting here would strand a joiner who is merely on a slow
    // network.
    vi.useFakeTimers()
    const pending = waitForIceGathering(fakePc('gathering'), 2500)
    vi.advanceTimersByTime(2500)
    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('removes its listener once settled', async () => {
    const pc = fakePc('gathering')
    const spy = vi.spyOn(pc, 'removeEventListener')
    const pending = waitForIceGathering(pc, 2500)
    pc.settle()
    await pending
    expect(spy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/net/peer.test.ts`
Expected: FAIL — cannot resolve `./peer`.

- [ ] **Step 3: Implement `src/net/peer.ts`**

```ts
import { encodeSignal, decodeSignal } from './sdp'

export const ICE_TIMEOUT_MS = 2500
export const CONNECT_TIMEOUT_MS = 15_000

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export class ConnectTimeoutError extends Error {
  constructor() {
    super(
      "Couldn't establish a direct connection. This happens when both networks " +
      'block peer-to-peer traffic; a relay server would be needed, and this app ' +
      'deliberately has no server.',
    )
    this.name = 'ConnectTimeoutError'
  }
}

export interface Transport {
  send(msg: unknown): void
  close(): void
  readonly isOpen: boolean
  onOpen(fn: () => void): void
  onMessage(fn: (raw: unknown) => void): void
  onClose(fn: () => void): void
}

export type IceGatheringSource =
  Pick<RTCPeerConnection, 'iceGatheringState' | 'addEventListener' | 'removeEventListener'>

/**
 * Wait for ICE gathering to finish, capped by a timeout.
 *
 * Manual signalling cannot deliver trickled candidates, so the code cannot be
 * produced until gathering settles. A timeout is not an error: we emit the
 * code with whatever candidates we have, which is usually enough.
 */
export function waitForIceGathering(pc: IceGatheringSource, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = (): void => { if (pc.iceGatheringState === 'complete') done() }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

function wrap(pc: RTCPeerConnection, channel: RTCDataChannel): Transport {
  const openFns: Array<() => void> = []
  const msgFns: Array<(raw: unknown) => void> = []
  const closeFns: Array<() => void> = []
  let closed = false

  const fail = setTimeout(() => {
    if (channel.readyState !== 'open') { shutdown() }
  }, CONNECT_TIMEOUT_MS)

  function shutdown(): void {
    if (closed) return
    closed = true
    clearTimeout(fail)
    try { channel.close(); pc.close() } catch { /* already gone */ }
    for (const fn of closeFns) fn()
  }

  channel.addEventListener('open', () => {
    clearTimeout(fail)
    for (const fn of openFns) fn()
  })
  channel.addEventListener('close', shutdown)
  channel.addEventListener('message', (e) => {
    // A peer can send anything. Parse defensively; validation is messages.ts's job.
    let parsed: unknown
    try { parsed = JSON.parse(String(e.data)) } catch { return }
    for (const fn of msgFns) fn(parsed)
  })
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') shutdown()
  })

  return {
    get isOpen() { return !closed && channel.readyState === 'open' },
    send(msg) { if (channel.readyState === 'open') channel.send(JSON.stringify(msg)) },
    close: shutdown,
    onOpen(fn) { openFns.push(fn) },
    onMessage(fn) { msgFns.push(fn) },
    onClose(fn) { closeFns.push(fn) },
  }
}

/** Guest side: create the offer, hand the code to a human, await the answer. */
export async function startOffer(): Promise<{
  offerCode: string
  transport: Transport
  acceptAnswer(answerCode: string): Promise<void>
}> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const channel = pc.createDataChannel('race', { ordered: true })
  await pc.setLocalDescription(await pc.createOffer())
  await waitForIceGathering(pc, ICE_TIMEOUT_MS)

  return {
    offerCode: await encodeSignal(pc.localDescription!),
    transport: wrap(pc, channel),
    async acceptAnswer(answerCode: string): Promise<void> {
      await pc.setRemoteDescription(await decodeSignal(answerCode))
    },
  }
}

/** Host side: consume a guest's offer and produce the answer code. */
export async function answerOffer(offerCode: string): Promise<{
  answerCode: string
  transport: Transport
}> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const channelReady = new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener('datachannel', (e) => resolve(e.channel))
  })

  await pc.setRemoteDescription(await decodeSignal(offerCode))
  await pc.setLocalDescription(await pc.createAnswer())
  await waitForIceGathering(pc, ICE_TIMEOUT_MS)

  return {
    answerCode: await encodeSignal(pc.localDescription!),
    transport: wrap(pc, await channelReady),
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/net/peer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify a real handshake by hand**

Temporarily expose `startOffer`/`answerOffer` on `window` in `main.ts`, open two browser tabs, and paste codes between their consoles until a channel opens and a message crosses. Remove the temporary exposure before committing. This is the first proof the handshake works at all; Task 14 automates it.

- [ ] **Step 6: Commit**

```bash
git add src/net/peer.ts src/net/peer.test.ts
git commit -m "feat: RTCPeerConnection wrapper behind a Transport interface

Guests offer and hosts answer, so the host can share one stable URL. ICE
gathering timing out is treated as normal and emits partial candidates;
a 15s open timeout surfaces the no-TURN failure honestly instead of hanging."
```

---

## Task 10: Race state reducer

Pure, and shared by both host and guest so their views of a race cannot drift apart in logic — only in the events they receive.

**Files:**
- Create: `src/core/raceState.ts`
- Test: `src/core/raceState.test.ts`

**Interfaces:**
- Consumes: `PeerId`, `Phase` from `src/core/ids.ts` (Task 8) — **not** from `net/messages.ts`, which would violate the layering constraint; `RaceResult` (Task 4).
- Produces:
  - `type Racer = { id: PeerId; nick: string; connected: boolean; charIndex: number; errors: number; result: RaceResult | null }`
  - `type RaceState = { phase: Phase; seed: number; wordCount: number; racers: Racer[] }`
  - `type RaceEvent` (see implementation)
  - `initRace(seed: number, wordCount: number): RaceState`
  - `raceReducer(s: RaceState, e: RaceEvent): RaceState`
  - `standings(s: RaceState): Racer[]`

**Rules, decided here:**

- Joining is refused once 6 racers are present. The reducer returns the state unchanged.
- A race auto-advances to `finished` when every *connected* racer has a result. A disconnected racer never blocks the finish.
- Progress from a racer who already has a result is ignored.
- `standings` sorts finishers first by time ascending, then unfinished by `charIndex` descending, then disconnected last.

- [ ] **Step 1: Write the failing tests**

Create `src/core/raceState.test.ts`.

```ts
import { describe, it, expect } from 'vitest'
import { initRace, raceReducer, standings, type RaceState, type RaceEvent } from './raceState'
import type { RaceResult } from './stats'

const run = (s: RaceState, ...events: RaceEvent[]) => events.reduce(raceReducer, s)
const base = () => initRace(42, 40)
const res = (ms: number): RaceResult => ({ ms, wpm: 60, acc: 1 })
const join = (id: string, nick = id): RaceEvent => ({ t: 'join', id, nick })

describe('initRace', () => {
  it('starts in lobby with no racers', () => {
    expect(base()).toEqual({ phase: 'lobby', seed: 42, wordCount: 40, racers: [] })
  })
})

describe('join and leave', () => {
  it('adds a racer at zero progress', () => {
    const s = run(base(), join('a'))
    expect(s.racers).toEqual([
      { id: 'a', nick: 'a', connected: true, charIndex: 0, errors: 0, result: null },
    ])
  })

  it('ignores a duplicate id', () => {
    const s = run(base(), join('a'), join('a', 'other'))
    expect(s.racers).toHaveLength(1)
    expect(s.racers[0]!.nick).toBe('a')
  })

  it('refuses a 7th racer', () => {
    let s = base()
    for (let i = 0; i < 6; i++) s = raceReducer(s, join(`p${i}`))
    const full = raceReducer(s, join('p6'))
    expect(full.racers).toHaveLength(6)
    expect(full).toBe(s)
  })

  it('marks a leaver disconnected rather than removing them', () => {
    // Their partial progress still belongs on the results table.
    const s = run(base(), join('a'), { t: 'leave', id: 'a' })
    expect(s.racers[0]!.connected).toBe(false)
  })
})

describe('progress', () => {
  it('records the latest position', () => {
    const s = run(base(), join('a'), { t: 'progress', id: 'a', charIndex: 12, errors: 2 })
    expect(s.racers[0]).toMatchObject({ charIndex: 12, errors: 2 })
  })

  it('ignores progress from an unknown racer', () => {
    const s = run(base(), join('a'))
    expect(raceReducer(s, { t: 'progress', id: 'ghost', charIndex: 5, errors: 0 })).toBe(s)
  })

  it('ignores progress from a racer who already finished', () => {
    const s = run(base(), join('a'), { t: 'start' }, { t: 'finish', id: 'a', result: res(100) })
    expect(raceReducer(s, { t: 'progress', id: 'a', charIndex: 99, errors: 0 }).racers[0]!.charIndex)
      .toBe(0)
  })
})

describe('phase transitions', () => {
  it('goes lobby → countdown → running', () => {
    expect(run(base(), { t: 'countdown' }).phase).toBe('countdown')
    expect(run(base(), { t: 'countdown' }, { t: 'start' }).phase).toBe('running')
  })

  it('finishes when every connected racer has a result', () => {
    const s = run(base(), join('a'), join('b'), { t: 'start' },
      { t: 'finish', id: 'a', result: res(100) })
    expect(s.phase).toBe('running')
    expect(raceReducer(s, { t: 'finish', id: 'b', result: res(200) }).phase).toBe('finished')
  })

  it('does not wait for a disconnected racer', () => {
    const s = run(base(), join('a'), join('b'), { t: 'start' },
      { t: 'finish', id: 'a', result: res(100) }, { t: 'leave', id: 'b' })
    expect(s.phase).toBe('finished')
  })

  it('stays running when nobody is connected and nobody finished', () => {
    const s = run(base(), join('a'), { t: 'start' }, { t: 'leave', id: 'a' })
    expect(s.phase).toBe('finished')
  })

  it('reset returns to lobby with a new seed and clears progress', () => {
    const s = run(base(), join('a'), { t: 'start' },
      { t: 'finish', id: 'a', result: res(100) }, { t: 'reset', seed: 9, wordCount: 20 })
    expect(s).toMatchObject({ phase: 'lobby', seed: 9, wordCount: 20 })
    expect(s.racers[0]).toMatchObject({ charIndex: 0, errors: 0, result: null, connected: true })
  })
})

describe('standings', () => {
  it('orders finishers by time, then leaders by progress, then the disconnected', () => {
    const s = run(base(), join('slow'), join('fast'), join('typing'), join('gone'),
      { t: 'start' },
      { t: 'finish', id: 'slow', result: res(9000) },
      { t: 'finish', id: 'fast', result: res(4000) },
      { t: 'progress', id: 'typing', charIndex: 30, errors: 0 },
      { t: 'leave', id: 'gone' })
    expect(standings(s).map((r) => r.id)).toEqual(['fast', 'slow', 'typing', 'gone'])
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/core/raceState.test.ts`
Expected: FAIL — cannot resolve `./raceState`.

- [ ] **Step 3: Implement `src/core/raceState.ts`**

```ts
import type { PeerId, Phase } from './ids'
import type { RaceResult } from './stats'

export const MAX_RACERS = 6

export type Racer = {
  id: PeerId
  nick: string
  connected: boolean
  charIndex: number
  errors: number
  result: RaceResult | null
}

export type RaceState = {
  phase: Phase
  seed: number
  wordCount: number
  racers: Racer[]
}

export type RaceEvent =
  | { t: 'join'; id: PeerId; nick: string }
  | { t: 'leave'; id: PeerId }
  | { t: 'progress'; id: PeerId; charIndex: number; errors: number }
  | { t: 'finish'; id: PeerId; result: RaceResult }
  | { t: 'countdown' }
  | { t: 'start' }
  | { t: 'reset'; seed: number; wordCount: number }

export function initRace(seed: number, wordCount: number): RaceState {
  return { phase: 'lobby', seed, wordCount, racers: [] }
}

/**
 * A race ends when everyone still connected has a result.
 *
 * Disconnected racers are excluded deliberately: waiting on someone whose
 * laptop closed would hang the race for everyone else.
 */
function settle(s: RaceState): RaceState {
  if (s.phase !== 'running') return s
  const live = s.racers.filter((r) => r.connected)
  const allDone = live.every((r) => r.result !== null)
  return allDone ? { ...s, phase: 'finished' } : s
}

function mapRacer(s: RaceState, id: PeerId, fn: (r: Racer) => Racer): RaceState | null {
  const i = s.racers.findIndex((r) => r.id === id)
  if (i === -1) return null
  const racers = [...s.racers]
  racers[i] = fn(racers[i]!)
  return { ...s, racers }
}

export function raceReducer(s: RaceState, e: RaceEvent): RaceState {
  switch (e.t) {
    case 'join': {
      if (s.racers.length >= MAX_RACERS) return s
      if (s.racers.some((r) => r.id === e.id)) return s
      return {
        ...s,
        racers: [...s.racers,
          { id: e.id, nick: e.nick, connected: true, charIndex: 0, errors: 0, result: null }],
      }
    }

    case 'leave': {
      const next = mapRacer(s, e.id, (r) => ({ ...r, connected: false }))
      return next === null ? s : settle(next)
    }

    case 'progress': {
      const target = s.racers.find((r) => r.id === e.id)
      if (target === undefined || target.result !== null) return s
      return mapRacer(s, e.id, (r) => ({ ...r, charIndex: e.charIndex, errors: e.errors })) ?? s
    }

    case 'finish': {
      const target = s.racers.find((r) => r.id === e.id)
      if (target === undefined || target.result !== null) return s
      const next = mapRacer(s, e.id, (r) => ({ ...r, result: e.result }))
      return next === null ? s : settle(next)
    }

    case 'countdown':
      return s.phase === 'lobby' ? { ...s, phase: 'countdown' } : s

    case 'start':
      return { ...s, phase: 'running' }

    case 'reset':
      return {
        phase: 'lobby',
        seed: e.seed,
        wordCount: e.wordCount,
        racers: s.racers
          .filter((r) => r.connected)
          .map((r) => ({ ...r, charIndex: 0, errors: 0, result: null })),
      }
  }
}

export function standings(s: RaceState): Racer[] {
  const rank = (r: Racer): number => (!r.connected ? 2 : r.result !== null ? 0 : 1)
  return [...s.racers].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    if (a.result !== null && b.result !== null) return a.result.ms - b.result.ms
    return b.charIndex - a.charIndex
  })
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/core/raceState.test.ts`
Expected: PASS, all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/raceState.ts src/core/raceState.test.ts
git commit -m "feat: race lifecycle and roster reducer

Shared by host and guest so their logic cannot drift. A race settles when
every connected racer has finished; someone who drops out never blocks it."
```

---

## Task 11: The star room

Host and guest room objects. Transports are injected, so this — the most intricate logic in the app — is fully unit-testable with fake transports and no WebRTC.

**Files:**
- Create: `src/net/room.ts`, `src/net/fakeTransport.ts`
- Test: `src/net/room.test.ts`

**Interfaces:**
- Consumes: `Transport` (Task 9); `parseGuestMsg`, `parseHostMsg`, `PeerId`, `MAX_PEERS` (Task 8); `initRace`, `raceReducer`, `RaceState` (Task 10); `RaceResult` (Task 4).
- Produces:
  - `linkedTransports(): [Transport, Transport]` in `fakeTransport.ts` — a duplex pair for tests.
  - `HOST_ID = 'host'`, `TICK_MS = 100`, `COUNTDOWN_MS = 3000`
  - `class RoomFullError extends Error`
  - `createHostRoom(deps: HostDeps): HostRoom` where
    `HostDeps = { answerOffer(code: string): Promise<{ answerCode: string; transport: Transport }>; mintId(): PeerId; now(): number; nick: string; seed: number; wordCount: number }`
    and `HostRoom = { state(): RaceState; selfId(): PeerId; admit(offerCode: string): Promise<string>; startRace(): void; reset(seed: number, wordCount?: number): void; report(charIndex: number, errors: number): void; finish(r: RaceResult): void; onChange(fn: (s: RaceState) => void): void; onStart(fn: (inMs: number) => void): void; dispose(): void }`
  - `createGuestRoom(deps: GuestDeps): GuestRoom` where
    `GuestDeps = { transport: Transport; nick: string; now(): number }`
    and `GuestRoom = { state(): RaceState; selfId(): PeerId | null; offsetMs(): number; report(charIndex: number, errors: number): void; finish(r: RaceResult): void; onChange(fn: (s: RaceState) => void): void; onStart(fn: (inMs: number) => void): void; dispose(): void }`

- [ ] **Step 1: Write `src/net/fakeTransport.ts`**

Test-only, but it lives in `src/` so it type-checks against the real `Transport`. If the interface changes, this breaks loudly.

```ts
import type { Transport } from './peer'

/**
 * Two Transports wired to each other. Delivery is asynchronous via microtask,
 * matching a real data channel closely enough that ordering bugs still surface.
 */
export function linkedTransports(): [Transport, Transport] {
  const make = (): Transport & { deliver(raw: unknown): void; peer?: Transport } => {
    const msgFns: Array<(raw: unknown) => void> = []
    const openFns: Array<() => void> = []
    const closeFns: Array<() => void> = []
    let closed = false
    let partner: { deliver(raw: unknown): void; shut(): void } | null = null

    const self = {
      get isOpen() { return !closed },
      send(msg: unknown) {
        if (closed) return
        const copy: unknown = JSON.parse(JSON.stringify(msg))
        queueMicrotask(() => partner?.deliver(copy))
      },
      close() { self.shut(); partner?.shut() },
      shut() {
        if (closed) return
        closed = true
        for (const fn of closeFns) fn()
      },
      deliver(raw: unknown) { if (!closed) for (const fn of msgFns) fn(raw) },
      onOpen(fn: () => void) { openFns.push(fn); queueMicrotask(fn) },
      onMessage(fn: (raw: unknown) => void) { msgFns.push(fn) },
      onClose(fn: () => void) { closeFns.push(fn) },
      link(p: typeof self) { partner = p },
    }
    return self as never
  }

  const a = make() as never as { link(p: unknown): void } & Transport
  const b = make() as never as { link(p: unknown): void } & Transport
  a.link(b)
  b.link(a)
  return [a, b]
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/net/room.test.ts`. The behaviours worth locking down are the ones that would be invisible until a real race went wrong: relaying, the room cap, tick batching, and a guest surviving the host vanishing.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHostRoom, createGuestRoom, RoomFullError, TICK_MS } from './room'
import { linkedTransports } from './fakeTransport'
import type { Transport } from './peer'

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

/** Wire a guest into a host room, bypassing the SDP layer entirely. */
async function connect(host: ReturnType<typeof createHostRoom>, nick: string) {
  const [hostSide, guestSide] = linkedTransports()
  pending = { answerCode: 'ANSWER', transport: hostSide }
  await host.admit('OFFER')
  const guest = createGuestRoom({ transport: guestSide, nick, now: () => 0 })
  await flush()
  return guest
}

let pending: { answerCode: string; transport: Transport }
let ids = 0

function makeHost() {
  return createHostRoom({
    answerOffer: async () => pending,
    mintId: () => `g${++ids}`,
    now: () => 0,
    nick: 'host',
    seed: 42,
    wordCount: 40,
  })
}

beforeEach(() => { ids = 0; vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => vi.useRealTimers())

describe('host room', () => {
  it('starts with only the host in the roster', () => {
    expect(makeHost().state().racers.map((r) => r.nick)).toEqual(['host'])
  })

  it('admits a guest and returns the answer code', async () => {
    const host = makeHost()
    const [hostSide] = linkedTransports()
    pending = { answerCode: 'ANSWER', transport: hostSide }
    expect(await host.admit('OFFER')).toBe('ANSWER')
  })

  it('adds the guest to the roster once it says hello', async () => {
    const host = makeHost()
    await connect(host, 'morten')
    expect(host.state().racers.map((r) => r.nick)).toEqual(['host', 'morten'])
  })

  it('refuses a 7th participant', async () => {
    const host = makeHost()
    for (let i = 0; i < 5; i++) await connect(host, `g${i}`)
    expect(host.state().racers).toHaveLength(6)
    const [hostSide] = linkedTransports()
    pending = { answerCode: 'X', transport: hostSide }
    await expect(host.admit('OFFER')).rejects.toThrow(RoomFullError)
  })
})

describe('guest room', () => {
  it('learns the seed and word count from the host', async () => {
    const host = makeHost()
    const guest = await connect(host, 'morten')
    expect(guest.state()).toMatchObject({ seed: 42, wordCount: 40 })
  })

  it('learns its own id', async () => {
    const guest = await connect(makeHost(), 'morten')
    expect(guest.selfId()).toBe('g1')
  })

  it('sees the host roster', async () => {
    const host = makeHost()
    const a = await connect(host, 'a')
    await connect(host, 'b')
    await flush()
    expect(a.state().racers.map((r) => r.nick).sort()).toEqual(['a', 'b', 'host'])
  })
})

describe('relaying', () => {
  it('propagates one guest’s progress to another guest', async () => {
    const host = makeHost()
    const a = await connect(host, 'a')
    const b = await connect(host, 'b')
    host.startRace()
    await vi.advanceTimersByTimeAsync(4000)

    a.report(25, 1)
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)

    expect(b.state().racers.find((r) => r.id === a.selfId()))
      .toMatchObject({ charIndex: 25, errors: 1 })
  })

  it('batches all progress into a single tick', async () => {
    const host = makeHost()
    const a = await connect(host, 'a')
    const b = await connect(host, 'b')
    host.startRace()
    await vi.advanceTimersByTimeAsync(4000)

    const seen: unknown[] = []
    // Count host→guest messages arriving at one guest across a single tick.
    b.onChange(() => seen.push(1))
    a.report(1, 0)
    host.report(2, 0)
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(seen.length).toBeLessThanOrEqual(2)
  })

  it('propagates a finish to every peer', async () => {
    const host = makeHost()
    const a = await connect(host, 'a')
    const b = await connect(host, 'b')
    host.startRace()
    await vi.advanceTimersByTimeAsync(4000)

    a.finish({ ms: 12_000, wpm: 55, acc: 0.97 })
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)

    expect(b.state().racers.find((r) => r.id === a.selfId())?.result)
      .toEqual({ ms: 12_000, wpm: 55, acc: 0.97 })
  })
})

describe('starting together', () => {
  it('tells every guest to start', async () => {
    const host = makeHost()
    const guest = await connect(host, 'a')
    const starts: number[] = []
    guest.onStart((inMs) => starts.push(inMs))
    host.startRace()
    await flush()
    expect(starts).toHaveLength(1)
    expect(starts[0]).toBeGreaterThan(0)
  })
})

describe('disconnects', () => {
  it('marks a guest disconnected when its transport closes', async () => {
    const host = makeHost()
    const guest = await connect(host, 'a')
    guest.dispose()
    await flush()
    expect(host.state().racers.find((r) => r.nick === 'a')?.connected).toBe(false)
  })

  it('leaves the guest with usable state when the host vanishes', async () => {
    const host = makeHost()
    const guest = await connect(host, 'a')
    host.dispose()
    await flush()
    // The race is over, but nothing threw and the roster is still readable.
    expect(guest.state().racers.length).toBeGreaterThan(0)
  })
})

describe('hostile input', () => {
  it('ignores a malformed message instead of throwing', async () => {
    const [hostSide, guestSide] = linkedTransports()
    const guest = createGuestRoom({ transport: guestSide, nick: 'a', now: () => 0 })
    expect(() => hostSide.send({ t: 'nonsense', boom: true })).not.toThrow()
    await flush()
    expect(guest.state().racers).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/net/room.test.ts`
Expected: FAIL — cannot resolve `./room`.

- [ ] **Step 4: Implement `src/net/room.ts`**

```ts
import type { Transport } from './peer'
import {
  parseGuestMsg, parseHostMsg, MAX_PEERS,
  type GuestMsg, type HostMsg, type PeerId, type PeerInfo,
} from './messages'
import { initRace, raceReducer, type RaceState } from '../core/raceState'
import type { RaceResult } from '../core/stats'

export const HOST_ID: PeerId = 'host'
export const TICK_MS = 100
export const COUNTDOWN_MS = 3000

export class RoomFullError extends Error {
  constructor() {
    super(`Room is full (${MAX_PEERS}/${MAX_PEERS}).`)
    this.name = 'RoomFullError'
  }
}

type Listener<T> = (v: T) => void

function emitter<T>() {
  const fns: Array<Listener<T>> = []
  return { on: (fn: Listener<T>) => void fns.push(fn), emit: (v: T) => { for (const fn of fns) fn(v) } }
}

// ---------------------------------------------------------------- host

export type HostDeps = {
  answerOffer(code: string): Promise<{ answerCode: string; transport: Transport }>
  mintId(): PeerId
  now(): number
  nick: string
  seed: number
  wordCount: number
}

export type HostRoom = {
  state(): RaceState
  /** Always HOST_ID. Present so the race screen can treat both room kinds alike. */
  selfId(): PeerId
  admit(offerCode: string): Promise<string>
  startRace(): void
  reset(seed: number, wordCount?: number): void
  report(charIndex: number, errors: number): void
  finish(r: RaceResult): void
  onChange(fn: Listener<RaceState>): void
  onStart(fn: Listener<number>): void
  dispose(): void
}

export function createHostRoom(deps: HostDeps): HostRoom {
  let state = raceReducer(initRace(deps.seed, deps.wordCount), {
    t: 'join', id: HOST_ID, nick: deps.nick,
  })
  const guests = new Map<PeerId, Transport>()
  const change = emitter<RaceState>()
  const start = emitter<number>()
  let dirty = false

  const timer = setInterval(() => {
    if (!dirty) return
    dirty = false
    broadcast({ t: 'tick', p: state.racers.map((r) => [r.id, r.charIndex, r.errors]) })
  }, TICK_MS)

  function apply(e: Parameters<typeof raceReducer>[1]): void {
    const next = raceReducer(state, e)
    if (next === state) return
    state = next
    change.emit(state)
  }

  function broadcast(msg: HostMsg): void {
    for (const t of guests.values()) t.send(msg)
  }

  function roster(): PeerInfo[] {
    return state.racers.map((r) => ({ id: r.id, nick: r.nick, connected: r.connected }))
  }

  function announceRoster(): void {
    broadcast({ t: 'peers', peers: roster() })
  }

  function onGuestMessage(id: PeerId, transport: Transport, raw: unknown): void {
    const msg: GuestMsg | null = parseGuestMsg(raw)
    if (msg === null) return
    switch (msg.t) {
      case 'hello':
        apply({ t: 'join', id, nick: msg.nick })
        transport.send({
          t: 'room', seed: state.seed, wordCount: state.wordCount,
          phase: state.phase, peers: roster(), you: id,
        })
        announceRoster()
        break
      case 'ping':
        transport.send({ t: 'pong', id: msg.id })
        break
      case 'progress':
        apply({ t: 'progress', id, charIndex: msg.charIndex, errors: msg.errors })
        dirty = true
        break
      case 'done':
        apply({ t: 'finish', id, result: { ms: msg.ms, wpm: msg.wpm, acc: msg.acc } })
        broadcast({ t: 'done', id, ms: msg.ms, wpm: msg.wpm, acc: msg.acc })
        break
    }
  }

  return {
    state: () => state,
    selfId: () => HOST_ID,

    async admit(offerCode: string): Promise<string> {
      if (state.racers.filter((r) => r.connected).length >= MAX_PEERS) throw new RoomFullError()
      const { answerCode, transport } = await deps.answerOffer(offerCode)
      const id = deps.mintId()
      guests.set(id, transport)
      transport.onMessage((raw) => onGuestMessage(id, transport, raw))
      transport.onClose(() => {
        guests.delete(id)
        apply({ t: 'leave', id })
        announceRoster()
      })
      return answerCode
    },

    startRace(): void {
      apply({ t: 'countdown' })
      broadcast({ t: 'start', inMs: COUNTDOWN_MS })
      start.emit(COUNTDOWN_MS)
      setTimeout(() => apply({ t: 'start' }), COUNTDOWN_MS)
    },

    reset(seed: number, wordCount: number = state.wordCount): void {
      apply({ t: 'reset', seed, wordCount })
      broadcast({ t: 'reset', seed, wordCount })
    },

    report(charIndex: number, errors: number): void {
      apply({ t: 'progress', id: HOST_ID, charIndex, errors })
      dirty = true
    },

    finish(r: RaceResult): void {
      apply({ t: 'finish', id: HOST_ID, result: r })
      broadcast({ t: 'done', id: HOST_ID, ms: r.ms, wpm: r.wpm, acc: r.acc })
    },

    onChange: change.on,
    onStart: start.on,

    dispose(): void {
      clearInterval(timer)
      for (const t of guests.values()) t.close()
      guests.clear()
    },
  }
}

// --------------------------------------------------------------- guest

export type GuestDeps = { transport: Transport; nick: string; now(): number }

export type GuestRoom = {
  state(): RaceState
  selfId(): PeerId | null
  offsetMs(): number
  report(charIndex: number, errors: number): void
  finish(r: RaceResult): void
  onChange(fn: Listener<RaceState>): void
  onStart(fn: Listener<number>): void
  dispose(): void
}

const PING_ROUNDS = 5

export function createGuestRoom(deps: GuestDeps): GuestRoom {
  let state = initRace(0, 40)
  let self: PeerId | null = null
  let offset = 0
  const sent = new Map<number, number>()
  const change = emitter<RaceState>()
  const start = emitter<number>()

  function set(next: RaceState): void {
    if (next === state) return
    state = next
    change.emit(state)
  }

  /** Rebuild the roster wholesale — the host is authoritative about who is present. */
  function syncRoster(peers: PeerInfo[]): void {
    const byId = new Map(state.racers.map((r) => [r.id, r]))
    set({
      ...state,
      racers: peers.map((p) => {
        const prev = byId.get(p.id)
        return prev !== undefined
          ? { ...prev, nick: p.nick, connected: p.connected }
          : { ...p, charIndex: 0, errors: 0, result: null }
      }),
    })
  }

  deps.transport.onMessage((raw) => {
    const msg: HostMsg | null = parseHostMsg(raw)
    if (msg === null) return
    switch (msg.t) {
      case 'room':
        self = msg.you
        set({ ...state, seed: msg.seed, wordCount: msg.wordCount, phase: msg.phase })
        syncRoster(msg.peers)
        break
      case 'pong': {
        const at = sent.get(msg.id)
        if (at === undefined) return
        sent.delete(msg.id)
        const rtt = deps.now() - at
        // Keep the smallest sample: the least-delayed round trip is the least
        // polluted by queueing, so it is the best estimate of one-way delay.
        const half = rtt / 2
        offset = offset === 0 ? half : Math.min(offset, half)
        break
      }
      case 'peers':
        syncRoster(msg.peers)
        break
      case 'start':
        set(raceReducer(state, { t: 'countdown' }))
        start.emit(Math.max(0, msg.inMs - offset))
        setTimeout(() => set(raceReducer(state, { t: 'start' })), Math.max(0, msg.inMs - offset))
        break
      case 'tick':
        for (const [id, charIndex, errors] of msg.p) {
          if (id === self) continue
          set(raceReducer(state, { t: 'progress', id, charIndex, errors }))
        }
        break
      case 'done':
        set(raceReducer(state, {
          t: 'finish', id: msg.id, result: { ms: msg.ms, wpm: msg.wpm, acc: msg.acc },
        }))
        break
      case 'reset':
        set(raceReducer(state, { t: 'reset', seed: msg.seed, wordCount: msg.wordCount }))
        break
    }
  })

  deps.transport.onOpen(() => {
    deps.transport.send({ t: 'hello', nick: deps.nick })
    for (let i = 0; i < PING_ROUNDS; i++) {
      const id = i + 1
      sent.set(id, deps.now())
      deps.transport.send({ t: 'ping', id })
    }
  })

  deps.transport.onClose(() => {
    set({ ...state, phase: 'finished' })
  })

  return {
    state: () => state,
    selfId: () => self,
    offsetMs: () => offset,
    report(charIndex, errors) {
      if (self !== null) set(raceReducer(state, { t: 'progress', id: self, charIndex, errors }))
      deps.transport.send({ t: 'progress', charIndex, errors })
    },
    finish(r) {
      if (self !== null) set(raceReducer(state, { t: 'finish', id: self, result: r }))
      deps.transport.send({ t: 'done', ms: r.ms, wpm: r.wpm, acc: r.acc })
    },
    onChange: change.on,
    onStart: start.on,
    dispose: () => deps.transport.close(),
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/net/room.test.ts`
Expected: PASS. Expect to iterate here — this is the densest task in the plan, and fake-timer interactions with microtask delivery are fiddly. If a test hangs, suspect a `queueMicrotask` that never runs because timers are frozen; `vi.useFakeTimers({ shouldAdvanceTime: true })` is already set for that reason.

- [ ] **Step 6: Commit**

```bash
git add src/net/room.ts src/net/fakeTransport.ts src/net/room.test.ts
git commit -m "feat: star-topology room with host relay

Transports are injected, so the trickiest logic in the app is unit-tested
with fake duplex pairs and no WebRTC. Progress is batched into one 10Hz
tick, turning the host fan-out from n squared messages into n."
```

---

## Task 12: Host lobby and join flow

The manual handshake made human-usable. This is where the UX either works or the whole approach feels broken, so the copy/paste affordances matter more than they usually would.

**Files:**
- Create: `src/ui/codeBox.ts`, `src/ui/screens/hostLobby.ts`, `src/ui/screens/join.ts`
- Modify: `src/main.ts`, `src/styles.css`
- Test: `src/ui/codeBox.test.ts`

**Interfaces:**
- Consumes: `createHostRoom`, `createGuestRoom`, `RoomFullError`, `HOST_ID` (Task 11); `startOffer`, `answerOffer` (Task 9); `SignalDecodeError` (Task 7); `standings` (Task 10).
- Produces:
  - `codeOutput(label: string, code: string): HTMLElement` — read-only field with a Copy button that reports success in place.
  - `codeInput(label: string, onSubmit: (code: string) => void): { node: HTMLElement; setError(msg: string): void; clear(): void }`
  - `mountHostLobby(root: HTMLElement, deps: HostLobbyDeps): void`
  - `mountJoin(root: HTMLElement, deps: JoinDeps): void`

- [ ] **Step 1: Write the failing test for the code widgets**

Create `src/ui/codeBox.test.ts`.

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { codeOutput, codeInput } from './codeBox'

describe('codeOutput', () => {
  it('shows the code in a readonly field', () => {
    const node = codeOutput('Your join code', 'ABC123')
    const field = node.querySelector('textarea')!
    expect(field.value).toBe('ABC123')
    expect(field.readOnly).toBe(true)
  })

  it('copies to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const node = codeOutput('x', 'ABC123')
    node.querySelector('button')!.click()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith('ABC123')
  })
})

describe('codeInput', () => {
  it('submits the trimmed value', () => {
    const onSubmit = vi.fn()
    const { node } = codeInput('Paste it', onSubmit)
    node.querySelector('textarea')!.value = '  ABC123  '
    node.querySelector('button')!.click()
    expect(onSubmit).toHaveBeenCalledWith('ABC123')
  })

  it('does not submit an empty value', () => {
    const onSubmit = vi.fn()
    const { node } = codeInput('Paste it', onSubmit)
    node.querySelector('button')!.click()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows and clears an error', () => {
    const { node, setError, clear } = codeInput('Paste it', vi.fn())
    setError('nope')
    expect(node.textContent).toContain('nope')
    clear()
    expect(node.textContent).not.toContain('nope')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/ui/codeBox.test.ts`
Expected: FAIL — cannot resolve `./codeBox`.

- [ ] **Step 3: Implement `src/ui/codeBox.ts`**

```ts
import { el } from './dom'

export function codeOutput(label: string, code: string): HTMLElement {
  const field = el('textarea', { rows: '3', readonly: 'readonly' })
  field.value = code
  const copy = el('button', {}, ['Copy'])
  const status = el('span', { class: 'muted' })

  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(code).then(
      () => { status.textContent = 'copied' },
      () => { field.select(); status.textContent = 'press ⌘C / Ctrl+C' },
    )
  })

  return el('div', { class: 'codebox' }, [
    el('label', {}, [label]), field, el('div', { class: 'row' }, [copy, status]),
  ])
}

export function codeInput(
  label: string,
  onSubmit: (code: string) => void,
): { node: HTMLElement; setError(msg: string): void; clear(): void } {
  const field = el('textarea', { rows: '3', placeholder: 'paste the code here' })
  const submit = el('button', {}, ['Continue'])
  const error = el('p', { class: 'error-text' })

  const fire = (): void => {
    const value = field.value.trim()
    if (value === '') return
    error.textContent = ''
    onSubmit(value)
  }
  submit.addEventListener('click', fire)

  return {
    node: el('div', { class: 'codebox' }, [
      el('label', {}, [label]), field, el('div', { class: 'row' }, [submit]), error,
    ]),
    setError: (msg) => { error.textContent = msg },
    clear: () => { field.value = ''; error.textContent = '' },
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/ui/codeBox.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the supporting styles to `src/styles.css`**

```css
.codebox { margin: 1rem 0; display: grid; gap: 0.5rem; }
.codebox label { font-size: 0.85rem; color: var(--dim); }
.error-text { color: var(--error); font-size: 0.9rem; min-height: 1.2em; margin: 0; }
.roster { list-style: none; padding: 0; display: grid; gap: 0.4rem; }
.roster li { display: flex; justify-content: space-between; padding: 0.4rem 0.6rem;
  background: #1c1f24; border-radius: 6px; }
.roster li.gone { opacity: 0.45; text-decoration: line-through; }
.steps { color: var(--dim); font-size: 0.9rem; padding-left: 1.2rem; }
```

- [ ] **Step 6: Implement `src/ui/screens/hostLobby.ts`**

```ts
import { el, clear } from '../dom'
import { codeInput, codeOutput } from '../codeBox'
import { createHostRoom, RoomFullError, type HostRoom } from '../../net/room'
import { answerOffer } from '../../net/peer'
import { SignalDecodeError } from '../../net/sdp'
import { MAX_PEERS } from '../../net/messages'
import { WORD_COUNTS } from '../../core/passage'

export type HostLobbyDeps = {
  nick: string
  wordCount: number
  onRace: (room: HostRoom) => void
  onExit: () => void
}

export function mountHostLobby(root: HTMLElement, deps: HostLobbyDeps): void {
  const room = createHostRoom({
    answerOffer,
    mintId: () => Math.random().toString(36).slice(2, 10),
    now: () => performance.now(),
    nick: deps.nick,
    seed: Math.floor(Math.random() * 2 ** 31),
    wordCount: deps.wordCount,
  })

  const rosterList = el('ul', { class: 'roster' })
  const answerSlot = el('div')
  const startBtn = el('button', {}, ['Start race'])

  // Spec section 8 puts word count in the lobby, not only on Home: the host may
  // want to change it after seeing who turned up. Reseeding broadcasts the new
  // length to everyone already connected.
  const counts = el('div', { class: 'row' })
  function renderCounts(): void {
    clear(counts)
    counts.append(el('span', { class: 'muted' }, ['Length:']))
    for (const n of WORD_COUNTS) {
      const active = room.state().wordCount === n
      const b = el('button', active ? { 'aria-pressed': 'true' } : {}, [`${n} words`])
      b.addEventListener('click', () => {
        room.reset(Math.floor(Math.random() * 2 ** 31), n)
        renderCounts()
      })
      counts.append(b)
    }
  }

  const paste = codeInput('A joiner sent you a code — paste it here', (code) => {
    paste.clear()
    room.admit(code).then(
      (answerCode) => {
        clear(answerSlot)
        answerSlot.append(codeOutput('Send this back to them', answerCode))
      },
      (err: unknown) => {
        paste.setError(
          err instanceof RoomFullError || err instanceof SignalDecodeError
            ? err.message
            : 'Something went wrong creating the answer. Ask them for a fresh code.',
        )
      },
    )
  })

  function renderRoster(): void {
    const { racers } = room.state()
    clear(rosterList)
    for (const r of racers) {
      rosterList.append(el('li', r.connected ? {} : { class: 'gone' }, [
        el('span', {}, [r.nick]),
        el('span', { class: 'muted' }, [r.connected ? 'ready' : 'disconnected']),
      ]))
    }
    startBtn.textContent = `Start race (${racers.filter((r) => r.connected).length}/${MAX_PEERS})`
  }

  room.onChange(renderRoster)
  startBtn.addEventListener('click', () => deps.onRace(room))

  const back = el('button', {}, ['Cancel'])
  back.addEventListener('click', () => { room.dispose(); deps.onExit() })

  renderCounts()
  clear(root)
  root.append(
    el('h1', {}, ['Your room']),
    counts,
    el('ol', { class: 'steps' }, [
      el('li', {}, ['Share this page’s URL with whoever you want to race.']),
      el('li', {}, ['They generate a join code and send it to you.']),
      el('li', {}, ['Paste it below, then send back the answer code you get.']),
    ]),
    rosterList,
    paste.node,
    answerSlot,
    el('div', { class: 'row' }, [startBtn, back]),
  )
  renderRoster()
}
```

- [ ] **Step 7: Implement `src/ui/screens/join.ts`**

```ts
import { el, clear } from '../dom'
import { codeInput, codeOutput } from '../codeBox'
import { startOffer } from '../../net/peer'
import { SignalDecodeError } from '../../net/sdp'
import { createGuestRoom, type GuestRoom } from '../../net/room'

export type JoinDeps = {
  nick: string
  onRace: (room: GuestRoom) => void
  onExit: () => void
}

export function mountJoin(root: HTMLElement, deps: JoinDeps): void {
  const slot = el('div')
  const back = el('button', {}, ['Cancel'])
  back.addEventListener('click', deps.onExit)

  clear(root)
  root.append(
    el('h1', {}, ['Join a room']),
    el('p', { class: 'muted' }, ['Generating your join code…']),
    slot,
    el('div', { class: 'row' }, [back]),
  )

  void startOffer().then(({ offerCode, transport, acceptAnswer }) => {
    const paste = codeInput('Paste the answer code they send back', (code) => {
      acceptAnswer(code).then(
        () => {
          paste.clear()
          clear(slot)
          slot.append(el('p', { class: 'muted' }, ['Connecting…']))
          const room = createGuestRoom({ transport, nick: deps.nick, now: () => performance.now() })
          transport.onOpen(() => deps.onRace(room))
          transport.onClose(() => {
            clear(slot)
            slot.append(el('p', { class: 'error-text' }, [
              'Couldn’t establish a direct connection. This happens when both ' +
              'networks block peer-to-peer traffic, and fixing it would need a ' +
              'relay server this app deliberately does not have.',
            ]))
          })
        },
        (err: unknown) => {
          paste.setError(err instanceof SignalDecodeError
            ? err.message
            : 'That code was rejected. Ask the host for a fresh one.')
        },
      )
    })

    clear(slot)
    slot.append(
      codeOutput('Send this code to the host', offerCode),
      paste.node,
    )
  })
}
```

- [ ] **Step 8: Wire both screens into `src/main.ts`**

Replace the two `alert` stubs from Task 6. The race screen arrives in Task 13; until then, log the room and return home.

```ts
onHost: (nick, wordCount) => mountHostLobby(root, {
  nick, wordCount,
  onRace: (room) => { console.log('race starts here', room.state()); home() },
  onExit: home,
}),
onJoin: (nick) => mountJoin(root, {
  nick,
  onRace: (room) => { console.log('race starts here', room.state()); home() },
  onExit: home,
}),
```

- [ ] **Step 9: Verify the handshake by hand across two tabs**

Run `npm run dev` and open the URL in two tabs. In tab A create a room; in tab B join and copy the generated code; paste it into tab A; copy A's answer back into B. Expected: B's name appears in A's roster within a second or two. Also check the failure paths — pasting garbage shows an inline error and pasting the same offer twice does not corrupt the roster.

- [ ] **Step 10: Commit and push**

```bash
git add -A
git commit -m "feat: host lobby and join flow

Guests generate the code and hosts answer, so the host shares one stable
URL rather than a distinct invite per joiner. Decode and room-full errors
surface inline instead of failing silently."
git push
```

---

## Task 13: Race and results screens

**Files:**
- Create: `src/ui/screens/race.ts`, `src/ui/screens/results.ts`
- Modify: `src/main.ts`, `src/styles.css`
- Test: `src/ui/screens/results.test.ts`

**Interfaces:**
- Consumes: `renderPassage` (Task 6); `passageText` (Task 2); `initTyping`, `applyKey` (Task 3); `wpm`, `accuracy` (Task 4); `standings`, `Racer` (Task 10); `HostRoom`, `GuestRoom`, `HOST_ID` (Task 11).
- Produces:
  - `type AnyRoom = HostRoom | GuestRoom` — the race screen works with either, since both expose `state`, `selfId`, `report`, `finish`, `onChange`, `onStart` and `dispose`.
  - `mountRace(root: HTMLElement, deps: RaceDeps): void`
  - `renderResults(racers: Racer[], selfId: string): HTMLElement`

- [ ] **Step 1: Write the failing test for the results table**

Create `src/ui/screens/results.test.ts`. The table is pure rendering from state, so it is worth testing; the race screen itself is covered end-to-end in Task 14.

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/ui/screens/results.test.ts`
Expected: FAIL — cannot resolve `./results`.

- [ ] **Step 3: Implement `src/ui/screens/results.ts`**

```ts
import { el } from '../dom'
import type { Racer } from '../../core/raceState'

export function renderResults(racers: Racer[], selfId: string): HTMLElement {
  const body = el('tbody')

  racers.forEach((r, i) => {
    const attrs = r.id === selfId ? { class: 'me' } : {}
    const status = !r.connected ? 'left' : r.result !== null ? `${r.result.wpm}` : '—'
    const acc = r.result !== null ? `${Math.round(r.result.acc * 100)}%` : '—'
    const time = r.result !== null ? `${(r.result.ms / 1000).toFixed(1)}s` : '—'
    body.append(el('tr', attrs, [
      el('td', {}, [String(i + 1)]),
      el('td', {}, [r.nick]),
      el('td', {}, [status]),
      el('td', {}, [acc]),
      el('td', {}, [time]),
    ]))
  })

  return el('table', { class: 'results' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', {}, ['#']), el('th', {}, ['who']), el('th', {}, ['wpm']),
      el('th', {}, ['acc']), el('th', {}, ['time']),
    ])]),
    body,
  ])
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/ui/screens/results.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add race styles to `src/styles.css`**

```css
.results { width: 100%; border-collapse: collapse; margin: 1rem 0; font-variant-numeric: tabular-nums; }
.results th { text-align: left; color: var(--dim); font-weight: 500; font-size: 0.8rem;
  text-transform: uppercase; padding: 0.4rem 0.5rem; }
.results td { padding: 0.5rem; border-top: 1px solid #2a2e35; }
.results tr.me { background: rgba(91, 157, 255, 0.12); }

.bars { display: grid; gap: 0.5rem; margin: 1rem 0; }
.bar { display: grid; grid-template-columns: 8ch 1fr 6ch; gap: 0.6rem; align-items: center;
  font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.bar .track { height: 8px; background: #2a2e35; border-radius: 4px; overflow: hidden; }
.bar .fill { height: 100%; background: var(--accent); border-radius: 4px;
  transition: width 120ms linear; }
.bar.me .fill { background: var(--done); }
.bar.gone { opacity: 0.4; }
```

- [ ] **Step 6: Implement `src/ui/screens/race.ts`**

One screen serves host and guest; the only difference is who may press "Race again".

```ts
import { el, clear } from '../dom'
import { renderPassage } from '../passageView'
import { renderResults } from './results'
import { passageText } from '../../core/passage'
import { initTyping, applyKey, type TypingState } from '../../core/typing'
import { wpm, accuracy, type RaceResult } from '../../core/stats'
import { standings } from '../../core/raceState'
import { HOST_ID, type GuestRoom, type HostRoom } from '../../net/room'
import type { AppStorage } from '../../core/storage'

export type AnyRoom = HostRoom | GuestRoom

const isHost = (room: AnyRoom): room is HostRoom => 'admit' in room

export type RaceDeps = {
  room: AnyRoom
  storage: AppStorage
  onExit: () => void
}

export function mountRace(root: HTMLElement, deps: RaceDeps): void {
  const { room } = deps
  const selfId = room.selfId() ?? HOST_ID
  const text = passageText(room.state().seed, room.state().wordCount)

  let state: TypingState = initTyping(text)
  let startedAt: number | null = null
  let raf = 0
  let reportedAt = 0

  const countdownBox = el('div', { class: 'countdown' })
  const passageBox = el('div')
  const barsBox = el('div', { class: 'bars' })
  const resultsBox = el('div')
  const actions = el('div', { class: 'row' })

  function drawBars(): void {
    clear(barsBox)
    for (const r of standings(room.state())) {
      const pct = text.length === 0 ? 0 : Math.round((r.charIndex / text.length) * 100)
      const cls = ['bar', r.id === selfId ? 'me' : '', r.connected ? '' : 'gone']
        .filter(Boolean).join(' ')
      const fill = el('div', { class: 'fill', style: `width:${pct}%` })
      barsBox.append(el('div', { class: cls }, [
        el('span', {}, [r.nick]),
        el('div', { class: 'track' }, [fill]),
        el('span', {}, [r.result !== null ? `${r.result.wpm}` : `${pct}%`]),
      ]))
    }
  }

  function draw(): void {
    clear(passageBox)
    passageBox.append(renderPassage(state, { hidden: startedAt === null }))
    drawBars()
  }

  function loop(): void {
    draw()
    if (!state.finished) raf = requestAnimationFrame(loop)
  }

  function onKey(e: KeyboardEvent): void {
    if (startedAt === null || state.finished) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === ' ' || e.key === 'Tab' || e.key === 'Backspace') e.preventDefault()
    const next = applyKey(state, e.key)
    if (next === state) return
    state = next

    // Throttle to the room's tick rate; the host batches these anyway.
    const now = performance.now()
    if (now - reportedAt > 100) {
      reportedAt = now
      room.report(state.cursor, state.errors)
    }
    if (state.finished) finish()
  }

  function finish(): void {
    cancelAnimationFrame(raf)
    const ms = performance.now() - (startedAt ?? performance.now())
    const result: RaceResult = {
      ms: Math.round(ms),
      wpm: wpm(state.cursor, ms),
      acc: accuracy(state.cursor, state.errors),
    }
    room.report(state.cursor, state.errors)
    room.finish(result)
    deps.storage.pushResult(result)
    draw()
  }

  function showResults(): void {
    clear(resultsBox)
    resultsBox.append(renderResults(standings(room.state()), selfId))
    clear(actions)
    if (isHost(room)) {
      const again = el('button', {}, ['Race again'])
      again.addEventListener('click', () => {
        room.reset(Math.floor(Math.random() * 2 ** 31))
        teardown()
        mountRace(root, deps)
      })
      actions.append(again)
    } else {
      actions.append(el('span', { class: 'muted' }, ['Waiting for the host to start another…']))
    }
    const leave = el('button', {}, ['Leave'])
    leave.addEventListener('click', () => { teardown(); room.dispose(); deps.onExit() })
    actions.append(leave)
  }

  function teardown(): void {
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKey)
  }

  room.onStart((inMs) => {
    let remaining = Math.ceil(inMs / 1000)
    countdownBox.textContent = String(remaining)
    const timer = window.setInterval(() => {
      remaining -= 1
      countdownBox.textContent = remaining > 0 ? String(remaining) : ''
      if (remaining <= 0) window.clearInterval(timer)
    }, 1000)
    window.setTimeout(() => {
      startedAt = performance.now()
      loop()
    }, inMs)
  })

  room.onChange((s) => {
    drawBars()
    if (s.phase === 'finished') showResults()
  })

  window.addEventListener('keydown', onKey)

  clear(root)
  root.append(countdownBox, passageBox, barsBox, resultsBox, actions)

  if (isHost(room)) {
    const go = el('button', {}, ['Go'])
    go.addEventListener('click', () => { go.remove(); room.startRace() })
    actions.append(go)
  } else {
    actions.append(el('span', { class: 'muted' }, ['Waiting for the host to start…']))
  }

  draw()
}
```

- [ ] **Step 7: Wire it into `src/main.ts`**

Replace the Task 12 `console.log` stubs:

```ts
onRace: (room) => mountRace(root, { room, storage, onExit: home }),
```

- [ ] **Step 8: Play a real two-tab race**

Run `npm run dev`, open two tabs, complete the handshake, press Go. Verify: both passages stay blurred through the countdown and sharpen together, both progress bars advance, the finisher's row appears first in the results, and "Race again" reseeds both tabs with new text.

- [ ] **Step 9: Run the suite, build, commit and push**

```bash
npm test && npm run build
git add -A
git commit -m "feat: race and results screens

One screen serves host and guest; only the reseed control differs. Progress
reports are throttled to the room tick rate rather than sent per keystroke."
git push
```

---

## Task 14: End-to-end smoke test

The star relay is where integration bugs hide, and no unit test will catch a broken real handshake.

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/race.spec.ts`
- Modify: `package.json`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the running app.
- Produces: `npm run test:e2e`.

- [ ] **Step 1: Install Playwright**

```bash
npm i -D @playwright/test
npx playwright install --with-deps chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

Two browser contexts in one Chromium instance connect over loopback, so no STUN server is needed and the test is not network-dependent.

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: !process.env['CI'],
  },
})
```

- [ ] **Step 3: Write the failing test**

Create `tests/e2e/race.spec.ts`.

```ts
import { test, expect, type Page } from '@playwright/test'

async function readCode(page: Page): Promise<string> {
  const field = page.locator('.codebox textarea[readonly]')
  await expect(field).not.toHaveValue('', { timeout: 20_000 })
  return field.inputValue()
}

test('two peers connect, race, and both appear in the results', async ({ browser }) => {
  const hostCtx = await browser.newContext()
  const guestCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()

  await host.goto('/')
  await host.getByPlaceholder('nickname').fill('hosty')
  await host.getByRole('button', { name: 'Create room' }).click()

  await guest.goto('/')
  await guest.getByPlaceholder('nickname').fill('guesty')
  await guest.getByRole('button', { name: 'Join a room' }).click()

  // Guest offers; host answers. This is the whole manual handshake.
  const offer = await readCode(guest)
  await host.locator('.codebox textarea:not([readonly])').fill(offer)
  await host.getByRole('button', { name: 'Continue' }).click()

  const answer = await readCode(host)
  await guest.locator('.codebox textarea:not([readonly])').fill(answer)
  await guest.getByRole('button', { name: 'Continue' }).click()

  await expect(host.locator('.roster')).toContainText('guesty', { timeout: 20_000 })

  await host.getByRole('button', { name: 'Start race' }).click()
  await host.getByRole('button', { name: 'Go' }).click()

  // The passage must be hidden during the countdown and revealed after.
  await expect(host.locator('.passage')).toHaveClass(/hidden/)
  await expect(host.locator('.passage')).not.toHaveClass(/hidden/, { timeout: 10_000 })

  const text = (await host.locator('.passage').innerText()).replace(/\n/g, '')
  await host.keyboard.type(text, { delay: 5 })

  await expect(host.locator('.results')).toBeVisible({ timeout: 20_000 })
  await expect(guest.locator('.bars')).toContainText('hosty')
})
```

- [ ] **Step 4: Run it and watch it fail or pass honestly**

Run: `npx playwright test`
If it fails, fix the app, not the test — this is the first automated proof the handshake works. A flaky timeout here usually means ICE gathering is slower than the 20s allowances; check the spike numbers from Task 7 before loosening anything.

- [ ] **Step 5: Add the script and wire it into CI**

`package.json`:

```json
"test:e2e": "playwright test"
```

In `.github/workflows/deploy.yml`, insert before the build step:

```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "test: end-to-end two-peer race smoke test

Two browser contexts complete the real manual handshake over loopback, so
no STUN server is involved and the test does not depend on the network.
Also asserts the passage is hidden during the countdown and revealed after."
git push
```

- [ ] **Step 7: Confirm CI is green and the deployed site races**

Watch the Actions run. Then open the Pages URL in two browsers on different networks if you can, and run a real race. That last check is the only one that exercises STUN and real NAT traversal — everything before it runs on loopback.

---

## Done when

- Solo practice works on the deployed Pages URL.
- Two people on different networks can complete a handshake and race.
- `npm test` and `npm run test:e2e` are green in CI.
- A failed connection shows the no-TURN explanation rather than hanging.
- The passage is unreadable until GO in every mode.
