// 3D Studio engine: a three.js scene with Diablo II's camera, used to turn 3D models into sprites.
//
// Conventions: three.js is Y-up. The game camera looks at the world origin from 30 degrees above the
// ground and 45 degrees around, orthographic. With that camera, a model facing +Z faces the bottom-left
// of the screen, which is Diablo II's direction 0. Facings are made by turning a "turntable" group.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import type { RenderImage } from '../../../core/renderImport'

export type ShapeKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'capsule'
export type Lighting = 'diablo' | 'bright' | 'dungeon'
export type ViewMode = 'game' | 'free'
export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface StudioObject {
  id: string
  name: string
  kind: 'model' | 'shape'
  shape?: ShapeKind
  object: THREE.Object3D
  clips: THREE.AnimationClip[]
  mixer: THREE.AnimationMixer | null
  color?: string
  attachedTo: string | null // name of the node it hangs from, or null for the scene
}

export interface StudioSettings {
  /** How tall the model should be in the game, in pixels */
  heightPx: number
  /** Pixels per world unit, derived from heightPx by fitSize() */
  ppu: number
  lighting: Lighting
  lightStrength: number
  /** Extra turn (degrees) applied to everything so the model faces bottom-left at direction 0 */
  yaw: number
  clipIndex: number
  playing: boolean
  speed: number
  time: number
  previewDir: number
  directions: number
  view: ViewMode
  gizmo: GizmoMode
  showGrid: boolean
}

// Diablo II direction index -> screen heading (0 = right, clockwise); direction 0 = bottom-left
export const HEADING_8 = [135, 225, 315, 45, 90, 180, 270, 0]
export const HEADING_16 = [...HEADING_8, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5]

const ELEVATION = THREE.MathUtils.degToRad(30)
const AZIMUTH = THREE.MathUtils.degToRad(45)
const CAM_DIST = 50
/** Game-pixel size of the square that renders are taken from (origin at its centre). */
export const GAME_CANVAS = 256
const SUPERSAMPLE = 2

let nextId = 1

export class Studio {
  readonly scene = new THREE.Scene()
  readonly turntable = new THREE.Group()
  readonly objects: StudioObject[] = []
  selected: string | null = null
  settings: StudioSettings = {
    heightPx: 80,
    ppu: 44,
    lighting: 'diablo',
    lightStrength: 1,
    yaw: 0,
    clipIndex: 0,
    playing: true,
    speed: 1,
    time: 0,
    previewDir: 0,
    directions: 16,
    view: 'game',
    gizmo: 'translate',
    showGrid: true
  }
  protected listeners = new Set<() => void>()
  version = 0

  // Viewport
  protected renderer: THREE.WebGLRenderer | null = null
  protected container: HTMLElement | null = null
  protected freeCam = new THREE.PerspectiveCamera(35, 1, 0.01, 500)
  protected viewGameCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500)
  protected orbit: OrbitControls | null = null
  protected gizmo: TransformControls | null = null
  protected raf = 0
  protected lastTick = 0
  protected resizeObs: ResizeObserver | null = null
  protected helpers = new THREE.Group()
  protected dragging = false

  // Offscreen game renderer (own canvas so reads never touch the viewport)
  protected offRenderer: THREE.WebGLRenderer | null = null
  protected offCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500)
  protected readCanvas = document.createElement('canvas')

  protected lights = {
    ambient: new THREE.AmbientLight(0xffffff, 0.4),
    key: new THREE.DirectionalLight(0xffffff, 2),
    fill: new THREE.DirectionalLight(0xffffff, 0.5),
    rim: new THREE.DirectionalLight(0xffffff, 0.5)
  }

  constructor() {
    this.scene.add(this.turntable)
    const L = this.lights
    // Key from the screen's upper-left, fill from the right, rim from behind (camera sits at +X,+Z)
    L.key.position.set(-1.5, 3, 2.5)
    L.fill.position.set(2.5, 1, -0.5)
    L.rim.position.set(-2, 2, -2.5)
    this.scene.add(L.ambient, L.key, L.fill, L.rim)
    const grid = new THREE.GridHelper(4, 16, 0x5a5a60, 0x2c2d31)
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.002, 0), 0.9, 0xdcab4f, 0.18, 0.1)
    arrow.name = 'facing-arrow'
    this.helpers.add(grid, arrow)
    this.scene.add(this.helpers)
    this.placeCamera(this.viewGameCam)
    this.placeCamera(this.offCam)
    this.freeCam.position.set(3, 2.2, 3)
    this.applyLighting()
  }

  // ------------------------------------------------------------------ state plumbing

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(): void {
    this.version++
    this.listeners.forEach((l) => l())
  }

  set(patch: Partial<StudioSettings>): void {
    this.settings = { ...this.settings, ...patch }
    if ('lighting' in patch || 'lightStrength' in patch) this.applyLighting()
    if ('gizmo' in patch) this.gizmo?.setMode(this.settings.gizmo)
    if ('view' in patch) this.syncControls()
    if ('showGrid' in patch) this.helpers.visible = this.settings.showGrid
    if ('clipIndex' in patch) this.bindClips()
    this.applyPose()
    this.emit()
  }

  get selectedObject(): StudioObject | null {
    return this.objects.find((o) => o.id === this.selected) ?? null
  }

  /** The model whose clips drive the timeline (first model with animations). */
  get animatedModel(): StudioObject | null {
    return this.objects.find((o) => o.kind === 'model' && o.clips.length) ?? null
  }

  get clip(): THREE.AnimationClip | null {
    const m = this.animatedModel
    return m ? (m.clips[Math.min(this.settings.clipIndex, m.clips.length - 1)] ?? null) : null
  }

  get duration(): number {
    return this.clip?.duration || 1
  }

  // ------------------------------------------------------------------ viewport

  mount(container: HTMLElement): void {
    this.container = container
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      this.renderer.setPixelRatio(window.devicePixelRatio)
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.setClearColor(0x000000, 0)
      this.orbit = new OrbitControls(this.freeCam, this.renderer.domElement)
      this.orbit.target.set(0, 0.8, 0)
      this.orbit.update()
      this.gizmo = new TransformControls(this.freeCam, this.renderer.domElement)
      this.gizmo.addEventListener('dragging-changed', (e) => {
        this.dragging = !!(e as unknown as { value: boolean }).value
        if (this.orbit) this.orbit.enabled = !this.dragging && this.settings.view === 'free'
        if (!this.dragging) this.emit()
      })
      this.gizmo.setSize(0.8)
      this.scene.add(this.gizmo.getHelper())
    }
    container.appendChild(this.renderer.domElement)
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    this.syncControls()
    this.lastTick = performance.now()
    const loop = (now: number) => {
      this.tick(now)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  unmount(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObs?.disconnect()
    if (this.renderer && this.container?.contains(this.renderer.domElement)) this.container.removeChild(this.renderer.domElement)
    this.container = null
  }

  protected syncControls(): void {
    const free = this.settings.view === 'free'
    if (this.orbit) this.orbit.enabled = free && !this.dragging
    if (this.gizmo) {
      // The gizmo needs the camera the user is looking through
      ;(this.gizmo as unknown as { camera: THREE.Camera }).camera = free ? this.freeCam : this.viewGameCam
    }
  }

  protected resize(): void {
    if (!this.renderer || !this.container) return
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h)
    this.freeCam.aspect = w / h
    this.freeCam.updateProjectionMatrix()
    this.updateViewGameCam()
  }

  /** Game view in the viewport: same angle as the renders, shown at 3x game pixels. */
  protected updateViewGameCam(): void {
    if (!this.container) return
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    const zoom = 3
    const halfW = w / 2 / (this.settings.ppu * zoom)
    const halfH = h / 2 / (this.settings.ppu * zoom)
    const c = this.viewGameCam
    // Keep the ground point a little below centre so tall models fit
    c.left = -halfW
    c.right = halfW
    c.top = halfH * 1.25
    c.bottom = -halfH * 0.75
    c.updateProjectionMatrix()
  }

  protected placeCamera(cam: THREE.Camera): void {
    cam.position.set(CAM_DIST * Math.cos(ELEVATION) * Math.sin(AZIMUTH), CAM_DIST * Math.sin(ELEVATION), CAM_DIST * Math.cos(ELEVATION) * Math.cos(AZIMUTH))
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
  }

  protected tick(now: number): void {
    const dt = Math.min(0.1, (now - this.lastTick) / 1000)
    this.lastTick = now
    if (this.settings.playing && this.clip) {
      this.settings.time = (this.settings.time + dt * this.settings.speed) % this.duration
    }
    this.applyPose()
    this.updateViewGameCam()
    if (this.renderer) {
      const cam = this.settings.view === 'free' ? this.freeCam : this.viewGameCam
      this.helpers.visible = this.settings.showGrid
      this.renderer.render(this.scene, cam)
    }
  }

  // ------------------------------------------------------------------ pose

  protected headingTurn(dir: number): number {
    const hs = this.settings.directions === 16 ? HEADING_16 : HEADING_8
    // Screen-clockwise = clockwise seen from above = negative rotation about +Y
    return -THREE.MathUtils.degToRad(hs[dir % hs.length] - hs[0])
  }

  /** Put every object at the given facing and animation time. */
  applyPose(dir = this.settings.previewDir, time = this.settings.time): void {
    this.turntable.rotation.y = THREE.MathUtils.degToRad(this.settings.yaw) + this.headingTurn(dir)
    for (const o of this.objects) if (o.mixer) o.mixer.setTime(time)
    this.turntable.updateMatrixWorld(true)
  }

  protected bindClips(): void {
    for (const o of this.objects) {
      if (!o.mixer) continue
      o.mixer.stopAllAction()
      const clip = o.clips[Math.min(this.settings.clipIndex, o.clips.length - 1)]
      if (clip) o.mixer.clipAction(clip).play()
    }
    this.settings.time = 0
  }

  // ------------------------------------------------------------------ lighting

  applyLighting(): void {
    const L = this.lights
    const k = this.settings.lightStrength
    const presets: Record<Lighting, { amb: [number, number]; key: [number, number]; fill: [number, number]; rim: [number, number] }> = {
      diablo: { amb: [0xb8b0a4, 0.45], key: [0xffe1b8, 2.4], fill: [0x7f93b3, 0.45], rim: [0xffffff, 0.6] },
      bright: { amb: [0xffffff, 0.8], key: [0xffffff, 1.9], fill: [0xffffff, 0.8], rim: [0xffffff, 0.4] },
      dungeon: { amb: [0x8a7a70, 0.18], key: [0xffae68, 2.8], fill: [0x5566aa, 0.25], rim: [0xff9a50, 0.5] }
    }
    const p = presets[this.settings.lighting]
    L.ambient.color.setHex(p.amb[0])
    L.ambient.intensity = p.amb[1] * k
    L.key.color.setHex(p.key[0])
    L.key.intensity = p.key[1] * k
    L.fill.color.setHex(p.fill[0])
    L.fill.intensity = p.fill[1] * k
    L.rim.color.setHex(p.rim[0])
    L.rim.intensity = p.rim[1] * k
  }

  // ------------------------------------------------------------------ objects

  async loadModel(file: { name: string; data: Uint8Array; siblings: { name: string; data: Uint8Array }[] }, opts: { normalize?: boolean } = {}): Promise<StudioObject> {
    const ext = file.name.split('.').pop()!.toLowerCase()
    // Resolve textures/buffers referenced by the model to the files that came with it
    const urls = new Map<string, string>()
    const made: string[] = []
    for (const s of file.siblings) {
      const url = URL.createObjectURL(new Blob([s.data.slice()]))
      made.push(url)
      const base = s.name.split(/[\\/]/).pop()!.toLowerCase()
      urls.set(base, url)
      urls.set(s.name.toLowerCase(), url)
    }
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((url) => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url
      const clean = decodeURIComponent(url.split('?')[0])
      const base = clean.split(/[\\/]/).pop()!.toLowerCase()
      return urls.get(clean.toLowerCase()) ?? urls.get(base) ?? url
    })
    const buf = file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength) as ArrayBuffer
    let root: THREE.Object3D
    let clips: THREE.AnimationClip[] = []
    if (ext === 'fbx') {
      root = new FBXLoader(manager).parse(buf, '')
      clips = (root as THREE.Group).animations ?? []
    } else if (ext === 'glb' || ext === 'gltf') {
      const data = ext === 'gltf' ? new TextDecoder().decode(file.data) : buf
      const gltf = await new GLTFLoader(manager).parseAsync(data, '')
      root = gltf.scene
      clips = gltf.animations
    } else if (ext === 'obj') {
      // Materials and textures come from the .mtl named by "mtllib" (3ds Max and Blender both write one)
      const text = new TextDecoder().decode(file.data)
      const lib = /^\s*mtllib\s+(.+?)\s*$/m.exec(text)?.[1]?.toLowerCase()
      const mtl = file.siblings.find((s) => /\.mtl$/i.test(s.name) && (!lib || s.name.toLowerCase() === lib || s.name.toLowerCase().endsWith(`/${lib}`))) ?? file.siblings.find((s) => /\.mtl$/i.test(s.name))
      const loader = new OBJLoader(manager)
      if (mtl) {
        const materials = new MTLLoader(manager).parse(new TextDecoder().decode(mtl.data), '')
        materials.preload()
        loader.setMaterials(materials)
      }
      root = loader.parse(text)
    } else throw new Error(`Unsupported file type .${ext}`)
    setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 30000)

    root.traverse((c) => {
      const m = c as THREE.Mesh
      if (m.isMesh) m.frustumCulled = false // skinned meshes can animate outside their bounds
    })

    const wrapper = new THREE.Group()
    wrapper.name = file.name
    wrapper.add(root)
    if (opts.normalize !== false) {
      // Characters: about 1.8 units tall, feet on the ground, centred
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const s = size.y > 0 ? 1.8 / size.y : 1
      root.scale.multiplyScalar(s)
      const box2 = new THREE.Box3().setFromObject(root)
      const c = box2.getCenter(new THREE.Vector3())
      root.position.x -= c.x
      root.position.z -= c.z
      root.position.y -= box2.min.y
    } else this.placeUnnormalized(root)
    this.turntable.add(wrapper)

    const mixer = clips.length ? new THREE.AnimationMixer(root) : null
    const obj: StudioObject = { id: `o${nextId++}`, name: file.name.replace(/\.[^.]+$/, ''), kind: 'model', object: wrapper, clips, mixer, attachedTo: null }
    this.objects.push(obj)
    if (mixer && this.animatedModel === obj) this.settings.clipIndex = 0
    this.bindClips()
    this.onModelLoaded(obj)
    return obj
  }

  /** Hook for subclasses: how an un-normalised model is placed. */
  protected placeUnnormalized(root: THREE.Object3D): void {
    void root
  }

  protected onModelLoaded(obj: StudioObject): void {
    this.select(obj.id)
    this.fitSize()
  }

  addShape(kind: ShapeKind): StudioObject {
    const geo =
      kind === 'box'
        ? new THREE.BoxGeometry(0.4, 0.4, 0.4)
        : kind === 'cylinder'
          ? new THREE.CylinderGeometry(0.1, 0.1, 0.8, 24)
          : kind === 'sphere'
            ? new THREE.SphereGeometry(0.22, 32, 16)
            : kind === 'cone'
              ? new THREE.ConeGeometry(0.18, 0.5, 24)
              : new THREE.CapsuleGeometry(0.12, 0.5, 8, 16)
    const color = '#b9a27a'
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }))
    mesh.name = kind
    mesh.position.set(0, 0.4, 0)
    this.turntable.add(mesh)
    const obj: StudioObject = { id: `o${nextId++}`, name: kind[0].toUpperCase() + kind.slice(1), kind: 'shape', shape: kind, object: mesh, clips: [], mixer: null, color, attachedTo: null }
    this.objects.push(obj)
    this.select(obj.id)
    this.emit()
    return obj
  }

  setColor(id: string, color: string): void {
    const o = this.objects.find((x) => x.id === id)
    const mat = (o?.object as THREE.Mesh)?.material as THREE.MeshStandardMaterial | undefined
    if (!o || !mat?.color) return
    mat.color.set(color)
    o.color = color
    this.emit()
  }

  setMetal(id: string, metalness: number): void {
    const o = this.objects.find((x) => x.id === id)
    const mat = (o?.object as THREE.Mesh)?.material as THREE.MeshStandardMaterial | undefined
    if (!mat || mat.metalness === undefined) return
    mat.metalness = metalness
    mat.roughness = 0.75 - metalness * 0.45
    this.emit()
  }

  /** Named nodes of loaded models that shapes can hang from (bones, hands, props…). */
  attachPoints(): { name: string; label: string }[] {
    const out: { name: string; label: string }[] = []
    for (const m of this.objects)
      if (m.kind === 'model')
        m.object.traverse((n) => {
          if (n.name && n !== m.object && (n as THREE.Bone).isBone) out.push({ name: n.name, label: `${m.name} › ${n.name.replace(/^mixamorig:?/i, '')}` })
        })
    if (!out.length)
      for (const m of this.objects)
        if (m.kind === 'model')
          m.object.traverse((n) => {
            // Named groups/empties (rigid models), skipping loader wrapper nodes
            const skip = !n.name || n === m.object || (n as THREE.Mesh).isMesh || /^(AuxScene|Scene|RootNode|Root)$/i.test(n.name)
            const useful = n.children.length > 0 || /hand|weapon|grip|socket/i.test(n.name)
            if (!skip && useful && !out.some((p) => p.name === n.name)) out.push({ name: n.name, label: `${m.name} › ${n.name}` })
          })
    return out
  }

  attach(id: string, nodeName: string | null): void {
    const o = this.objects.find((x) => x.id === id)
    if (!o) return
    this.applyPose()
    let parent: THREE.Object3D = this.turntable
    if (nodeName) {
      const found = this.objects.map((m) => (m.kind === 'model' ? m.object.getObjectByName(nodeName) : undefined)).find(Boolean)
      if (found) parent = found
    }
    parent.attach(o.object) // keeps its world rotation and size...
    if (nodeName) o.object.position.set(0, 0, 0) // ...but moves into the hand/bone so it's held
    o.attachedTo = nodeName
    this.emit()
  }

  remove(id: string): void {
    const i = this.objects.findIndex((x) => x.id === id)
    if (i < 0) return
    const [o] = this.objects.splice(i, 1)
    if (this.selected === id) this.select(null)
    o.object.removeFromParent()
    o.object.traverse((n) => {
      const m = n as THREE.Mesh
      if (m.isMesh) {
        m.geometry?.dispose()
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        mats.forEach((mt) => mt?.dispose())
      }
    })
    this.emit()
  }

  select(id: string | null): void {
    this.selected = id
    const o = this.selectedObject
    if (this.gizmo) {
      if (o) this.gizmo.attach(o.object)
      else this.gizmo.detach()
    }
    this.emit()
  }

  // ------------------------------------------------------------------ sizing & rendering

  /** Choose pixels-per-unit so the current pose is `heightPx` tall in the game view. */
  fitSize(): void {
    this.applyPose(0, this.settings.time)
    const box = new THREE.Box3()
    for (const o of this.objects) box.expandByObject(o.object)
    if (box.isEmpty()) return this.emit()
    const view = this.offCam.matrixWorldInverse
    let min = Infinity
    let max = -Infinity
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const v = new THREE.Vector3(x, y, z).applyMatrix4(view)
          min = Math.min(min, v.y)
          max = Math.max(max, v.y)
        }
    const h = max - min
    if (h > 0) this.settings.ppu = this.settings.heightPx / h
    this.applyPose()
    this.emit()
  }

  /** Render one facing at one time as game-sized RGBA (supersampled), ground point at the centre. */
  renderGame(dir: number, time: number): RenderImage {
    const px = GAME_CANVAS * SUPERSAMPLE
    if (!this.offRenderer) {
      this.offRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true })
      this.offRenderer.outputColorSpace = THREE.SRGBColorSpace
      this.offRenderer.setClearColor(0x000000, 0)
      this.offRenderer.setPixelRatio(1)
    }
    const r = this.offRenderer
    if (r.domElement.width !== px) r.setSize(px, px, false)
    const half = GAME_CANVAS / 2 / this.settings.ppu
    const c = this.offCam
    c.left = -half
    c.right = half
    c.top = half
    c.bottom = -half
    c.updateProjectionMatrix()
    const gizmoHelper = this.gizmo?.getHelper()
    const helperVis = this.helpers.visible
    const gizmoVis = gizmoHelper?.visible ?? false
    this.helpers.visible = false
    if (gizmoHelper) gizmoHelper.visible = false
    this.applyPose(dir, time)
    r.render(this.scene, c)
    this.helpers.visible = helperVis
    if (gizmoHelper) gizmoHelper.visible = gizmoVis
    this.readCanvas.width = px
    this.readCanvas.height = px
    const ctx = this.readCanvas.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, px, px)
    ctx.drawImage(r.domElement, 0, 0)
    const img = ctx.getImageData(0, 0, px, px)
    this.applyPose()
    return { dir, frame: 0, width: px, height: px, rgba: img.data }
  }

  /** Sample the current clip into `frames` evenly spaced poses (looping, so the last != the first). */
  frameTimes(frames: number): number[] {
    const d = this.clip ? this.duration : 0
    return Array.from({ length: frames }, (_, i) => (d * i) / frames)
  }

  get supersample(): number {
    return SUPERSAMPLE
  }
}

/** One studio for the whole app, so the scene survives switching screens. */
export const studio = new Studio()
