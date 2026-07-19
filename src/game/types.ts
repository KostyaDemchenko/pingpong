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
  | 'net' // loser's shot hit the net and never reached the receiver's half
  | 'serve_fault' // serve's first felt touch was not on the server's own half
  | 'short' // loser's return landed on their own half (never crossed)

export interface GameEvent {
  kind: 'serve' | 'point'
  /** who served / who won the point */
  player: 0 | 1
  reason?: PointReason
  scoreHost?: number
  scoreGuest?: number
}

/**
 * Compact 30Hz host->guest snapshot (~300 bytes). The FULL GameState (with
 * events/stats/votes) goes over the wire only ~1/sec and on score changes —
 * shipping the whole state at 30Hz caused multi-KB JSON per tick, which hurts
 * badly when the pair is TURN-relayed.
 */
export interface HotSnapshot {
  seq: number
  phase: GameState['phase']
  serving: 0 | 1
  paused: boolean
  scoreHost: number
  scoreGuest: number
  b: {x: number; y: number; vx: number; vy: number; z: number; vz: number; spin: number}
  hx: number // host paddle
  hy: number
  /** volley-gate mirror: bounce counts since the last hit + who hit last —
   * the guest needs these to render the "armed/disarmed" paddle state at
   * snapshot rate (a paddle is live iff its half was touched AND the owner
   * didn't hit last) */
  bh: number
  bg: number
  lh: 0 | 1
  /** felt-touch counter (GameState.bounceSeq) for guest-side bounce effects */
  bs: number
  /** echo of the guest's latest input timestamp — lets the guest measure RTT */
  et: number
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
  /** total felt touches this match — the renderer diffs it to fire bounce
   * effects (ripple/squash) exactly when the ENGINE says the ball landed,
   * instead of sniffing z between frames (which misses fast bounces) */
  bounceSeq: number
  /** the ball clipped the net since the last hit (drives the 'net' reason) */
  netTouch: boolean
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
  // --- "jpeg" cheat easter egg (per player): max-speed spun shots that always
  // land on the receiver's half ---
  cheatHost: boolean
  cheatGuest: boolean
}

export const FIELD = {
  // Physics sizes ARE the visual sizes: render.ts draws the blade & ball at
  // exactly these model widths via the projection, so "looks like a hit" and
  // "is a hit" agree on every screen. Proportions match the Pencil frames
  // (blade ~17% / ball ~5% of the table width).
  paddleWidth: 0.17,
  ballRadius: 0.026,
  ballSpeed: 0.9, // units/sec
  // Return speed is a BLEND, not an accumulator: keep this share of the
  // incoming speed, refill the rest from ballSpeed, then add the swing bonus.
  // Passive blocks settle near ballSpeed instead of ratcheting to the cap —
  // the ball is only as fast as the swings that are keeping it fast.
  returnBlend: 0.7,
  physicsHz: 60,
  netBroadcastHz: 60, // one ~190B snapshot per physics tick (~12KB/s) — min guest delay
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
  restitution: 0.86, // energy kept on a felt bounce (low values read as "the ball dies")
  returnVz: 1.05, // upward velocity added to a paddle return so it arcs back
  // --- the net is PHYSICAL: a ball crossing the midline below netHeight
  // plops off the mesh and drops on the hitter's side ---
  netHeight: 0.055, // real TT proportion: 15.25cm net vs 274cm table
  netBounce: 0.12, // how much forward speed survives the net plop (reversed)
  rollFriction: 3, // per-sec decay for a ball rolling flat on the felt
  deadBallSpeed: 0.06, // a rally ball slower than this at z=0 is dead -> score it
  // --- REAL serve: struck from serveHeight behind the serve line; vz is
  // SOLVED ballistically so the first bounce lands on the server's own half,
  // clears the net after the bounce, and drops on the receiver's half.
  // Wrong-half touches are still faults (spin/side-outs stay honest). ---
  serveHeight: 0.1, // the ball hovers at paddle height while waiting to serve
  serveOwnBounceFrac: 0.42, // own-half bounce target: this far from the net (of launch depth)
  serveSpeedBase: 0.72, // serve forward speed before the flick bonus
  serveSpeedMax: 0.85, // hard cap keeps every honest serve inside the legal window
  serveVzClamp: 1.5, // sanity clamp for the solved launch vz
  // the serve is struck from BEHIND the serve line (real TT: behind the end
  // line) — the waiting ball is glued no closer to the net than this depth
  hostServeYMax: 0.18,
  guestServeYMin: 0.82,
  // --- proximity hit model: "what you see is what you hit" ---
  // The renderer lifts the ball sprite by z * aimLift IN TABLE-DEPTH UNITS
  // (render.ts uses the same constant), so the sprite's position on the felt
  // and the engine's hit test agree EXACTLY. A hit connects when the paddle
  // covers the ball's visual position OR its true/shadow position — no height
  // gate: a high ball's sprite sits further up-court, which IS its difficulty.
  hitDepth: 0.055, // how close in table depth the paddle must be to connect
  aimLift: 0.6, // sprite lift per unit of ball height, in depth units
  // --- manual serve ---
  serveBallLead: 0.05, // how far in front of the server's paddle the ball waits
  aiServeDelayTicks: 50, // practice AI serves ~0.8s after the serve phase begins
  serveSwingVel: 1.1, // flicking the paddle forward this fast serves too (touch UX)
  // --- spin & inertia (paddle velocity -> shot character) ---
  maxPaddleVel: 4, // clamp per-axis paddle velocity (units/sec) before use
  spinFactor: 0.55, // lateral paddle velocity -> ball spin
  maxSpin: 1.2, // spin clamp
  spinCurve: 1.0, // how strongly spin bends vx (units/sec^2 per spin unit)
  spinDecay: 0.9, // spin fades ~e^-t*decay (too fast reads as losing momentum)
  inertiaPower: 0.12, // forward paddle velocity -> extra shot speed
  // --- overdrive smash (risk/reward): a violent swing breaks the normal speed
  // cap — the ball catches fire, but physics makes overpowered shots overshoot
  // the table (out without touching the receiver's half = hitter loses)
  overdriveSwing: 2.2, // forward swing speed that triggers overdrive
  overdrivePowerMul: 2, // inertia boost multiplier while overdriven
  overdriveMaxSpeed: 2.2, // hard cap for overdriven shots (normal cap is maxSpeed)
  fireSpeed: 1.55, // ball speed above which the flame trail renders
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
    bounceSeq: 0,
    netTouch: false,
    firstServer: -1,
    pointTimer: 0,
    events: [],
    stats: {rallies: 0, aces: [0, 0], ticks: 0},
    rallyHits: 0,
    paused: false,
    pauseVoteHost: false,
    pauseVoteGuest: false,
    cheatHost: false,
    cheatGuest: false,
  }
}
