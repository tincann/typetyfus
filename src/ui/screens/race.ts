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

const REPORT_INTERVAL_MS = 100

export function mountRace(root: HTMLElement, deps: RaceDeps): void {
  const { room } = deps
  const selfId = room.selfId() ?? HOST_ID
  const text = passageText(room.state().seed, room.state().wordCount)

  let state: TypingState = initTyping(text)
  let startedAt: number | null = null
  let raf = 0
  let reportedAt = 0
  let countdownTimer = 0
  let startTimer = 0
  let shown = false

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

  /** Drives the live clock only; keystrokes redraw themselves. */
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
    draw()

    // Throttle to the room's tick rate; the host batches these anyway.
    const now = performance.now()
    if (now - reportedAt > REPORT_INTERVAL_MS) {
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
    if (shown) return
    shown = true
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
    window.clearInterval(countdownTimer)
    window.clearTimeout(startTimer)
    window.removeEventListener('keydown', onKey)
  }

  room.onStart((inMs) => {
    let remaining = Math.ceil(inMs / 1000)
    countdownBox.textContent = String(remaining)
    countdownTimer = window.setInterval(() => {
      remaining -= 1
      countdownBox.textContent = remaining > 0 ? String(remaining) : ''
      if (remaining <= 0) window.clearInterval(countdownTimer)
    }, 1000)
    startTimer = window.setTimeout(() => {
      countdownBox.textContent = ''
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
