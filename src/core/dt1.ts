// DT1: Diablo II map tile sets. Each tile is a set of 32-pixel blocks: floor-like tiles use
// "isometric" diamond blocks (32x15, raw pixels), walls use RLE-compressed 32x32 blocks.
// Layout per Paul Siramy's DT1 documentation.

export interface Dt1Block {
  x: number // pixel position within the tile (walls: y is negative, measured up from the floor line)
  y: number
  gridX: number
  gridY: number
  /** 1 = isometric diamond, anything else = RLE */
  format: number
  /** Decoded 32x32 pixels (isometric blocks use the top 15 rows as a diamond) */
  pixels: Uint8Array
}

export interface Dt1Tile {
  direction: number
  roofHeight: number
  soundIndex: number
  animated: number
  height: number // negative for walls
  width: number
  orientation: number
  mainIndex: number
  subIndex: number
  rarity: number // also the frame number of animated tiles
  unknown: Uint8Array // 4 bytes kept for round trips
  subtileFlags: Uint8Array // 25 bytes, 5x5
  blocks: Dt1Block[]
}

export interface Dt1 {
  version1: number
  version2: number
  tiles: Dt1Tile[]
}

export const ORIENTATION_NAMES: Record<number, string> = {
  0: 'Floor',
  1: 'Left wall',
  2: 'Right wall',
  3: 'North corner (right part)',
  4: 'North corner (left part)',
  5: 'Left end wall',
  6: 'Right end wall',
  7: 'South corner',
  8: 'Left wall with door',
  9: 'Right wall with door',
  10: 'Special',
  11: 'Special',
  12: 'Pillar / standalone',
  13: 'Shadow',
  14: 'Tree',
  15: 'Roof',
  16: 'Lower left wall',
  17: 'Lower right wall',
  18: 'Lower north corner',
  19: 'Lower south corner'
}

/** Floor-like orientations are drawn with isometric blocks on the tile diamond. */
export function isFloorLike(orientation: number): boolean {
  return orientation === 0 || orientation === 15
}

// Isometric block: 15 lines, each centred, widths 4..32..4
const ISO_X = [14, 12, 10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14]
const ISO_N = [4, 8, 12, 16, 20, 24, 28, 32, 28, 24, 20, 16, 12, 8, 4]

export const SUBTILE = { WALK_BLOCK: 0x01, LOS_BLOCK: 0x02, JUMP_BLOCK: 0x04, PLAYER_WALK: 0x08, UNKNOWN: 0x10, LIGHT_BLOCK: 0x20, MISSILE: 0x40, UNKNOWN2: 0x80 }

function decodeIso(data: Uint8Array, p: number): Uint8Array {
  const px = new Uint8Array(32 * 32)
  for (let y = 0; y < 15; y++) {
    const n = ISO_N[y]
    for (let i = 0; i < n; i++) px[y * 32 + ISO_X[y] + i] = data[p++]
  }
  return px
}

function decodeRle(data: Uint8Array, p: number, length: number): Uint8Array {
  const px = new Uint8Array(32 * 32)
  const end = p + length
  let x = 0
  let y = 0
  while (p < end && y < 32) {
    const jump = data[p++]
    const n = data[p++]
    if (jump === 0 && n === 0) {
      x = 0
      y++
      continue
    }
    x += jump
    for (let i = 0; i < n; i++, x++) {
      const v = data[p++]
      if (x < 32) px[y * 32 + x] = v
    }
  }
  return px
}

export function decodeDt1(data: Uint8Array): Dt1 {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const version1 = dv.getInt32(0, true)
  const version2 = dv.getInt32(4, true)
  // Diablo II 1.x uses version 7/6; a few leftover files in the archives use an older layout
  if (version1 !== 7 || version2 !== 6) throw new Error(`DT1: unsupported version ${version1}/${version2}`)
  const nTiles = dv.getInt32(268, true)
  let tp = dv.getInt32(272, true)
  if (nTiles < 0 || nTiles > 100000 || tp + nTiles * 96 > data.length) throw new Error('DT1: bad tile table')
  const tiles: Dt1Tile[] = []
  for (let t = 0; t < nTiles; t++, tp += 96) {
    const blocksPtr = dv.getInt32(tp + 72, true)
    const nBlocks = dv.getInt32(tp + 80, true)
    if (nBlocks < 0 || blocksPtr < 0 || blocksPtr + nBlocks * 20 > data.length) throw new Error(`DT1: bad block table in tile ${t}`)
    const blocks: Dt1Block[] = []
    for (let b = 0; b < nBlocks; b++) {
      const bp = blocksPtr + b * 20
      const format = dv.getInt16(bp + 8, true)
      const length = dv.getInt32(bp + 10, true)
      const offset = dv.getInt32(bp + 16, true)
      const dp = blocksPtr + offset
      blocks.push({
        x: dv.getInt16(bp, true),
        y: dv.getInt16(bp + 2, true),
        gridX: data[bp + 6],
        gridY: data[bp + 7],
        format,
        pixels: format === 1 ? decodeIso(data, dp) : decodeRle(data, dp, length)
      })
    }
    tiles.push({
      direction: dv.getInt32(tp, true),
      roofHeight: dv.getInt16(tp + 4, true),
      soundIndex: data[tp + 6],
      animated: data[tp + 7],
      height: dv.getInt32(tp + 8, true),
      width: dv.getInt32(tp + 12, true),
      orientation: dv.getInt32(tp + 20, true),
      mainIndex: dv.getInt32(tp + 24, true),
      subIndex: dv.getInt32(tp + 28, true),
      rarity: dv.getInt32(tp + 32, true),
      unknown: data.slice(tp + 36, tp + 40),
      subtileFlags: data.slice(tp + 40, tp + 65),
      blocks
    })
  }
  return { version1, version2, tiles }
}

function encodeIso(px: Uint8Array): number[] {
  const out: number[] = []
  for (let y = 0; y < 15; y++) for (let i = 0; i < ISO_N[y]; i++) out.push(px[y * 32 + ISO_X[y] + i])
  return out
}

function encodeRle(px: Uint8Array): number[] {
  const out: number[] = []
  for (let y = 0; y < 32; y++) {
    let x = 0
    let last = 32
    while (last > 0 && px[y * 32 + last - 1] === 0) last--
    while (x < last) {
      let jump = 0
      while (x < last && px[y * 32 + x] === 0) {
        x++
        jump++
      }
      const start = x
      while (x < last && px[y * 32 + x] !== 0) x++
      out.push(jump, x - start)
      for (let i = start; i < x; i++) out.push(px[y * 32 + i])
    }
    out.push(0, 0)
  }
  return out
}

function blockIsEmpty(b: Dt1Block): boolean {
  return b.pixels.every((v) => v === 0)
}

export function encodeDt1(d: Dt1, opts: { dropEmptyBlocks?: boolean } = {}): Uint8Array {
  const headerSize = 276
  const tileHeadersSize = d.tiles.length * 96
  // Per-tile block section: 20-byte headers followed by the block data
  const sections = d.tiles.map((t) => {
    const blocks = opts.dropEmptyBlocks ? t.blocks.filter((b) => !blockIsEmpty(b)) : t.blocks
    const datas = blocks.map((b) => (b.format === 1 ? encodeIso(b.pixels) : encodeRle(b.pixels)))
    const headersLen = blocks.length * 20
    let dataLen = 0
    for (const x of datas) dataLen += x.length
    const buf = new Uint8Array(headersLen + dataLen)
    const dv = new DataView(buf.buffer)
    let off = headersLen
    blocks.forEach((b, i) => {
      const hp = i * 20
      dv.setInt16(hp, b.x, true)
      dv.setInt16(hp + 2, b.y, true)
      buf[hp + 6] = b.gridX
      buf[hp + 7] = b.gridY
      dv.setInt16(hp + 8, b.format, true)
      dv.setInt32(hp + 10, datas[i].length, true)
      dv.setInt32(hp + 16, off, true)
      buf.set(datas[i], off)
      off += datas[i].length
    })
    return { buf, count: blocks.length }
  })
  let total = headerSize + tileHeadersSize
  for (const s of sections) total += s.buf.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setInt32(0, d.version1, true)
  dv.setInt32(4, d.version2, true)
  dv.setInt32(268, d.tiles.length, true)
  dv.setInt32(272, headerSize, true)
  let bp = headerSize + tileHeadersSize
  d.tiles.forEach((t, i) => {
    const tp = headerSize + i * 96
    dv.setInt32(tp, t.direction, true)
    dv.setInt16(tp + 4, t.roofHeight, true)
    out[tp + 6] = t.soundIndex
    out[tp + 7] = t.animated
    dv.setInt32(tp + 8, t.height, true)
    dv.setInt32(tp + 12, t.width, true)
    dv.setInt32(tp + 20, t.orientation, true)
    dv.setInt32(tp + 24, t.mainIndex, true)
    dv.setInt32(tp + 28, t.subIndex, true)
    dv.setInt32(tp + 32, t.rarity, true)
    out.set(t.unknown.subarray(0, 4), tp + 36)
    out.set(t.subtileFlags.subarray(0, 25), tp + 40)
    dv.setInt32(tp + 72, bp, true)
    dv.setInt32(tp + 76, sections[i].buf.length, true)
    dv.setInt32(tp + 80, sections[i].count, true)
    out.set(sections[i].buf, bp)
    bp += sections[i].buf.length
  })
  return out
}

/**
 * Paint a tile into an indexed image. Returns the image and where the tile's own origin sits in it.
 * Floors: origin = top-left of the 160x80 diamond box. Walls: origin = top-left of the floor box too,
 * with the wall rising above it (block y values are negative).
 */
export function tileImage(t: Dt1Tile): { width: number; height: number; originX: number; originY: number; pixels: Uint8Array } {
  let x0 = 0
  let y0 = 0
  let x1 = 160
  let y1 = 80
  for (const b of t.blocks) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + 32)
    y1 = Math.max(y1, b.y + 32)
  }
  const w = x1 - x0
  const h = y1 - y0
  const px = new Uint8Array(w * h)
  for (const b of t.blocks) {
    const rows = b.format === 1 ? 15 : 32
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < 32; x++) {
        const v = b.pixels[y * 32 + x]
        if (!v) continue
        const tx = b.x - x0 + x
        const ty = b.y - y0 + y
        if (tx >= 0 && ty >= 0 && tx < w && ty < h) px[ty * w + tx] = v
      }
  }
  return { width: w, height: h, originX: -x0, originY: -y0, pixels: px }
}
