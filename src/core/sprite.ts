// Format-independent sprite model shared by the DC6 and DCC codecs and the editor.

export interface Frame {
  width: number
  height: number
  /** Position of the frame's top-left corner relative to the sprite origin (the unit's feet). */
  offsetX: number
  offsetY: number
  /** Palette indices, row-major, 0 = transparent. */
  pixels: Uint8Array
}

export interface Sprite {
  directions: number
  framesPerDir: number
  /** frames[dir][frame] */
  frames: Frame[][]
}

export function emptyFrame(width: number, height: number, offsetX = 0, offsetY = -height): Frame {
  return { width, height, offsetX, offsetY, pixels: new Uint8Array(width * height) }
}

export function cloneFrame(f: Frame): Frame {
  return { ...f, pixels: f.pixels.slice() }
}

export function cloneSprite(s: Sprite): Sprite {
  return { ...s, frames: s.frames.map((d) => d.map(cloneFrame)) }
}

/** Bounding box of all frames in sprite space. */
export function spriteBounds(frames: Frame[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const f of frames) {
    if (!f.width || !f.height) continue
    x0 = Math.min(x0, f.offsetX)
    y0 = Math.min(y0, f.offsetY)
    x1 = Math.max(x1, f.offsetX + f.width)
    y1 = Math.max(y1, f.offsetY + f.height)
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  return { x0, y0, x1, y1 }
}

/** Crop transparent borders, adjusting offsets so sprite-space placement is preserved. */
export function trimFrame(f: Frame): Frame {
  let minX = f.width
  let minY = f.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++)
      if (f.pixels[y * f.width + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  if (maxX < 0) return { width: 0, height: 0, offsetX: f.offsetX, offsetY: f.offsetY, pixels: new Uint8Array(0) }
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) px.set(f.pixels.subarray((y + minY) * f.width + minX, (y + minY) * f.width + minX + w), y * w)
  return { width: w, height: h, offsetX: f.offsetX + minX, offsetY: f.offsetY + minY, pixels: px }
}

/** Re-grow a frame to cover a sprite-space rectangle (used while editing so pixels can be drawn anywhere). */
export function expandFrame(f: Frame, x0: number, y0: number, x1: number, y1: number): Frame {
  const w = x1 - x0
  const h = y1 - y0
  const px = new Uint8Array(w * h)
  for (let y = 0; y < f.height; y++) {
    const ty = f.offsetY + y - y0
    if (ty < 0 || ty >= h) continue
    for (let x = 0; x < f.width; x++) {
      const tx = f.offsetX + x - x0
      if (tx < 0 || tx >= w) continue
      px[ty * w + tx] = f.pixels[y * f.width + x]
    }
  }
  return { width: w, height: h, offsetX: x0, offsetY: y0, pixels: px }
}
