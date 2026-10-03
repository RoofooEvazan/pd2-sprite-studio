// DS1: Diablo II map presets. A grid of cells with several layers (walls + their orientations, floors,
// shadow, optional tag), a list of DT1 file names, objects, and (in later versions) groups and NPC paths.
// Unknown/rare trailing data is preserved byte-for-byte so files round-trip.

export interface Ds1Cell {
  /** Non-zero means "a tile is here" for walls/floors (the game's prop1 byte) */
  prop1: number
  sequence: number // sub index
  unknown1: number
  style: number // main index
  unknown2: number
  hidden: boolean
}

export interface Ds1Object {
  type: number
  id: number
  x: number
  y: number
  flags: number
}

export interface Ds1 {
  version: number
  width: number // in tiles
  height: number
  act: number // 1-based
  substitutionType: number
  files: string[]
  /** wall layers: cells + orientation per cell */
  walls: { cells: Ds1Cell[]; orientations: number[] }[]
  floors: Ds1Cell[][]
  shadow: Ds1Cell[]
  tag: number[] | null
  objects: Ds1Object[]
  /** Everything after the objects (groups, NPC paths), kept verbatim */
  trailing: Uint8Array
  /** Two unknown dwords present in versions 9-13 */
  unknownV9: [number, number]
}

// Versions < 7 store orientations through this lookup
const DIR_LOOKUP = [0x00, 0x01, 0x02, 0x01, 0x02, 0x03, 0x03, 0x05, 0x05, 0x06, 0x06, 0x07, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x14]

export function decodeCell(dw: number): Ds1Cell {
  return {
    prop1: dw & 0xff,
    sequence: (dw >>> 8) & 0x3f,
    unknown1: (dw >>> 14) & 0x3f,
    style: (dw >>> 20) & 0x3f,
    unknown2: (dw >>> 26) & 0x1f,
    hidden: (dw >>> 31) === 1
  }
}

export function encodeCell(c: Ds1Cell): number {
  return ((c.prop1 & 0xff) | ((c.sequence & 0x3f) << 8) | ((c.unknown1 & 0x3f) << 14) | ((c.style & 0x3f) << 20) | ((c.unknown2 & 0x1f) << 26) | ((c.hidden ? 1 : 0) << 31)) >>> 0
}

export const EMPTY_CELL: Ds1Cell = { prop1: 0, sequence: 0, unknown1: 0, style: 0, unknown2: 0, hidden: false }

export function decodeDs1(data: Uint8Array): Ds1 {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let p = 0
  const i32 = () => {
    const v = dv.getInt32(p, true)
    p += 4
    return v
  }
  const version = i32()
  const width = i32() + 1
  const height = i32() + 1
  const act = version >= 8 ? Math.min(5, i32() + 1) : 1
  const substitutionType = version >= 10 ? i32() : 0
  const files: string[] = []
  if (version >= 3) {
    const n = i32()
    for (let i = 0; i < n; i++) {
      let s = ''
      while (p < data.length && data[p] !== 0) s += String.fromCharCode(data[p++])
      p++
      files.push(s)
    }
  }
  const unknownV9: [number, number] = [0, 0]
  if (version >= 9 && version <= 13) {
    unknownV9[0] = i32()
    unknownV9[1] = i32()
  }
  let nWalls = 1
  let nFloors = 1
  if (version >= 4) {
    nWalls = i32()
    if (version >= 16) nFloors = i32()
  }
  const hasTag = substitutionType === 1 || substitutionType === 2
  const n = width * height
  const readCells = () => {
    const out: Ds1Cell[] = []
    for (let i = 0; i < n; i++) out.push(decodeCell(dv.getUint32(p + i * 4, true)))
    p += n * 4
    return out
  }
  const readOrient = () => {
    const out: number[] = []
    // v7+: full dword kept (orientation is the low byte; use `& 0xff`)
    for (let i = 0; i < n; i++) {
      const v = data[p + i * 4]
      out.push(version < 7 ? (DIR_LOOKUP[v] ?? v) : dv.getUint32(p + i * 4, true))
    }
    p += n * 4
    return out
  }
  const walls: Ds1['walls'] = []
  const floors: Ds1Cell[][] = []
  let shadow: Ds1Cell[] = []
  let tag: number[] | null = null
  if (version < 4) {
    // Old fixed order: wall, floor, orientation, tag, shadow
    const w = readCells()
    floors.push(readCells())
    const o = readOrient()
    walls.push({ cells: w, orientations: o })
    const t: number[] = []
    for (let i = 0; i < n; i++) t.push(dv.getUint32(p + i * 4, true))
    p += n * 4
    if (hasTag) tag = t
    shadow = readCells()
  } else {
    for (let i = 0; i < nWalls; i++) {
      const cells = readCells()
      const orientations = readOrient()
      walls.push({ cells, orientations })
    }
    for (let i = 0; i < nFloors; i++) floors.push(readCells())
    shadow = readCells()
    if (hasTag) {
      tag = []
      for (let i = 0; i < n; i++) tag.push(dv.getUint32(p + i * 4, true))
      p += n * 4
    }
  }
  const objects: Ds1Object[] = []
  if (version >= 2 && p + 4 <= data.length) {
    const count = i32()
    for (let i = 0; i < count; i++) {
      const o: Ds1Object = { type: i32(), id: i32(), x: i32(), y: i32(), flags: version > 5 ? i32() : 0 }
      objects.push(o)
    }
  }
  return { version, width, height, act, substitutionType, files, walls, floors, shadow, tag, objects, trailing: data.slice(p), unknownV9 }
}

export function encodeDs1(d: Ds1): Uint8Array {
  const parts: number[] = []
  const bytes: Uint8Array[] = []
  const flush = () => {
    if (!parts.length) return
    const b = new Uint8Array(parts.length * 4)
    const dv = new DataView(b.buffer)
    parts.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true))
    bytes.push(b)
    parts.length = 0
  }
  const i32 = (v: number) => parts.push(v >>> 0)
  const v = d.version
  i32(v)
  i32(d.width - 1)
  i32(d.height - 1)
  if (v >= 8) i32(d.act - 1)
  if (v >= 10) i32(d.substitutionType)
  if (v >= 3) {
    i32(d.files.length)
    flush()
    for (const f of d.files) {
      const s = new Uint8Array(f.length + 1)
      for (let i = 0; i < f.length; i++) s[i] = f.charCodeAt(i) & 0xff
      bytes.push(s)
    }
  }
  if (v >= 9 && v <= 13) {
    i32(d.unknownV9[0])
    i32(d.unknownV9[1])
  }
  const cells = (c: Ds1Cell[]) => c.forEach((x) => i32(encodeCell(x)))
  const orients = (o: number[]) => o.forEach((x) => i32(v < 7 ? Math.max(0, DIR_LOOKUP.indexOf(x)) : x))
  if (v < 4) {
    cells(d.walls[0].cells)
    cells(d.floors[0])
    orients(d.walls[0].orientations)
    ;(d.tag ?? new Array(d.width * d.height).fill(0)).forEach((x) => i32(x))
    cells(d.shadow)
  } else {
    i32(d.walls.length)
    if (v >= 16) i32(d.floors.length)
    for (const w of d.walls) {
      cells(w.cells)
      orients(w.orientations)
    }
    for (const f of d.floors) cells(f)
    cells(d.shadow)
    if (d.tag) d.tag.forEach((x) => i32(x))
  }
  if (v >= 2) {
    i32(d.objects.length)
    for (const o of d.objects) {
      i32(o.type)
      i32(o.id)
      i32(o.x)
      i32(o.y)
      if (v > 5) i32(o.flags)
    }
  }
  flush()
  bytes.push(d.trailing)
  let total = 0
  for (const b of bytes) total += b.length
  const out = new Uint8Array(total)
  let p = 0
  for (const b of bytes) {
    out.set(b, p)
    p += b.length
  }
  return out
}

/** A blank version-18 map piece. */
export function newDs1(width: number, height: number, act: number, files: string[], wallLayers = 2, floorLayers = 1): Ds1 {
  const n = width * height
  const blank = () => Array.from({ length: n }, () => ({ ...EMPTY_CELL }))
  return {
    version: 18,
    width,
    height,
    act,
    substitutionType: 0,
    files,
    walls: Array.from({ length: wallLayers }, () => ({ cells: blank(), orientations: new Array(n).fill(0) })),
    floors: Array.from({ length: floorLayers }, blank),
    shadow: blank(),
    tag: null,
    objects: [],
    // version >= 14 ends with an NPC path count
    trailing: new Uint8Array(4),
    unknownV9: [0, 0]
  }
}
