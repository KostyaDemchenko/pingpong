/**
 * Physics & scoring for pixel-pong, as pure-ish functions over GameState.
 *
 * Coordinate model (from types.ts): normalized 0..1.
 *   x = 0..1 across table width, y = 0..1 far(0) -> near(1).
 *   host  = far/top player, moves in FIELD.hostYMin..hostYMax.
 *   guest = near/bottom player, moves in FIELD.guestYMin..guestYMax.
 *
 * step() is deterministic and fixed-timestep friendly: call it with a fixed dt
 * from an accumulator (see loop.ts). Internally each tick is split into
 * sub-steps so the per-sub-step displacement stays below FIELD.maxStepDisp —
 * that's what prevents a fast ball from tunneling through a paddle plane or
 * skipping the felt bounce.
 *
 * Table-tennis rules implemented (simplified):
 *  - Coin flip decides the first server (phase 'coin' until startMatch()).
 *  - MANUAL serve: during 'serve' the ball waits in front of the server's
 *    paddle; the server launches it via Inputs.serveHost/serveGuest (a click).
 *  - Server alternates every 2 points; every 1 point from 10:10 (deuce).
 *  - Win at 11+ with a 2-point lead.
 *  - NO volleys: a paddle can only return the ball after it has bounced on
 *    that player's half since the opponent's hit (else it passes through).
 *  - Ball out (past a side OR an end): if it bounced on the receiver's half
 *    since the last hit, the hitter wins the point; otherwise the hitter loses.
 *  - Two felt bounces on one half since the last hit: that half's owner
 *    failed to return -> the other side scores.
 *  - Between points there's a short pause (phase 'point' + pointTimer).
 *
 * Spin & inertia: paddle velocity at contact shapes the shot — lateral swipe
 * adds spin (curves the ball via a Magnus-ish vx acceleration that decays),
 * swinging INTO the ball adds shot speed.
 */
import type {GameEvent, GameState, Paddle, PointReason} from './types'
import {FIELD, initialState} from './types'

export interface Inputs {
  /** host paddle center, 0..1 (far/top player) */
  hostX: number
  hostY: number
  /** guest paddle center, 0..1 (near/bottom player) */
  guestX: number
  guestY: number
  /** edge-triggered serve clicks; only the current server's flag is honored */
  serveHost?: boolean
  serveGuest?: boolean
}

/** Paddle velocities for this tick (units/sec, clamped), derived in step(). */
interface PaddleVel {
  hostVx: number
  hostVy: number
  guestVx: number
  guestVy: number
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0)

/** Append to the match history, capped so snapshots stay small. */
function pushEvent(state: GameState, ev: GameEvent): void {
  state.events.push(ev)
  if (state.events.length > 40) state.events.shift()
}

/** Where the served ball waits: just in front of the server's paddle. */
function glueBallToServer(state: GameState): void {
  const server: Paddle = state.serving === 0 ? state.host : state.guest
  const lead = state.serving === 0 ? FIELD.serveBallLead : -FIELD.serveBallLead
  state.ball.x = server.x
  state.ball.y = server.y + lead
  state.ball.vx = 0
  state.ball.vy = 0
  state.ball.z = 0
  state.ball.vz = 0
  state.ball.spin = 0
}

/**
 * Reset the ball to the server's paddle and schedule the next serve.
 * `pause` = true inserts the between-points breather (phase 'point').
 */
export function serveReset(state: GameState, server: 0 | 1, pause = false): GameState {
  state.serving = server
  glueBallToServer(state)
  state.phase = pause ? 'point' : 'serve'
  state.pointTimer = pause ? FIELD.pointPauseTicks : 0
  return state
}

/** Real serve rotation: every 2 points, every 1 from deuce (10:10). */
function nextServer(state: GameState): 0 | 1 {
  const first = state.firstServer === 1 ? 1 : 0 // -1 falls back to host
  const total = state.scoreHost + state.scoreGuest
  const deuce = state.scoreHost >= FIELD.pointsToWin - 1 && state.scoreGuest >= FIELD.pointsToWin - 1
  const swaps = deuce ? total : Math.floor(total / FIELD.servesPerTurn)
  return swaps % 2 === 0 ? first : other(first)
}

/** Award a point to host (0) or guest (1); transitions to over/point-pause. */
function scorePoint(state: GameState, winner: 0 | 1, reason: PointReason): void {
  // ace: nobody returned the serve and the point went to the server
  if (state.rallyHits === 0 && winner === state.lastHitter) state.stats.aces[winner]++
  if (winner === 0) state.scoreHost++
  else state.scoreGuest++
  pushEvent(state, {kind: 'point', player: winner, reason, scoreHost: state.scoreHost, scoreGuest: state.scoreGuest})

  const hi = Math.max(state.scoreHost, state.scoreGuest)
  const lead = Math.abs(state.scoreHost - state.scoreGuest)
  if (hi >= FIELD.pointsToWin && lead >= 2) {
    state.phase = 'over'
    state.ball.vx = 0
    state.ball.vy = 0
    state.ball.spin = 0
    state.paused = false
    state.pauseVoteHost = false
    state.pauseVoteGuest = false
    return
  }
  serveReset(state, nextServer(state), true)
}

/** Verdict for an out-of-bounds ball, per the touched-the-receiver-half rule. */
function outVerdict(state: GameState): {winner: 0 | 1; reason: PointReason} {
  const receiver = other(state.lastHitter)
  const receiverTouched = receiver === 0 ? state.bounceHost >= 1 : state.bounceGuest >= 1
  return receiverTouched
    ? {winner: state.lastHitter, reason: 'missed'}
    : {winner: receiver, reason: 'hit_out'}
}

/** Advance the simulation by dtSec seconds (call at a fixed dt). */
export function step(state: GameState, dtSec: number, inputs: Inputs): GameState {
  // mutual-vote pause: when BOTH sides vote, the paused state flips and the
  // votes reset (so resuming needs a fresh double vote too). Everything freezes.
  if (state.phase === 'rally' || state.phase === 'serve' || state.phase === 'point') {
    if (state.pauseVoteHost && state.pauseVoteGuest) {
      state.paused = !state.paused
      state.pauseVoteHost = false
      state.pauseVoteGuest = false
    }
    if (state.paused) return state
  }

  // remember where the paddles were BEFORE this tick's input is applied
  const oldHostX = state.host.x
  const oldHostY = state.host.y
  const oldGuestX = state.guest.x
  const oldGuestY = state.guest.y

  // paddles follow inputs immediately (host authoritative; guest predicts
  // locally). x spans the FULL table width so edge balls stay reachable.
  const halfW = state.host.width / 2
  state.host.x = clamp(inputs.hostX, 0, 1)
  state.host.y = clamp(inputs.hostY, FIELD.hostYMin, FIELD.hostYMax)
  state.guest.x = clamp(inputs.guestX, 0, 1)
  state.guest.y = clamp(inputs.guestY, FIELD.guestYMin, FIELD.guestYMax)

  // paddle velocities (units/sec, clamped) — drive spin & shot power
  const mv = FIELD.maxPaddleVel
  const pv: PaddleVel = {
    hostVx: clamp((state.host.x - oldHostX) / dtSec, -mv, mv),
    hostVy: clamp((state.host.y - oldHostY) / dtSec, -mv, mv),
    guestVx: clamp((state.guest.x - oldGuestX) / dtSec, -mv, mv),
    guestVy: clamp((state.guest.y - oldGuestY) / dtSec, -mv, mv),
  }

  if (state.phase === 'over' || state.phase === 'coin') return state

  state.stats.ticks++ // match clock (runs through rallies & point pauses)

  // between-points breather: ball rests at the next server's paddle
  if (state.phase === 'point') {
    glueBallToServer(state)
    if (state.pointTimer > 0) {
      state.pointTimer--
      return state
    }
    state.phase = 'serve'
    return state
  }

  // manual serve: ball follows the server's paddle until they either CLICK or
  // FLICK the paddle forward fast enough (the natural touch gesture — the
  // swing's speed & sideways motion feed power/spin exactly like a click serve)
  if (state.phase === 'serve') {
    glueBallToServer(state)
    const dir = state.serving === 0 ? 1 : -1 // host serves toward near/guest
    const pvx = state.serving === 0 ? pv.hostVx : pv.guestVx
    const pvy = state.serving === 0 ? pv.hostVy : pv.guestVy
    const clicked = state.serving === 0 ? inputs.serveHost : inputs.serveGuest
    const flicked = dir * pvy >= FIELD.serveSwingVel
    if (!clicked && !flicked) return state
    const drift = ((state.seq % 7) / 7 - 0.5) * 0.25 * FIELD.ballSpeed
    const speed = Math.min(FIELD.ballSpeed + Math.max(0, dir * pvy) * FIELD.inertiaPower, FIELD.maxSpeed)
    state.ball.vx = drift
    state.ball.vy = dir * speed
    state.ball.vz = FIELD.serveVz
    state.ball.spin = clamp(pvx * FIELD.spinFactor, -FIELD.maxSpin, FIELD.maxSpin)
    state.lastHitter = state.serving
    state.bounceHost = 0
    state.bounceGuest = 0
    state.rallyHits = 0
    state.stats.rallies++
    state.phase = 'rally'
    state.seq++
    pushEvent(state, {kind: 'serve', player: state.serving})
    return state
  }

  const b = state.ball

  // swept contact: paddle INPUT jumps once per tick while the ball moves in
  // sub-steps — a fast swing (power/spin hits!) can carry the paddle clean
  // over the proximity window between two ticks. If the paddle plane crossed
  // the ball's TRUE or VISUAL position this tick, that's a hit too.
  const hostVisY = b.y + b.z * FIELD.aimLift
  const guestVisY = b.y - b.z * FIELD.aimLift
  if (
    b.vy < 0 &&
    ((oldHostY < b.y && state.host.y >= b.y) || (oldHostY < hostVisY && state.host.y >= hostVisY))
  ) {
    tryPaddleHit(state, 0, halfW, 1, pv.hostVx, pv.hostVy)
  } else if (
    b.vy > 0 &&
    ((oldGuestY > b.y && state.guest.y <= b.y) ||
      (oldGuestY > guestVisY && state.guest.y <= guestVisY))
  ) {
    tryPaddleHit(state, 1, halfW, -1, pv.guestVx, pv.guestVy)
  }

  // --- rally integration, sub-stepped against tunneling ---
  const maxV = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz))
  const n = clamp(Math.ceil((maxV * dtSec) / FIELD.maxStepDisp), 1, FIELD.maxSubSteps)
  const dt = dtSec / n

  for (let i = 0; i < n; i++) {
    if (subStep(state, dt, halfW, pv)) break // point resolved; stop this tick
  }
  return state
}

/**
 * One integration sub-step. Returns true when the rally ended (point scored),
 * so the caller stops integrating the remainder of the tick.
 */
function subStep(state: GameState, dt: number, halfW: number, pv: PaddleVel): boolean {
  const b = state.ball

  // Magnus-ish curve: spin bends the sideways velocity, then fades
  b.vx += b.spin * FIELD.spinCurve * dt
  b.spin *= Math.max(0, 1 - FIELD.spinDecay * dt)

  b.x += b.vx * dt
  b.y += b.vy * dt

  // vertical (height) integration: gravity pulls the ball back to the felt,
  // where it bounces — this is what makes the ball arc & bounce like 2.5D pong.
  b.vz -= FIELD.gravity * dt
  b.z += b.vz * dt
  if (b.z <= 0) {
    b.z = 0
    if (b.vz < 0) {
      b.vz = -b.vz * FIELD.restitution
      // felt touch: book it on the half it landed on; a SECOND bounce on the
      // same half since the last hit means that side failed to return.
      if (b.y < 0.5) {
        if (++state.bounceHost >= 2) {
          scorePoint(state, 1, 'double_bounce')
          return true
        }
      } else {
        if (++state.bounceGuest >= 2) {
          scorePoint(state, 0, 'double_bounce')
          return true
        }
      }
    }
    // let tiny residual bounces settle so the ball rolls flat instead of jittering
    if (Math.abs(b.vz) < 0.02) b.vz = 0
  }

  // SIDE out-of-bounds: no invisible walls — the ball flies off the table
  if (b.x < -FIELD.sideMargin || b.x > 1 + FIELD.sideMargin) {
    const v = outVerdict(state)
    scorePoint(state, v.winner, v.reason)
    return true
  }

  // paddle contact — PROXIMITY, not plane-crossing: the return connects
  // whenever the incoming ball is near the paddle, so late hits (after the
  // ball already passed your depth and you reach back for it) work naturally.
  if (b.vy < 0 && paddleReaches(state, 0)) {
    if (tryPaddleHit(state, 0, halfW, 1, pv.hostVx, pv.hostVy)) return false
  } else if (b.vy > 0 && paddleReaches(state, 1)) {
    if (tryPaddleHit(state, 1, halfW, -1, pv.guestVx, pv.guestVy)) return false
  }

  // END out-of-bounds: same touched-the-receiver-half rule as the sides
  if (b.y < -FIELD.endMargin || b.y > 1 + FIELD.endMargin) {
    const v = outVerdict(state)
    scorePoint(state, v.winner, v.reason)
    return true
  }

  return false
}

/**
 * Is the ball within the paddle's reach in table DEPTH? Matches against the
 * ball's true position AND its VISUAL position — the rendered sprite is lifted
 * by z toward the viewer's far side, and players aim at what they see, so a
 * paddle placed "under the sprite" must also connect. Sub-stepping keeps the
 * per-step displacement well below the hitDepth window, so nothing tunnels.
 */
function paddleReaches(state: GameState, hitter: 0 | 1): boolean {
  const p = hitter === 0 ? state.host : state.guest
  const b = state.ball
  // for the guest's (bottom) view the lift shifts the sprite toward smaller y;
  // for the host's flipped view — toward larger y
  const visualY = hitter === 0 ? b.y + b.z * FIELD.aimLift : b.y - b.z * FIELD.aimLift
  return Math.abs(b.y - p.y) <= FIELD.hitDepth || Math.abs(visualY - p.y) <= FIELD.hitDepth
}

/**
 * Test & resolve a paddle hit at the paddle's own depth plane. A return is
 * valid only when:
 *  - the ball has bounced on the hitter's half since the opponent's hit
 *    (NO volleys — otherwise the ball simply passes through the paddle),
 *  - the paddle covers the ball's x,
 *  - the ball is low enough (z <= maxHitHeight).
 * Paddle velocity shapes the shot: lateral -> spin, forward -> extra speed.
 * `dir` = +1 sends the ball toward near (down), -1 toward far (up).
 */
function tryPaddleHit(
  state: GameState,
  hitter: 0 | 1,
  halfW: number,
  dir: 1 | -1,
  pvx: number,
  pvy: number,
): boolean {
  // volley gate: your paddle is "live" only after the ball touched your half
  if ((hitter === 0 ? state.bounceHost : state.bounceGuest) < 1) return false

  const paddle = hitter === 0 ? state.host : state.guest
  const b = state.ball
  const dx = b.x - paddle.x
  if (Math.abs(dx) > halfW + b.radius) return false // paddle didn't cover the ball's x

  // snap back onto the plane and send it the other way
  b.y = paddle.y

  // speed-up per hit + inertia bonus for swinging INTO the ball. A violent
  // swing (>= overdriveSwing) goes into OVERDRIVE: doubled boost past the
  // normal cap — spectacular, but fast flat shots overshoot the table and
  // hand the point to the receiver (out without touching their half).
  const swing = Math.max(0, dir * pvy)
  const overdrive = swing >= FIELD.overdriveSwing
  const boost = swing * FIELD.inertiaPower * (overdrive ? FIELD.overdrivePowerMul : 1)
  const cap = overdrive ? FIELD.overdriveMaxSpeed : FIELD.maxSpeed
  const speed = Math.min(Math.hypot(b.vx, b.vy) * FIELD.speedUpPerHit + boost, cap)

  // angle from hit offset: center = straight, edges = steep deflection
  const offset = clamp(dx / halfW, -1, 1)
  const vxNorm = offset * FIELD.maxDeflect
  const vyMag = Math.sqrt(Math.max(0.0001, 1 - vxNorm * vxNorm))
  b.vx = vxNorm * speed
  b.vy = dir * vyMag * speed
  // lateral swipe puts spin on the ball; fresh contact replaces old spin
  b.spin = clamp(pvx * FIELD.spinFactor, -FIELD.maxSpin, FIELD.maxSpin)
  // give the return an upward arc so it bounces on the way back
  b.vz = FIELD.returnVz

  state.lastHitter = hitter
  state.bounceHost = 0
  state.bounceGuest = 0
  state.rallyHits++
  return true
}

/** Fresh match waiting on the coin flip (phase 'coin'). */
export function newGame(): GameState {
  return initialState()
}

/** Coin flip resolved: lock the first server and hand them the ball. */
export function startMatch(state: GameState, firstServer: 0 | 1): GameState {
  state.firstServer = firstServer
  return serveReset(state, firstServer, true)
}
