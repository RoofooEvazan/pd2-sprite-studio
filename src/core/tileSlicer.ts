// Cut a rendered 3D scene into Diablo II DT1 tiles and a DS1 map piece that places them.
//
// Input images are in "map screen space": world (X, Y, Z) projects to
//   px = originX + (X - Z) * 80,  py = originY + (X + Z) * 40 - Y * PX_PER_HEIGHT
// (1 world unit = 1 map tile; world +X = DS1 x, world +Z = DS1 y; Y = 0 is the ground; the game's 2:1 view).
//
// Floors: every cell's 160x80 diamond is sampled from the floor layer.
// Walls: each wall pixel belongs to the nearest cell edge, found from its world position:
//   near an X = integer line -> left wall  of cell (X, floor Z)
//   near a  Z = integer line -> right wall of cell (floor X, Z)
//   above the ground -> upper wall (orientation 1 / 2), below the ground -> lower wall (16 / 17).
//   Parts marked as lower walls are always lower walls (cliff faces, platform sides, pit walls).
// Roofs: diamonds sampled from the roof layer, raised by the roof height.
//
// Game conventions (measured from the game's own tiles and maps): walls and lower walls share a base line
// 80 px below the cell's box top; lower walls are drawn before floors; upper walls block walking (0x07).

import { Dt1, Dt1Block, Dt1Tile } from './dt1'
import { Ds1, Ds1Cell, EMPTY_CELL, newDs1 } from './ds1'

/** Screen pixels per world unit of height (ppu * cos 30deg with 160 px per tile diagonal). */
export const PX_PER_HEIGHT = (160 / Math.SQRT2) * Math.cos(Math.PI / 6)

export interface SliceInput {
  mapWidth: number // tiles along X
  mapHeight: number // tiles along Z
  imageWidth: number
  imageHeight: number
  originX: number
  originY: number
  floor: Uint8Array | null // palette indices, 0 = empty
  /** parts marked as walls (their below-ground parts become lower walls) */
  wall: Uint8Array | null
  /** world position per wall pixel: x, y, z, then 0 = empty, 1 = valid, 2 = surface faces X, 3 = faces Z */
  wallPos: Float32Array | null
  /** parts marked as lower walls */
  lower: Uint8Array | null
  lowerPos: Float32Array | null
  roof: Uint8Array | null
  roofPx: number
}

export type TileKind = 'floor' | 'walls' | 'roof'

export interface SliceOptions {
  name: string
  act: number
  mainIndex: number
  /**
   * DS1-style path for each output file (e.g. \d2\data\global\tiles\act1\mytiles\mytiles_floor.dt1).
   * With `split`, one file per kind (like the game's own tile folders); otherwise one file for everything.
   */
  dt1Path: (kind: TileKind | 'all') => string
  split: boolean
}

export interface SliceFile {
  kind: TileKind | 'all'
  path: string
  dt1: Dt1
}

export interface SliceResult {
  /** every tile, for previews */
  dt1: Dt1
  /** the DT1 files to write */
  files: SliceFile[]
  ds1: Ds1
  stats: { floors: number; walls: number; lowerWalls: number; roofs: number; unique: number; blockedSubtiles: number; droppedOverlaps: number }
}

export function kindOf(orientation: number): TileKind {
  return orientation === 0 ? 'floor' : orientation === 15 ? 'roof' : 'walls'
}

const ISO_X = [14, 12, 10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14]
const ISO_N = [4, 8, 12, 16, 20, 24, 28, 32, 28, 24, 20, 16, 12, 8, 4]
const WALL_FLAGS = 0x07 // block walking, line of sight and jumping
const GROUND_EPS = 0.02 // world units: below this a wall pixel counts as "below the ground"
const MAX_WALL_LAYERS = 4 // the game supports up to 4 wall layers per map

type WallOrientation = 1 | 2 | 16 | 17
const WALL_DIRECTION: Record<WallOrientation, number> = { 1: 1, 2: 2, 16: 6, 17: 7 }

function hash(parts: (Uint8Array | number[])[]): string {
  let h1 = 0x811c9dc5
  let h2 = 0
  for (const p of parts)
    for (let i = 0; i < p.length; i++) {
      h1 = Math.imul(h1 ^ p[i], 16777619)
      h2 = (h2 + p[i] * (i + 1)) | 0
    }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`
}

/** Sample the 25 diamond blocks of a floor-like tile whose 160x80 box starts at (bx, by). */
function sampleDiamond(img: Uint8Array, w: number, h: number, bx: number, by: number): Dt1Block[] {
  const blocks: Dt1Block[] = []
  for (let j = 0; j < 5; j++)
    for (let i = 0; i < 5; i++) {
      const x = 64 + (i - j) * 16
      const y = (i + j) * 8
      const px = new Uint8Array(32 * 32)
      let any = false
      for (let r = 0; r < 15; r++)
        for (let c = 0; c < ISO_N[r]; c++) {
          const sx = bx + x + ISO_X[r] + c
          const sy = by + y + r
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
          const v = img[sy * w + sx]
          if (v) {
            px[r * 32 + ISO_X[r] + c] = v
            any = true
          }
        }
      if (any) blocks.push({ x, y, gridX: i, gridY: j, format: 1, pixels: px })
    }
  return blocks
}

function floorLikeTile(orientation: number, direction: number, blocks: Dt1Block[], roofHeight = 0): Dt1Tile {
  return {
    direction,
    roofHeight,
    soundIndex: 0,
    animated: 0,
    height: -128,
    width: 160,
    orientation,
    mainIndex: 0,
    subIndex: 0,
    rarity: 1,
    unknown: new Uint8Array(4),
    subtileFlags: new Uint8Array(25),
    blocks
  }
}

interface WallAcc {
  orientation: WallOrientation
  cx: number
  cz: number
  pixels: Map<number, number> // key = (ly + 4096) * 256 + lx -> palette index
  minY: number
  maxY: number
}

export function sliceScene(input: SliceInput, opts: SliceOptions): SliceResult {
  const { mapWidth: W, mapHeight: H, imageWidth: iw, imageHeight: ih, originX: ox, originY: oy } = input
  // Cell box (top-left of its 160x80 diamond box) in image pixels
  const boxX = (cx: number, cz: number) => Math.round(ox + (cx - cz) * 80 - 80)
  const boxY = (cx: number, cz: number) => Math.round(oy + (cx + cz) * 40)

  // Map piece is one larger than the scene so walls on the far edges have a cell
  const mw = W + 1
  const mh = H + 1
  const floorTiles = new Map<number, Dt1Tile>()
  const roofTiles = new Map<number, Dt1Tile>()
  const walls = new Map<string, WallAcc>()
  const blocked = new Map<number, Uint8Array>() // cell -> 25 flags
  const cellId = (cx: number, cz: number) => cz * mw + cx

  // Neighbouring diamonds share their boundary pixels, so a floor ending exactly on a grid line leaves a 1-px line in
  // the next cell. A cell only gets a tile when it has pixels clearly inside its own diamond.
  const ownsPixels = (img: Uint8Array, bx: number, by: number) => {
    let n = 0
    for (let ly = 0; ly < 80; ly++)
      for (let lx = 0; lx < 160; lx++) {
        if (Math.abs(lx + 0.5 - 80) / 80 + Math.abs(ly + 0.5 - 40) / 40 > 0.94) continue
        const x = bx + lx
        const y = by + ly
        if (x >= 0 && y >= 0 && x < iw && y < ih && img[y * iw + x] && ++n >= 4) return true
      }
    return false
  }

  if (input.floor)
    for (let cz = 0; cz < H; cz++)
      for (let cx = 0; cx < W; cx++) {
        if (!ownsPixels(input.floor, boxX(cx, cz), boxY(cx, cz))) continue
        const blocks = sampleDiamond(input.floor, iw, ih, boxX(cx, cz), boxY(cx, cz))
        if (blocks.length) floorTiles.set(cellId(cx, cz), floorLikeTile(0, 3, blocks))
      }

  if (input.roof)
    for (let cz = 0; cz < H; cz++)
      for (let cx = 0; cx < W; cx++) {
        if (!ownsPixels(input.roof, boxX(cx, cz), boxY(cx, cz) - input.roofPx)) continue
        const blocks = sampleDiamond(input.roof, iw, ih, boxX(cx, cz), boxY(cx, cz) - input.roofPx)
        if (blocks.length) roofTiles.set(cellId(cx, cz), floorLikeTile(15, 5, blocks, input.roofPx))
      }

  const addWallLayer = (img: Uint8Array | null, pos: Float32Array | null, alwaysLower: boolean) => {
    if (!img || !pos) return
    const valid = (i: number) => pos[i * 4 + 3] > 0.5
    for (let py = 0; py < ih; py++)
      for (let px = 0; px < iw; px++) {
        const i = py * iw + px
        const v = img[i]
        if (!v) continue
        // Anti-aliased edge pixels may miss the position pass: borrow a neighbour's position
        let k = i
        if (!valid(k)) {
          const n = [i - 1, i + 1, i - iw, i + iw].find((j) => j >= 0 && j < iw * ih && valid(j))
          if (n === undefined) continue
          k = n
        }
        const X = pos[k * 4]
        const Y = pos[k * 4 + 1]
        const Z = pos[k * 4 + 2]
        const lower = alwaysLower || Y < -GROUND_EPS
        // Which grid line: the one the surface runs along if the render says (alpha 2 = faces X, 3 = faces Z),
        // else the nearest. Facing keeps pixels near grid crossings on their own wall.
        let facing = Math.round(pos[k * 4 + 3])
        // A wall's flat top belongs to the face below it on screen: borrow that face's direction
        for (let y = py + 1; facing === 1 && y < Math.min(ih, py + 24); y++) {
          const j = y * iw + px
          if (!img[j]) break
          const f = Math.round(pos[j * 4 + 3])
          if (f === 2 || f === 3) facing = f
        }
        const fx = Math.abs(X - Math.round(X))
        const fz = Math.abs(Z - Math.round(Z))
        let orientation: WallOrientation
        let cx: number
        let cz: number
        if (facing === 2 || (facing !== 3 && fx <= fz)) {
          orientation = lower ? 16 : 1
          cx = Math.round(X)
          cz = Math.floor(Z)
        } else {
          orientation = lower ? 17 : 2
          cx = Math.floor(X)
          cz = Math.round(Z)
        }
        if (cx < 0 || cz < 0 || cx >= mw || cz >= mh) continue
        const lx = px - boxX(cx, cz)
        const ly = py - (boxY(cx, cz) + 80) // walls and lower walls share this base line
        if (lx < 0 || lx >= 160) continue
        if (!lower && ly >= 32) continue
        const key = `${orientation}:${cx}:${cz}`
        let acc = walls.get(key)
        if (!acc) walls.set(key, (acc = { orientation, cx, cz, pixels: new Map(), minY: ly, maxY: ly }))
        acc.pixels.set((ly + 4096) * 256 + lx, v)
        acc.minY = Math.min(acc.minY, ly)
        acc.maxY = Math.max(acc.maxY, ly)
        // Low parts of upper walls block the subtile they stand on
        if (!lower && Y < 0.6) {
          const bx = Math.floor(X)
          const bz = Math.floor(Z)
          if (bx >= 0 && bz >= 0 && bx < mw && bz < mh) {
            const si = Math.min(4, Math.floor((X - bx) * 5))
            const sj = Math.min(4, Math.floor((Z - bz) * 5))
            const f = blocked.get(cellId(bx, bz)) ?? new Uint8Array(25)
            f[(4 - sj) * 5 + si] = WALL_FLAGS // flags are stored with the Z axis reversed
            blocked.set(cellId(bx, bz), f)
          }
        }
      }
  }
  addWallLayer(input.wall, input.wallPos, false)
  addWallLayer(input.lower, input.lowerPos, true)

  const wallTiles = new Map<string, Dt1Tile>()
  for (const [key, acc] of walls) {
    const top = Math.floor(acc.minY / 32) * 32
    const blocks: Dt1Block[] = []
    for (let yb = top; yb <= acc.maxY; yb += 32)
      for (let xb = 0; xb < 160; xb += 32) {
        const px = new Uint8Array(32 * 32)
        let any = false
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) {
            const v = acc.pixels.get((yb + y + 4096) * 256 + xb + x)
            if (v) {
              px[y * 32 + x] = v
              any = true
            }
          }
        if (any) blocks.push({ x: xb, y: yb, gridX: xb / 32, gridY: 0, format: 0x1001, pixels: px })
      }
    if (!blocks.length) continue
    const minBlockY = Math.min(...blocks.map((b) => b.y))
    const maxBlockEnd = Math.max(...blocks.map((b) => b.y + 32))
    const isLower = acc.orientation >= 16
    wallTiles.set(key, {
      direction: WALL_DIRECTION[acc.orientation],
      roofHeight: 0,
      soundIndex: 0,
      animated: 0,
      // Upper walls: measured from the top block; lower walls: their full span (as in the game's tiles)
      height: isLower ? -(maxBlockEnd - minBlockY) : minBlockY - 32,
      width: 160,
      orientation: acc.orientation,
      mainIndex: 0,
      subIndex: 0,
      rarity: 1,
      unknown: new Uint8Array(4),
      subtileFlags: new Uint8Array(25),
      blocks
    })
  }

  // Walkability: a cell's blocked subtiles go on its left wall, else right wall, else floor tile
  let blockedSubtiles = 0
  for (const [cell, flags] of blocked) {
    const cx = cell % mw
    const cz = Math.floor(cell / mw)
    const target = wallTiles.get(`1:${cx}:${cz}`) ?? wallTiles.get(`2:${cx}:${cz}`) ?? floorTiles.get(cell)
    if (!target) continue
    for (let i = 0; i < 25; i++)
      if (flags[i]) {
        target.subtileFlags[i] |= flags[i]
        blockedSubtiles++
      }
  }

  // Assign indexes; identical tiles share one entry
  const tiles: Dt1Tile[] = []
  const counters = new Map<number, { main: number; sub: number }>()
  const seen = new Map<string, Dt1Tile>()
  const assign = (t: Dt1Tile): Dt1Tile => {
    const h = hash([[t.orientation, t.roofHeight, t.height & 0xffff], t.subtileFlags, ...t.blocks.map((b) => [b.x & 0xff, b.y & 0xff, (b.x >> 8) & 0xff, (b.y >> 8) & 0xff]), ...t.blocks.map((b) => b.pixels)])
    const existing = seen.get(h)
    if (existing) return existing
    const c = counters.get(t.orientation) ?? { main: opts.mainIndex, sub: 0 }
    t.mainIndex = c.main
    t.subIndex = c.sub
    c.sub++
    if (c.sub > 63) {
      c.sub = 0
      c.main++
    }
    counters.set(t.orientation, c)
    if (t.mainIndex > 63) throw new Error('Too many unique tiles for the index range. Use a lower starting index or a smaller scene.')
    seen.set(h, t)
    tiles.push(t)
    return t
  }

  const ds1 = newDs1(mw, mh, opts.act, [], MAX_WALL_LAYERS, 1)
  const cell = (t: Dt1Tile, prop1: number): Ds1Cell => ({ ...EMPTY_CELL, prop1, style: t.mainIndex, sequence: t.subIndex })
  for (const [id, t] of floorTiles) ds1.floors[0][id] = cell(assign(t), 194)
  // Walls, lower walls and roofs share the wall layers: each goes into the first free layer of its cell
  let droppedOverlaps = 0
  const placeWall = (id: number, t: Dt1Tile) => {
    const layer = ds1.walls.find((l) => !l.cells[id].prop1)
    if (!layer) {
      droppedOverlaps++
      return
    }
    layer.cells[id] = cell(t, 129)
    layer.orientations[id] = t.orientation
  }
  // Order within a cell: upper walls, then lower walls, then roofs
  const sortedWalls = [...wallTiles.entries()].sort((a, b) => Number(a[0].split(':')[0]) - Number(b[0].split(':')[0]))
  for (const [key, t] of sortedWalls) {
    const [, cx, cz] = key.split(':').map(Number)
    placeWall(cellId(cx, cz), assign(t))
  }
  for (const [id, t] of roofTiles) placeWall(id, assign(t))

  const files: SliceFile[] = []
  if (opts.split) {
    for (const kind of ['floor', 'walls', 'roof'] as TileKind[]) {
      const own = tiles.filter((t) => kindOf(t.orientation) === kind)
      if (own.length) files.push({ kind, path: opts.dt1Path(kind), dt1: { version1: 7, version2: 6, tiles: own } })
    }
  } else files.push({ kind: 'all', path: opts.dt1Path('all'), dt1: { version1: 7, version2: 6, tiles } })
  ds1.files = files.map((f) => f.path)

  const lowerWalls = [...wallTiles.values()].filter((t) => t.orientation >= 16).length
  return {
    dt1: { version1: 7, version2: 6, tiles },
    files,
    ds1,
    stats: {
      floors: floorTiles.size,
      walls: wallTiles.size - lowerWalls,
      lowerWalls,
      roofs: roofTiles.size,
      unique: tiles.length,
      blockedSubtiles,
      droppedOverlaps
    }
  }
}
