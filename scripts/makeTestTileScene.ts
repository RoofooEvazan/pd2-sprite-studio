// A small "ruined chapel" scene as a Blender-style GLB (1 unit = 1 map tile) for testing the Tile Maker:
// stone floor with a path, a left wall and a back wall (with a doorway gap), a pillar, and a roof section.
import fs from 'node:fs'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
;(globalThis as unknown as { FileReader: unknown }).FileReader = class {
  result: ArrayBuffer | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b
      this.onloadend?.()
    })
  }
}

const mat = (c: number, name: string) => {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05 })
  m.name = name
  return m
}
const scene = new THREE.Group()
scene.name = 'Chapel'
const add = (name: string, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
  const mesh = new THREE.Mesh(geo, m)
  mesh.name = name
  mesh.position.set(x, y, z)
  scene.add(mesh)
  return mesh
}
const stone = mat(0x7d7466, 'stone')
const dark = mat(0x4f4a42, 'darkstone')
// Floor: 5x4 tiles, checker of slabs so the tiles differ
for (let x = 0; x < 5; x++)
  for (let z = 0; z < 4; z++) add(`floor_${x}_${z}`, new THREE.BoxGeometry(0.98, 0.06, 0.98), (x + z) % 2 ? stone : dark, x + 0.5, -0.03, z + 0.5)
add('ground_path', new THREE.BoxGeometry(5, 0.02, 0.6), mat(0x8a6a44, 'dirt'), 2.5, 0.01, 2.5)
// Left wall along X = 0 (3 tiles tall-ish), with battlements
add('wall_left', new THREE.BoxGeometry(0.2, 2.4, 4), mat(0x9a8f7c, 'wallstone'), 0.1, 1.2, 2)
for (let z = 0; z < 4; z++) add(`wall_left_merlon_${z}`, new THREE.BoxGeometry(0.24, 0.4, 0.45), mat(0x9a8f7c, 'wallstone'), 0.12, 2.6, z + 0.5)
// Back wall along Z = 0 with a doorway gap between x=2 and x=3
add('wall_back_a', new THREE.BoxGeometry(2, 2.4, 0.2), mat(0x8f8573, 'wallstone2'), 1, 1.2, 0.1)
add('wall_back_b', new THREE.BoxGeometry(2, 2.4, 0.2), mat(0x8f8573, 'wallstone2'), 4, 1.2, 0.1)
add('wall_back_lintel', new THREE.BoxGeometry(1, 0.5, 0.2), mat(0x8f8573, 'wallstone2'), 2.5, 2.15, 0.1)
// Pillar in the middle of the floor
add('pillar', new THREE.CylinderGeometry(0.2, 0.25, 2.2, 16), mat(0xb0a58f, 'marble'), 3.5, 1.1, 2.5)
// Roof over the back-left corner
add('roof_section', new THREE.BoxGeometry(2, 0.15, 2), mat(0x6e3a2c, 'rooftiles'), 1, 2.45, 1)

new GLTFExporter().parse(
  scene,
  (result) => {
    fs.mkdirSync('out-test/models', { recursive: true })
    for (const f of fs.readdirSync('out-test/models')) if (f.endsWith('.glb')) fs.renameSync(`out-test/models/${f}`, `out-test/models/${f}.bak`)
    fs.writeFileSync('out-test/models/chapel.glb', Buffer.from(result as ArrayBuffer))
    console.log(`wrote out-test/models/chapel.glb (${(result as ArrayBuffer).byteLength} bytes)`)
  },
  (err) => {
    console.error(err)
    process.exit(1)
  },
  { binary: true }
)
