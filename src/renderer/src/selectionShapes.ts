// Selection masks from shapes (sprite space): lasso polygons, boxes, unions.

export interface Selection {
  x0: number
  y0: number
  w: number
  h: number
  mask: Uint8Array
}

export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    pts.push([x0, y0])
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return pts
}

/** Selection mask from a closed polygon (lasso), outline included. */
export function polygonSelection(pts: { x: number; y: number }[]): Selection | null {
  if (pts.length < 3) return null
  const x0 = Math.min(...pts.map((p) => p.x))
  const y0 = Math.min(...pts.map((p) => p.y))
  const x1 = Math.max(...pts.map((p) => p.x)) + 1
  const y1 = Math.max(...pts.map((p) => p.y)) + 1
  const w = x1 - x0
  const h = y1 - y0
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x0 + x + 0.5
      const py = y0 + y + 0.5
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i]
        const b = pts[j]
        if (a.y + 0.5 > py !== b.y + 0.5 > py && px < ((b.x - a.x) * (py - a.y - 0.5)) / (b.y - a.y || 1e-9) + a.x + 0.5) inside = !inside
      }
      if (inside) mask[y * w + x] = 1
    }
  // include the outline itself
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    for (const [x, y] of linePoints(a.x, a.y, b.x, b.y)) mask[(y - y0) * w + (x - x0)] = 1
  }
  return { x0, y0, w, h, mask }
}

export function rectSelection(a: { x: number; y: number }, b: { x: number; y: number }): Selection {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const w = Math.abs(a.x - b.x) + 1
  const h = Math.abs(a.y - b.y) + 1
  return { x0, y0, w, h, mask: new Uint8Array(w * h).fill(1) }
}

export function unionSelection(a: Selection | null, b: Selection | null): Selection | null {
  if (!a) return b
  if (!b) return a
  const x0 = Math.min(a.x0, b.x0)
  const y0 = Math.min(a.y0, b.y0)
  const w = Math.max(a.x0 + a.w, b.x0 + b.w) - x0
  const h = Math.max(a.y0 + a.h, b.y0 + b.h) - y0
  const mask = new Uint8Array(w * h)
  for (const s of [a, b]) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.mask[y * s.w + x]) mask[(s.y0 + y - y0) * w + (s.x0 + x - x0)] = 1
  return { x0, y0, w, h, mask }
}
