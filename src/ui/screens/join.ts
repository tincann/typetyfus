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
  const status = el('p', { class: 'muted' }, ['Generating your join code…'])
  const back = el('button', {}, ['Cancel'])
  back.addEventListener('click', deps.onExit)

  clear(root)
  root.append(
    el('h1', {}, ['Join a room']),
    status,
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
          // onReady, not onOpen: the seed arrives in the host's room message,
          // which is sent in reply to our hello. Entering on open would render
          // a passage from the placeholder seed.
          room.onReady(() => deps.onRace(room))
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

    status.textContent = 'Send the first code to the host, then paste back what they reply with.'
    clear(slot)
    slot.append(
      codeOutput('Send this code to the host', offerCode),
      paste.node,
    )
  })
}
