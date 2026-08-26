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
