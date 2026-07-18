/**
 * Design tokens mirrored from the Pencil design (ping pong.pen) as TS constants.
 * Use these where CSS classes can't reach — e.g. drawing on <canvas>.
 * Keep in sync with src/style.css @theme.
 */
export const colors = {
  bgBase: '#151515',
  bgSurface: '#1c1c1c',
  bgElevated: '#232323',
  border: '#2e2e2e',
  borderStrong: '#3e3e3e',
  brand: '#3ecf8e',
  brandHover: '#34b27b',
  brandDeep: '#006239',
  brandShadow: '#0b3d28',
  textPrimary: '#ededed',
  textSecondary: '#a0a0a0',
  textMuted: '#6b6b6b',
  danger: '#f76b6b',
  pixelBlack: '#0c0c0c',
  white: '#ffffff',
  // table felt
  tableTop: '#0c4c36',
  tableShade: '#072518',
  tableSide: '#06341f',
  tableEdge: '#062a1c',
  net: '#f4f4f4',
  post: '#c8c8c8',
  // game court (canvas-only, from the Pencil Court 3D frames)
  courtBg: '#111111',
  wood: '#7a4e2a',
  woodHi: '#a9744a',
  woodGrip: '#5e3a18',
  ballFill: '#ececec',
  ballShade: '#b0b0b0',
} as const

export const fonts = {
  display: '"Press Start 2P", monospace',
  body: '"Silkscreen", monospace',
} as const

export const spacing = {xs: 8, sm: 12, md: 20, lg: 32, xl: 48} as const

/** Table-tennis / gameplay tuning constants (normalized 0..1 coordinate space). */
export const rules = {
  pointsToWin: 11,
  bestOf: 5,
} as const
