// DT1 tiles as editable pictures: a tile becomes one indexed frame in tile coordinates, and an edited frame is
// written back into the tile's own blocks. Existing blocks keep their position and format (isometric diamonds or
// RLE squares) so an unedited tile round-trips exactly; art painted outside them gets new 32×32 RLE blocks.

import { Dt1Block, Dt1Tile, isFloorLike, tileImage } from './dt1'
import { Frame } from './sprite'

// Isometric block rows: 15 lines, centred, widths 4..32..4 (as stored in DT1 files)
const ISO_X = [14, 12, 10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14]
const ISO_N = [4, 8, 12, 16, 20, 24, 28, 32, 28, 24, 20, 16, 12, 8, 4]

/** Room above a wall for new art (e.g. something that sticks out over the wall top). */
export const WALL_HEADROOM = 32

/**
 * A tile as one frame. Sprite coordinates are tile coordinates: x 0..160 across the diamond box, y 0 at the top
 * of the floor box (walls rise into negative y).
 */
export function tileToFrame(t: Dt1Tile): Frame {
  const img = tileImage(t)
  const pad = isFloorLike(t.orientation) ? 0 : WALL_HEADROOM
  const width = img.width
  const height = img.height + pad
  const pixels = new Uint8Array(width * height)
  pixels.set(img.pixels, pad * width)
  return { width, height, offsetX: -img.originX, offsetY: -img.originY - pad, pixels }
}

const at = (f: Frame, x: number, y: number) => {
  const lx = x - f.offsetX
  const ly = y - f.offsetY
  return lx >= 0 && ly >= 0 && lx < f.width && ly < f.height ? f.pixels[ly * f.width + lx] : 0
}

/**
 * Write an edited frame back into a copy of the tile. Only pixels that differ from the tile's own picture are
 * written (into every block covering them), so untouched art, including blocks that overlap, stays exactly as is.
 */
export function frameToTile(t: Dt1Tile, f: Frame): Dt1Tile {
  const orig = tileToFrame(t)
  const changed = (x: number, y: number) => at(f, x, y) !== at(orig, x, y)
  const covered = new Set<number>()
  const key = (x: number, y: number) => (y + 4096) * 8192 + (x + 4096)
  const blocks: Dt1Block[] = t.blocks.map((b) => {
    const px = b.pixels.slice()
    const visit = (x: number, y: number) => {
      covered.add(key(b.x + x, b.y + y))
      if (changed(b.x + x, b.y + y)) px[y * 32 + x] = at(f, b.x + x, b.y + y)
    }
    if (b.format === 1) {
      for (let y = 0; y < 15; y++) for (let i = 0; i < ISO_N[y]; i++) visit(ISO_X[y] + i, y)
    } else for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) visit(x, y)
    return { ...b, pixels: px }
  })
  // New art outside the existing blocks: 32×32 RLE blocks on the grid the tile's RLE blocks already use
  const rle = t.blocks.find((b) => b.format !== 1)
  const gx = (((rle?.x ?? 0) % 32) + 32) % 32
  const gy = (((rle?.y ?? 0) % 32) + 32) % 32
  const extra = new Map<string, Dt1Block>()
  for (let ly = 0; ly < f.height; ly++)
    for (let lx = 0; lx < f.width; lx++) {
      const v = f.pixels[ly * f.width + lx]
      if (!v) continue
      const x = f.offsetX + lx
      const y = f.offsetY + ly
      if (covered.has(key(x, y)) || !changed(x, y)) continue
      const bx = gx + Math.floor((x - gx) / 32) * 32
      const by = gy + Math.floor((y - gy) / 32) * 32
      const k = `${bx},${by}`
      let b = extra.get(k)
      if (!b) extra.set(k, (b = { x: bx, y: by, gridX: Math.max(0, Math.floor(bx / 32)), gridY: 0, format: rle?.format ?? 0x1001, pixels: new Uint8Array(32 * 32) }))
      b.pixels[(y - by) * 32 + (x - bx)] = v
    }
  const all = [...blocks, ...extra.values()]
  // Walls: the height field reaches 32 px above the highest block
  const minY = Math.min(...all.map((b) => b.y))
  const height = !isFloorLike(t.orientation) && extra.size ? Math.min(t.height, minY - 32) : t.height
  return { ...t, blocks: all, height }
}

/** Tiles whose pictures are identical (same blocks, same pixels). */
export function sameTilePixels(a: Dt1Tile, b: Dt1Tile): boolean {
  if (a.blocks.length !== b.blocks.length) return false
  return a.blocks.every((x, i) => {
    const y = b.blocks[i]
    return x.x === y.x && x.y === y.y && x.format === y.format && x.pixels.every((v, j) => v === y.pixels[j])
  })
}
