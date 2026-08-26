# typetyfus — design

**Date:** 2026-08-26
**Status:** approved, ready for implementation planning

A TypeRacer-style typing speed trainer with peer-to-peer multiplayer rooms,
deployed as pure static assets to GitHub Pages. No backend, no database,
no signaling server.

---

## 1. Goals and constraints

**Goal.** Practice typing speed solo, and race up to 6 people (host included) in a room you
invite friends into.

**Hard constraint.** The deployed artifact is static files only. There is no
server we control at runtime. This rules out a signaling server, a TURN relay,
authoritative scoring, and any persistence beyond the browser.

**Deliberate non-goals.**

- Anti-cheat. Progress and WPM are self-reported by each peer and are believed.
  Fixing this requires an authoritative server, which the constraint forbids.
- Accounts, global leaderboards, cross-device history.
- Reconnecting a dropped peer mid-race.
- Mobile-first layout. It should not be broken on a phone, but the target is a
  physical keyboard.

---

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Signaling | Manual code exchange | Zero third-party infrastructure; nothing to trust or outlive |
| Topology | Star, host is hub, hard cap 6 incl. host | Manual handshakes scale linearly, not quadratically |
| Handshake direction | Guest offers, host answers | Lets the host share one stable public URL |
| Input model | Blocking on error | TypeRacer-faithful; makes progress % unambiguous |
| Text source | Seeded generator over a 1000-word list | Peers sync a passage with a single integer |
| Text visibility | Hidden until GO | Removes the pre-read advantage (improvement over TypeRacer) |
| Stack | Vite + TypeScript, no UI framework | Types where they pay off; static output; small app |
| Hosting | GitHub Pages via Actions | Free static hosting, HTTPS required by WebRTC comes free |

---

## 3. Architecture

Static SPA. Five screens, plain DOM, a small typed event bus. No UI framework —
the app is small enough that React would be more ceremony than it earns. If it
starts hurting, Preact can be added later without touching `core/`.

```
src/core/     pure: no DOM, no network  → unit tested
  rng.ts        mulberry32 seeded PRNG
  wordlist.ts   the 1000 most common words (data)
  passage.ts    generatePassage(seed, n) → string[]   deterministic
  typing.ts     blocking-input reducer: keystroke → cursor / error / finished
  stats.ts      WPM (gross + net), accuracy
  raceState.ts  lobby → countdown → running → finished, + peer roster

src/net/
  messages.ts   discriminated union of every wire message + runtime type guards
  sdp.ts        encode/decode: prune SDP → deflate-raw → base64url
  peer.ts       one RTCPeerConnection + data channel, typed events
  room.ts       star topology: host fans out, guest talks only to host

src/ui/         screens; read stores, dispatch events
src/main.ts     wiring
```

**The boundary that matters:** `core/` never imports from `net/` or `ui/`. The
typing engine and scoring are where subtle bugs live, and they must be testable
as plain functions with no browser and no peer.

---

## 4. Signaling

WebRTC requires an offer and an answer to cross between peers before they can
talk. With no server, a human carries them. Two exchanges per guest is the hard
floor — there is no side channel to smuggle either one through.

The handshake is **inverted** relative to the obvious design: guests create the
offer, the host answers. If the host created offers, each guest would need a
different link and the host could not post one invite to a group chat.

**Flow:**

1. Host opens the app, clicks *Create room*, picks a nickname and word count.
   The app rolls a `seed`. No peer connections exist yet.
2. Host shares the plain app URL. One link, reusable, nothing encoded in it.
3. Guest opens it, clicks *Join*, enters a nickname. The app creates an
   `RTCPeerConnection`, opens the data channel, creates an offer, waits for ICE
   gathering to complete, and compresses the result into a join code.
4. Guest sends that code to the host by any channel.
5. Host pastes it into a *pending joiners* box. The app answers. The answer code
   carries room state with it — seed, word count, roster, phase — so the guest
   lands fully synced.
6. Host sends the answer code back. Guest pastes it. Channel opens. Guest
   appears in the lobby.

A 4-person race costs 6 paste operations total, spread across three people.

**No trickle ICE.** Manual signaling cannot deliver late candidates, so a code
cannot be generated until gathering finishes. Gathering against public STUN is
usually sub-second but can hang: 2.5s timeout, then emit with whatever
candidates were gathered.

**No TURN.** A TURN relay is a server. Consequence: two peers who are *both*
behind symmetric NAT cannot connect at all. The app must fail honestly and
promptly rather than spin.

**Open risk, spike first.** Whether a compressed offer fits comfortably in a
pasteable chat message. Estimate: ~2KB of SDP compresses to 550–800 base64url
characters. This is an estimate. If it is wrong the join UX changes shape, so
it gets validated on day one before any UI exists.

---

## 5. Wire protocol

The host relays. Guests only ever talk to the host.

```ts
type PeerId   = string            // random 8-char id minted by the host on accept
type Phase    = 'lobby' | 'countdown' | 'running' | 'finished'
type PeerInfo = { id: PeerId; nick: string; connected: boolean }

type GuestMsg =
  | { t:'hello';    nick: string }
  | { t:'ping';     id: number }
  | { t:'progress'; charIndex: number; errors: number }
  | { t:'done';     ms: number; wpm: number; acc: number }

type HostMsg =
  | { t:'room';  seed: number; wordCount: number; phase: Phase; peers: PeerInfo[]; you: PeerId }
  | { t:'pong';  id: number }
  | { t:'start'; inMs: number }
  | { t:'tick';  p: Array<[PeerId, charIndex: number, errors: number]> }
  | { t:'peers'; peers: PeerInfo[] }
  | { t:'done';  id: PeerId; ms: number; wpm: number; acc: number }
  | { t:'reset'; seed: number; wordCount: number }
```

`tick` batches every peer's progress into one message at 10 Hz rather than
relaying each update separately. That turns the host's fan-out from n² messages
into n, and 10 Hz is past the point where progress bars look smooth.

`messages.ts` owns both the types and hand-written runtime type guards. It is
the single source of truth for the wire format; nothing else parses raw
messages.

---

## 6. Starting together

Guest clocks disagree with the host's, so `start` carries `inMs`, a duration,
not an absolute timestamp. Each guest schedules off its own `performance.now()`,
corrected by a one-way-delay estimate derived from a ping/pong RTT measured at
connect time.

This puts skew in the low tens of milliseconds — irrelevant across a 30-second
race, and enough to make a photo finish honest.

---

## 7. Gameplay

**Passage.** `mulberry32(seed)` samples uniformly from the 1000-word list,
joined with spaces. Word count is selectable at 20 / 40 / 60, default 40
(roughly 30 seconds at 40 WPM). The host broadcasts the seed; every peer
generates identical text locally.

**Input.** Blocking. A wrong character is rejected: the cursor does not advance
and the input shows an error state until the typist backspaces and corrects it.
Every rejected keystroke increments an error counter.

**Reveal.** During the countdown the passage renders normally but under
`filter: blur(10px) opacity(.35)`, transitioning to sharp on GO. Layout stays
pixel-identical so nothing jumps at the start, and the un-blur doubles as the go
cue.

> Honest caveat: the text is present in the DOM, so anyone with devtools open
> can read it early. This is a UX improvement, not a security control, and must
> not be described as one.

**Scoring.** `WPM = (correctChars / 5) / elapsedMinutes`.
`accuracy = correct / (correct + rejectedKeystrokes)`. Accuracy is well-defined
precisely because the input model blocks on errors.

**Persistence.** `localStorage` holds nickname, settings, personal best WPM, and
the last 10 solo results. Nothing leaves the browser.

---

## 8. Screens

1. **Home** — nickname, [Practice solo] [Create room] [Join a room], personal
   best and recent results.
2. **Solo** — passage, live WPM, restart.
3. **Host lobby** — word count, roster, pending-joiner paste box that emits
   answer codes, [Start race].
4. **Join** — nickname → generate join code (copy) → paste answer code → wait.
5. **Race** — passage, one progress bar per player with name / WPM / %,
   countdown overlay.
6. **Results** — final table, [Race again] (host reseeds and broadcasts
   `reset`).

---

## 9. Failure modes

Each has defined behavior. None may hang or crash the race.

| Failure | Behavior |
|---|---|
| ICE gathering hangs | 2.5s timeout, emit code with partial candidates |
| Both peers symmetric NAT | 15s connect timeout → "couldn't connect directly", explain, no retry loop |
| 7th joiner offers a code | Host refuses, surfaces "room is full (6/6)", emits no answer |
| Malformed pasted code | Inline validation error, nothing thrown |
| Guest drops mid-race | Greyed in roster, race continues for everyone else |
| Host drops | Guests jump to results with the data they already have |
| Unknown / invalid message | Dropped and logged, never crashes the race |

---

## 10. Testing

**Vitest against `core/`**, where the real logic lives:

- passage determinism — same seed produces identical words across simulated peers
- typing reducer — blocking, backspace, error counting, finish detection
- stats math
- `messages.ts` type guards, including hostile input
- `sdp.ts` encode → decode roundtrip

Node 18+ ships `CompressionStream`, so the SDP tests run headless with no
browser.

**One Playwright two-context smoke test** that creates a room, joins it, and
races to completion. The star relay is exactly where integration bugs hide and
unit tests will not catch them.

---

## 11. Deployment

- `base: './'` in `vite.config.ts` — relative asset paths work at
  `user.github.io/<anything>/` without hardcoding the repo name, and survive a
  later move to a custom domain.
- **No client-side routing.** Screen changes are in-app state, never URL paths.
  This sidesteps the Pages SPA-rewrite problem, so no `404.html` hack.
- `.github/workflows/deploy.yml` on push to `main`:
  `npm ci` → `npm test` → `npm run build` → `upload-pages-artifact` →
  `deploy-pages`. Tests gate the deploy.
- Repo setting: Pages source = "GitHub Actions" (one-time, manual).
- HTTPS is automatic, and WebRTC requires a secure context, so this lines up.

Note the repo is `tincann/typetyfus` while the local working directory is
`typtyfus`. `base: './'` means the name is never hardcoded, so the difference is
cosmetic.
