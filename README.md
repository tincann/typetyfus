# typetyfus

A TypeRacer-style typing speed trainer with peer-to-peer multiplayer rooms —
built as pure static assets. No backend, no database, no signaling server.

Practice solo, or create a room and race up to 6 people. Race traffic flows
directly between browsers over WebRTC data channels.

## How the multiplayer works

WebRTC needs peers to exchange connection details before they can talk, and
that normally requires a signaling server. Here a human carries them instead:
the joiner generates a code, sends it to the host by any channel, and pastes
back the code the host returns. Two exchanges per joiner, then a direct
connection with nothing in the middle.

The host acts as a hub — joiners connect to the host, and the host relays
everyone's progress to everyone else.

## One change from TypeRacer

The passage stays hidden until the race starts. In TypeRacer you can speed-read
the text during the countdown, which quietly turns part of the game into a
reading-speed contest. Here everyone starts cold.

## Status

Design complete, implementation not started. See
[the design spec](docs/superpowers/specs/2026-08-26-typetyfus-design.md).

## Known limitations

- **No TURN relay.** Two peers who are both behind symmetric NAT cannot connect.
  A relay would require a server, which defeats the point.
- **No anti-cheat.** Progress is self-reported by each peer and believed.
  Authoritative scoring needs a server.
- The hidden passage is present in the DOM. It is a UX improvement, not a
  security control.
