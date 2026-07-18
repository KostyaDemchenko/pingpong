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
  return {sx, sy, scale: half / (g.nearHalf * W)}
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

/** Extra shrink for sprites so far objects read smaller, like in the design. */
function spriteScale(scale: number): number {
  return Math.pow(scale, 1.5)
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
  unit: number,
  start: readonly [number, number],
  deltas: Deltas,
): void {
  ctx.beginPath()
  let x = ox + start[0] * unit
  let y = oy + start[1] * unit
  ctx.moveTo(x, y)
  for (const [dx, dy] of deltas) {
    x += dx * unit
    y += dy * unit
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

  // --- ground shadow ellipse (hard, flat) under the table ---
  ctx.save()
  ctx.globalAlpha = 0.4
  ctx.fillStyle = colors.pixelBlack
  ctx.beginPath()
  ctx.ellipse(W / 2, nl.sy + thick + H * 0.012, nearW / 2 + W * 0.02, H * 0.06, 0, 0, Math.PI * 2)
  ctx.fill()
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
 * `isNear` = the player's own (bottom) paddle: green & bigger; far = red.
 */
export function drawPaddle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  nx: number,
  ny: number,
  isNear: boolean,
): void {
  const p = project(W, H, nx, ny)
  const s = spriteScale(p.scale)
  const D = Math.max(16, H * 0.12 * s) // blade diameter
  const u = D / 70 // component blade grid unit
  const bx = p.sx - 35 * u // blade origin (top-left of the 70-grid)
  const by = p.sy - 35 * u

  const rubber = isNear ? colors.brand : colors.danger
  const bladeShadow = isNear ? colors.brandShadow : colors.pixelBlack

  // ground shadow on the felt below the floating paddle
  ctx.save()
  ctx.globalAlpha = 0.3
  ctx.fillStyle = colors.pixelBlack
  ctx.beginPath()
  ctx.ellipse(p.sx, p.sy + D * 0.78, D * 0.57, D * 0.13, 0, 0, Math.PI * 2)
  ctx.fill()
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
  pixelPoly(ctx, bx + 4 * u, by + 5 * u, u, BLADE_START, BLADE_POLY)
  ctx.fill()

  // blade rubber + strong black outline
  ctx.fillStyle = rubber
  pixelPoly(ctx, bx, by, u, BLADE_START, BLADE_POLY)
  ctx.fill()
  ctx.strokeStyle = colors.pixelBlack
  ctx.lineWidth = Math.max(1.5, 4 * u)
  ctx.stroke()

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
}

/** How much screen height one unit of ball height (z) lifts the ball, before depth scaling. */
const HEIGHT_SCALE = 0.6

/**
 * Draw the ball from the Pencil `Ball` component: white pixel sphere with a
 * hard offset shadow, highlights and a bottom-right shade, RAISED on screen by
 * its height `z`. Its ground shadow stays at z=0 — the gap sells the 2.5D arc.
 * A faint green trail is drawn behind the ball while it moves (design detail).
 */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  nx: number,
  ny: number,
  z = 0,
  vx = 0,
  vy = 0,
): void {
  const p = project(W, H, nx, ny)
  const s = spriteScale(p.scale)
  const zc = Math.min(0.5, Math.max(0, z))
  // the ball reads closer to the camera as it rises — scale it up with height
  const d = Math.max(6, H * 0.046 * s) * (1 + zc * 0.7)
  const u = d / 24 // component grid unit
  const lift = Math.max(0, z) * H * HEIGHT_SCALE * s

  // ground shadow at z = 0: shrinks AND fades as the ball rises (height cue #1)
  const shrink = 1 - Math.min(0.55, zc * 1.1)
  ctx.save()
  ctx.globalAlpha = 0.35 * (1 - Math.min(0.6, zc * 1.3))
  ctx.fillStyle = colors.pixelBlack
  ctx.beginPath()
  ctx.ellipse(p.sx, p.sy, d * 0.5 * shrink, d * 0.15 * shrink, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const bx = p.sx - 12 * u
  const by = p.sy - lift - 12 * u

  // dotted height line between the shadow and the ball (height cue #2)
  if (lift > d * 0.8) {
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = colors.white
    const dot = Math.max(1, Math.round(u))
    for (let yy = p.sy - d * 0.5; yy > p.sy - lift + d * 0.55; yy -= dot * 4) {
      ctx.fillRect(Math.round(p.sx - dot / 2), Math.round(yy), dot, dot)
    }
    ctx.restore()
  }

  // green motion trail behind the ball (opposite its velocity)
  const speed = Math.hypot(vx, vy)
  if (speed > 0.05) {
    const tx = p.sx - (vx / speed) * d * 0.75
    const ty = p.sy - lift - (vy / speed) * d * 0.75
    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.fillStyle = colors.brand
    ctx.beginPath()
    ctx.ellipse(tx, ty, d * 0.23, d * 0.23, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // hard offset shadow silhouette, then the pixel sphere + outline
  ctx.fillStyle = colors.pixelBlack
  pixelPoly(ctx, bx + 2 * u, by + 2 * u, u, BALL_START, BALL_POLY)
  ctx.fill()
  ctx.fillStyle = colors.ballFill
  pixelPoly(ctx, bx, by, u, BALL_START, BALL_POLY)
  ctx.fill()
  ctx.strokeStyle = colors.pixelBlack
  ctx.lineWidth = Math.max(1, 2 * u)
  ctx.stroke()

  // highlights (top-left) & shade (bottom-right)
  ctx.fillStyle = colors.white
  ctx.fillRect(bx + 6 * u, by + 4 * u, 6 * u, 6 * u)
  ctx.fillRect(bx + 4 * u, by + 7 * u, 3 * u, 3 * u)
  ctx.save()
  ctx.globalAlpha = 0.75
  ctx.fillStyle = colors.ballShade
  ctx.fillRect(bx + 14 * u, by + 13 * u, 6 * u, 6 * u)
  ctx.restore()
}
