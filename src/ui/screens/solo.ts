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
  const hint = el('p', { class: 'muted' }, ['The text is hidden until the countdown ends.'])
  const restart = el('button', {}, ['Restart'])
  const back = el('button', {}, ['Back'])

  function draw(): void {
    clear(passageBox)
    passageBox.append(renderPassage(state, { hidden: startedAt === null }))
    const elapsed = startedAt === null ? 0 : performance.now() - startedAt
    wpmOut.textContent = String(wpm(state.cursor, elapsed))
    accOut.textContent = `${Math.round(accuracy(state.cursor, state.errors) * 100)}%`
  }

  /** Drives only the live WPM readout; keystrokes redraw themselves. */
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
    // Redraw immediately rather than waiting for the rAF loop: browsers pause
    // rAF in background tabs, and keystroke feedback must never be delayed.
    draw()
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
      hint.remove()
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
    hint,
    el('div', { class: 'row' }, [restart, back]),
  )

  draw()
  startCountdown()
}
