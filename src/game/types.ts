/**
 * Game engine contracts.
 * Coordinate space is normalized 0..1 so it's resolution-independent and safe
 * to send over the wire. The renderer maps it onto the pixel 3D perspective
 * table from the Pencil design (portrait: you at the bottom, rival at the top).
 */
export interface Ball {
  x: number // 0..1 across table width
  y: number // 0..1 far(0)→near(1)
  vx: number
  vy: number
  radius: number
  // --- 2.5D height, added additively (serializes for free in Snapshot=GameState) ---
  z: number // height above the felt; 0 = resting on the table, arcs upward on hits
  vz: number // vertical velocity (up = positive); gravity pulls it down each step
  /** sideways spin from a lateral paddle swipe; curves vx over time (Magnus) */
  spin: number
}

export interface Paddle {
  x: number // 0..1 center position across the table width
  y: number // 0..1 depth position, clamped to the owner's half (host far, guest near)
  width: number // 0..1
}

/** Why a point was awarded (drives the match-history log). */
export type PointReason =
  | 'double_bounce' // ball bounced twice on the loser's half
  | 'hit_out' // loser knocked the ball out without touching the receiver's half
  | 'missed' // ball bounced on the loser's half and they failed to return it

export interface GameEvent {
  kind: 'serve' | 'point'
  /** who served / who won the point */
  player: 0 | 1
  reason?: PointReason
  scoreHost?: number
  scoreGuest?: number
}

export interface GameState {
  ball: Ball
  host: Paddle // far/top player in the canonical (guest) view
  guest: Paddle
  scoreHost: number
  scoreGuest: number
  serving: 0 | 1
  /** 'coin' = pre-match coin flip; 'point' = between-points pause (pointTimer) */
  phase: 'coin' | 'serve' | 'rally' | 'point' | 'over'
  seq: number
  // --- rules bookkeeping since the last paddle hit ---
  lastHitter: 0 | 1 // who last hit the ball (server counts as first hitter)
  bounceHost: number // felt bounces on the host half since the last hit
  bounceGuest: number // felt bounces on the guest half since the last hit
  /** who serves the FIRST point (coin flip); -1 until decided */
  firstServer: -1 | 0 | 1
  /** ticks left in the between-points pause ('point' phase) */
  pointTimer: number
  /** match history: serves & points with reasons (capped, newest last) */
  events: GameEvent[]
  /** real match stats for the result screen (serialized with snapshots) */
  stats: {
    rallies: number // serves launched = points contested
    aces: [number, number] // unreturned winning serves per player [host, guest]
    ticks: number // 60Hz ticks while the match ran (excludes coin & pause)
  }
  /** paddle returns in the current rally (transient; 0 right after a serve) */
  rallyHits: number
  // --- mutual-vote pause (both must vote to pause AND to resume) ---
  paused: boolean
  pauseVoteHost: boolean
  pauseVoteGuest: boolean
}

export const FIELD = {
  paddleWidth: 0.15, // physics width ~matches the visual blade (was 0.22 = ghost hits)
  ballRadius: 0.02,
  ballSpeed: 0.9, // units/sec
  speedUpPerHit: 1.02, // gentle ramp within a rally (resets every point)
  physicsHz: 60,
  netBroadcastHz: 30,
  pointsToWin: 11, // reach 11 with a 2-point lead (deuce rules)
  servesPerTurn: 2, // server alternates every 2 points (every 1 at deuce)
  pointPauseTicks: 72, // ~1.2s breather between points before the next serve
  hostPaddleY: 0.06, // host spawn depth (far end)
  guestPaddleY: 0.94, // guest spawn depth (near end)
  // depth bands each paddle may move in (its own half, stopping short of the net)
  hostYMin: 0.03,
  hostYMax: 0.42,
  guestYMin: 0.58,
  guestYMax: 0.97,
  maxSpeed: 1.5, // clamp so speed-up can't run away
  maxDeflect: 0.75, // max horizontal vx contribution from an off-center hit
  // integration: cap per-sub-step displacement so fast balls can't tunnel through
  // a paddle plane or the felt (must stay well under ballRadius / paddle halfW)
  maxStepDisp: 0.008,
  maxSubSteps: 12,
  sideMargin: 0.04, // how far past the side edge the ball may fly before it's out
  endMargin: 0.08, // how far past an end the ball may fly before the point is scored
  // --- 2.5D height / bounce tuning (z is in the same normalized units as y) ---
  gravity: 4.0, // downward accel on z (units/sec^2) — pulls the ball back to the felt
  restitution: 0.82, // energy kept on a felt bounce (0.7 made the 2nd bounce feel dead)
  serveVz: 1.0, // upward launch velocity when the ball is served
  returnVz: 1.05, // upward velocity added to a paddle return so it arcs back
  maxHitHeight: 0.35, // ball must be at/below this height to be returnable
  // --- proximity hit model (no more plane-crossing-only registration) ---
  hitDepth: 0.045, // how close in table depth the paddle must be to connect
  aimLift: 0.6, // players aim at the RENDERED ball (lifted by z) — also match
  // the paddle against the ball's visual position, shifted by z * aimLift
  // --- manual serve ---
  serveBallLead: 0.05, // how far in front of the server's paddle the ball waits
  aiServeDelayTicks: 50, // practice AI serves ~0.8s after the serve phase begins
  // --- spin & inertia (paddle velocity -> shot character) ---
  maxPaddleVel: 4, // clamp per-axis paddle velocity (units/sec) before use
  spinFactor: 0.55, // lateral paddle velocity -> ball spin
  maxSpin: 1.2, // spin clamp
  spinCurve: 1.0, // how strongly spin bends vx (units/sec^2 per spin unit)
  spinDecay: 1.1, // spin fades ~e^-t*decay
  inertiaPower: 0.12, // forward paddle velocity -> extra shot speed
} as const

export function initialState(): GameState {
  return {
    ball: {x: 0.5, y: 0.5, vx: 0, vy: 0, radius: FIELD.ballRadius, z: 0, vz: 0, spin: 0},
    host: {x: 0.5, y: FIELD.hostPaddleY, width: FIELD.paddleWidth},
    guest: {x: 0.5, y: FIELD.guestPaddleY, width: FIELD.paddleWidth},
    scoreHost: 0,
    scoreGuest: 0,
    serving: 0,
    phase: 'coin',
    seq: 0,
    lastHitter: 0,
    bounceHost: 0,
    bounceGuest: 0,
    firstServer: -1,
    pointTimer: 0,
    events: [],
    stats: {rallies: 0, aces: [0, 0], ticks: 0},
    rallyHits: 0,
    paused: false,
    pauseVoteHost: false,
    pauseVoteGuest: false,
  }
}
