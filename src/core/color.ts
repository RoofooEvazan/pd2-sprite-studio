// Colour-space helpers for choosing palette entries perceptually.

import { Palette } from './palette'

export type Rgb = [number, number, number]
export type Hsv = [number, number, number] // h 0..360, s 0..1, v 0..1

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  let h = 0
  if (d) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}

export function hsvToRgb([h, s, v]: Hsv): Rgb {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToLab([r, g, b]: Rgb): [number, number, number] {
  const lin = (c: number) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047)
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722)
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function paletteRgb(p: Palette, i: number): Rgb {
  return [p[i * 4], p[i * 4 + 1], p[i * 4 + 2]]
}

/** The n palette entries (excluding transparent 0) perceptually closest to a colour. */
export function nearestIndices(p: Palette, rgb: Rgb, n = 8): { index: number; dist: number }[] {
  const target = rgbToLab(rgb)
  const out: { index: number; dist: number }[] = []
  for (let i = 1; i < 256; i++) out.push({ index: i, dist: deltaE(target, rgbToLab(paletteRgb(p, i))) })
  out.sort((a, b) => a.dist - b.dist)
  // drop exact duplicates of the same RGB (palettes repeat some colours)
  const seen = new Set<string>()
  return out.filter((e) => {
    const k = rgbToHex(paletteRgb(p, e.index))
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, n)
}

/**
 * A light-to-dark shading ramp around a palette entry: entries of similar hue and chroma,
 * sorted by lightness. Useful for shading with the colours the original artists used.
 */
export function shadeRamp(p: Palette, index: number, max = 12): number[] {
  if (!index) return []
  const base = rgbToLab(paletteRgb(p, index))
  const baseHue = Math.atan2(base[2], base[1])
  const baseChroma = Math.hypot(base[1], base[2])
  const cands: { i: number; L: number; score: number }[] = []
  const seen = new Set<string>()
  for (let i = 1; i < 256; i++) {
    const rgb = paletteRgb(p, i)
    const key = rgbToHex(rgb)
    if (seen.has(key)) continue
    seen.add(key)
    const lab = rgbToLab(rgb)
    const chroma = Math.hypot(lab[1], lab[2])
    let dh = Math.abs(Math.atan2(lab[2], lab[1]) - baseHue)
    if (dh > Math.PI) dh = 2 * Math.PI - dh
    // Greys have no meaningful hue: match them by chroma only
    const hueTerm = baseChroma < 6 || chroma < 6 ? 0 : dh * 40
    const score = hueTerm + Math.abs(chroma - baseChroma) * 0.8
    if (score < 22 || i === index) cands.push({ i, L: lab[0], score })
  }
  cands.sort((a, b) => a.score - b.score)
  const picked = cands.slice(0, max * 2)
  // keep a spread across lightness: bucket by L and take the best per bucket
  const buckets = new Map<number, { i: number; L: number; score: number }>()
  for (const c of picked) {
    const b = Math.round(c.L / 7)
    const cur = buckets.get(b)
    if (!cur || c.score < cur.score || c.i === index) buckets.set(b, c)
  }
  if (![...buckets.values()].some((c) => c.i === index)) buckets.set(-1, { i: index, L: base[0], score: 0 })
  return [...buckets.values()].sort((a, b) => b.L - a.L).slice(0, max).map((c) => c.i)
}

export type PaletteSort = 'index' | 'hue' | 'light'

/** Palette display order (index 0 always first). */
export function sortedPalette(p: Palette, mode: PaletteSort): number[] {
  const idx = Array.from({ length: 255 }, (_, i) => i + 1)
  if (mode === 'index') return [0, ...idx]
  const info = idx.map((i) => {
    const rgb = paletteRgb(p, i)
    const [h, s, v] = rgbToHsv(rgb)
    return { i, h, s, v, L: rgbToLab(rgb)[0] }
  })
  if (mode === 'light') info.sort((a, b) => a.L - b.L)
  else
    info.sort((a, b) => {
      // greys first, then by hue band, then lightness within each band
      const ga = a.s < 0.12 ? -1 : Math.floor(a.h / 20)
      const gb = b.s < 0.12 ? -1 : Math.floor(b.h / 20)
      return ga !== gb ? ga - gb : a.L - b.L
    })
  return [0, ...info.map((x) => x.i)]
}
