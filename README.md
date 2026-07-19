# PIXEL PONG

Pixel-art online table tennis. Two players connect **peer-to-peer** — by room code or
quick match — and play a real-rules pong with spin, manual serves and a coin flip.
No accounts, no game servers: the match itself runs entirely between the two browsers.

**Play: [pixel-pong.online](https://pixel-pong.online)** · practice vs AI works offline-ish,
multiplayer needs two devices.

Built 1:1 from a [Pencil](https://pencil.dev) design (`ping pong.pen` — the source of truth
for every color, sprite and screen).

## Features

- **Real table-tennis rules**: coin flip for first serve, manual serve (click / forward
  flick), 2-serve rotation, deuce (win by 2), no volleys, double-bounce & out rules —
  every point in the match log explains WHY it was scored.
- **Spin & inertia**: paddle velocity at contact shapes the shot — lateral swipe curves
  the ball (Magnus), swinging into it adds power.
- **2.5D physics**: ball height, gravity, felt bounces; "what you see is what you hit" —
  the sprite you aim at and the hitbox agree exactly.
- **Netcode**: host-authoritative 60Hz sim, ~190-byte hot snapshots at 60Hz, snapshot
  interpolation with a jitter-adaptive delay buffer on the guest, live ping in the HUD.
- **Quality of life**: same-room rematch handshake, mutual-vote pause, opponent-left
  overlay, real nickname sync, match stats (rallies / duration / aces), real online counter.

## Stack

| Concern | Choice |
|---|---|
| UI | **Vue 3** (`<script setup>` + TS strict), **Vite 6**, **Tailwind v4** (CSS-first `@theme`) |
| Game render | **Canvas 2D** — perspective-projected pixel table, sprites traced from the Pencil components |
| Multiplayer | **[Trystero](https://github.com/dmotz/trystero)** (WebRTC data channels) |
| Signaling | Self-hosted **`@trystero-p2p/ws-relay`** (`relay-server/`, docker) with a public-Nostr fallback for local dev |
| NAT traversal | Self-hosted **coturn** (TURN) for peers that can't connect directly |
| Hosting | Frontend on **Vercel** (CDN), relay + TURN on a small VPS behind Cloudflare |

## Architecture in one paragraph

The browser loads the static SPA from Vercel. To find an opponent it opens a WebSocket to
the relay (`wss://relay.…`) — a tiny pub/sub server used ONLY to exchange WebRTC
handshakes. The two browsers then talk directly over an encrypted data channel (or via
TURN when NATs block direct paths). The peer with the smaller id becomes the **host** and
runs the authoritative physics; the guest sends paddle inputs (~60/s) and renders
interpolated snapshots. Full details in `src/net/room.ts` and `src/game/loop.ts`.

## Run locally

```sh
npm install
npm run dev        # localhost + LAN (host:true) for 2-device testing
npm run typecheck  # vue-tsc --noEmit
npm run build      # production build
```

Open the dev URL in two browsers, CREATE ROOM in one, JOIN in the other (WebRTC needs
`localhost` or https). Without `VITE_RELAY_URLS` the client falls back to public Nostr
relays — fine for dev, unreliable in production. Production env vars (Vercel):
`VITE_RELAY_URLS`, `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS`.

Deploying your own relay/TURN: see **[relay-server/README.md](relay-server/README.md)**
(docker compose, Cloudflare DNS/TLS notes, GitHub Actions auto-deploy).

## Project layout

```
src/
  style.css            design system (Tailwind @theme = Pencil tokens)
  theme/tokens.ts      same tokens as TS constants (for canvas)
  components/          PixelButton, PixelPanel, Wordmark, PixelDecor, CoinFlip
  screens/             MainMenu, Lobby, QuickMatch, GameScreen, ResultScreen, Loading
  composables/         useGameFlow — screen state machine
  net/
    room.ts            Trystero wrapper: strategy switch, actions, host election
    quickMatch.ts      serverless matchmaking (mutual-smallest pairing)
    presence.ts        real "N online" counter
    useNetwork.ts      connection lifecycle + auto-retry
  game/
    types.ts           engine contracts + all tuning constants (FIELD)
    engine.ts          pure physics & rules (deterministic, fixed-dt, sub-stepped)
    loop.ts            rAF loop, modes (local/host/guest), snapshot interpolation
    render.ts          canvas drawing (perspective projection, pixel sprites)
relay-server/          self-hosted signaling + TURN (docker compose)
.github/workflows/     CI (typecheck+build) and relay auto-deploy
```

## Roadmap

**Now**
- [ ] Move the VPS to an EU datacenter (relay/TURN latency for European players)

**Next**
- [ ] Sounds: paddle hit, felt bounce, score, win/lose, coin flip — plus the sound
      toggle button from the Pencil design
- [ ] Mobile: haptic feedback on hits, PWA install (offline practice)
- [ ] Reconnect grace period — resume the match if the opponent returns within ~15s
      instead of instantly ending it

**Later**
- [ ] Practice AI difficulty levels (easy / normal / hard)
- [ ] Best-of-3 / best-of-5 sets (real match format)
- [ ] Pixel emotes / quick-chat between points
- [ ] Colorblind-friendly paddle indicators
- [ ] Accounts & leaderboard (Supabase) — only if it's ever worth it
