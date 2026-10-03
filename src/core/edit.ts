// Palette-aware editing operations: ramp shifting, shading steps, outlines, clean-up, flips.

import { hsvToRgb, nearestIndices, paletteRgb, rgbToHsv, rgbToLab, shadeRamp } from './color'
import { Palette } from './palette'
import { Frame } from './sprite'

// ---------------------------------------------------------------------------------------------
// Ramps

const rampCache = new WeakMap<Palette, Map<number, number[]>>()

/** Shading ramp (light -> dark) containing `index`, cached per palette. */
export function rampOf(p: Palette, index: number): number[] {
  let m = rampCache.get(p)
  if (!m) rampCache.set(p, (m = new Map()))
  let r = m.get(index)
  if (!r) m.set(index, (r = shadeRamp(p, index, 14)))
  return r
}

/** One step lighter (step < 0) or darker (step > 0) along the pixel's own ramp. */
export function shadeStep(p: Palette, index: number, step: number): number {
  if (!index) return 0
  const ramp = rampOf(p, index)
  const i = ramp.indexOf(index)
  if (i < 0) return index
  return ramp[Math.max(0, Math.min(ramp.length - 1, i + step))]
}

/**
 * Map every colour of the source ramp onto the target ramp by relative lightness position,
 * anchored so the clicked colour lands on the chosen target colour.
 */
export function rampSwapMap(p: Palette, srcIndex: number, tgtIndex: number): Map<number, number> {
  // Each source shade keeps its lightness offset and relative chroma from the clicked colour, but
  // takes the target's hue; the result snaps to the nearest colour in the whole palette (Lab), so
  // shading survives even when the target hue has few entries.
  const src = rampOf(p, srcIndex)
  const la = rgbToLab(paletteRgb(p, srcIndex))
  const lt = rgbToLab(paletteRgb(p, tgtIndex))
  const ca = Math.hypot(la[1], la[2])
  const ct = Math.hypot(lt[1], lt[2])
  const ht = Math.atan2(lt[2], lt[1])
  const labs = Array.from({ length: 256 }, (_, i) => rgbToLab(paletteRgb(p, i)))
  const map = new Map<number, number>()
  for (const s of src) {
    if (s === srcIndex) {
      map.set(s, tgtIndex)
      continue
    }
    const ls = labs[s]
    const cs = Math.hypot(ls[1], ls[2])
    const L = Math.max(0, Math.min(100, ls[0] + (lt[0] - la[0])))
    const C = ca > 4 ? Math.min(ct * 2, ct * (cs / ca)) : ct * Math.min(1.5, L / Math.max(lt[0], 1))
    const want: [number, number, number] = [L, C * Math.cos(ht), C * Math.sin(ht)]
    let best = tgtIndex
    let bestD = Infinity
    for (let i = 1; i < 256; i++) {
      const l = labs[i]
      const d = (l[0] - want[0]) ** 2 * 1.5 + (l[1] - want[1]) ** 2 + (l[2] - want[2]) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    map.set(s, best)
  }
  return map
}

/** Map a set of colours through an HSV adjustment, snapping each result to the nearest palette colour. */
export function hsvShiftMap(p: Palette, indices: number[], dHue: number, sMul: number, vAdd: number): Map<number, number> {
  const map = new Map<number, number>()
  for (const i of indices) {
    if (!i) continue
    const [h, s, v] = rgbToHsv(paletteRgb(p, i))
    const rgb = hsvToRgb([(h + dHue + 360) % 360, Math.min(1, Math.max(0, s * sMul)), Math.min(1, Math.max(0, v + vAdd))])
    map.set(i, nearestIndices(p, rgb, 1)[0].index)
  }
  return map
}

export function applyMap(f: Frame, map: Map<number, number>, mask?: (x: number, y: number) => boolean): Frame {
  const px = f.pixels.slice()
  for (let i = 0; i < px.length; i++) {
    const to = map.get(px[i])
    if (to === undefined || !px[i]) continue
    if (mask && !mask(f.offsetX + (i % f.width), f.offsetY + Math.floor(i / f.width))) continue
    px[i] = to
  }
  return { ...f, pixels: px }
}

/** Connected pixels (4-way) starting at a frame-local point whose colours are in `set`. Sprite-space keys. */
export function connectedRegion(f: Frame, lx: number, ly: number, set: Set<number>): Set<number> {
  const out = new Set<number>()
  if (lx < 0 || ly < 0 || lx >= f.width || ly >= f.height) return out
  const stack = [ly * f.width + lx]
  const seen = new Uint8Array(f.pixels.length)
  while (stack.length) {
    const i = stack.pop()!
    if (seen[i]) continue
    seen[i] = 1
    if (!set.has(f.pixels[i])) continue
    out.add(i)
    const x = i % f.width
    if (x > 0) stack.push(i - 1)
    if (x < f.width - 1) stack.push(i + 1)
    if (i >= f.width) stack.push(i - f.width)
    if (i + f.width < f.pixels.length) stack.push(i + f.width)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Outline & clean-up

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]]

function grow(f: Frame, by: number): Frame {
  const w = f.width + by * 2
  const h = f.height + by * 2
  const px = new Uint8Array(w * h)
  for (let y = 0; y < f.height; y++) px.set(f.pixels.subarray(y * f.width, (y + 1) * f.width), (y + by) * w + by)
  return { width: w, height: h, offsetX: f.offsetX - by, offsetY: f.offsetY - by, pixels: px }
}

export type OutlineColor = { kind: 'fixed'; index: number } | { kind: 'auto' }

/**
 * Add a 1px outline on transparent pixels touching the shape. 'auto' uses the darkest step of the
 * neighbouring pixel's own ramp, so outlines blend like the originals.
 * `allow(x, y)` (sprite space) restricts where outline pixels may be added.
 */
export function addOutline(f: Frame, p: Palette, color: OutlineColor, diagonal: boolean, allow?: (x: number, y: number) => boolean, canGrow = true): Frame {
  if (!f.width) return f
  const g = canGrow ? grow(f, 1) : { ...f, pixels: f.pixels.slice() }
  const src = g.pixels.slice()
  const nb = diagonal ? N8 : N4
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x
      if (src[i]) continue
      if (allow && !allow(g.offsetX + x, g.offsetY + y)) continue
      let neighbour = 0
      for (const [dx, dy] of nb) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue
        const v = src[ny * g.width + nx]
        if (v) {
          neighbour = v
          break
        }
      }
      if (!neighbour) continue
      if (color.kind === 'fixed') g.pixels[i] = color.index
      else {
        const ramp = rampOf(p, neighbour)
        g.pixels[i] = ramp[ramp.length - 1] ?? neighbour
      }
    }
  return g
}

/** Darken the edge pixels of the shape by `steps` along their ramps (a soft inner outline). */
export function darkenEdges(f: Frame, p: Palette, steps: number, allow?: (x: number, y: number) => boolean): Frame {
  const px = f.pixels.slice()
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x
      if (!f.pixels[i]) continue
      if (allow && !allow(f.offsetX + x, f.offsetY + y)) continue
      const edge = N4.some(([dx, dy]) => {
        const nx = x + dx
        const ny = y + dy
        return nx < 0 || ny < 0 || nx >= f.width || ny >= f.height || !f.pixels[ny * f.width + nx]
      })
      if (edge) px[i] = shadeStep(p, f.pixels[i], steps)
    }
  return { ...f, pixels: px }
}

/** Remove isolated opaque pixels and fill single-pixel holes (with the most common neighbour). */
export function cleanStrays(f: Frame, allow?: (x: number, y: number) => boolean): { frame: Frame; removed: number; filled: number } {
  const px = f.pixels.slice()
  let removed = 0
  let filled = 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= f.width || y >= f.height ? 0 : f.pixels[y * f.width + x])
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++) {
      if (allow && !allow(f.offsetX + x, f.offsetY + y)) continue
      const i = y * f.width + x
      const around = N8.map(([dx, dy]) => at(x + dx, y + dy))
      if (f.pixels[i] && around.every((v) => !v)) {
        px[i] = 0
        removed++
      } else if (!f.pixels[i] && N4.every(([dx, dy]) => at(x + dx, y + dy))) {
        const counts = new Map<number, number>()
        for (const v of around) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
        px[i] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        filled++
      }
    }
  return { frame: { ...f, pixels: px }, removed, filled }
}

// ---------------------------------------------------------------------------------------------
// Flips & mirrored directions

/** Heading (degrees, screen space, 0 = east, clockwise) of Diablo II direction indices. */
const DIR8 = [135, 225, 315, 45, 90, 180, 270, 0]
const DIR16 = [...DIR8, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5]

export function dirHeading(count: number, d: number): number | null {
  if (count === 8) return DIR8[d]
  if (count === 16) return DIR16[d]
  if (count === 4) return DIR8[d]
  return null
}

/** Direction that is the left/right mirror image of `d` (e.g. SW <-> SE). */
export function mirrorDir(count: number, d: number): number {
  const a = dirHeading(count, d)
  if (a === null) return d
  const want = (540 - a) % 360
  const table = count === 16 ? DIR16 : DIR8
  for (let i = 0; i < count; i++) if (Math.abs(table[i] - want) < 0.01) return i
  return d
}

/** Horizontally mirror pixels; with `aroundOrigin`, also mirror the position about sprite x = 0. */
export function flipH(f: Frame, aroundOrigin = false): Frame {
  const px = new Uint8Array(f.pixels.length)
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++) px[y * f.width + (f.width - 1 - x)] = f.pixels[y * f.width + x]
  return { ...f, pixels: px, offsetX: aroundOrigin ? -(f.offsetX + f.width) : f.offsetX }
}

export function flipV(f: Frame): Frame {
  const px = new Uint8Array(f.pixels.length)
  for (let y = 0; y < f.height; y++) px.set(f.pixels.subarray(y * f.width, (y + 1) * f.width), (f.height - 1 - y) * f.width)
  return { ...f, pixels: px }
}
