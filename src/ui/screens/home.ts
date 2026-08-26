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
