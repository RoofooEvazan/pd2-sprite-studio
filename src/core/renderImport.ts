// Turn 3D renders (RGBA frames per direction) into a palette-indexed Diablo II sprite.

import { nearestIndex, Palette } from './palette'
import { Frame, Sprite, trimFrame } from './sprite'

export interface RenderImage {
  dir: number
  frame: number
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export interface RenderManifest {
  tool?: string
  name?: string
  directions?: number
  frames?: number
  width?: number
  height?: number
  originX?: number
  originY?: number
  fps?: number
}

export interface RenderImportOptions {
  /** Ground point (the unit's feet) in render pixels. */
  originX: number
  originY: number
  /** Downscale factor, 0 < scale <= 1 (area-averaged). */
  scale: number
  /** Pixels with alpha below this (0-255) become transparent. */
  alphaThreshold: number
  dither: boolean
}

/** `name_d03_f012.png` -> { dir: 3, frame: 12 } */
export function parseRenderName(name: string): { dir: number; frame: number } | null {
  const m = /_d(\d+)_f(\d+)\.png$/i.exec(name)
  return m ? { dir: parseInt(m[1], 10), frame: parseInt(m[2], 10) } : null
}

const HEADING_8 = [135, 225, 315, 45, 90, 180, 270, 0]
const HEADING_16 = [...HEADING_8, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5]

function headings(count: number): number[] | null {
  if (count === 8) return HEADING_8
  if (count === 16) return HEADING_16
  if (count === 4) return HEADING_8.slice(0, 4)
  return null
}

/** For each target direction, the source direction facing closest to it. */
export function mapDirections(sourceCount: number, targetCount: number): number[] {
  const hs = headings(sourceCount)
  const ht = headings(targetCount)
  return Array.from({ length: targetCount }, (_, t) => {
    if (sourceCount === targetCount) return t
    if (!hs || !ht) return Math.round((t * sourceCount) / targetCount) % sourceCount
    let best = 0
    let bestD = Infinity
    hs.forEach((h, s) => {
      let d = Math.abs(h - ht[t]) % 360
      if (d > 180) d = 360 - d
      if (d < bestD) {
        bestD = d
        best = s
      }
    })
    return best
  })
}

/** For each target frame, the nearest source frame (resamples when counts differ). */
export function mapFrames(sourceCount: number, targetCount: number): number[] {
  return Array.from({ length: targetCount }, (_, t) => Math.min(sourceCount - 1, Math.round((t * sourceCount) / Math.max(1, targetCount))))
}

/** Fast palette lookup: 5 bits per channel cube of nearest palette indices. */
export class PaletteLut {
  private readonly lut = new Uint8Array(32 * 32 * 32)
  constructor(private readonly pal: Palette) {
    const cache = new Map<number, number>()
    for (let r = 0; r < 32; r++)
      for (let g = 0; g < 32; g++)
        for (let b = 0; b < 32; b++) this.lut[(r << 10) | (g << 5) | b] = nearestIndex(pal, (r << 3) | 4, (g << 3) | 4, (b << 3) | 4, cache)
  }
  get(r: number, g: number, b: number): number {
    const c = (v: number) => (v < 0 ? 0 : v > 255 ? 31 : v >> 3)
    return this.lut[(c(r) << 10) | (c(g) << 5) | c(b)]
  }
  rgb(i: number): [number, number, number] {
    return [this.pal[i * 4], this.pal[i * 4 + 1], this.pal[i * 4 + 2]]
  }
}

/**
 * Palette-quantize an RGBA image in place of a full conversion: returns palette indices (0 = transparent).
 * Optional Floyd–Steinberg dithering over opaque pixels.
 */
export function quantizeRgba(rgba: Uint8ClampedArray | Float32Array, w: number, h: number, lut: PaletteLut, alphaThreshold: number, dither: boolean): Uint8Array {
  const px = new Uint8Array(w * h)
  const buf = dither ? Float32Array.from(rgba) : rgba
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (buf[i * 4 + 3] < alphaThreshold) continue
      const r = buf[i * 4]
      const g = buf[i * 4 + 1]
      const b = buf[i * 4 + 2]
      let idx = lut.get(Math.round(r), Math.round(g), Math.round(b))
      if (idx === 0) idx = 1
      px[i] = idx
      if (!dither) continue
      const [pr, pg, pb] = lut.rgb(idx)
      const e = [r - pr, g - pg, b - pb]
      const spread = (dx: number, dy: number, f: number) => {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || xx >= w || yy >= h) return
        const j = (yy * w + xx) * 4
        if (buf[j + 3] < alphaThreshold) return
        buf[j] += e[0] * f
        buf[j + 1] += e[1] * f
        buf[j + 2] += e[2] * f
      }
      spread(1, 0, 7 / 16)
      spread(-1, 1, 3 / 16)
      spread(0, 1, 5 / 16)
      spread(1, 1, 1 / 16)
    }
  return px
}

function downscale(img: RenderImage, scale: number): { w: number; h: number; rgba: Float32Array } {
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const out = new Float32Array(w * h * 4)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      const y0 = Math.floor(y * sy)
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * img.width + xx) * 4
          const al = img.rgba[o + 3]
          r += img.rgba[o] * al
          g += img.rgba[o + 1] * al
          b += img.rgba[o + 2] * al
          a += al
          n++
        }
      const o = (y * w + x) * 4
      out[o + 3] = a / n
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = b / a
      }
    }
  return { w, h, rgba: out }
}

/** Convert one render to an indexed frame positioned so the ground point sits at sprite (0, 0). */
export function renderToFrame(img: RenderImage, lut: PaletteLut, o: RenderImportOptions): Frame {
  const { w, h, rgba } = downscale(img, o.scale)
  const px = new Uint8Array(w * h)
  if (o.dither) {
    // Floyd-Steinberg error diffusion over opaque pixels only
    const buf = new Float32Array(rgba)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (buf[i * 4 + 3] < o.alphaThreshold) continue
        const r = buf[i * 4]
        const g = buf[i * 4 + 1]
        const b = buf[i * 4 + 2]
        let idx = lut.get(Math.round(r), Math.round(g), Math.round(b))
        if (idx === 0) idx = 1
        px[i] = idx
        const [pr, pg, pb] = lut.rgb(idx)
        const er = r - pr
        const eg = g - pg
        const eb = b - pb
        const spread = (dx: number, dy: number, f: number) => {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy >= h || xx >= w) return
          const j = (yy * w + xx) * 4
          if (buf[j + 3] < o.alphaThreshold) return
          buf[j] += er * f
          buf[j + 1] += eg * f
          buf[j + 2] += eb * f
        }
        spread(1, 0, 7 / 16)
        spread(-1, 1, 3 / 16)
        spread(0, 1, 5 / 16)
        spread(1, 1, 1 / 16)
      }
  } else {
    for (let i = 0; i < w * h; i++) {
      if (rgba[i * 4 + 3] < o.alphaThreshold) continue
      const idx = lut.get(Math.round(rgba[i * 4]), Math.round(rgba[i * 4 + 1]), Math.round(rgba[i * 4 + 2]))
      px[i] = idx === 0 ? 1 : idx
    }
  }
  const frame: Frame = {
    width: w,
    height: h,
    offsetX: -Math.round(o.originX * (w / img.width)),
    offsetY: -Math.round(o.originY * (h / img.height)),
    pixels: px
  }
  return trimFrame(frame)
}

/**
 * Build a sprite with the target's direction/frame layout from a set of renders.
 * `only` limits conversion to one target direction (fast previews); other directions stay empty.
 */
export function buildSpriteFromRenders(
  images: RenderImage[],
  lut: PaletteLut,
  o: RenderImportOptions,
  target: { directions: number; framesPerDir: number },
  only?: number
): Sprite {
  const srcDirs = Math.max(...images.map((i) => i.dir)) + 1
  const srcFrames = Math.max(...images.map((i) => i.frame)) + 1
  const dmap = mapDirections(srcDirs, target.directions)
  const fmap = mapFrames(srcFrames, target.framesPerDir)
  const byKey = new Map(images.map((i) => [`${i.dir}:${i.frame}`, i]))
  const empty = (): Frame => ({ width: 0, height: 0, offsetX: 0, offsetY: 0, pixels: new Uint8Array(0) })
  const frames: Frame[][] = []
  for (let d = 0; d < target.directions; d++) {
    const dir: Frame[] = []
    for (let f = 0; f < target.framesPerDir; f++) {
      if (only !== undefined && d !== only) {
        dir.push(empty())
        continue
      }
      const img = byKey.get(`${dmap[d]}:${fmap[f]}`)
      dir.push(img ? renderToFrame(img, lut, o) : empty())
    }
    frames.push(dir)
  }
  return { directions: target.directions, framesPerDir: target.framesPerDir, frames }
}
