// Pixel drawing primitives operating on indexed frames (frame-local coordinates).

import { Frame } from './sprite'

export function inside(f: Frame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < f.width && y < f.height
}

export function plot(f: Frame, x: number, y: number, c: number, size = 1): void {
  const r0 = -Math.floor((size - 1) / 2)
  for (let dy = r0; dy < r0 + size; dy++)
    for (let dx = r0; dx < r0 + size; dx++) if (inside(f, x + dx, y + dy)) f.pixels[(y + dy) * f.width + x + dx] = c
}

export function line(f: Frame, x0: number, y0: number, x1: number, y1: number, c: number, size = 1): void {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    plot(f, x0, y0, c, size)
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
}

export function rect(f: Frame, x0: number, y0: number, x1: number, y1: number, c: number, filled: boolean): void {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0]
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0]
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) if (filled || x === ax || x === bx || y === ay || y === by) plot(f, x, y, c)
}

export function floodFill(f: Frame, x: number, y: number, c: number, contiguous = true): void {
  if (!inside(f, x, y)) return
  const target = f.pixels[y * f.width + x]
  if (target === c) return
  if (!contiguous) {
    for (let i = 0; i < f.pixels.length; i++) if (f.pixels[i] === target) f.pixels[i] = c
    return
  }
  const stack = [y * f.width + x]
  while (stack.length) {
    const i = stack.pop()!
    if (f.pixels[i] !== target) continue
    f.pixels[i] = c
    const px = i % f.width
    const py = (i - px) / f.width
    if (px > 0) stack.push(i - 1)
    if (px < f.width - 1) stack.push(i + 1)
    if (py > 0) stack.push(i - f.width)
    if (py < f.height - 1) stack.push(i + f.width)
  }
}

/** Shift every non-transparent pixel of `from` palette index to `to`. */
export function replaceColor(f: Frame, from: number, to: number): number {
  let n = 0
  for (let i = 0; i < f.pixels.length; i++)
    if (f.pixels[i] === from) {
      f.pixels[i] = to
      n++
    }
  return n
}
