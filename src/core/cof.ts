// COF: animation composition file. Lists the layers (components) of a unit for one mode + weapon class,
// their draw order per direction/frame, and per-layer draw effects.

export const COMPOSITS = ['HD', 'TR', 'LG', 'RA', 'LA', 'RH', 'LH', 'SH', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const
export type Composit = (typeof COMPOSITS)[number]

export const COMPOSIT_NAMES: Record<Composit, string> = {
  HD: 'Head',
  TR: 'Torso',
  LG: 'Legs',
  RA: 'Right arm',
  LA: 'Left arm',
  RH: 'Right hand',
  LH: 'Left hand',
  SH: 'Shield',
  S1: 'Special 1',
  S2: 'Special 2',
  S3: 'Special 3',
  S4: 'Special 4',
  S5: 'Special 5',
  S6: 'Special 6',
  S7: 'Special 7',
  S8: 'Special 8'
}

export interface CofLayer {
  composit: number // index into COMPOSITS
  shadow: number
  selectable: number
  transparent: number
  drawEffect: number
  /** upper-cased; rawWeaponClass keeps the file's original casing for re-encoding */
  weaponClass: string
  rawWeaponClass?: string
}

export interface Cof {
  numLayers: number
  framesPerDir: number
  directions: number
  version: number
  header: Uint8Array // raw 28-byte header, preserved on write
  box: { xMin: number; xMax: number; yMin: number; yMax: number }
  speed: number
  layers: CofLayer[]
  keyframes: Uint8Array
  /** order[dir][frame] = composit indices, back to front */
  order: number[][][]
}

const HEADER = 28

export function decodeCof(data: Uint8Array): Cof {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const numLayers = data[0]
  const framesPerDir = data[1]
  const directions = data[2]
  const expected = HEADER + numLayers * 9 + framesPerDir + directions * framesPerDir * numLayers
  if (data.length < expected) throw new Error(`COF: size ${data.length} < expected ${expected}`)
  const layers: CofLayer[] = []
  let p = HEADER
  for (let i = 0; i < numLayers; i++, p += 9) {
    let wc = ''
    for (let k = 0; k < 4 && data[p + 5 + k]; k++) wc += String.fromCharCode(data[p + 5 + k])
    layers.push({ composit: data[p], shadow: data[p + 1], selectable: data[p + 2], transparent: data[p + 3], drawEffect: data[p + 4], weaponClass: wc.toUpperCase(), rawWeaponClass: wc })
  }
  const keyframes = data.slice(p, p + framesPerDir)
  p += framesPerDir
  const order: number[][][] = []
  for (let d = 0; d < directions; d++) {
    const dir: number[][] = []
    for (let f = 0; f < framesPerDir; f++) {
      dir.push(Array.from(data.subarray(p, p + numLayers)))
      p += numLayers
    }
    order.push(dir)
  }
  return {
    numLayers,
    framesPerDir,
    directions,
    version: data[3],
    header: data.slice(0, HEADER),
    box: { xMin: dv.getInt32(8, true), xMax: dv.getInt32(12, true), yMin: dv.getInt32(16, true), yMax: dv.getInt32(20, true) },
    speed: dv.getUint16(24, true),
    layers,
    keyframes,
    order
  }
}

export function encodeCof(c: Cof): Uint8Array {
  const size = HEADER + c.layers.length * 9 + c.framesPerDir + c.directions * c.framesPerDir * c.layers.length
  const out = new Uint8Array(size)
  const dv = new DataView(out.buffer)
  out.set(c.header.subarray(0, HEADER))
  out[0] = c.layers.length
  out[1] = c.framesPerDir
  out[2] = c.directions
  dv.setInt32(8, c.box.xMin, true)
  dv.setInt32(12, c.box.xMax, true)
  dv.setInt32(16, c.box.yMin, true)
  dv.setInt32(20, c.box.yMax, true)
  dv.setUint16(24, c.speed, true)
  let p = HEADER
  for (const l of c.layers) {
    out[p] = l.composit
    out[p + 1] = l.shadow
    out[p + 2] = l.selectable
    out[p + 3] = l.transparent
    out[p + 4] = l.drawEffect
    const wc = l.rawWeaponClass?.toUpperCase() === l.weaponClass ? l.rawWeaponClass : l.weaponClass
    for (let k = 0; k < 4; k++) out[p + 5 + k] = wc.charCodeAt(k) || 0
    p += 9
  }
  out.set(c.keyframes.subarray(0, c.framesPerDir), p)
  p += c.framesPerDir
  for (const dir of c.order) for (const fr of dir) for (let i = 0; i < c.layers.length; i++) out[p++] = fr[i] ?? 0
  return out
}

// ---------------------------------------------------------------------------------------------
// AnimData.d2: per-COF frame counts and animation speed.

export interface AnimDataRecord {
  name: string
  framesPerDir: number
  speed: number // 256 = 25 fps
  events: Uint8Array
}

export function decodeAnimData(data: Uint8Array): Map<string, AnimDataRecord> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const map = new Map<string, AnimDataRecord>()
  let p = 0
  for (let b = 0; b < 256 && p + 4 <= data.length; b++) {
    const count = dv.getUint32(p, true)
    p += 4
    for (let i = 0; i < count; i++) {
      let name = ''
      for (let k = 0; k < 8 && data[p + k]; k++) name += String.fromCharCode(data[p + k])
      const rec: AnimDataRecord = {
        name,
        framesPerDir: dv.getUint32(p + 8, true),
        speed: dv.getUint32(p + 12, true),
        events: data.slice(p + 16, p + 160)
      }
      map.set(name.toUpperCase(), rec)
      p += 160
    }
  }
  return map
}

/** Frames per second the game plays an animation at. */
export function animFps(speed: number): number {
  return (25 * speed) / 256
}
