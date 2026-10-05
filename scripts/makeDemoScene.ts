// Example map scene for the Tile Maker: a ruined Tristram-style chapel courtyard on a cliff top, written as
// a Blender-style .glb (textures embedded) and a 3ds Max-friendly .obj + .mtl + PNG textures.
// 1 unit = 1 map tile, Y up, ground (the courtyard floor) at Y = 0. Part names make the roles guess themselves:
// floor_*, wall_* / pillar / grave / barrel (walls), cliff_* (lower walls), roof_* (roof).
// Usage: npx tsx scripts/makeDemoScene.ts   → examples/tristram-courtyard/
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { encodePng } from './pngNode'

const OUT = path.join('examples', 'tristram-courtyard')
const TEX = 256

// ------------------------------------------------------------------ seamless procedural textures

let seed = 1234567
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)
const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** Value noise that wraps every `p` lattice cells (so textures tile). */
function noise(x: number, y: number, p: number, s = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const w = (v: number) => ((v % p) + p) % p
  const a = hash(w(xi), w(yi), s)
  const b = hash(w(xi + 1), w(yi), s)
  const c = hash(w(xi), w(yi + 1), s)
  const d = hash(w(xi + 1), w(yi + 1), s)
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const fbm = (x: number, y: number, p: number, s = 0) => {
  let t = 0
  let amp = 0.5
  for (let o = 0; o < 4; o++) {
    t += amp * noise(x * 2 ** o, y * 2 ** o, p * 2 ** o, s + o)
    amp /= 2
  }
  return t
}

type Shader = (u: number, v: number) => [number, number, number]
function texture(fn: Shader): Uint8Array {
  const px = new Uint8Array(TEX * TEX * 4)
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const [r, g, b] = fn(x / TEX, y / TEX)
      const i = (y * TEX + x) * 4
      px[i] = Math.max(0, Math.min(255, r))
      px[i + 1] = Math.max(0, Math.min(255, g))
      px[i + 2] = Math.max(0, Math.min(255, b))
      px[i + 3] = 255
    }
  return px
}
const tint = (base: [number, number, number], k: number): [number, number, number] => [base[0] * k, base[1] * k, base[2] * k]

/** Irregular flagstones: wrapped jittered-grid Voronoi, dark mortar between stones. */
const flagstone: Shader = (u, v) => {
  const n = 4
  let d1 = 9
  let d2 = 9
  let id = 0
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = Math.floor(u * n) + i
      const cy = Math.floor(v * n) + j
      const wx = ((cx % n) + n) % n
      const wy = ((cy % n) + n) % n
      const px = (cx + 0.2 + 0.6 * hash(wx, wy, 7)) / n
      const py = (cy + 0.2 + 0.6 * hash(wx, wy, 8)) / n
      const d = Math.hypot(u - px, v - py)
      if (d < d1) {
        d2 = d1
        d1 = d
        id = wx * 31 + wy
      } else if (d < d2) d2 = d
    }
  const edge = (d2 - d1) * n
  const grain = fbm(u * 8, v * 8, 8, 3)
  if (edge < 0.08) return tint([52, 47, 40], 0.8 + grain * 0.4)
  const k = 0.75 + 0.35 * hash(id, 1, 9) + (grain - 0.5) * 0.35 - (edge < 0.16 ? 0.15 : 0)
  return tint([118, 110, 98], k)
}

const dirt: Shader = (u, v) => {
  const g = fbm(u * 6, v * 6, 6, 11)
  const pebble = noise(u * 40, v * 40, 40, 12) > 0.82 ? 1.35 : 1
  return tint([104, 82, 56], (0.7 + g * 0.6) * pebble)
}

/** Stone bricks, 4 courses per tile, half-offset rows. */
const bricks: Shader = (u, v) => {
  const rows = 8
  const r = Math.floor(v * rows)
  const cols = 4
  const uu = u * cols + (r % 2 ? 0.5 : 0)
  const c = Math.floor(uu)
  const fu = uu - c
  const fv = v * rows - r
  const mortar = fu < 0.04 || fu > 0.96 || fv < 0.07 || fv > 0.93
  const g = fbm(u * 10, v * 10, 10, 21)
  if (mortar) return tint([60, 55, 48], 0.85 + g * 0.3)
  const k = 0.78 + 0.3 * hash(((c % cols) + cols) % cols, r, 22) + (g - 0.5) * 0.3
  return tint([132, 122, 104], k)
}

/** Layered cliff rock with cracks. */
const rock: Shader = (u, v) => {
  // Stacked boulders: wrapped Voronoi cells, each shaded lighter at its top (light from above), dark cracks between
  const n = 5
  let d1 = 9
  let d2 = 9
  let id = 0
  let cy0 = 0
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = Math.floor(u * n) + i
      const cy = Math.floor(v * n) + j
      const wx = ((cx % n) + n) % n
      const wy = ((cy % n) + n) % n
      const px = (cx + 0.15 + 0.7 * hash(wx, wy, 33)) / n
      const py = (cy + 0.15 + 0.7 * hash(wx, wy, 34)) / n
      // squash vertically so boulders read as layered ledges
      const d = Math.hypot(u - px, (v - py) * 1.6)
      if (d < d1) {
        d2 = d1
        d1 = d
        id = wx * 17 + wy
        cy0 = py
      } else if (d < d2) d2 = d
    }
  const edge = (d2 - d1) * n
  const g = fbm(u * 9, v * 9, 9, 31)
  if (edge < 0.07) return tint([38, 32, 27], 0.9 + g * 0.3)
  const lit = 1.15 - Math.max(0, Math.min(1, (v - cy0) * n + 0.5)) * 0.45
  return tint([112, 94, 76], (0.7 + 0.3 * hash(id, 2, 35) + (g - 0.5) * 0.35) * lit * (edge < 0.14 ? 0.8 : 1))
}

/** Clay roof shingles. */
const shingles: Shader = (u, v) => {
  const rows = 10
  const r = Math.floor(v * rows)
  const uu = u * 8 + (r % 2 ? 0.5 : 0)
  const c = Math.floor(uu)
  const fu = uu - c
  const fv = v * rows - r
  const g = fbm(u * 8, v * 8, 8, 41)
  if (fu < 0.05 || fv > 0.9) return tint([45, 25, 20], 0.9 + g * 0.2)
  return tint([128, 62, 44], (0.7 + 0.3 * hash(c % 8, r, 42) + (g - 0.5) * 0.3) * (0.75 + 0.25 * fv))
}

const wood: Shader = (u, v) => {
  const plank = Math.floor(u * 4)
  const grain = noise(u * 4 * 6, v * 30, 24, 51 + plank)
  const seam = u * 4 - plank < 0.05 ? 0.5 : 1
  return tint([104, 72, 44], (0.7 + grain * 0.45 + 0.15 * hash(plank, 0, 52)) * seam)
}

const gravestone: Shader = (u, v) => {
  const g = fbm(u * 7, v * 7, 7, 61)
  const moss = fbm(u * 3, v * 3, 3, 62) > 0.62
  return moss ? tint([78, 92, 58], 0.8 + g * 0.4) : tint([150, 146, 136], 0.75 + g * 0.4)
}

const flame: Shader = (u, v) => tint([255, 150, 40], 0.85 + 0.3 * noise(u * 8, v * 8, 8, 71))

interface Mat {
  name: string
  file: string
  pixels: Uint8Array
  /** texture repeats per world unit (tile) */
  repeat: number
}
const mats: Record<string, Mat> = {}
const mat = (name: string, fn: Shader, repeat: number): Mat => (mats[name] = { name, file: `${name}.png`, pixels: texture(fn), repeat })
const M = {
  flagstone: mat('flagstone', flagstone, 1),
  dirt: mat('dirt', dirt, 1),
  bricks: mat('stone_bricks', bricks, 1),
  rock: mat('cliff_rock', rock, 0.5),
  roof: mat('roof_shingles', shingles, 1),
  wood: mat('wood', wood, 2),
  grave: mat('gravestone', gravestone, 2),
  flame: mat('torch_flame', flame, 1)
}

// ------------------------------------------------------------------ scene (all positions in tiles)

interface Part {
  name: string
  mat: Mat
  geo: THREE.BufferGeometry // baked into world space
}
const parts: Part[] = []

function add(name: string, m: Mat, geo: THREE.BufferGeometry, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotY = 0) {
  const mesh = new THREE.Mesh(geo)
  mesh.position.set(...pos)
  mesh.scale.set(...scale)
  mesh.rotation.y = rotY
  mesh.updateMatrixWorld(true)
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(mesh.matrixWorld)
  // World-space (box-projected) UVs: the same texel size on every part, at `repeat` per tile
  const p = g.getAttribute('position')
  const n = g.getAttribute('normal')
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i))
    const ny = Math.abs(n.getY(i))
    const nz = Math.abs(n.getZ(i))
    const [a, b] = ny >= nx && ny >= nz ? [p.getX(i), p.getZ(i)] : nx >= nz ? [p.getZ(i), -p.getY(i)] : [p.getX(i), -p.getY(i)]
    uv[i * 2] = a * m.repeat
    uv[i * 2 + 1] = b * m.repeat
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  parts.push({ name, mat: m, geo: g })
}
/** Box from its minimum corner and size. */
const box = (name: string, m: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0) =>
  add(name, m, new THREE.BoxGeometry(1, 1, 1), [x + sx / 2, y + sy / 2, z + sz / 2], [sx, sy, sz], rotY)
const cylinder = (name: string, m: Mat, cx: number, y: number, cz: number, r: number, h: number, seg = 16) =>
  add(name, m, new THREE.CylinderGeometry(r, r, h, seg), [cx, y + h / 2, cz])

const H = 2.4 // wall height

// Floor: flagstone courtyard (top at Y = 0) and a dirt path from the chapel door to the cliff edge
box('floor_flagstones', M.flagstone, 0, -0.12, 0, 6, 0.12, 6)
box('floor_path_dirt', M.dirt, 2.6, 0, 0.3, 0.8, 0.012, 5.7)

// West wall (along the X = 0 grid line) with a window, and battlements
box('wall_west_a', M.bricks, 0, 0, 0, 0.3, H, 2.2)
box('wall_west_sill', M.bricks, 0, 0, 2.2, 0.3, 0.9, 1)
box('wall_west_lintel', M.bricks, 0, 1.9, 2.2, 0.3, H - 1.9, 1)
box('wall_west_b', M.bricks, 0, 0, 3.2, 0.3, H, 2.8)
for (let z = 0.15; z < 6; z += 0.7) box(`wall_west_merlon_${Math.round(z * 10)}`, M.bricks, 0, H, z, 0.3, 0.35, 0.35)

// North wall (along the Z = 0 grid line): the chapel door, then a collapsed section
box('wall_north_a', M.bricks, 0, 0, 0, 2.5, H, 0.3)
box('wall_north_lintel', M.bricks, 2.5, 2.0, 0, 1, H - 2.0, 0.3)
box('wall_north_b', M.bricks, 3.5, 0, 0, 0.8, H, 0.3)
;[1.7, 1.2, 0.75, 0.4].forEach((h, i) => box(`wall_north_ruin_${i}`, M.bricks, 4.3 + i * 0.425, 0, 0, 0.425, h, 0.3))
box('wall_rubble_1', M.bricks, 4.7, 0, 0.45, 0.35, 0.18, 0.3, 0.4)
box('wall_rubble_2', M.bricks, 5.3, 0, 0.7, 0.25, 0.14, 0.25, -0.3)

// Pillars: one whole, one broken
cylinder('pillar_whole', M.grave, 3.9, 0, 3.2, 0.18, 2.1)
box('pillar_whole_top', M.grave, 3.65, 2.1, 2.95, 0.5, 0.18, 0.5)
cylinder('pillar_broken', M.grave, 1.6, 0, 4.4, 0.18, 0.85)

// Low balustrade on the south edge of the plateau (Z = 6 grid line), above the cliff
box('wall_balustrade', M.bricks, 0.3, 0, 5.8, 2.7, 0.5, 0.2)
for (let x = 0.3; x <= 3.0; x += 0.9) box(`wall_balustrade_post_${Math.round(x * 10)}`, M.bricks, x, 0, 5.75, 0.24, 0.65, 0.25)

// Graveyard
;[
  [4.6, 3.9],
  [5.2, 4.7],
  [4.3, 5.0],
  [5.3, 3.5]
].forEach(([x, z], i) => {
  box(`grave_${i + 1}`, M.grave, x, 0, z, 0.36, 0.55 + (i % 2) * 0.12, 0.12)
  if (i % 2 === 0) box(`grave_${i + 1}_cross`, M.grave, x - 0.08, 0.38, z - 0.01, 0.52, 0.1, 0.14)
})

// Barrels and a torch by the door
cylinder('barrel_1', M.wood, 5.35, 0, 1.5, 0.22, 0.55)
cylinder('barrel_2', M.wood, 5.65, 0, 2.05, 0.22, 0.55)
cylinder('torch_post', M.wood, 2.25, 0, 0.55, 0.05, 1.3, 8)
add('torch_flame', M.flame, new THREE.ConeGeometry(0.1, 0.28, 8), [2.25, 1.44, 0.55])

// Shrine in the back corner: altar, a post, and a pyramid roof
box('altar', M.grave, 0.55, 0, 0.55, 0.8, 0.55, 0.5)
cylinder('shrine_post', M.wood, 2.05, 0, 2.05, 0.09, H)
box('roof_shrine_eaves', M.roof, 0, H, 0, 2.3, 0.1, 2.3)
add('roof_shrine', M.roof, new THREE.ConeGeometry(2.3 / Math.SQRT2, 0.9, 4), [1.15, H + 0.1 + 0.45, 1.15], [1, 1, 1], Math.PI / 4)

// Cliffs under the two front edges (X = 6 and Z = 6): these hang below the floor → lower walls
box('cliff_east', M.rock, 5.85, -2, 0, 0.15, 2, 6)
box('cliff_south', M.rock, 0, -2, 5.85, 6, 2, 0.15)
box('cliff_east_outcrop', M.rock, 6.0, -1.6, 1.0, 0.22, 0.7, 1.2)
box('cliff_south_outcrop', M.rock, 3.5, -2, 6.0, 1.5, 0.8, 0.25)

// ------------------------------------------------------------------ GLB writer (glTF 2.0, textures embedded)

function writeGlb(file: string): void {
  const chunks: Buffer[] = []
  let offset = 0
  const bufferViews: object[] = []
  const accessors: object[] = []
  const view = (data: Buffer, target?: number) => {
    const pad = (4 - (offset % 4)) % 4
    if (pad) {
      chunks.push(Buffer.alloc(pad))
      offset += pad
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, ...(target ? { target } : {}) })
    chunks.push(data)
    offset += data.length
    return bufferViews.length - 1
  }
  const matList = Object.values(mats)
  const images = matList.map((m) => ({ bufferView: view(encodePng(TEX, TEX, m.pixels)), mimeType: 'image/png', name: m.name }))
  const materials = matList.map((m, i) => ({
    name: m.name,
    pbrMetallicRoughness: { baseColorTexture: { index: i }, metallicFactor: 0, roughnessFactor: 0.9 },
    ...(m === M.flame ? { emissiveFactor: [0.9, 0.5, 0.15] } : {})
  }))
  const meshes = parts.map((p) => {
    const attr = (name: string, n: number) => {
      const a = p.geo.getAttribute(name)
      const arr = new Float32Array(a.count * n)
      for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) arr[i * n + k] = a.array[i * a.itemSize + k] as number
      return arr
    }
    const pos = attr('position', 3)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k])
        max[k] = Math.max(max[k], pos[i + k])
      }
    const acc = (arr: Float32Array, type: string, extra: object = {}) => {
      accessors.push({ bufferView: view(Buffer.from(arr.buffer), 34962), componentType: 5126, count: arr.length / (type === 'VEC3' ? 3 : 2), type, ...extra })
      return accessors.length - 1
    }
    return {
      name: p.name,
      primitives: [
        {
          attributes: { POSITION: acc(pos, 'VEC3', { min, max }), NORMAL: acc(attr('normal', 3), 'VEC3'), TEXCOORD_0: acc(attr('uv', 2), 'VEC2') },
          material: matList.indexOf(p.mat)
        }
      ]
    }
  })
  const gltf = {
    asset: { version: '2.0', generator: 'PD2 Sprite Studio example scene' },
    scene: 0,
    scenes: [{ name: 'Tristram courtyard', nodes: parts.map((_, i) => i) }],
    nodes: parts.map((p, i) => ({ name: p.name, mesh: i })),
    meshes,
    materials,
    textures: matList.map((_, i) => ({ source: i, sampler: 0 })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images,
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }]
  }
  let bin = Buffer.concat(chunks)
  bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)])
  gltf.buffers[0].byteLength = bin.length
  let json = Buffer.from(JSON.stringify(gltf), 'utf8')
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
  const ch = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(data.length, 0)
    h.writeUInt32LE(type, 4)
    return Buffer.concat([h, data])
  }
  fs.writeFileSync(file, Buffer.concat([header, ch(0x4e4f534a, json), ch(0x004e4942, bin)]))
}

// ------------------------------------------------------------------ OBJ + MTL writer (3ds Max: File › Import)

function writeObj(dir: string, name: string): void {
  const lines = [`# Tristram courtyard: 1 unit = 1 map tile, Y up (3ds Max's OBJ importer can flip it to Z up)`, `mtllib ${name}.mtl`]
  let v = 1
  for (const p of parts) {
    const pos = p.geo.getAttribute('position')
    const nor = p.geo.getAttribute('normal')
    const uv = p.geo.getAttribute('uv')
    lines.push(`o ${p.name}`, `usemtl ${p.mat.name}`)
    for (let i = 0; i < pos.count; i++) lines.push(`v ${pos.getX(i).toFixed(5)} ${pos.getY(i).toFixed(5)} ${pos.getZ(i).toFixed(5)}`)
    for (let i = 0; i < uv.count; i++) lines.push(`vt ${uv.getX(i).toFixed(5)} ${(1 - uv.getY(i)).toFixed(5)}`)
    for (let i = 0; i < nor.count; i++) lines.push(`vn ${nor.getX(i).toFixed(4)} ${nor.getY(i).toFixed(4)} ${nor.getZ(i).toFixed(4)}`)
    for (let i = 0; i < pos.count; i += 3) lines.push(`f ${[0, 1, 2].map((k) => `${v + i + k}/${v + i + k}/${v + i + k}`).join(' ')}`)
    v += pos.count
  }
  fs.writeFileSync(path.join(dir, `${name}.obj`), lines.join('\n') + '\n')
  const mtl = Object.values(mats).flatMap((m) => [`newmtl ${m.name}`, 'Kd 1 1 1', 'Ka 0 0 0', 'Ks 0.05 0.05 0.05', `map_Kd textures/${m.file}`, ''])
  fs.writeFileSync(path.join(dir, `${name}.mtl`), mtl.join('\n'))
}

fs.mkdirSync(path.join(OUT, 'textures'), { recursive: true })
for (const m of Object.values(mats)) fs.writeFileSync(path.join(OUT, 'textures', m.file), encodePng(TEX, TEX, m.pixels))
writeGlb(path.join(OUT, 'tristram_courtyard.glb'))
writeObj(OUT, 'tristram_courtyard')
void rand
console.log(`${parts.length} parts, ${Object.keys(mats).length} textures → ${OUT}`)
