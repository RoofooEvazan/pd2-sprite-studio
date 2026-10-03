// A raised plateau with cliff sides (Blender-style GLB, 1 unit = 1 tile) for testing lower walls in the Tile Maker.
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

const add = (name: string, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
  const mesh = new THREE.Mesh(geo, m)
  mesh.name = name
  mesh.position.set(x, y, z)
  scene.add(mesh)
  return mesh
}
const stone = mat(0x7d7466, 'stone')
const dark = mat(0x4f4a42, 'darkstone')
scene.name = 'Plateau'
const rock = mat(0x6b5f52, 'rock')
const rock2 = mat(0x564c42, 'rock_dark')
const H = 1.5 // plateau height: snapping should put its top on the ground and everything under it becomes lower walls
for (let x = 0; x < 4; x += 2)
  for (let z = 0; z < 4; z += 2) add(`floor_${x}_${z}`, new THREE.BoxGeometry(1.98, 0.06, 1.98), (x + z) % 4 ? stone : dark, x + 1, H - 0.03, z + 1)
// Cliff faces on the two sides the camera sees (X = 4 and Z = 4), in horizontal rock bands; names say nothing about "cliff"
for (let i = 0; i < 3; i++) {
  const h = H / 3
  add(`rock_side_x_${i}`, new THREE.BoxGeometry(0.1, h, 4), i % 2 ? rock : rock2, 3.95, h * i + h / 2, 2)
  add(`rock_side_z_${i}`, new THREE.BoxGeometry(4, h, 0.1), i % 2 ? rock2 : rock, 2, h * i + h / 2, 3.95)
}
// A ledge trim named as a cliff (role guessed from the name)
add('cliff_trim', new THREE.BoxGeometry(4.1, 0.12, 0.14), mat(0x8b7f6a, 'trim'), 2.05, H - 0.1, 4.02)
// A tower on the plateau (an upper wall) along the back edge
add('wall_tower', new THREE.BoxGeometry(2, 1.6, 0.2), mat(0x9a8f7c, 'wallstone'), 1, H + 0.8, 0.1)

new GLTFExporter().parse(
  scene,
  (result) => {
    fs.mkdirSync('out-test/models', { recursive: true })
    fs.writeFileSync('out-test/models/plateau.glb', Buffer.from(result as ArrayBuffer))
    console.log('wrote out-test/models/plateau.glb')
  },
  (err) => {
    console.error(err)
    process.exit(1)
  },
  { binary: true }
)
