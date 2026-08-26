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
const nick = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_NICK
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
        ? {
            t: 'room', seed: o['seed'], wordCount: o['wordCount'],
            phase: o['phase'] as Phase, peers: o['peers'], you: o['you'],
          }
        : null
    case 'pong':
      return num(o['id']) ? { t: 'pong', id: o['id'] } : null
    case 'start':
      return num(o['inMs']) ? { t: 'start', inMs: o['inMs'] } : null
    case 'tick': {
      const p = o['p']
      if (!Array.isArray(p) || p.length > MAX_PEERS) return null
      const ok = p.every(
        (e) => Array.isArray(e) && e.length === 3 && id(e[0]) && num(e[1]) && num(e[2]),
      )
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
