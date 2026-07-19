/**
 * Pure Canvas 2D drawing for the pixel-art 3D-perspective table-tennis table.
 * Faithful port of the Pencil design (ping pong.pen — Court 3D in
 * `Game — Mobile` KvwNN / `Game — Desktop` UVoMS): you at the bottom/near,
 * opponent at the top/far, net across the middle.
 *
 * Everything is drawn from the normalized 0..1 game coordinates via project():
 *   nx = 0..1 across table width, ny = 0..1 far(0) -> near(1).
 * Depth uses a TRUE perspective mapping (not linear): the model midpoint
 * ny=0.5 lands at ~42% of the screen span — exactly where the design puts the
 * net & far-shade boundary. Near objects render larger than far ones.
 *
 * Style: sharp pixel edges, hard blur-less offset shadows, flat colors, black
 * outlines. Colors come from src/theme/tokens.ts (ported from the .pen file).
 */
import {colors} from '@/theme/tokens'
import {FIELD} from '@/game/types'

interface TableGeom {
  farY: number // top (far) edge y, fraction of H
  nearY: number // bottom (near) edge y, fraction of H
  farHalf: number // half-width of the far edge, fraction of W
  nearHalf: number // half-width of the near edge, fraction of W
  thickness: number // table slab thickness, fraction of H
  sideTaper: number // how much the slab bottom tapers in, fraction of near width
}

/** Trapezoid geometry measured from the Pencil frames (portrait vs landscape). */
const PORTRAIT: TableGeom = {farY: 0.13, nearY: 0.81, farHalf: 0.35, nearHalf: 0.48, thickness: 0.045, sideTaper: 0.017}
const LANDSCAPE: TableGeom = {farY: 0.13, nearY: 0.82, farHalf: 0.31, nearHalf: 0.47, thickness: 0.04, sideTaper: 0.013}

export function tableGeom(W: number, H: number): TableGeom {
  return W > H ? LANDSCAPE : PORTRAIT
}

export interface Projected {
  sx: number
  sy: number
  /** linear width scale at this depth: farHalf/nearHalf at ny=0, 1 at ny=1 */
  scale: number
  /** screen pixels per model-x unit at this depth — sprites sized with this
   * render at EXACTLY their physics width ("what you see is what you hit") */
  xpu: number
}

/** Model depth u (0 far..1 near) -> screen depth t (0..1), true perspective. */
function depthT(u: number, g: TableGeom): number {
  return (u * g.farHalf) / (g.nearHalf + u * (g.farHalf - g.nearHalf))
}

/** Screen depth t -> model depth u (inverse of depthT). */
function depthU(t: number, g: TableGeom): number {
  return (t * g.nearHalf) / (g.farHalf + t * (g.nearHalf - g.farHalf))
}

/** Map a normalized point (nx, ny) to screen pixels on the perspective table. */
export function project(W: number, H: number, nx: number, ny: number): Projected {
  const g = tableGeom(W, H)
  const t = depthT(clamp01(ny), g)
  const sy = (g.farY + (g.nearY - g.farY) * t) * H
  const half = (g.farHalf + (g.nearHalf - g.farHalf) * t) * W
  const sx = W / 2 + (nx - 0.5) * 2 * half
  return {sx, sy, scale: half / (g.nearHalf * W), xpu: 2 * half}
}

/** Inverse of project(): screen pixels -> normalized table coords (clamped). */
export function unproject(W: number, H: number, sx: number, sy: number): {nx: number; ny: number} {
  const g = tableGeom(W, H)
  const t = clamp01((sy / H - g.farY) / (g.nearY - g.farY))
  const ny = depthU(t, g)
  const half = (g.farHalf + (g.nearHalf - g.farHalf) * t) * W
  const nx = clamp01(0.5 + (sx - W / 2) / (2 * half))
  return {nx, ny}
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Hard-edged pixel ellipse: horizontal rows of `unit`-tall rects with widths
 * quantized to the unit grid — the pixel-art replacement for ctx.ellipse()
 * everywhere a shadow/flat blob is drawn (the design bans smooth curves).
 */
function pixelEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  unit: number,
): void {
  const u = Math.max(1, Math.round(unit))
  const rows = Math.max(1, Math.round((ry * 2) / u))
  for (let i = 0; i < rows; i++) {
    const yy = -ry + (i + 0.5) * ((ry * 2) / rows)
    const f = 1 - (yy * yy) / (ry * ry)
    if (f <= 0) continue
    const w = Math.max(u, Math.round(((rx * 2 * Math.sqrt(f)) / u) * 0.5) * 2 * u)
    ctx.fillRect(Math.round(cx - w / 2), Math.round(cy + yy - u / 2), w, u)
  }
}

/** Fill (and optionally stroke) a quad from four screen-space corners. */
function quad(
  ctx: CanvasRenderingContext2D,
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
  stroke?: string,
  strokeW = 2,
): void {
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.lineTo(c[0], c[1])
  ctx.lineTo(d[0], d[1])
  ctx.closePath()
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = strokeW
    ctx.stroke()
  }
}

// ---------------------------------------------------------------------------
// Pixel polygons traced from the Pencil components (Ball Evk4k / Paddle q6t3DH)
// ---------------------------------------------------------------------------

type Deltas = ReadonlyArray<readonly [number, number]>

/** Pixel circle of the Ball component, 24x24 grid, starting at (6,0). */
const BALL_START: readonly [number, number] = [6, 0]
const BALL_POLY: Deltas = [
  [12, 0], [0, 3], [3, 0], [0, 3], [3, 0], [0, 3], [0, 3], [0, 3], [0, 3],
  [-3, 0], [0, 3], [-3, 0], [0, 3], [-12, 0], [0, -3], [-3, 0], [0, -3],
  [-3, 0], [0, -3], [0, -3], [0, -3], [0, -3], [3, 0], [0, -3], [3, 0], [0, -3],
]

/** Pixel circle of the Paddle blade, 70x70 grid, starting at (20,0). */
const BLADE_START: readonly [number, number] = [20, 0]
const BLADE_POLY: Deltas = [
  [30, 0], [0, 5], [5, 0], [0, 5], [5, 0], [0, 5], [5, 0], [0, 5], [0, 5],
  [5, 0], [0, 5], [0, 5], [0, 5], [0, 5], [-5, 0], [0, 5], [0, 5], [-5, 0],
  [0, 5], [-5, 0], [0, 5], [-5, 0], [0, 5], [-5, 0], [0, 5], [-30, 0],
  [0, -5], [-5, 0], [0, -5], [-5, 0], [0, -5], [-5, 0], [0, -5], [0, -5],
  [-5, 0], [0, -5], [0, -5], [0, -5], [0, -5], [5, 0], [0, -5], [0, -5],
  [5, 0], [0, -5], [5, 0], [0, -5], [5, 0], [0, -5], [5, 0], [0, -5],
]

function pixelPoly(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  unitX: number,
  unitY: number,
  start: readonly [number, number],
  deltas: Deltas,
): void {
  ctx.beginPath()
  let x = ox + start[0] * unitX
  let y = oy + start[1] * unitY
  ctx.moveTo(x, y)
  for (const [dx, dy] of deltas) {
    x += dx * unitX
    y += dy * unitY
    ctx.lineTo(x, y)
  }
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/**
 * Draw the whole static scene, back-to-front (z-order straight from the .pen):
 * ground shadow, legs, side slab, felt top, far shade, boundary + center lines,
 * then the net (base line, mesh band, top tape, posts).
 */
export function drawTable(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = tableGeom(W, H)

  // court background (design: #111 court inside the #151515 page)
  ctx.fillStyle = colors.courtBg
  ctx.fillRect(0, 0, W, H)

  const fl = project(W, H, 0, 0)
  const fr = project(W, H, 1, 0)
  const nl = project(W, H, 0, 1)
  const nr = project(W, H, 1, 1)
  const thick = g.thickness * H
  const nearW = nr.sx - nl.sx
  const minWH = Math.min(W, H)

  // --- ground shadow (hard, flat, PIXEL rows) under the table ---
  ctx.save()
  ctx.globalAlpha = 0.4
  ctx.fillStyle = colors.pixelBlack
  pixelEllipse(ctx, W / 2, nl.sy + thick + H * 0.012, nearW / 2 + W * 0.02, H * 0.06, Math.max(3, minWH * 0.012))
  ctx.restore()

  // --- legs (dark), inset ~19% from the near corners, tucked under the slab ---
  const legW = Math.max(3, nearW * 0.033)
  const legH = H * 0.133
  const legInset = nearW * 0.1875
  ctx.fillStyle = colors.pixelBlack
  ctx.fillRect(nl.sx + legInset, nl.sy + thick * 0.8, legW, legH)
  ctx.fillRect(nr.sx - legInset - legW, nl.sy + thick * 0.8, legW, legH)

  // --- side slab (table thickness), bottom edge tapers slightly inward ---
  const taper = nearW * g.sideTaper
  ctx.fillStyle = colors.tableSide
  quad(
    ctx,
    [nl.sx, nl.sy],
    [nr.sx, nr.sy],
    [nr.sx - taper, nr.sy + thick],
    [nl.sx + taper, nl.sy + thick],
    colors.pixelBlack,
  )

  // --- felt top trapezoid ---
  ctx.fillStyle = colors.tableTop
  quad(ctx, [fl.sx, fl.sy], [fr.sx, fr.sy], [nr.sx, nr.sy], [nl.sx, nl.sy], colors.tableEdge)

  // --- far shade: darken the far half up to the net (model midline) ---
  const ml = project(W, H, 0, 0.5)
  const mr = project(W, H, 1, 0.5)
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = colors.tableShade
  quad(ctx, [fl.sx, fl.sy], [fr.sx, fr.sy], [mr.sx, mr.sy], [ml.sx, ml.sy])
  ctx.restore()

  // --- white inset boundary lines (a trapezoid) + center line ---
  const lineW = Math.max(2, minWH * 0.0055)
  const bfl = project(W, H, 0.04, 0.03)
  const bfr = project(W, H, 0.96, 0.03)
  const bnl = project(W, H, 0.04, 0.97)
  const bnr = project(W, H, 0.96, 0.97)
  ctx.save()
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = colors.textPrimary
  ctx.lineWidth = lineW
  ctx.beginPath()
  ctx.moveTo(bfl.sx, bfl.sy)
  ctx.lineTo(bfr.sx, bfr.sy)
  ctx.lineTo(bnr.sx, bnr.sy)
  ctx.lineTo(bnl.sx, bnl.sy)
  ctx.closePath()
  ctx.stroke()
  // center line down the length of the table
  ctx.globalAlpha = 0.5
  ctx.lineWidth = Math.max(1, lineW * 0.7)
  const cf = project(W, H, 0.5, 0.03)
  const cn = project(W, H, 0.5, 0.97)
  ctx.beginPath()
  ctx.moveTo(cf.sx, cf.sy)
  ctx.lineTo(cn.sx, cn.sy)
  ctx.stroke()
  ctx.restore()

  drawNet(ctx, W, H)
}

/** Net at the model midline: base line + mesh band + white top tape + posts. */
function drawNet(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const l = project(W, H, 0, 0.5)
  const r = project(W, H, 1, 0.5)
  const netW = r.sx - l.sx
  const baseY = l.sy

  // proportions measured from the Pencil frames (fractions of H)
  const meshUp = H * 0.02
  const meshDown = H * 0.025
  const tapeH = Math.max(2, H * 0.016)
  const tapeY = baseY - H * 0.037
  const postW = Math.max(3, netW * 0.027)
  const postH = H * 0.083
  const postY = baseY - H * 0.049

  // base line on the felt
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = colors.textPrimary
  ctx.fillRect(l.sx, baseY - 1, netW, Math.max(2, H * 0.005))
  ctx.restore()

  // mesh band: faint bg + vertical white lines (hangs slightly below the base)
  ctx.save()
  ctx.globalAlpha = 0.07
  ctx.fillStyle = colors.white
  ctx.fillRect(l.sx, baseY - meshUp, netW, meshUp + meshDown)
  ctx.restore()
  ctx.save()
  ctx.globalAlpha = 0.24
  ctx.fillStyle = colors.white
  const cells = Math.min(80, Math.max(16, Math.round(netW / 12)))
  for (let i = 0; i <= cells; i++) {
    const x = l.sx + (netW * i) / cells
    ctx.fillRect(Math.round(x), Math.round(baseY - meshUp), 1, Math.round(meshUp + meshDown))
  }
  ctx.restore()

  // white top tape with a black outline
  ctx.fillStyle = colors.net
  ctx.fillRect(l.sx, tapeY, netW, tapeH)
  ctx.strokeStyle = colors.pixelBlack
  ctx.lineWidth = 1
  ctx.strokeRect(l.sx, tapeY, netW, tapeH)

  // grey posts just OUTSIDE the table edges
  ctx.fillStyle = colors.post
  ctx.lineWidth = Math.max(1, postW * 0.25)
  ctx.fillRect(l.sx - postW, postY, postW, postH)
  ctx.strokeRect(l.sx - postW, postY, postW, postH)
  ctx.fillRect(r.sx, postY, postW, postH)
  ctx.strokeRect(r.sx, postY, postW, postH)
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/**
 * Draw a paddle from the Pencil `Paddle` component: pixel-circle blade with a
 * hard offset shadow, black outline, highlights/shades, and a wooden handle
 * (with grip lines) pointing DOWN — both paddles, exactly like the design.
 * `isNear` = the player's own (bottom) paddle: green; far = red.
 *
 * The blade diameter equals FIELD.paddleWidth in model units via the
 * projection, so the sprite you steer covers EXACTLY the x-range the engine's
 * hit test covers — on every screen size and aspect.
 *
 * `live` — the volley-gate state: a dead paddle (ball hasn't bounced on your
 * half yet) renders dimmed with no shine, so unregistered swings explain
 * themselves. `flash` (1 → 0) is the short arming pulse when it goes live.
 */
export function drawPaddle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  nx: number,
  ny: number,
  isNear: boolean,
  live = true,
  flash = 0,
): void {
  const p = project(W, H, nx, ny)
  const D = Math.max(22, FIELD.paddleWidth * p.xpu) // blade diameter = physics width
  const u = D / 70 // component blade grid unit
  const bx = p.sx - 35 * u // blade origin (top-left of the 70-grid)
  const by = p.sy - 35 * u

  const rubber = isNear ? colors.brand : colors.danger
  const bladeShadow = isNear ? colors.brandShadow : colors.pixelBlack

  // ground shadow on the felt below the floating paddle (hard pixel rows)
  ctx.save()
  ctx.globalAlpha = 0.3
  ctx.fillStyle = colors.pixelBlack
  pixelEllipse(ctx, p.sx, p.sy + D * 0.78, D * 0.57, D * 0.13, Math.max(2, 3 * u))
  ctx.restore()

  // wooden handle (drawn first so the blade overlaps its top)
  const hw = 17 * u
  const hh = 44 * u
  const hx = p.sx - hw / 2
  const hy = by + 61 * u
  ctx.fillStyle = colors.wood
  ctx.fillRect(hx, hy, hw, hh)
  ctx.fillStyle = colors.woodHi
  ctx.fillRect(hx, hy, 5 * u, hh)
  ctx.fillStyle = colors.woodGrip
  ctx.fillRect(hx + 1.5 * u, hy + 15 * u, hw - 3 * u, 3.5 * u)
  ctx.fillRect(hx + 1.5 * u, hy + 27 * u, hw - 3 * u, 3.5 * u)
  ctx.strokeStyle = colors.pixelBlack
  ctx.lineWidth = Math.max(1.5, 2.5 * u)
  ctx.strokeRect(hx, hy, hw, hh)

  // hard offset blade shadow (no blur), slightly deeper than the component's
  ctx.fillStyle = bladeShadow
  pixelPoly(ctx, bx + 4 * u, by + 5 * u, u, u, BLADE_START, BLADE_POLY)
  ctx.fill()

  // blade rubber + strong black outline
  ctx.fillStyle = rubber
  pixelPoly(ctx, bx, by, u, u, BLADE_START, BLADE_POLY)
  ctx.fill()
  ctx.strokeStyle = colors.pixelBlack
  ctx.lineWidth = Math.max(1.5, 4 * u)
  ctx.stroke()

  if (live) {
    // inner rim shade along the bottom-right for a rounded pixel-sphere read
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = '#000000'
    ctx.fillRect(bx + 41 * u, by + 47 * u, 18 * u, 11 * u)
    ctx.fillRect(bx + 53 * u, by + 36 * u, 10 * u, 11 * u)
    ctx.fillRect(bx + 30 * u, by + 56 * u, 14 * u, 8 * u)
    // pixel highlights (top-left)
    ctx.globalAlpha = 0.45
    ctx.fillStyle = colors.white
    ctx.fillRect(bx + 16 * u, by + 11 * u, 14 * u, 9 * u)
    ctx.fillRect(bx + 10 * u, by + 19 * u, 9 * u, 9 * u)
    ctx.fillRect(bx + 26 * u, by + 8 * u, 8 * u, 5 * u)
    ctx.restore()
  } else {
    // volley gate closed: matte dimmed rubber, no shine — "not armed yet"
    ctx.save()
    ctx.globalAlpha = 0.45
    ctx.fillStyle = colors.pixelBlack
    pixelPoly(ctx, bx, by, u, u, BLADE_START, BLADE_POLY)
    ctx.fill()
    ctx.restore()
  }

  // arming pulse: a white pixel ring pops outward the moment the gate opens
  if (flash > 0) {
    const grow = 1 + 0.22 * (1 - flash)
    const u2 = u * grow
    ctx.save()
    ctx.globalAlpha = 0.9 * flash
    ctx.strokeStyle = colors.white
    ctx.lineWidth = Math.max(2, 3 * u)
    pixelPoly(ctx, p.sx - 35 * u2, p.sy - 35 * u2, u2, u2, BLADE_START, BLADE_POLY)
    ctx.stroke()
    ctx.restore()
  }
}

/**
 * Draw the ball from the Pencil `Ball` component: white pixel sphere with a
 * hard offset shadow, highlights and a bottom-right shade. Height is shown by
 * lifting the sprite toward the far side IN TABLE-DEPTH UNITS (z * aimLift) —
 * the SAME formula the engine's hit test uses, so the sprite you aim at is
 * exactly where the engine checks the paddle. The ground shadow stays at the
 * true position — the gap between them sells the 2.5D arc.
 */
/** Effect palette (canvas-only, not Pencil design tokens). */
const FIRE_COLORS = ['#ffd75e', '#ff9f45', '#f76b6b'] as const

/** A felt-bounce ripple: view-space position + age 0..1.
 * `own` = the bounce landed on the LOCAL player's half — drawn in brand green
 * (that's the moment your paddle arms); far-half bounces stay white. */
export interface Ripple {
  nx: number
  ny: number
  age: number
  own: boolean
}

/**
 * Expanding pixel rings on the felt where the ball bounced: chunky squares
 * stepped around a perspective-flattened ellipse (no smooth strokes), plus a
 * short bright landing flash — bounces must be READABLE across the table,
 * they're what arms the receiver's paddle.
 */
export function drawRipples(ctx: CanvasRenderingContext2D, W: number, H: number, ripples: Ripple[]): void {
  for (const rp of ripples) {
    const p = project(W, H, rp.nx, rp.ny)
    const ballD = 2 * FIELD.ballRadius * p.xpu
    const sq = Math.max(2, Math.round(ballD * 0.16)) // ring pixel size
    const color = rp.own ? colors.brand : colors.white
    ctx.save()
    // landing flash: a hard bright pad right where the ball touched
    if (rp.age < 0.22) {
      ctx.globalAlpha = 0.5 * (1 - rp.age / 0.22)
      ctx.fillStyle = color
      pixelEllipse(ctx, p.sx, p.sy, ballD * 0.7, ballD * 0.24, sq)
    }
    ctx.fillStyle = color
    for (let ring = 0; ring < 2; ring++) {
      const a = rp.age - ring * 0.26
      if (a < 0 || a > 1) continue
      // radius quantized to whole pixel-squares — stepped waves, not circles
      const r = (0.55 + a * 2.4) * ballD
      const rq = Math.round(r / sq) * sq
      const dots = 10 + ring * 4
      ctx.globalAlpha = 0.55 * (1 - a)
      for (let i = 0; i < dots; i++) {
        const ang = (i / dots) * Math.PI * 2
        const dx = Math.round((Math.cos(ang) * rq) / sq) * sq
        const dy = Math.round((Math.sin(ang) * rq * 0.32) / sq) * sq
        ctx.fillRect(p.sx + dx - sq / 2, p.sy + dy - sq / 2, sq, sq)
      }
    }
    ctx.restore()
  }
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  nx: number,
  ny: number,
  z = 0,
  vx = 0,
  vy = 0,
  spin = 0,
  squash = 0,
  animMs = 0,
): void {
  const zc = Math.min(0.5, Math.max(0, z))
  const pGround = project(W, H, nx, ny) // true position (shadow)
  const pBall = project(W, H, nx, ny - zc * FIELD.aimLift) // rendered sprite
  // sprite diameter = physics diameter via the projection (honest hitbox);
  // slight growth with height keeps a rising ball readable (visual only)
  const d = Math.max(8, 2 * FIELD.ballRadius * pBall.xpu) * (1 + zc * 0.35)
  const u = d / 24 // component grid unit
  // felt-touch squash: flatten vertically, widen horizontally (1 -> 0)
  const ux = u * (1 + 0.35 * squash)
  const uy = u * (1 - 0.4 * squash)

  // ground shadow at z = 0: shrinks AND fades as the ball rises (height cue #1)
  const shrink = 1 - Math.min(0.55, zc * 1.1)
  ctx.save()
  ctx.globalAlpha = 0.35 * (1 - Math.min(0.6, zc * 1.3))
  ctx.fillStyle = colors.pixelBlack
  pixelEllipse(ctx, pGround.sx, pGround.sy, d * 0.5 * shrink, d * 0.15 * shrink, Math.max(2, 2 * u))
  ctx.restore()

  const bx = pBall.sx - 12 * ux
  const by = pBall.sy - 12 * uy

  // dotted height line between the shadow and the sprite (height cue #2)
  const liftPx = Math.hypot(pGround.sx - pBall.sx, pGround.sy - pBall.sy)
  if (liftPx > d * 0.8) {
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = colors.white
    const dot = Math.max(1, Math.round(u))
    const steps = Math.floor(liftPx / (dot * 4))
    for (let i = 1; i <= steps; i++) {
      const f = i / (steps + 1)
      const lx = pGround.sx + (pBall.sx - pGround.sx) * f
      const ly = pGround.sy + (pBall.sy - pGround.sy) * f
      ctx.fillRect(Math.round(lx - dot / 2), Math.round(ly), dot, dot)
    }
    ctx.restore()
  }

  // motion trails behind the ball (opposite its velocity):
  //  - overdrive smash  -> pixel FLAME: a chunky teardrop of grid-snapped
  //    squares, color-banded yellow->orange->red, animated by a deterministic
  //    2-frame wiggle (no per-frame randomness — that read as static noise)
  //  - heavy spin       -> curved trail bending toward the Magnus direction
  //  - otherwise        -> the design's single faint green pixel dot
  const speed = Math.hypot(vx, vy)
  const fire = speed >= FIELD.fireSpeed
  const spinning = Math.abs(spin) > 0.35
  const grid = Math.max(2, Math.round(2 * u)) // trail pixel grid
  const snap = (v: number): number => Math.round(v / grid) * grid
  if (speed > 0.05 && (fire || spinning)) {
    const vnx = vx / speed
    const vny = vy / speed
    const px = -vny // lateral (perpendicular) direction for the spin curve
    const py = vnx
    const curve = spinning ? Math.sign(spin) * Math.min(1, Math.abs(spin)) : 0
    // 2-frame flame wiggle: alternating lateral offsets, phase-flipped ~8x/sec
    const phase = Math.floor(animMs / 66) % 2
    const n = fire ? 6 : 3
    ctx.save()
    for (let i = 1; i <= n; i++) {
      const back = d * (0.5 + 0.34 * i)
      const side = curve * d * 0.09 * i * i
      const wiggle = fire ? ((i + phase) % 2 === 0 ? 1 : -1) * d * 0.08 * Math.min(i, 2) : 0
      const cx = snap(pBall.sx - vnx * back + px * (side + wiggle))
      const cy = snap(pBall.sy - vny * back + py * (side + wiggle))
      const size = Math.max(grid, snap(d * (fire ? 0.5 - 0.06 * i : 0.28 - 0.045 * i)))
      ctx.globalAlpha = (fire ? 0.9 : 0.5) * (1 - i / (n + 1))
      // color bands: hottest (yellow) at the ball, red at the tail
      ctx.fillStyle = fire ? FIRE_COLORS[Math.min(2, Math.floor((i - 1) / 2))]! : colors.brand
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size)
    }
    ctx.restore()
  } else if (speed > 0.05) {
    const size = Math.max(grid, snap(d * 0.4))
    const tx = snap(pBall.sx - (vx / speed) * d * 0.75)
    const ty = snap(pBall.sy - (vy / speed) * d * 0.75)
    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.fillStyle = colors.brand
    ctx.fillRect(tx - size / 2, ty - size / 2, size, size)
    ctx.restore()
  }

  // hard offset shadow silhouette, then the pixel sphere + outline
  ctx.fillStyle = colors.pixelBlack
  pixelPoly(ctx, bx + 2 * ux, by + 2 * uy, ux, uy, BALL_START, BALL_POLY)
  ctx.fill()
  ctx.fillStyle = colors.ballFill
  pixelPoly(ctx, bx, by, ux, uy, BALL_START, BALL_POLY)
  ctx.fill()
  ctx.strokeStyle = colors.pixelBlack
  ctx.lineWidth = Math.max(1, 2 * u)
  ctx.stroke()

  // highlights (top-left) & shade (bottom-right)
  ctx.fillStyle = colors.white
  ctx.fillRect(bx + 6 * ux, by + 4 * uy, 6 * ux, 6 * uy)
  ctx.fillRect(bx + 4 * ux, by + 7 * uy, 3 * ux, 3 * uy)
  ctx.save()
  ctx.globalAlpha = 0.75
  ctx.fillStyle = colors.ballShade
  ctx.fillRect(bx + 14 * ux, by + 13 * uy, 6 * ux, 6 * uy)
  ctx.restore()

  // overdrive: heat-tint the ball itself
  if (fire) {
    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.fillStyle = FIRE_COLORS[1]!
    pixelPoly(ctx, bx, by, ux, uy, BALL_START, BALL_POLY)
    ctx.fill()
    ctx.restore()
  }
}
