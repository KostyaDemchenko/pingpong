# src/game — Canvas 2D engine

Pixel-art 3D-perspective table-tennis engine. Pure drawing (`render.ts`),
pure-ish physics (`engine.ts`), and the RAF loop + canvas lifecycle (`loop.ts`).

## Coordinate model
Normalized `0..1`: `x` across table width, `y` from far(0) → near(1).
`host` = far/top player (red), `guest` = near/bottom player (green).

## Public API — `createGame`

```ts
import {createGame, type GameHandle} from '@/game/loop'

const game = createGame(canvasEl, {mode: 'local'}) // 'local' | 'host' | 'guest'
game.onScore = ({host, guest}) => { /* update HUD */ }
game.start()

// input (near/guest paddle, 0..1 across width):
game.setLocalPaddle(x)

// teardown:
game.stop()      // pause loop
game.destroy()   // stop + release observers
```

`GameHandle`:
- `start()` / `stop()` / `destroy()`
- `setLocalPaddle(x: number)` — local human paddle (near/guest), 0..1
- `setRemotePaddle(x: number)` — (host mode) remote guest paddle input
- `getState(): GameState`
- `applySnapshot(s: Partial<GameState>)` — (guest mode) apply host snapshot; stale `seq` dropped
- `onScore?({host, guest})` — assign to receive score changes

## Modes
- **local** (default): human drives the near/guest paddle; a simple tracking AI
  drives the far/host paddle (capped speed, deadzone). Fully runnable with one input.
- **host**: this peer runs the 60Hz physics. Feed the remote guest paddle via
  `setRemotePaddle()`, broadcast `getState()` snapshots @~30Hz.
- **guest**: physics is NOT run locally; call `applySnapshot()` with host snapshots
  and `setLocalPaddle()` to predict your own near paddle.

## GameScreen wiring (one player, local)
```ts
const game = createGame(canvas.value!, {mode: 'local'})
game.onScore = ({host, guest}) => { scoreHost.value = host; scoreGuest.value = guest }
game.start()
// pointer/touch → normalized x:
function onMove(e) {
  const r = canvas.value!.getBoundingClientRect()
  game.setLocalPaddle((e.clientX - r.left) / r.width)
}
onBeforeUnmount(() => game.destroy())
```
Later for P2P: guest feeds input via `setLocalPaddle`, host state via `applySnapshot`.

## Rules
First to `FIELD.pointsToWin` (11). Ball speeds up `FIELD.speedUpPerHit` per hit
(clamped by `FIELD.maxSpeed`); hit angle depends on where the ball strikes the paddle.
