// Tile Maker engine: a 3D scene on Diablo II's map grid, rendered into the layers the tile slicer needs.
// 1 world unit = 1 map tile (160x80 px diamond). World +X = DS1 x, world +Z = DS1 y, Y is up.

import * as THREE from 'three'
import { Studio, StudioObject } from './engine'
import { PX_PER_HEIGHT, SliceInput } from '../../../core/tileSlicer'
import { PaletteLut, quantizeRgba } from '../../../core/renderImport'

export type TileRole = 'floor' | 'wall' | 'lower' | 'roof' | 'ignore'

/** What each role means, in the words the UI shows. Colours are used for "Colour by role". */
export const ROLE_INFO: Record<TileRole, { label: string; hint: string; color: string }> = {
  floor: { label: 'Floor', hint: 'The ground you walk on', color: '#7fbf6a' },
  wall: { label: 'Wall', hint: 'Stands up from the floor: buildings, fences, pillars', color: '#e0b650' },
  lower: { label: 'Lower wall', hint: 'Hangs down from a floor edge: cliffs, platform sides, pits', color: '#5b9bd8' },
  roof: { label: 'Roof', hint: 'Covers the top; fades when the player walks under it', color: '#d9705a' },
  ignore: { label: 'Leave out', hint: 'Not turned into tiles', color: '#5d5f66' }
}

/** Pixels per world unit along the ground diagonal: 160 px per tile. */
export const TILE_PPU = 160 / Math.SQRT2

export function guessRole(name: string): TileRole {
  const n = name.toLowerCase()
  if (/roof|ceiling/.test(n)) return 'roof'
  // Whole-word starts only: "capital" isn't a pit, "flower" isn't lower, "knowledge" isn't a ledge
  if (/(?<![a-z])(cliff|ledge|lower|pit|chasm|drop|underside|foundation|embank|overhang)/.test(n)) return 'lower'
  if (/floor|ground|terrain|grass|dirt|path|road|pave|plaza|carpet|rug|water/.test(n)) return 'floor'
  if (/ignore|helper|camera|light|collider|proxy/.test(n)) return 'ignore'
  return 'wall'
}

/** Parts lying entirely below the ground can only be lower walls. */
const BELOW_GROUND = 0.05

export interface TileSettings {
  mapW: number
  mapH: number
  act: number
  name: string
  mainIndex: number
  dither: boolean
}

export interface ScenePart {
  mesh: THREE.Mesh
  label: string
  owner: StudioObject
  role: TileRole
}

export const MAX_MAP = 20

export class TileStudio extends Studio {
  tile: TileSettings = { mapW: 4, mapH: 4, act: 1, name: 'mytiles', mainIndex: 30, dither: false }
  private grid = new THREE.Group()
  private tileRenderer: THREE.WebGLRenderer | null = null
  private posMaterial: THREE.MeshBasicMaterial

  constructor() {
    super()
    this.settings.playing = false
    this.settings.view = 'game'
    this.helpers.clear()
    this.helpers.add(this.grid)
    this.rebuildGrid()
    this.posMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    this.posMaterial.blending = THREE.NoBlending
    this.posMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vD2World;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vD2World = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      // Alpha says which way the surface faces: 1 = up/down, 2 = faces X (runs along an X grid line), 3 = faces Z
      shader.fragmentShader =
        'varying vec3 vD2World;\n' +
        shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          'vec3 d2n = abs(normalize(cross(dFdx(vD2World), dFdy(vD2World))));\n' +
            '  float d2f = d2n.y > 0.7 ? 1.0 : (d2n.x >= d2n.z ? 2.0 : 3.0);\n' +
            '  gl_FragColor = vec4(vD2World, d2f);'
        )
    }
  }

  // ------------------------------------------------------------------ map grid

  setTile(patch: Partial<TileSettings>): void {
    const next = { ...this.tile, ...patch }
    next.mapW = Math.max(1, Math.min(MAX_MAP, Math.round(next.mapW)))
    next.mapH = Math.max(1, Math.min(MAX_MAP, Math.round(next.mapH)))
    next.mainIndex = Math.max(0, Math.min(63, Math.round(next.mainIndex)))
    this.tile = next
    this.rebuildGrid()
    this.emit()
  }

  private rebuildGrid(): void {
    this.grid.clear()
    const { mapW: W, mapH: H } = this.tile
    const line = (pts: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
      this.grid.add(new THREE.LineSegments(g, m))
    }
    const sub: number[] = []
    const main: number[] = []
    for (let i = 0; i <= W * 5; i++) (i % 5 ? sub : main).push(i / 5, 0.001, 0, i / 5, 0.001, H)
    for (let j = 0; j <= H * 5; j++) (j % 5 ? sub : main).push(0, 0.001, j / 5, W, 0.001, j / 5)
    line(sub, 0x3a3b40, 0.5)
    line(main, 0x8a8a93, 0.9)
    line([0, 0.002, 0, W, 0.002, 0, W, 0.002, 0, W, 0.002, H, W, 0.002, H, 0, 0.002, H, 0, 0.002, H, 0, 0.002, 0], 0xdcab4f, 1)
  }

  get mapCenter(): THREE.Vector3 {
    return new THREE.Vector3(this.tile.mapW / 2, 0, this.tile.mapH / 2)
  }

  // ------------------------------------------------------------------ viewing

  protected updateViewGameCam(): void {
    if (!this.container) return
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    const { mapW: W, mapH: H } = this.tile
    const box = this.sceneBox()
    const tall = Math.max(2, box.isEmpty() ? 2 : box.max.y)
    const needW = (W + H) * 80 + 160
    const needH = (W + H) * 40 + tall * PX_PER_HEIGHT + 120
    const scale = Math.min(w / needW, h / needH) // screen px per game px
    const ppu = TILE_PPU * scale
    const c = this.viewGameCam
    this.viewGameCam.updateMatrixWorld()
    const centre = new THREE.Vector3(W / 2, tall / 2, H / 2).applyMatrix4(c.matrixWorldInverse)
    c.left = centre.x - w / 2 / ppu
    c.right = centre.x + w / 2 / ppu
    c.top = centre.y + h / 2 / ppu
    c.bottom = centre.y - h / 2 / ppu
    c.updateProjectionMatrix()
  }

  mount(container: HTMLElement): void {
    super.mount(container)
    const orbit = (this as unknown as { orbit: { target: THREE.Vector3; update(): void } | null }).orbit
    if (orbit) {
      orbit.target.copy(this.mapCenter)
      orbit.update()
    }
    this.freeCam.position.set(this.tile.mapW / 2 + 6, 6, this.tile.mapH / 2 + 6)
  }

  applyPose(_dir = 0, time = this.settings.time): void {
    this.turntable.rotation.y = 0
    for (const o of this.objects) if (o.mixer) o.mixer.setTime(time)
    this.turntable.updateMatrixWorld(true)
  }

  // ------------------------------------------------------------------ scene contents

  protected placeUnnormalized(root: THREE.Object3D): void {
    // Sit the model on the ground with its corner at the grid origin (scale is set per model, see setUnits)
    const box = new THREE.Box3().setFromObject(root)
    root.position.x -= box.min.x
    root.position.z -= box.min.z
    root.position.y -= box.min.y
  }

  protected onModelLoaded(obj: StudioObject): void {
    obj.object.traverse((n) => {
      const m = n as THREE.Mesh
      if (m.isMesh && !m.userData.d2role) {
        m.userData.d2role = guessRole(`${m.name} ${m.parent?.name ?? ''} ${(m.material as THREE.Material)?.name ?? ''}`)
        m.userData.d2roleAuto = true
      }
    })
    // Guess the model's units: tile-scale (1), metres (~2 m per tile) or centimetres (3ds Max)
    const size = new THREE.Box3().setFromObject(obj.object).getSize(new THREE.Vector3())
    const foot = Math.max(size.x, size.z)
    const units = foot <= MAX_MAP ? 1 : foot / 2 <= MAX_MAP ? 2 : foot / 200 <= MAX_MAP ? 200 : Math.ceil(foot / MAX_MAP)
    this.setUnits(obj.id, units, false)
    this.snapToGrid(obj.id, false)
    this.fitGridToScene()
    this.select(obj.id)
  }

  /** How many of the model's own units make one map tile. */
  unitsOf(id: string): number {
    return (this.objects.find((x) => x.id === id)?.object.userData.unitsPerTile as number) ?? 1
  }

  setUnits(id: string, unitsPerTile: number, refit = true): void {
    const o = this.objects.find((x) => x.id === id)
    if (!o || !(unitsPerTile > 0)) return
    o.object.userData.unitsPerTile = unitsPerTile
    o.object.scale.setScalar(1 / unitsPerTile)
    o.object.updateMatrixWorld(true)
    if (refit) {
      this.snapToGrid(id, false)
      this.fitGridToScene()
    }
    this.emit()
  }

  /**
   * Put the model's corner on the grid origin and its walkable floor at ground level (Y = 0).
   * Ground = the top of the floor parts covering the most area; without floors, the model's lowest point.
   * Anything below that level (cliffs, platform sides) becomes lower walls.
   */
  snapToGrid(id: string, emit = true): void {
    const o = this.objects.find((x) => x.id === id)
    if (!o) return
    o.object.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(o.object)
    o.object.position.x -= b.min.x
    o.object.position.z -= b.min.z
    o.object.position.y -= this.groundLevelOf(o) ?? b.min.y
    o.object.updateMatrixWorld(true)
    this.refreshAutoRoles()
    if (emit) {
      this.fitGridToScene()
      this.emit()
    }
  }

  /** Height of the main walkable floor of a model (area-weighted top of its floor parts). */
  private groundLevelOf(o: StudioObject): number | null {
    const areaAt = new Map<number, number>()
    o.object.traverse((n) => {
      const m = n as THREE.Mesh
      if (!m.isMesh || m.userData.d2role !== 'floor') return
      const bb = new THREE.Box3().setFromObject(m)
      const top = Math.round(bb.max.y * 100) / 100
      areaAt.set(top, (areaAt.get(top) ?? 0) + (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z))
    })
    let best: number | null = null
    let bestArea = -1
    for (const [y, a] of areaAt)
      if (a > bestArea) {
        best = y
        bestArea = a
      }
    return best
  }

  /** Re-check guessed roles: a guessed "wall" lying entirely below the ground becomes a lower wall (and back). */
  refreshAutoRoles(): void {
    for (const o of this.objects)
      o.object.traverse((n) => {
        const m = n as THREE.Mesh
        if (!m.isMesh || !m.userData.d2roleAuto) return
        const r = m.userData.d2role as TileRole
        if (r !== 'wall' && r !== 'lower') return
        const named = guessRole(`${m.name} ${m.parent?.name ?? ''} ${(m.material as THREE.Material)?.name ?? ''}`)
        if (named === 'lower') return
        const top = new THREE.Box3().setFromObject(m).max.y
        m.userData.d2role = top <= BELOW_GROUND ? 'lower' : 'wall'
      })
    this.applyRoleColours()
  }

  /** How far (in tiles) a model reaches below the ground; 0 when it sits on it. */
  depthBelowGround(id: string): number {
    const o = this.objects.find((x) => x.id === id)
    if (!o) return 0
    return Math.max(0, -new THREE.Box3().setFromObject(o.object).min.y)
  }

  /** Raise or lower a model relative to the ground (e.g. to choose which floor is ground level). */
  raise(id: string, dy: number): void {
    this.nudge(id, 0, 0, dy)
  }

  /** Turn the model (90 degree steps around the vertical, or stand a Z-up model upright). */
  turn(id: string, how: 'left' | 'right' | 'upright'): void {
    const o = this.objects.find((x) => x.id === id)
    if (!o) return
    const q = new THREE.Quaternion()
    if (how === 'upright') q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    else q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), how === 'left' ? Math.PI / 2 : -Math.PI / 2)
    o.object.quaternion.premultiply(q)
    this.snapToGrid(id)
  }

  /** Move the model by whole or partial tiles. */
  nudge(id: string, dx: number, dz: number, dy = 0): void {
    const o = this.objects.find((x) => x.id === id)
    if (!o) return
    o.object.position.x += dx
    o.object.position.y += dy
    o.object.position.z += dz
    o.object.updateMatrixWorld(true)
    if (dy) this.refreshAutoRoles()
    this.emit()
  }
  /** Grow/shrink the map so the whole scene fits (in whole tiles). */
  fitGridToScene(): void {
    const box = this.sceneBox()
    if (box.isEmpty()) return
    this.setTile({ mapW: Math.ceil(box.max.x - 1e-3), mapH: Math.ceil(box.max.z - 1e-3) })
  }

  sceneBox(): THREE.Box3 {
    const box = new THREE.Box3()
    for (const p of this.parts()) if (p.role !== 'ignore' && p.mesh.visible !== false) box.expandByObject(p.mesh)
    return box
  }

  parts(): ScenePart[] {
    const out: ScenePart[] = []
    for (const o of this.objects)
      o.object.traverse((n) => {
        const m = n as THREE.Mesh
        if (!m.isMesh) return
        const role = (m.userData.d2role as TileRole) ?? (o.kind === 'shape' ? 'wall' : guessRole(m.name))
        out.push({ mesh: m, label: m.name || o.name, owner: o, role })
      })
    return out
  }

  setRole(mesh: THREE.Mesh, role: TileRole): void {
    mesh.userData.d2role = role
    mesh.userData.d2roleAuto = false // the user decided; don't second-guess it
    this.applyRoleColours()
    this.emit()
  }

  /**
   * Add a solid block to the "Built scene" group (made for AI assistants and scripted scenes).
   * `position` is the block's minimum corner and `size` its extent, both in tiles; Y is up.
   */
  addBlock(spec: { shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'ramp'; position: number[]; size: number[]; color?: string; role?: TileRole; name?: string; rotationY?: number }): THREE.Mesh {
    let group = this.objects.find((o) => o.id === 'built')
    if (!group) {
      const g = new THREE.Group()
      g.name = 'Built scene'
      this.turntable.add(g)
      group = { id: 'built', name: 'Built scene', kind: 'model', object: g, clips: [], mixer: null, attachedTo: null }
      this.objects.push(group)
    }
    let geo: THREE.BufferGeometry
    if (spec.shape === 'cylinder') geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24)
    else if (spec.shape === 'cone') geo = new THREE.ConeGeometry(0.5, 1, 24)
    else if (spec.shape === 'sphere') geo = new THREE.SphereGeometry(0.5, 24, 16)
    else if (spec.shape === 'ramp') {
      // Wedge rising along +X
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1)])
      geo = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false })
      geo.center()
    } else geo = new THREE.BoxGeometry(1, 1, 1)
    const [sx, sy, sz] = spec.size.map((v) => Math.max(0.001, v))
    const [px, py, pz] = spec.position
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: spec.color ?? '#8a8070', roughness: 0.85, metalness: 0.05 }))
    mesh.name = spec.name || `${spec.shape}_${group.object.children.length + 1}`
    mesh.scale.set(sx, sy, sz)
    mesh.position.set(px + sx / 2, py + sy / 2, pz + sz / 2)
    mesh.rotation.y = THREE.MathUtils.degToRad(spec.rotationY ?? 0)
    mesh.userData.d2role = spec.role ?? guessRole(mesh.name)
    mesh.userData.d2roleAuto = !spec.role
    group.object.add(mesh)
    mesh.updateMatrixWorld(true)
    this.refreshAutoRoles()
    this.emit()
    return mesh
  }

  /** Give every part of a model the same role. */
  setModelRole(id: string, role: TileRole): void {
    const o = this.objects.find((x) => x.id === id)
    o?.object.traverse((n) => {
      const m = n as THREE.Mesh
      if (m.isMesh) {
        m.userData.d2role = role
        m.userData.d2roleAuto = false
      }
    })
    this.applyRoleColours()
    this.emit()
  }

  // ------------------------------------------------------------------ colour by role

  roleColours = false
  private roleMaterials = new Map<TileRole, THREE.MeshStandardMaterial>()

  setRoleColours(on: boolean): void {
    this.roleColours = on
    this.applyRoleColours()
    this.emit()
  }

  /** Swap every part's material for its role colour (the real materials are kept and restored). */
  applyRoleColours(on = this.roleColours): void {
    for (const p of this.parts()) {
      const m = p.mesh
      if (on) {
        if (!m.userData.d2origMaterial) m.userData.d2origMaterial = m.material
        let mat = this.roleMaterials.get(p.role)
        if (!mat) {
          mat = new THREE.MeshStandardMaterial({ color: ROLE_INFO[p.role].color, roughness: 0.8, transparent: p.role === 'ignore', opacity: p.role === 'ignore' ? 0.35 : 1 })
          this.roleMaterials.set(p.role, mat)
        }
        m.material = mat
      } else if (m.userData.d2origMaterial) {
        m.material = m.userData.d2origMaterial as THREE.Material
        delete m.userData.d2origMaterial
      }
    }
  }

  // ------------------------------------------------------------------ rendering for the slicer

  /** Render floor / wall / roof layers (and wall world positions) in map screen space. */
  renderSliceInput(lut: PaletteLut): SliceInput & { layersRgba: Record<'floor' | 'wall' | 'lower' | 'roof', Uint8ClampedArray | null> } {
    const coloured = this.roleColours
    if (coloured) this.applyRoleColours(false)
    const { mapW: W, mapH: H } = this.tile
    const parts = this.parts()
    const box = this.sceneBox()
    const maxY = Math.max(0.5, box.isEmpty() ? 0 : box.max.y)
    const minY = Math.min(0, box.isEmpty() ? 0 : box.min.y) // lower walls reach below the ground
    const ox = H * 80 + 80
    const oy = Math.ceil(maxY * PX_PER_HEIGHT) + 60
    const iw = (W + H) * 80 + 160
    const ih = oy + (W + H) * 40 + 60 + Math.ceil(-minY * PX_PER_HEIGHT)
    const cam = this.offCam
    this.placeCamera(cam)
    cam.left = -ox / TILE_PPU
    cam.right = (iw - ox) / TILE_PPU
    cam.top = oy / TILE_PPU
    cam.bottom = -(ih - oy) / TILE_PPU
    cam.near = 0.01
    cam.far = 1000
    cam.updateProjectionMatrix()

    if (!this.tileRenderer) {
      this.tileRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
      this.tileRenderer.outputColorSpace = THREE.SRGBColorSpace
      this.tileRenderer.setClearColor(0x000000, 0)
      this.tileRenderer.setPixelRatio(1)
    }
    const r = this.tileRenderer
    r.setSize(iw, ih, false)
    const gizmoHelper = (this as unknown as { gizmo: { getHelper(): THREE.Object3D } | null }).gizmo?.getHelper()
    const helperVis = this.helpers.visible
    const gizmoVis = gizmoHelper?.visible ?? false
    this.helpers.visible = false
    if (gizmoHelper) gizmoHelper.visible = false
    const vis = new Map(parts.map((p) => [p.mesh, p.mesh.visible]))
    this.applyPose()

    const only = (role: TileRole) => {
      let any = false
      for (const p of parts) {
        p.mesh.visible = (vis.get(p.mesh) ?? true) && p.role === role
        if (p.mesh.visible) any = true
      }
      return any
    }
    const canvas = document.createElement('canvas')
    canvas.width = iw
    canvas.height = ih
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const beauty = (role: TileRole): Uint8ClampedArray | null => {
      if (!only(role)) return null
      r.render(this.scene, cam)
      ctx.clearRect(0, 0, iw, ih)
      ctx.drawImage(r.domElement, 0, 0)
      return ctx.getImageData(0, 0, iw, ih).data
    }
    // Floors: only what's at or above the ground. Slab sides below it would leak into neighbouring cells as slivers.
    r.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.005)]
    const floorRgba = beauty('floor')
    r.clippingPlanes = []
    const wallRgba = beauty('wall')
    const lowerRgba = beauty('lower')
    const roofRgba = beauty('roof')

    // World position of every wall pixel (float render target; rows come back bottom-up)
    const positions = (role: TileRole): Float32Array | null => {
      if (!only(role)) return null
      const rt = new THREE.WebGLRenderTarget(iw, ih, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true })
      this.scene.overrideMaterial = this.posMaterial
      r.setRenderTarget(rt)
      r.setClearColor(0x000000, 0)
      r.clear()
      r.render(this.scene, cam)
      const raw = new Float32Array(iw * ih * 4)
      r.readRenderTargetPixels(rt, 0, 0, iw, ih, raw)
      r.setRenderTarget(null)
      this.scene.overrideMaterial = null
      rt.dispose()
      const out = new Float32Array(iw * ih * 4)
      for (let y = 0; y < ih; y++) out.set(raw.subarray((ih - 1 - y) * iw * 4, (ih - y) * iw * 4), y * iw * 4)
      return out
    }
    const wallPos = wallRgba ? positions('wall') : null
    const lowerPos = lowerRgba ? positions('lower') : null
    // Roofs are floor-like tiles raised by a height: use the roof's top surface, which is what you see
    let roofPx = 0
    const roofBox = new THREE.Box3()
    for (const p of parts) if (p.role === 'roof' && vis.get(p.mesh) !== false) roofBox.expandByObject(p.mesh)
    if (!roofBox.isEmpty()) roofPx = Math.max(0, Math.round(roofBox.max.y * PX_PER_HEIGHT))

    for (const p of parts) p.mesh.visible = vis.get(p.mesh) ?? true
    if (coloured) this.applyRoleColours(true)
    this.helpers.visible = helperVis
    if (gizmoHelper) gizmoHelper.visible = gizmoVis

    const q = (rgba: Uint8ClampedArray | null) => (rgba ? quantizeRgba(rgba, iw, ih, lut, 128, this.tile.dither) : null)
    return {
      mapWidth: W,
      mapHeight: H,
      imageWidth: iw,
      imageHeight: ih,
      originX: ox,
      originY: oy,
      floor: q(floorRgba),
      wall: q(wallRgba),
      wallPos,
      lower: q(lowerRgba),
      lowerPos,
      roof: q(roofRgba),
      roofPx,
      layersRgba: { floor: floorRgba, wall: wallRgba, lower: lowerRgba, roof: roofRgba }
    }
  }
}

export const tileStudio = new TileStudio()
