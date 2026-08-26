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
