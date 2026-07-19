/**
 * Game loop + canvas lifecycle for pixel-pong.
 *
 * createGame(canvas, opts) returns a GameHandle that runs a requestAnimationFrame
 * loop with a fixed 60Hz physics accumulator and renders every frame. It handles
 * hi-DPI sizing (devicePixelRatio) and keeps the canvas pixelated.
 *
 * Modes:
 *  - 'local' (default): one human drives the near/guest paddle via setPointer;
 *    the far/host paddle is driven by a simple 2-axis tracking AI.
 *  - 'host': this peer owns physics. Feed the remote guest's paddle via
 *    setRemotePaddle(); broadcast getState() snapshots to the guest.
 *  - 'guest': this peer renders authoritative snapshots via applySnapshot() and
 *    predicts only its own (near) paddle locally.
 *
 * View: each player sees THEMSELF at the bottom (near, green). The engine's
 * canonical space has host far / guest near, so in host mode the whole view is
 * flipped (nx -> 1-nx, ny -> 1-ny) for both rendering AND pointer input.
 */
import type {GameState, HotSnapshot} from './types'
import {FIELD} from './types'
import {newGame, step, startMatch as engineStartMatch, type Inputs} from './engine'
import {drawBall, drawPaddle, drawTable, unproject} from './render'

export type GameMode = 'local' | 'host' | 'guest'

export interface GameHandle {
  start(): void
  stop(): void
  destroy(): void
  /** Feed the local pointer position in canvas CSS pixels; the loop maps it
   * onto the table (inverse perspective), flips for the host view, and clamps
   * to the local player's own half. */
  setPointer(px: number, py: number): void
  /** The local player's paddle in MODEL coords (for sending over the net). */
  getLocalPaddle(): {x: number; y: number}
  /** (host mode) Set the remote guest's paddle center in model coords.
   * `t` is the guest's send timestamp — echoed back for RTT measurement. */
  setRemotePaddle(x: number, y: number, t?: number): void
  /** (host mode) Compact 30Hz snapshot for the wire (~300B vs multi-KB state). */
  getHotSnapshot(): HotSnapshot
  /** (guest mode) Apply a compact snapshot (hot path). */
  applyHotSnapshot(h: HotSnapshot): void
  /** (guest mode) Smoothed round-trip time in ms (0 until measured). */
  getPing(): number
  /** (host/local) Publish the coin-flip result while still in the 'coin' phase
   * so guest overlays can reveal the same winner from snapshots. */
  setCoinResult(firstServer: 0 | 1): void
  /** (host/local) Coin flip done — lock the first server & start serving. */
  startMatch(firstServer: 0 | 1): void
  /** Serve click for the given side (host also relays the guest's clicks).
   * The engine ignores it unless that side is actually serving. */
  requestServe(side: 0 | 1): void
  /** Set a side's pause vote (both sides voting toggles paused & resets votes).
   * In practice mode the CPU always agrees, so the player's vote acts alone. */
  setPauseVote(side: 0 | 1, vote: boolean): void
  getState(): GameState
  /** (guest mode) Apply an authoritative snapshot from the host. */
  applySnapshot(s: Partial<GameState>): void
  /** Called whenever the score changes. */
  onScore?: (s: {host: number; guest: number}) => void
}

const FIXED_DT = 1 / FIELD.physicsHz
const MAX_ACCUM = 0.25 // avoid spiral-of-death after a tab stall

interface Options {
  mode?: GameMode
}

export function createGame(canvas: HTMLCanvasElement, opts: Options = {}): GameHandle {
  const mode: GameMode = opts.mode ?? 'local'
  const flip = mode === 'host' // host sees itself near/bottom
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('createGame: 2D context unavailable')

  let state = newGame()
  let raf = 0
  let running = false
  let last = 0
  let accum = 0

  // logical (CSS-pixel) canvas size, updated on resize
  let W = 1
  let H = 1

  // local player's paddle target in MODEL coords + remote guest paddle (host mode)
  const myBand = localBand(mode)
  let localX = 0.5
  let localY: number = mode === 'host' ? FIELD.hostPaddleY : FIELD.guestPaddleY
  let remoteGuestX = 0.5
  let remoteGuestY: number = FIELD.guestPaddleY

  // smoothed AI position for local mode (far/host paddle)
  let aiX = 0.5
  let aiY: number = FIELD.hostPaddleY

  // pending serve clicks (edge-triggered, consumed by the next physics step)
  let serveHostPending = false
  let serveGuestPending = false
  let aiServeTicks = 0

  // (guest) smoothed display positions: snapshots arrive at ~30Hz but we render
  // at 60fps. We keep the last TWO snapshots and render slightly in the past,
  // INTERPOLATING between them (smooth regardless of network jitter); only
  // when the buffer runs dry do we extrapolate ahead.
  interface Sample {
    t: number
    bx: number
    by: number
    bz: number
    bvx: number
    bvy: number
    bvz: number
    hx: number
    hy: number
  }
  let lastSnapAt = 0
  const samples: Sample[] = [] // ~400ms of history, newest last
  let snapGapEma = 17 // measured ms between snapshots
  let snapJitterEma = 4 // measured |gap - average| — network jitter
  const disp = {bx: 0.5, by: 0.5, bz: 0, hx: 0.5, hy: FIELD.hostPaddleY as number}
  // (host) latest guest input timestamp, echoed in hot snapshots for RTT
  let lastGuestInputT = 0
  // (guest) smoothed RTT estimate in ms
  let rttEma = 0

  // last score reported through onScore. Compared each tick against the state,
  // NOT against a pre-physics snapshot — the guest's score changes between
  // ticks via network snapshots, which a before/after diff can never see.
  let notifiedHost = 0
  let notifiedGuest = 0

  const dpr = () => Math.max(1, Math.min(window.devicePixelRatio || 1, 3))

  function resize(): void {
    // layout size, NOT getBoundingClientRect: the CRT screen transition scales
    // the whole screen layer, and a rect measured mid-animation would bake the
    // collapsed size into the canvas buffer (transforms don't retrigger the RO).
    W = Math.max(1, canvas.clientWidth)
    H = Math.max(1, canvas.clientHeight)
    const ratio = dpr()
    const pxW = Math.round(W * ratio)
    const pxH = Math.round(H * ratio)
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW
      canvas.height = pxH
    }
    ctx!.setTransform(ratio, 0, 0, ratio, 0, 0)
    ;(ctx as CanvasRenderingContext2D).imageSmoothingEnabled = false
    canvas.style.imageRendering = 'pixelated'
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null

  /** Simple 2-axis tracking AI for the far/host paddle in local mode. */
  function stepAi(dt: number): void {
    const b = state.ball
    const targetX = clamp01(b.x)
    // come out to meet the ball when it's incoming on the AI half, else go home
    const incoming = b.vy < 0 && b.y < 0.6
    const targetY = incoming
      ? Math.min(Math.max(b.y, FIELD.hostYMin), FIELD.hostYMax)
      : FIELD.hostPaddleY
    const dz = 0.01
    const dx = targetX - aiX
    if (Math.abs(dx) > dz) aiX += Math.sign(dx) * Math.min(Math.abs(dx), 0.9 * dt)
    const dy = targetY - aiY
    if (Math.abs(dy) > dz) aiY += Math.sign(dy) * Math.min(Math.abs(dy), 0.6 * dt)
    aiX = clamp01(aiX)
  }

  /** Compute engine inputs for this tick based on the mode. */
  function computeInputs(dt: number): Inputs {
    // consume pending serve clicks (edge-triggered)
    const serveHost = serveHostPending
    const serveGuest = serveGuestPending
    serveHostPending = false
    serveGuestPending = false

    if (mode === 'host') {
      // host authoritative: own paddle is host, guest comes from the network
      return {hostX: localX, hostY: localY, guestX: remoteGuestX, guestY: remoteGuestY, serveHost, serveGuest}
    }
    // local: human = near/guest; AI = far/host (serves by itself after a beat)
    stepAi(dt)
    let aiServe = serveHost
    if (state.phase === 'serve' && state.serving === 0) {
      if (++aiServeTicks >= FIELD.aiServeDelayTicks) {
        aiServe = true
        aiServeTicks = 0
      }
    } else {
      aiServeTicks = 0
    }
    return {hostX: aiX, hostY: aiY, guestX: localX, guestY: localY, serveHost: aiServe, serveGuest}
  }

  function tick(now: number): void {
    if (!running) return
    if (!last) last = now
    let frameDt = (now - last) / 1000
    last = now
    if (frameDt > MAX_ACCUM) frameDt = MAX_ACCUM
    accum += frameDt

    // guest mode does NOT run physics; it renders the last applied snapshot and
    // only tracks its own paddle locally.
    if (mode !== 'guest') {
      while (accum >= FIXED_DT) {
        state = step(state, FIXED_DT, computeInputs(FIXED_DT))
        accum -= FIXED_DT
      }
    } else {
      accum = 0
      state.guest.x = localX
      state.guest.y = localY
      smoothGuestView(now, frameDt)
    }

    if (state.scoreHost !== notifiedHost || state.scoreGuest !== notifiedGuest) {
      notifiedHost = state.scoreHost
      notifiedGuest = state.scoreGuest
      handle.onScore?.({host: state.scoreHost, guest: state.scoreGuest})
    }

    render()
    raf = requestAnimationFrame(tick)
  }

  /** Model -> view coords (identity for guest/local; 180° flip for host). */
  const vx = (nx: number) => (flip ? 1 - nx : nx)
  const vy = (ny: number) => (flip ? 1 - ny : ny)

  /**
   * (guest) pull the displayed ball & remote paddle toward the extrapolated
   * snapshot state — critically-damped, with a hard snap on teleports (serve
   * resets) so smoothing never rubber-bands across the table.
   */
  function smoothGuestView(now: number, frameDt: number): void {
    const newest = samples[samples.length - 1]
    if (!newest) return
    // adaptive render delay: one snapshot interval + 2x measured jitter — a
    // clean connection renders ~35ms behind; jitter spikes push the buffer
    // back fast (asymmetric EMA) so interpolation rarely runs dry
    const delay = Math.min(180, Math.max(30, snapGapEma + snapJitterEma * 2 + 8))
    const rt = now - delay
    let tx: number
    let ty: number
    let tz: number
    let thx: number
    let thy: number
    if (rt >= newest.t) {
      // buffer dry (late snapshots) — extrapolate ahead of the newest state
      const el = Math.min(0.25, (rt - newest.t) / 1000)
      tx = newest.bx + newest.bvx * el
      ty = newest.by + newest.bvy * el
      tz = Math.max(0, newest.bz + newest.bvz * el - 0.5 * FIELD.gravity * el * el)
      thx = newest.hx
      thy = newest.hy
    } else {
      // walk the history for the two samples straddling the render time
      let a = samples[0]!
      let b = newest
      for (let i = samples.length - 1; i >= 1; i--) {
        if (samples[i - 1]!.t <= rt) {
          a = samples[i - 1]!
          b = samples[i]!
          break
        }
      }
      const span = b.t - a.t
      const f = span > 0 ? Math.min(1, Math.max(0, (rt - a.t) / span)) : 1
      tx = a.bx + (b.bx - a.bx) * f
      ty = a.by + (b.by - a.by) * f
      tz = a.bz + (b.bz - a.bz) * f
      thx = a.hx + (b.hx - a.hx) * f
      thy = a.hy + (b.hy - a.hy) * f
    }
    const a = 1 - Math.pow(0.000005, frameDt)
    if (Math.hypot(tx - disp.bx, ty - disp.by) > 0.15) {
      disp.bx = tx
      disp.by = ty
      disp.bz = tz
    } else {
      disp.bx += (tx - disp.bx) * a
      disp.by += (ty - disp.by) * a
      disp.bz += (tz - disp.bz) * a
    }
    disp.hx += (thx - disp.hx) * a
    disp.hy += (thy - disp.hy) * a
  }

  function render(): void {
    drawTable(ctx!, W, H)
    // my paddle is always the near/green one in MY view; opponent far/red.
    const far = flip ? state.guest : state.host
    const near = flip ? state.host : state.guest
    // guest renders the SMOOTHED remote state, not raw 30Hz snapshots
    const farX = mode === 'guest' ? disp.hx : far.x
    const farY = mode === 'guest' ? disp.hy : far.y
    const bX = mode === 'guest' ? disp.bx : state.ball.x
    const bY = mode === 'guest' ? disp.by : state.ball.y
    const bZ = mode === 'guest' ? disp.bz : state.ball.z
    drawPaddle(ctx!, W, H, vx(farX), vy(farY), false)
    drawBall(
      ctx!,
      W,
      H,
      vx(bX),
      vy(bY),
      bZ,
      flip ? -state.ball.vx : state.ball.vx,
      flip ? -state.ball.vy : state.ball.vy,
    )
    drawPaddle(ctx!, W, H, vx(near.x), vy(near.y), true)
  }

  const handle: GameHandle = {
    start(): void {
      if (running) return
      resize()
      running = true
      last = 0
      accum = 0
      ro?.observe(canvas)
      raf = requestAnimationFrame(tick)
    },
    stop(): void {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      ro?.disconnect()
    },
    destroy(): void {
      handle.stop()
    },
    setPointer(px: number, py: number): void {
      const {nx, ny} = unproject(W, H, px, py)
      localX = clamp01(vx(nx)) // view -> model (vx/vy are involutions)
      localY = Math.min(Math.max(vy(ny), myBand.min), myBand.max)
    },
    getLocalPaddle(): {x: number; y: number} {
      return {x: localX, y: localY}
    },
    setRemotePaddle(x: number, y: number, t = 0): void {
      remoteGuestX = clamp01(x)
      remoteGuestY = Math.min(Math.max(y, FIELD.guestYMin), FIELD.guestYMax)
      if (t > 0) lastGuestInputT = t
    },
    getHotSnapshot(): HotSnapshot {
      const b = state.ball
      return {
        seq: state.seq,
        phase: state.phase,
        serving: state.serving,
        paused: state.paused,
        scoreHost: state.scoreHost,
        scoreGuest: state.scoreGuest,
        b: {x: b.x, y: b.y, vx: b.vx, vy: b.vy, z: b.z, vz: b.vz, spin: b.spin},
        hx: state.host.x,
        hy: state.host.y,
        et: lastGuestInputT,
      }
    },
    applyHotSnapshot(h: HotSnapshot): void {
      if (h.seq < state.seq) return
      const nowMs = performance.now()
      if (lastSnapAt) {
        const gap = Math.min(250, nowMs - lastSnapAt)
        snapGapEma = snapGapEma * 0.8 + gap * 0.2
        const dev = Math.abs(gap - snapGapEma)
        // asymmetric: spikes raise the estimate instantly, calm decays it slowly
        snapJitterEma =
          dev > snapJitterEma ? snapJitterEma * 0.5 + dev * 0.5 : snapJitterEma * 0.95 + dev * 0.05
      }
      lastSnapAt = nowMs
      samples.push({
        t: nowMs,
        bx: h.b.x,
        by: h.b.y,
        bz: h.b.z,
        bvx: h.b.vx,
        bvy: h.b.vy,
        bvz: h.b.vz,
        hx: h.hx,
        hy: h.hy,
      })
      while (samples.length > 30 || (samples.length > 2 && nowMs - samples[0]!.t > 450)) {
        samples.shift()
      }
      state.seq = h.seq
      state.phase = h.phase
      state.serving = h.serving
      state.paused = h.paused
      state.scoreHost = h.scoreHost
      state.scoreGuest = h.scoreGuest
      state.ball = {...state.ball, ...h.b}
      state.host.x = h.hx
      state.host.y = h.hy
      if (h.et > 0) {
        const rtt = performance.now() - h.et
        if (rtt >= 0 && rtt < 5000) rttEma = rttEma ? rttEma * 0.8 + rtt * 0.2 : rtt
      }
    },
    getPing(): number {
      return Math.round(rttEma)
    },
    setCoinResult(firstServer: 0 | 1): void {
      state.firstServer = firstServer
    },
    startMatch(firstServer: 0 | 1): void {
      if (state.phase === 'coin') engineStartMatch(state, firstServer)
    },
    requestServe(side: 0 | 1): void {
      if (side === 0) serveHostPending = true
      else serveGuestPending = true
    },
    setPauseVote(side: 0 | 1, vote: boolean): void {
      if (side === 0) state.pauseVoteHost = vote
      else state.pauseVoteGuest = vote
      // practice: the CPU is always agreeable — mirror the player's vote
      if (mode === 'local') state.pauseVoteHost = state.pauseVoteGuest
    },
    getState(): GameState {
      return state
    },
    applySnapshot(s: Partial<GameState>): void {
      // drop stale snapshots by seq when available
      if (typeof s.seq === 'number' && s.seq < state.seq) return
      lastSnapAt = performance.now()
      state = {
        ...state,
        ...s,
        ball: s.ball ? {...state.ball, ...s.ball} : state.ball,
        host: s.host ? {...state.host, ...s.host} : state.host,
        guest: s.guest ? {...state.guest, ...s.guest} : state.guest,
      }
    },
  }

  return handle
}

function localBand(mode: GameMode): {min: number; max: number} {
  return mode === 'host'
    ? {min: FIELD.hostYMin, max: FIELD.hostYMax}
    : {min: FIELD.guestYMin, max: FIELD.guestYMax}
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
