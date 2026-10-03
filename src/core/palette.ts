// Diablo II palettes: data\global\palette\<ACT>\pal.dat = 256 x (B,G,R).

export type Palette = Uint8Array // 256*4 RGBA

export const PALETTE_NAMES = ['ACT1', 'ACT2', 'ACT3', 'ACT4', 'ACT5', 'ENDGAME', 'FECHAR', 'LOADING', 'MENU0', 'MENU1', 'MENU2', 'MENU3', 'MENU4', 'SKY', 'STATIC', 'TRADEMARK', 'UNITS'] as const

export function palettePath(name: string): string {
  return `data\\global\\palette\\${name}\\pal.dat`
}

export function parsePalDat(data: Uint8Array): Palette {
  const p = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    p[i * 4] = data[i * 3 + 2]
    p[i * 4 + 1] = data[i * 3 + 1]
    p[i * 4 + 2] = data[i * 3]
    p[i * 4 + 3] = i === 0 ? 0 : 255 // index 0 is transparent in sprites
  }
  return p
}

export function paletteToHex(p: Palette, i: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(p[i * 4])}${h(p[i * 4 + 1])}${h(p[i * 4 + 2])}`
}

/** Nearest palette index (excluding 0 = transparent) by weighted RGB distance. */
export function nearestIndex(p: Palette, r: number, g: number, b: number, cache?: Map<number, number>): number {
  const key = (r << 16) | (g << 8) | b
  const hit = cache?.get(key)
  if (hit !== undefined) return hit
  let best = 1
  let bestD = Infinity
  for (let i = 1; i < 256; i++) {
    const dr = p[i * 4] - r
    const dg = p[i * 4 + 1] - g
    const db = p[i * 4 + 2] - b
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  cache?.set(key, best)
  return best
}

/**
 * Item colour maps (data\global\items\palette\*.dat): each file holds 21 remap tables of 256 bytes.
 * Used by the game to tint item graphics (e.g. set/unique/crafted colours, gems).
 */
export const COLORMAP_FILES = ['grey', 'grey2', 'brown', 'gold', 'greybrown', 'invgrey', 'invgrey2', 'invgreybrown'] as const
export const COLORMAP_SHADES = ['whit', 'lgry', 'dgry', 'blac', 'lblu', 'dblu', 'cblu', 'lred', 'dred', 'cred', 'lgrn', 'dgrn', 'cgrn', 'lyel', 'dyel', 'lgld', 'dgld', 'lpur', 'dpur', 'oran', 'bwht'] as const

export function colormapPath(name: string): string {
  return `data\\global\\items\\palette\\${name}.dat`
}

export function remap(indices: Uint8Array, table: Uint8Array | null): Uint8Array {
  if (!table) return indices
  const out = new Uint8Array(indices.length)
  for (let i = 0; i < indices.length; i++) out[i] = indices[i] === 0 ? 0 : table[indices[i]]
  return out
}

/** Paint indexed pixels into an RGBA buffer. */
export function indexedToRgba(indices: Uint8Array, p: Palette, out?: Uint8ClampedArray<ArrayBuffer>): Uint8ClampedArray<ArrayBuffer> {
  const o = out ?? new Uint8ClampedArray(indices.length * 4)
  for (let i = 0; i < indices.length; i++) {
    const c = indices[i]
    o[i * 4] = p[c * 4]
    o[i * 4 + 1] = p[c * 4 + 1]
    o[i * 4 + 2] = p[c * 4 + 2]
    o[i * 4 + 3] = c === 0 ? 0 : 255
  }
  return o
}
