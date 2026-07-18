# PIXEL PONG

Pixel-art online table-tennis. Two players connect **peer-to-peer by room code** — no
backend, no accounts. Built from the Pencil design (`ping pong.pen`).

## Stack

| Concern | Choice | Why |
|---|---|---|
| UI | **Vue 3 + `<script setup>` + TS** | Lighter than React, plenty for the screen shells |
| Build | **Vite 6** | Fast dev, static SPA output (deploy anywhere) |
| Styling | **Tailwind v4 (CSS-first `@theme`)** | Pencil design tokens map 1:1 → utilities |
| Game render | **Canvas 2D** | Per-pixel control of the 3D perspective table |
| Multiplayer | **[Trystero](https://github.com/dmotz/trystero) (Nostr)** | Serverless WebRTC P2P, zero-config, room = code |
| Backend / auth | **none (for now)** | No user data collected → Supabase deferred |

> Nuxt was considered and dropped: there's no SSR/backend to justify it — this is a
> client-only P2P SPA.

## Design system

The Pencil design is the source of truth. Its variables are ported verbatim:

- **Colors / fonts / spacing** → `src/style.css` (`@theme`) as Tailwind tokens
  (`bg-bg-base`, `text-brand`, `border-border-strong`, `font-display`, `p-md`, `gap-lg`, …).
- Same tokens as TS constants in `src/theme/tokens.ts` for canvas drawing.
- Fonts: **Press Start 2P** (display) + **Silkscreen** (body), loaded in `index.html`.
- Pixel rules baked in: sharp corners, hard blur-less shadows (`pixel-shadow*` utilities),
  `image-rendering: pixelated`, no font anti-aliasing.
- Ported components: `PixelButton`, `PixelPanel`, `Wordmark` — mirrors of the Pencil
  reusable components (`PixelButton`, `Paddle`, `Ball`).

## Multiplayer (Trystero)

All P2P is isolated in **`src/net/room.ts`** (nothing else imports `trystero`, so a version
bump touches one file; the wrapper even normalizes the `makeAction` object-vs-tuple API shape).

- `joinRoom({appId, password: code}, code)` — the **room code is the `roomId`** (and the
  password), so only matching codes ever connect and signaling stays private.
- **Host election** is server-less & deterministic: the peer with the smaller `selfId` hosts.
- **Host-authoritative** model: host simulates physics @60Hz and broadcasts `state` @30Hz;
  guest sends only paddle input and renders authoritative snapshots (with local prediction).
- Actions: `paddle`, `state`, `ready`, `rematch`.

## Run

Node is required (project uses Homebrew node at `/opt/homebrew/bin`; add it to PATH if needed):

```sh
cd "/Users/user/Desktop/pixel-pong"
npm install
npm run dev            # opens on localhost + LAN (host:true) for 2-device testing
```

Open the dev URL in **two browsers/devices**, CREATE a room in one, JOIN with the code in
the other. (WebRTC needs a secure context — `localhost` and `https://` are fine.)

> If `npm install` resolves a `trystero` version whose API differs from the reviewed v0.25.2
> (e.g. different import path or the older `[send,get]` tuple), only `src/net/room.ts` needs
> tweaking — the wrapper already handles both action shapes.

## Project layout

```
src/
  style.css            design system (Tailwind @theme = Pencil tokens)
  theme/tokens.ts       tokens as TS (for canvas)
  components/           PixelButton, PixelPanel, Wordmark
  screens/              MainMenu, Lobby, GameScreen, ResultScreen, LoadingScreen
  composables/          useGameFlow (screen state machine + room code)
  net/room.ts           Trystero wrapper (createRoom, actions, host election)
  game/types.ts         engine contracts (normalized 0..1 state)
```

## Roadmap

- [x] Scaffold + design system (tokens, fonts, pixel utilities)
- [x] Screen flow + core components + Trystero wrapper/architecture
- [ ] Canvas engine: 3D perspective pixel table + paddles/ball (port visuals from Pencil)
- [ ] Physics + scoring (host-authoritative), serve/rally/point states
- [ ] Wire Trystero into Lobby→Game (connect, sync, rematch, opponent-left handling)
- [ ] Input: pointer/touch paddle control + local prediction
- [ ] Polish: sounds, loading→match transition, responsive desktop/mobile layouts
```
