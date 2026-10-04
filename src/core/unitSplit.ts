// Unit-sprite frame size limit and layer splitting.
//
// D2CMP.dll halts ("LINE: 1454") when a unit layer frame (DCC or DC6) is wider or taller than 256 px. Larger art
// must be cut into tiles, each drawn by its own composit layer (S1..S8 or another composit the unit doesn't use).
// Tiles follow one grid per layer and direction, anchored at that direction's bounding box, so they meet exactly.

import { COMPOSITS, Cof } from './cof'
import { Frame, Sprite } from './sprite'

/** Largest frame width or height the game accepts for a unit layer. */
export const MAX_UNIT_FRAME = 256
/** Tile size used when splitting: a multiple of 4 (keeps the DCC cell grid), with room for the encoder's anchor padding (≤3 px). */
export const SPLIT_TILE = 252

export function maxFrameSize(s: Sprite): { width: number; height: number } {
  let width = 0
  let height = 0
  for (const d of s.frames)
    for (const f of d) {
      width = Math.max(width, f.width)
      height = Math.max(height, f.height)
    }
  return { width, height }
}

export function exceedsUnitFrameLimit(s: Sprite, max = MAX_UNIT_FRAME): boolean {
  const m = maxFrameSize(s)
  return m.width > max || m.height > max
}

/** Copy the part of `f` inside the sprite-space rectangle [x0,x1)×[y0,y1), trimmed to its opaque pixels. */
function cropTrim(f: Frame, x0: number, y0: number, x1: number, y1: number): Frame {
  const ax = Math.max(x0, f.offsetX)
  const ay = Math.max(y0, f.offsetY)
  const bx = Math.min(x1, f.offsetX + f.width)
  const by = Math.min(y1, f.offsetY + f.height)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let y = ay; y < by; y++)
    for (let x = ax; x < bx; x++)
      if (f.pixels[(y - f.offsetY) * f.width + (x - f.offsetX)]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  // Empty tile: zero-size frame (the DCC encoder writes it as one transparent pixel).
  if (minX === Infinity) return { width: 0, height: 0, offsetX: x0, offsetY: y0, pixels: new Uint8Array(0) }
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) px[y * w + x] = f.pixels[(minY + y - f.offsetY) * f.width + (minX + x - f.offsetX)]
  return { width: w, height: h, offsetX: minX, offsetY: minY, pixels: px }
}

/**
 * Cut a sprite into tiles of at most `tile`×`tile` px. Each frame is cut on its own grid of `tile`-px cells,
 * starting at its opaque top-left rounded down to the direction's 4-px DCC cell grid (so cell contents don't
 * change and nothing is lost when re-encoding); tile k is cell k of that grid in row-major order. Returns as
 * many sprites as the frame needing the most cells (other frames get empty tiles). The tiles of a frame
 * don't overlap and re-assemble exactly into it. A sprite within the limit comes back as [itself].
 */
export function splitSprite(s: Sprite, tile = SPLIT_TILE, max = MAX_UNIT_FRAME, align = 4): Sprite[] {
  if (!exceedsUnitFrameLimit(s, max)) return [s]
  const empty = (x: number, y: number): Frame => ({ width: 0, height: 0, offsetX: x, offsetY: y, pixels: new Uint8Array(0) })
  const plans = s.frames.map((frames) => {
    let ax = Infinity
    let ay = Infinity
    for (const f of frames)
      if (f.width && f.height) {
        ax = Math.min(ax, f.offsetX)
        ay = Math.min(ay, f.offsetY)
      }
    return frames.map((f) => {
      const t = cropTrim(f, -Infinity, -Infinity, Infinity, Infinity)
      if (!t.width) return { f: { ...t, offsetX: f.offsetX, offsetY: f.offsetY }, x0: 0, y0: 0, nx: 0, ny: 0 }
      const x0 = ax + align * Math.floor((t.offsetX - ax) / align)
      const y0 = ay + align * Math.floor((t.offsetY - ay) / align)
      return { f: t, x0, y0, nx: Math.ceil((t.offsetX + t.width - x0) / tile), ny: Math.ceil((t.offsetY + t.height - y0) / tile) }
    })
  })
  const n = Math.max(1, ...plans.flat().map((p) => p.nx * p.ny))
  const out: Sprite[] = []
  for (let k = 0; k < n; k++)
    out.push({
      directions: s.directions,
      framesPerDir: s.framesPerDir,
      frames: plans.map((dir) =>
        dir.map((p) => {
          if (k >= p.nx * p.ny) return empty(p.f.offsetX, p.f.offsetY)
          const tx = p.x0 + (k % p.nx) * tile
          const ty = p.y0 + Math.floor(k / p.nx) * tile
          return cropTrim(p.f, tx, ty, tx + tile, ty + tile)
        })
      )
    })
  return out
}

/** Re-assemble tiles into one sprite-space image per frame (for checks): returns a pixel lookup per (dir, frame). */
export function compositeTiles(tiles: Sprite[], dir: number, frame: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of tiles) {
    const f = t.frames[dir][frame]
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const v = f.pixels[y * f.width + x]
        if (v) m.set(`${f.offsetX + x},${f.offsetY + y}`, v)
      }
  }
  return m
}

/**
 * Add COF layers for the extra tiles of composit `composit`: each copies that layer's flags, draw effect and
 * weapon class, and is drawn right after it in every direction and frame. Frame and direction counts stay.
 */
export function addTileLayers(cof: Cof, composit: number, extra: number[]): Cof {
  const src = cof.layers.find((l) => l.composit === composit)
  if (!src) throw new Error(`COF has no ${COMPOSITS[composit]} layer`)
  for (const e of extra) if (cof.layers.some((l) => l.composit === e)) throw new Error(`COF already uses ${COMPOSITS[e]}`)
  const layers = [...cof.layers, ...extra.map((e) => ({ ...src, composit: e }))]
  const order = cof.order.map((dir) =>
    dir.map((fr) => {
      const i = fr.indexOf(composit)
      const base = fr.slice(0, cof.layers.length)
      if (i < 0) return [...base, ...extra]
      return [...base.slice(0, i + 1), ...extra, ...base.slice(i + 1)]
    })
  )
  return { ...cof, numLayers: layers.length, layers, order }
}

/** Composits free for tiles: not drawn by any of the unit's COFs and not switched on in its MonStats2 rows. Last slots first. */
export function freeComposits(cofs: Cof[], reserved: Iterable<number> = []): number[] {
  const used = new Set<number>(reserved)
  for (const c of cofs) for (const l of c.layers) used.add(l.composit)
  const order = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 0, 2, 1] // S8..S1, SH, LH, RH, LA, RA, HD, LG, TR
  return order.filter((c) => !used.has(c))
}

/** MonStats2 column names of a composit's on/off flag and armtype list (RA/LA use "Rav"/"Lav"). */
export function ms2Columns(composit: number): { on: string; arm: string } {
  const c = COMPOSITS[composit]
  return { on: c, arm: c === 'RA' ? 'Rav' : c === 'LA' ? 'Lav' : `${c}v` }
}

/**
 * DCC direction size limit. D2CMP.dll decodes a DCC direction into a fixed static buffer of 4×4 cells
 * (20 bytes each at 0x6FEF5860, 5,625 entries before the next variable) and clears ceil(w/4)·ceil(h/4) entries for
 * the direction's bounding box (all its frames together) without a bounds check. A bigger box overwrites
 * D2CMP's data and crashes (ACCESS_VIOLATION at D2CMP+0x14739). The largest box a game monster uses is 5,429 cells
 * (the Overseer's whip, 356×244). Art past this limit must be stored as DC6, which isn't decoded through that buffer.
 */
export const MAX_DCC_DIRECTION_CELLS = 5400

/** Largest ceil(w/4)·ceil(h/4) over the sprite's directions, for the box of all frames in a direction. */
export function dccDirectionCells(s: Sprite): number {
  let max = 0
  for (const frames of s.frames) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const f of frames) {
      const w = Math.max(1, f.width)
      const h = Math.max(1, f.height)
      x0 = Math.min(x0, f.offsetX)
      y0 = Math.min(y0, f.offsetY)
      x1 = Math.max(x1, f.offsetX + w)
      y1 = Math.max(y1, f.offsetY + h)
    }
    if (x0 === Infinity) continue
    max = Math.max(max, Math.ceil((x1 - x0) / 4) * Math.ceil((y1 - y0) / 4))
  }
  return max
}

/** Grid tile size for splitSpriteGrid: well under 256, since the DCC encoder may pad a direction's edge frames. */
export const GRID_TILE = 240

/**
 * Cut a sprite on one fixed grid per direction (anchored at the direction's bounding box, 4-px aligned), so every
 * tile keeps all its frames inside one `tile`×`tile` square: each tile's frames are ≤ tile px and its DCC direction
 * box stays far below MAX_DCC_DIRECTION_CELLS. Needs more tiles than splitSprite when an animation moves a lot, but
 * the tiles can always be DCC. Returns [s] when the sprite already fits both limits.
 */
export function splitSpriteGrid(s: Sprite, tile = GRID_TILE): Sprite[] {
  if (!exceedsUnitFrameLimit(s) && dccDirectionCells(s) <= MAX_DCC_DIRECTION_CELLS) return [s]
  const grids = s.frames.map((frames) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const f of frames) {
      const t = cropTrim(f, -Infinity, -Infinity, Infinity, Infinity)
      if (!t.width) continue
      x0 = Math.min(x0, t.offsetX)
      y0 = Math.min(y0, t.offsetY)
      x1 = Math.max(x1, t.offsetX + t.width)
      y1 = Math.max(y1, t.offsetY + t.height)
    }
    if (x0 === Infinity) return { x0: 0, y0: 0, nx: 1, ny: 1 }
    x0 = 4 * Math.floor(x0 / 4)
    y0 = 4 * Math.floor(y0 / 4)
    return { x0, y0, nx: Math.ceil((x1 - x0) / tile), ny: Math.ceil((y1 - y0) / tile) }
  })
  const n = Math.max(...grids.map((g) => g.nx * g.ny))
  const out: Sprite[] = []
  for (let k = 0; k < n; k++)
    out.push({
      directions: s.directions,
      framesPerDir: s.framesPerDir,
      frames: s.frames.map((frames, d) => {
        const g = grids[d]
        // empty tiles sit at one point, so they don't widen the direction box
        if (k >= g.nx * g.ny) return frames.map(() => ({ width: 0, height: 0, offsetX: g.x0, offsetY: g.y0, pixels: new Uint8Array(0) }))
        const tx = g.x0 + (k % g.nx) * tile
        const ty = g.y0 + Math.floor(k / g.nx) * tile
        return frames.map((f) => cropTrim(f, tx, ty, tx + tile, ty + tile))
      })
    })
  return out
}
