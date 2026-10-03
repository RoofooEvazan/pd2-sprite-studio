import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import type { Rgba } from '../../core/composite'
import { newRgba, overlay } from '../../core/composite'
import { api } from './api'

export type Background = { kind: 'transparent' } | { kind: 'color'; rgb: [number, number, number] }

export function scaleRgba(im: Rgba, scale: number): Rgba {
  if (scale === 1) return im
  const out = newRgba(im.x0 * scale, im.y0 * scale, im.width * scale, im.height * scale)
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const s = (Math.floor(y / scale) * im.width + Math.floor(x / scale)) * 4
      out.data.set(im.data.subarray(s, s + 4), (y * out.width + x) * 4)
    }
  return out
}

export function withBackground(im: Rgba, bg: Background): Rgba {
  if (bg.kind === 'transparent') return im
  const out = newRgba(im.x0, im.y0, im.width, im.height)
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg.rgb[0]
    out.data[i + 1] = bg.rgb[1]
    out.data[i + 2] = bg.rgb[2]
    out.data[i + 3] = 255
  }
  overlay(out, im, 0, 0)
  return out
}

export async function rgbaToBytes(im: Rgba, type: 'image/png' | 'image/jpeg'): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = Math.max(1, im.width)
  c.height = Math.max(1, im.height)
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(im.data), c.width, c.height), 0, 0)
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, 0.95))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Pad all frames to a common canvas (they share sprite-space origin). */
export function alignFrames(frames: Rgba[]): Rgba[] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const f of frames) {
    x0 = Math.min(x0, f.x0)
    y0 = Math.min(y0, f.y0)
    x1 = Math.max(x1, f.x0 + f.width)
    y1 = Math.max(y1, f.y0 + f.height)
  }
  return frames.map((f) => {
    const out = newRgba(x0, y0, x1 - x0, y1 - y0)
    overlay(out, f, f.x0 - x0, f.y0 - y0)
    return out
  })
}

export function encodeGif(framesIn: Rgba[], fps: number, bg: Background): Uint8Array {
  const frames = alignFrames(framesIn).map((f) => withBackground(f, bg))
  const w = frames[0].width
  const h = frames[0].height
  // Hard-threshold alpha: GIF has 1-bit transparency
  for (const f of frames) for (let i = 3; i < f.data.length; i += 4) f.data[i] = f.data[i] >= 128 ? 255 : 0
  const all = new Uint8ClampedArray(frames.length * w * h * 4)
  frames.forEach((f, i) => all.set(f.data, i * w * h * 4))
  const palette = quantize(all, 256, { format: 'rgba4444', oneBitAlpha: true })
  const tIdx = palette.findIndex((c) => c[3] === 0)
  const gif = GIFEncoder()
  const delay = Math.round(1000 / Math.max(1, fps))
  for (const f of frames) {
    const index = applyPalette(f.data, palette, 'rgba4444')
    gif.writeFrame(index, w, h, { palette, delay, transparent: tIdx >= 0, transparentIndex: Math.max(0, tIdx), repeat: 0, dispose: 2 })
  }
  gif.finish()
  return gif.bytes()
}

export async function saveBytes(defaultName: string, data: Uint8Array, ext: string, label: string): Promise<string | null> {
  return api.saveFile({ defaultName, data, filters: [{ name: label, extensions: [ext] }] })
}

/** Decode a PNG/JPEG file into RGBA. */
export async function decodeImage(bytes: Uint8Array): Promise<ImageData> {
  const bmp = await createImageBitmap(new Blob([bytes.slice()]))
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height)
}
