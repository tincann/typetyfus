import { el } from '../dom'
import type { Racer } from '../../core/raceState'

export function renderResults(racers: Racer[], selfId: string): HTMLElement {
  const body = el('tbody')

  racers.forEach((r, i) => {
    const attrs: Record<string, string> = r.id === selfId ? { class: 'me' } : {}
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
