// Layer compositing for animated units (COF + per-composit DCC sprites) into RGBA images.

import { Cof } from './cof'
import { Palette } from './palette'
import { Frame, Sprite } from './sprite'

export interface Rgba {
  x0: number // sprite-space position of pixel (0,0)
  y0: number
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

export interface LayerInput {
  sprite: Sprite | null
  visible: boolean
  /** Optional palette index remap (e.g. colormap tint) applied before drawing. */
  remap?: Uint8Array | null
  /** Force a draw alpha (0..1), e.g. to ghost non-edited layers. */
  alpha?: number
}

type Blend = 'normal' | 'add'

/** Game draw effects for layers flagged as transparent in the COF. */
export function drawEffectStyle(transparent: number, drawEffect: number): { alpha: number; blend: Blend } {
  if (!transparent) return { alpha: 1, blend: 'normal' }
  switch (drawEffect) {
    case 0:
      return { alpha: 0.75, blend: 'normal' }
    case 1:
      return { alpha: 0.5, blend: 'normal' }
    case 2:
      return { alpha: 0.25, blend: 'normal' }
    case 3:
    case 4:
    case 6:
    case 7:
      return { alpha: 1, blend: 'add' }
    default:
      return { alpha: 1, blend: 'normal' }
  }
}

export function frameAt(s: Sprite | null, dir: number, frame: number): Frame | null {
  if (!s) return null
  const d = s.frames[Math.min(dir, s.frames.length - 1)]
  if (!d || !d.length) return null
  return d[frame % d.length] ?? null
}

/** Layers drawn for a given direction/frame, back to front. */
export function drawOrder(cof: Cof, dir: number, frame: number): number[] {
  const d = cof.order[Math.min(dir, cof.order.length - 1)]
  const order = d?.[frame % Math.max(1, d.length)]
  if (order && order.length) return order.filter((c) => cof.layers.some((l) => l.composit === c))
  return cof.layers.map((l) => l.composit)
}

export function directionBounds(cof: Cof, layers: Map<number, LayerInput>, dir: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let f = 0; f < cof.framesPerDir; f++) {
    for (const c of drawOrder(cof, dir, f)) {
      const li = layers.get(c)
      const fr = li?.visible ? frameAt(li.sprite, dir, f) : null
      if (!fr || !fr.width) continue
      x0 = Math.min(x0, fr.offsetX)
      y0 = Math.min(y0, fr.offsetY)
      x1 = Math.max(x1, fr.offsetX + fr.width)
      y1 = Math.max(y1, fr.offsetY + fr.height)
    }
  }
  if (x0 === Infinity) return { x0: -8, y0: -16, x1: 8, y1: 0 }
  return { x0, y0, x1, y1 }
}

export function blitIndexed(
  dst: Rgba,
  fr: Frame,
  pal: Palette,
  opts: { alpha?: number; blend?: Blend; remap?: Uint8Array | null } = {}
): void {
  const alpha = opts.alpha ?? 1
  const add = opts.blend === 'add'
  const remap = opts.remap
  for (let y = 0; y < fr.height; y++) {
    const ty = fr.offsetY + y - dst.y0
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < fr.width; x++) {
      let c = fr.pixels[y * fr.width + x]
      if (!c) continue
      const tx = fr.offsetX + x - dst.x0
      if (tx < 0 || tx >= dst.width) continue
      if (remap) c = remap[c]
      const o = (ty * dst.width + tx) * 4
      const r = pal[c * 4]
      const g = pal[c * 4 + 1]
      const b = pal[c * 4 + 2]
      const da = dst.data[o + 3] / 255
      if (add) {
        dst.data[o] = Math.min(255, dst.data[o] * da + r * alpha)
        dst.data[o + 1] = Math.min(255, dst.data[o + 1] * da + g * alpha)
        dst.data[o + 2] = Math.min(255, dst.data[o + 2] * da + b * alpha)
        dst.data[o + 3] = Math.max(dst.data[o + 3], Math.min(255, Math.max(r, g, b) * alpha))
      } else if (alpha >= 1) {
        dst.data[o] = r
        dst.data[o + 1] = g
        dst.data[o + 2] = b
        dst.data[o + 3] = 255
      } else {
        const oa = alpha + da * (1 - alpha)
        dst.data[o] = (r * alpha + dst.data[o] * da * (1 - alpha)) / oa
        dst.data[o + 1] = (g * alpha + dst.data[o + 1] * da * (1 - alpha)) / oa
        dst.data[o + 2] = (b * alpha + dst.data[o + 2] * da * (1 - alpha)) / oa
        dst.data[o + 3] = oa * 255
      }
    }
  }
}

export function newRgba(x0: number, y0: number, width: number, height: number): Rgba {
  return { x0, y0, width, height, data: new Uint8ClampedArray(Math.max(1, width * height) * 4) }
}

export interface CompositeOptions {
  bounds?: { x0: number; y0: number; x1: number; y1: number }
  /** Only draw layers for which this returns true. */
  filter?: (composit: number) => boolean
  /** Replace a layer's frame (e.g. with the live edited, expanded frame). */
  override?: (composit: number) => Frame | null | undefined
}

export function compositeFrame(cof: Cof, layers: Map<number, LayerInput>, pal: Palette, dir: number, frame: number, opts: CompositeOptions = {}): Rgba {
  const b = opts.bounds ?? directionBounds(cof, layers, dir)
  const out = newRgba(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
  for (const c of drawOrder(cof, dir, frame)) {
    if (opts.filter && !opts.filter(c)) continue
    const li = layers.get(c)
    if (!li || !li.visible) continue
    const fr = opts.override?.(c) ?? frameAt(li.sprite, dir, frame)
    if (!fr) continue
    const layer = cof.layers.find((l) => l.composit === c)!
    const fx = drawEffectStyle(layer.transparent, layer.drawEffect)
    blitIndexed(out, fr, pal, { alpha: fx.alpha * (li.alpha ?? 1), blend: fx.blend, remap: li.remap })
  }
  return out
}

/** Paint a single indexed frame to RGBA at its own bounds. */
export function frameToRgba(fr: Frame, pal: Palette, remap?: Uint8Array | null): Rgba {
  const out = newRgba(fr.offsetX, fr.offsetY, fr.width, fr.height)
  blitIndexed(out, fr, pal, { remap })
  return out
}

/** Lay out images in a grid, aligned by their common origin. */
export function sheet(images: Rgba[][], pad = 0, bg?: [number, number, number, number]): Rgba {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const row of images)
    for (const im of row) {
      x0 = Math.min(x0, im.x0)
      y0 = Math.min(y0, im.y0)
      x1 = Math.max(x1, im.x0 + im.width)
      y1 = Math.max(y1, im.y0 + im.height)
    }
  if (x0 === Infinity) return newRgba(0, 0, 1, 1)
  const cw = x1 - x0 + pad
  const ch = y1 - y0 + pad
  const cols = Math.max(...images.map((r) => r.length))
  const out = newRgba(0, 0, cols * cw, images.length * ch)
  if (bg) for (let i = 0; i < out.data.length; i += 4) out.data.set(bg, i)
  images.forEach((row, ry) =>
    row.forEach((im, rx) => {
      const ox = rx * cw + (im.x0 - x0)
      const oy = ry * ch + (im.y0 - y0)
      overlay(out, im, ox, oy)
    })
  )
  return out
}

/** Stack all images at their procedural (sprite-space) positions in one picture. */
export function overlayAll(images: Rgba[], alpha = 1): Rgba {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const im of images) {
    x0 = Math.min(x0, im.x0)
    y0 = Math.min(y0, im.y0)
    x1 = Math.max(x1, im.x0 + im.width)
    y1 = Math.max(y1, im.y0 + im.height)
  }
  if (x0 === Infinity) return newRgba(0, 0, 1, 1)
  const out = newRgba(x0, y0, x1 - x0, y1 - y0)
  for (const im of images) overlay(out, im, im.x0 - x0, im.y0 - y0, alpha)
  return out
}

export function overlay(dst: Rgba, src: Rgba, ox: number, oy: number, alpha = 1): void {
  for (let y = 0; y < src.height; y++) {
    const ty = oy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = ox + x
      if (tx < 0 || tx >= dst.width) continue
      const s = (y * src.width + x) * 4
      const sa = (src.data[s + 3] / 255) * alpha
      if (!sa) continue
      const d = (ty * dst.width + tx) * 4
      const da = dst.data[d + 3] / 255
      const oa = sa + da * (1 - sa)
      for (let k = 0; k < 3; k++) dst.data[d + k] = (src.data[s + k] * sa + dst.data[d + k] * da * (1 - sa)) / oa
      dst.data[d + 3] = oa * 255
    }
  }
}
