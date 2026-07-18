/**
 * Random pixel/retro-themed nicknames, e.g. PIXEL_KO, RETRO_99, NEON_ACE.
 * Format: PREFIX_SUFFIX (uppercase). Used for the local player and (until real
 * names sync over the network) a placeholder opponent name.
 */
const PREFIXES = [
  'PIXEL', 'RETRO', 'NEON', 'GLITCH', 'ARCADE', 'BYTE', 'TURBO', 'LASER', 'CYBER', 'VECTOR',
  'PLASMA', 'SCANLINE', 'VOXEL', 'SYNTH', 'BLASTER', 'GHOST', 'NOVA', 'ATOMIC', 'CRT', 'BIT',
] as const

const SUFFIXES = [
  'KO', 'ACE', 'PRO', 'ZERO', 'MAX', 'BOT', 'GG', 'HERO', 'FURY', 'DASH',
  'VOLT', 'PUNK', 'WAVE', 'XL', 'RAD', 'JR', 'X', 'NG', 'FX', 'HD',
] as const

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Generate a nickname like "PIXEL_KO" or "RETRO_99". ~30% chance of a numeric suffix. */
export function randomNick(): string {
  const prefix = pick(PREFIXES)
  const suffix = Math.random() < 0.3 ? String(10 + Math.floor(Math.random() * 90)) : pick(SUFFIXES)
  return `${prefix}_${suffix}`
}
