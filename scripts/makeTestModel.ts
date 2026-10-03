// Builds a small animated "knight" and exports it as out-test/models/knight.glb for testing the 3D Studio.
// Body, head, and an arm (with a named RightHand node) that swings; the knight faces +Z.
import fs from 'node:fs'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// Minimal FileReader for GLTFExporter's binary output in Node
;(globalThis as unknown as { FileReader: unknown }).FileReader = class {
  result: ArrayBuffer | string | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b
      this.onloadend?.()
    })
  }
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(b).toString('base64')}`
      this.onloadend?.()
    })
  }
}

const mat = (c: number, metal = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: metal })
const root = new THREE.Group()
root.name = 'Knight'

const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), mat(0x4a3526))
legs.position.y = 0.4
const torso = new THREE.Group()
torso.name = 'Torso'
torso.position.y = 0.8
const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.36), mat(0x8c8f99, 0.6))
chest.position.y = 0.35
const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), mat(0xd2a07a))
head.position.y = 0.92
const helm = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.25, 16), mat(0x70737c, 0.7))
helm.position.y = 1.12
// Visor points the way the knight faces (+Z)
const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.14), mat(0xb03020))
nose.position.set(0, 0.92, 0.2)
const shoulder = new THREE.Group()
shoulder.name = 'RightShoulder'
shoulder.position.set(-0.4, 0.62, 0)
const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), mat(0x8c8f99, 0.6))
arm.position.y = -0.3
const hand = new THREE.Group()
hand.name = 'RightHand'
hand.position.y = -0.62
shoulder.add(arm, hand)
torso.add(chest, head, helm, nose, shoulder)
root.add(legs, torso)

// Attack-ish swing: arm rotates forward and back, torso bobs (1 second loop)
const times = [0, 0.25, 0.5, 0.75, 1]
const q = (x: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, 0, 0))
const armTrack = new THREE.QuaternionKeyframeTrack(
  'RightShoulder.quaternion',
  times,
  [q(0), q(-1.6), q(-0.4), q(0.5), q(0)].flatMap((v) => [v.x, v.y, v.z, v.w])
)
const bobTrack = new THREE.VectorKeyframeTrack('Torso.position', times, [0, 0.8, 0, 0, 0.84, 0.03, 0, 0.8, 0, 0, 0.78, -0.02, 0, 0.8, 0])
const clip = new THREE.AnimationClip('Attack', 1, [armTrack, bobTrack])

new GLTFExporter().parse(
  root,
  (result) => {
    fs.mkdirSync('out-test/models', { recursive: true })
    fs.writeFileSync('out-test/models/knight.glb', Buffer.from(result as ArrayBuffer))
    console.log(`wrote out-test/models/knight.glb (${(result as ArrayBuffer).byteLength} bytes)`)
  },
  (err) => {
    console.error(err)
    process.exit(1)
  },
  { binary: true, animations: [clip] }
)
