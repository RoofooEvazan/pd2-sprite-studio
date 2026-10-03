import { useSyncExternalStore } from 'react'
import { api, GameStatus, prefetch, readGameFile, UpdateCheck } from './api'
import { Catalog, ItemEntry, UnitEntry, cofPath } from '../../core/catalog'
import { decodeLayerFile, LayerFormat, layerFormat, layerPath } from '../../core/unitLayer'
import { Cof, COMPOSITS, decodeAnimData, decodeCof, AnimDataRecord, animFps } from '../../core/cof'
import { decodeDc6, Dc6Meta } from '../../core/dc6'
import { DccFrameMeta } from '../../core/dcc'
import { COLORMAP_FILES, colormapPath, Palette, PALETTE_NAMES, palettePath, parsePalDat } from '../../core/palette'
import { cloneFrame, cloneSprite, expandFrame, Frame, Sprite, trimFrame } from '../../core/sprite'
import { mirrorDir } from '../../core/edit'
import type { LayerInput } from '../../core/composite'

export type Tool = 'pencil' | 'eraser' | 'fill' | 'fillAll' | 'picker' | 'line' | 'rect' | 'rectFill' | 'replace' | 'move' | 'shade' | 'ramp' | 'select' | 'lasso' | 'wand'

export type LockMode = 'off' | 'opaque' | 'transparent' | 'color' | 'ramp'
export type Scope = 'frame' | 'dir' | 'all'

/** Sprite-space selection mask. */
export interface Selection {
  x0: number
  y0: number
  w: number
  h: number
  mask: Uint8Array
}

/** Pixels lifted or pasted, floating above the active frame until committed. */
export interface Floating {
  dir: number
  frame: number
  key: string
  x: number
  y: number
  w: number
  h: number
  pixels: Uint8Array
  /** Frame as it was before lifting/pasting (for commit/cancel). */
  before: Frame
}

export interface Clip {
  x: number
  y: number
  w: number
  h: number
  pixels: Uint8Array
}

export interface Reference {
  url: string
  name: string
  width: number
  height: number
  x: number
  y: number
  scale: number
  opacity: number
  above: boolean
  visible: boolean
  moving: boolean
}

export interface ItemDoc {
  kind: 'item'
  title: string
  path: string
  item: ItemEntry | null
  sprite: Sprite
  meta: Dc6Meta
  original: Sprite
  dirty: boolean
}

export interface AnimLayer {
  composit: number
  weaponClass: string
  armtype: string
  src: { base: string; token: string }
  path: string
  sprite: Sprite | null
  frameMeta: DccFrameMeta[][] | null
  /** DCC for most units; DC6 for e.g. Mephisto. Exports keep the format. */
  format: LayerFormat
  dc6Meta: Dc6Meta | null
  original: Sprite | null
  visible: boolean
  dirty: boolean
  missing: boolean
}

export interface AnimDoc {
  kind: 'anim'
  title: string
  unit: UnitEntry
  mode: string
  wclass: string
  cof: Cof
  cofPath: string
  layers: AnimLayer[]
  active: number // composit index being edited
  fps: number
  anim: AnimDataRecord | null
}

export type Doc = ItemDoc | AnimDoc

export interface ViewOptions {
  grid: boolean
  onion: boolean
  ghostLayers: boolean
  ghostAlpha: number
  cellWarn: boolean
  tint: boolean
  origin: boolean
  /** highlight pixels that differ from the original game file */
  diff: boolean
}

interface UndoEntry {
  frames: { key: string; before: Frame; after: Frame }[]
}

export interface State {
  status: GameStatus | null
  catalog: Catalog | null
  loadingMsg: string | null
  error: string | null
  palettes: Record<string, Palette>
  paletteName: string
  colormaps: Record<string, Uint8Array>
  colormap: string
  tintCode: string
  animData: Map<string, AnimDataRecord> | null
  doc: Doc | null
  tool: Tool
  primary: number
  secondary: number
  brush: number
  zoom: number
  dir: number
  frame: number
  view: ViewOptions
  version: number
  undo: UndoEntry[]
  redo: UndoEntry[]
  /** Frame snapshots taken before the first edit, used by the transfer tool. key -> frame */
  baselines: Map<string, Frame>
  showTransfer: boolean
  showExport: boolean
  toast: string | null
  prompt: { title: string; value: string; resolve: (v: string | null) => void } | null
  lock: LockMode
  lockColor: number
  scope: Scope
  selection: Selection | null
  floating: Floating | null
  clipboard: Clip | null
  reference: Reference | null
  /** true while the compare key is held: show the original game frame */
  showOriginal: boolean
  rampDialog: { index: number; x: number; y: number } | null
  showOutline: boolean
  screen: Screen
  /** unit picked on the character/monster/object picker (before choosing an animation) */
  pickUnit: UnitEntry | null
  exportMode: 'game' | 'pictures'
  inspectorTab: 'parts' | 'colours' | 'reference'
  showPreview: boolean
  playing: boolean
  recent: RecentEntry[]
  /** open the 3D render import dialog, targeting this body part */
  renderImport: { composit: number } | null
  /** a newer release found by the startup check */
  update: UpdateCheck | null
  showUpdate: boolean
}

export type Screen = 'home' | 'chars' | 'monsters' | 'objects' | 'items' | 'editor' | '3d' | 'tiles'

export type RecentEntry =
  | { kind: 'item'; title: string; path: string; code: string; name: string }
  | { kind: 'anim'; title: string; base: string; token: string; mode: string; wclass: string }

const initial: State = {
  status: null,
  catalog: null,
  loadingMsg: 'Opening game archives…',
  error: null,
  palettes: {},
  paletteName: 'ACT1',
  colormaps: {},
  colormap: '',
  tintCode: '',
  animData: null,
  doc: null,
  tool: 'pencil',
  primary: 32,
  secondary: 0,
  brush: 1,
  zoom: 6,
  dir: 0,
  frame: 0,
  view: { grid: true, onion: false, ghostLayers: true, ghostAlpha: 0.7, cellWarn: true, tint: false, origin: true, diff: false },
  version: 0,
  undo: [],
  redo: [],
  baselines: new Map(),
  showTransfer: false,
  showExport: false,
  toast: null,
  prompt: null,
  lock: 'off',
  lockColor: 0,
  scope: 'frame',
  selection: null,
  floating: null,
  clipboard: null,
  reference: null,
  showOriginal: false,
  rampDialog: null,
  showOutline: false,
  screen: 'home',
  pickUnit: null,
  exportMode: 'game',
  inspectorTab: 'parts',
  showPreview: true,
  playing: false,
  recent: loadRecent(),
  renderImport: null,
  update: null,
  showUpdate: false
}

function loadRecent(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem('pd2ss.recent') ?? '[]')
  } catch {
    return []
  }
}

export function pushRecent(e: RecentEntry): void {
  const key = (r: RecentEntry) => (r.kind === 'item' ? r.path : `///`)
  const recent = [e, ...state.recent.filter((r) => key(r) !== key(e))].slice(0, 8)
  try {
    localStorage.setItem('pd2ss.recent', JSON.stringify(recent))
  } catch {
    /* storage unavailable */
  }
  setState({ recent })
}

export function goTo(screen: Screen): void {
  commitFloating()
  setState({ screen, pickUnit: null })
}

let state: State = initial
const listeners = new Set<() => void>()

export function getState(): State {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sel(state)
  )
}

/** In-app replacement for window.prompt (unsupported in Electron). */
export function askText(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) =>
    setState({
      prompt: {
        title,
        value,
        resolve: (v) => {
          setState({ prompt: null })
          resolve(v)
        }
      }
    })
  )
}

export function toast(msg: string): void {
  setState({ toast: msg })
  setTimeout(() => {
    if (state.toast === msg) setState({ toast: null })
  }, 4000)
}

// ---------------------------------------------------------------------------------------------
// Startup

export async function init(): Promise<void> {
  try {
    const status = await api.status()
    setState({ status })
    if (!status.loaded.length) {
      setState({ loadingMsg: null, error: 'No game archives found. Set your Diablo II and ProjectD2 folders in Settings.' })
      return
    }
    setState({ loadingMsg: 'Reading palettes…' })
    const palPaths = PALETTE_NAMES.map(palettePath)
    const cmPaths = COLORMAP_FILES.map(colormapPath)
    await prefetch([...palPaths, ...cmPaths, 'data\\global\\animdata.d2'])
    const palettes: Record<string, Palette> = {}
    for (const n of PALETTE_NAMES) {
      const d = await readGameFile(palettePath(n))
      if (d && d.length >= 768) palettes[n] = parsePalDat(d)
    }
    const colormaps: Record<string, Uint8Array> = {}
    for (const n of COLORMAP_FILES) {
      const d = await readGameFile(colormapPath(n))
      if (d) colormaps[n] = d
    }
    const ad = await readGameFile('data\\global\\animdata.d2')
    setState({ palettes, colormaps, animData: ad ? decodeAnimData(ad) : null, loadingMsg: 'Indexing sprites…' })
    const catalog = await api.catalog()
    setState({ catalog, loadingMsg: null, error: null })
  } catch (e) {
    setState({ loadingMsg: null, error: String(e) })
  }
}

export async function changeLocation(loc: { d2Dir: string; pd2Dir: string }): Promise<void> {
  setState({ loadingMsg: 'Reopening archives…', catalog: null, doc: null })
  await api.setLocation(loc)
  await init()
}

export function palette(): Palette {
  return state.palettes[state.paletteName] ?? state.palettes.ACT1 ?? new Uint8Array(1024)
}

/** Colormap remap table for item tint preview (InvTrans colormap + colour shade). */
export function tintTable(): Uint8Array | null {
  if (!state.view.tint || !state.colormap || !state.tintCode || !state.catalog) return null
  const cm = state.colormaps[state.colormap]
  const shade = state.catalog.colors.findIndex((c) => c.code === state.tintCode)
  if (!cm || shade < 0 || cm.length < (shade + 1) * 256) return null
  return cm.subarray(shade * 256, shade * 256 + 256)
}

const INVTRANS_FILES = ['', 'grey', 'grey2', 'gold', 'brown', 'greybrown', 'invgrey', 'invgrey2', 'invgreybrown']

// ---------------------------------------------------------------------------------------------
// Documents

function resetEditState(): Partial<State> {
  return { dir: 0, frame: 0, undo: [], redo: [], baselines: new Map(), version: state.version + 1, showTransfer: false, selection: null, floating: null, rampDialog: null, showOutline: false }
}

export function confirmDiscard(): boolean {
  const d = state.doc
  const dirty = d && (d.kind === 'item' ? d.dirty : d.layers.some((l) => l.dirty))
  return !dirty || window.confirm('Discard unsaved edits to the current sprite?')
}

export async function openItem(item: ItemEntry | null, path: string): Promise<void> {
  if (!confirmDiscard()) return
  const data = await readGameFile(path)
  if (!data) return toast(`File not found in archives: ${path}`)
  try {
    const dc6 = decodeDc6(data)
    const { meta, ...sprite } = dc6
    setState({
      doc: { kind: 'item', title: item?.name ?? path.substring(path.lastIndexOf('\\') + 1), path, item, sprite, meta, original: cloneSprite(sprite), dirty: false },
      colormap: item ? INVTRANS_FILES[item.invTrans] ?? '' : '',
      tintCode: item?.tint ?? '',
      zoom: Math.max(2, Math.min(12, Math.floor(420 / Math.max(sprite.frames[0][0]?.height ?? 1, 1)))),
      ...resetEditState(),
      screen: 'editor',
      inspectorTab: 'colours'
    })
    pushRecent({ kind: 'item', title: item?.name ?? path, path, code: item?.code ?? '', name: item?.name ?? '' })
  } catch (e) {
    toast(`Could not decode ${path}: ${e}`)
  }
}

export function defaultArmtype(unit: UnitEntry, comp: string, mode: string, wclass: string): string | null {
  const candidates = (unit.armtypes[comp] ?? []).filter((a) => unit.dccs.includes(`${comp}${a}${mode}${wclass}`))
  if (!candidates.length) return null
  // Plain, recognisable defaults for armour, weapons and shields
  const prefs: Record<string, string[]> = {
    RH: ['AXE', 'HAX', 'SSD', 'SCM', 'LSD', 'CLB', 'MAC', 'SPR', 'LBW', 'SBW', 'LXB', 'JAV', 'BST', 'SST', 'WND', 'KTR', 'GLV'],
    LH: ['LBB', 'SBB', 'LBW', 'SBW', 'SSD', 'AXE', 'HAX', 'KTR', 'LXB'],
    SH: ['BUC', 'LRG', 'KIT', 'TOW', 'SML']
  }
  for (const pref of [...(prefs[comp] ?? []), 'LIT', 'MED', 'HVY']) if (candidates.includes(pref)) return pref
  return candidates[0]
}

/** The catalog entry for a layer's source unit (it may come from another unit than the open one). */
function unitOf(src: { base: string; token: string }): UnitEntry | undefined {
  return state.catalog?.units.find((u) => u.base === src.base && u.token === src.token)
}

/** Path of a part graphic in whichever format (DCC/DC6) the source unit uses for it. */
export function partPath(src: { base: string; token: string }, comp: string, armtype: string, mode: string, wclass: string): string {
  return layerPath(src, comp, armtype, mode, wclass, layerFormat(unitOf(src), comp, armtype, mode, wclass))
}

async function loadLayerSprite(layer: AnimLayer, mode: string): Promise<void> {
  const comp = COMPOSITS[layer.composit]
  layer.format = layerFormat(unitOf(layer.src), comp, layer.armtype, mode, layer.weaponClass)
  layer.path = layerPath(layer.src, comp, layer.armtype, mode, layer.weaponClass, layer.format)
  const data = layer.armtype ? await readGameFile(layer.path) : null
  if (!data) {
    layer.sprite = null
    layer.original = null
    layer.frameMeta = null
    layer.dc6Meta = null
    layer.missing = true
    return
  }
  try {
    const dec = decodeLayerFile(data, layer.format)
    layer.sprite = dec.sprite
    layer.frameMeta = dec.frameMeta
    layer.dc6Meta = dec.dc6Meta
    layer.original = cloneSprite(layer.sprite)
    layer.missing = false
  } catch (e) {
    layer.sprite = null
    layer.missing = true
    toast(`Could not decode ${layer.path}: ${e}`)
  }
}

export async function openAnim(unit: UnitEntry, mode: string, wclass: string, keep?: AnimLayer[]): Promise<void> {
  if (!keep && !confirmDiscard()) return
  const cp = cofPath(unit, mode, wclass)
  const data = await readGameFile(cp)
  if (!data) return toast(`No COF for ${unit.token} ${mode} ${wclass}`)
  let cof: Cof
  try {
    cof = decodeCof(data)
  } catch (e) {
    return toast(`Bad COF ${cp}: ${e}`)
  }
  setState({ loadingMsg: `Loading ${unit.token} ${mode} ${wclass}…` })
  const layers: AnimLayer[] = cof.layers.map((l) => {
    const comp = COMPOSITS[l.composit]
    const kept = keep?.find((k) => k.composit === l.composit && k.dirty)
    if (kept) return { ...kept }
    return {
      composit: l.composit,
      weaponClass: l.weaponClass,
      armtype: defaultArmtype(unit, comp, mode, l.weaponClass) ?? '',
      src: { base: unit.base, token: unit.token },
      path: '',
      sprite: null,
      frameMeta: null,
      format: 'dcc' as LayerFormat,
      dc6Meta: null,
      original: null,
      visible: true,
      dirty: false,
      missing: false
    }
  })
  await prefetch(layers.filter((l) => !l.dirty && l.armtype).map((l) => partPath(l.src, COMPOSITS[l.composit], l.armtype, mode, l.weaponClass)))
  await Promise.all(layers.filter((l) => !l.dirty).map((l) => loadLayerSprite(l, mode)))
  const anim = state.animData?.get(`${unit.token}${mode}${wclass}`.toUpperCase()) ?? null
  const prev = state.doc?.kind === 'anim' ? state.doc : null
  const preferred = prev ? prev.active : ['TR', 'HD', 'RH', 'LG'].map((c) => COMPOSITS.indexOf(c as never)).find((c) => layers.some((l) => l.composit === c && l.sprite))
  const active = layers.find((l) => l.composit === preferred && l.sprite)?.composit ?? layers.find((l) => l.sprite)?.composit ?? layers[0]?.composit ?? 0
  const doc: AnimDoc = {
    kind: 'anim',
    title: `${unit.label} — ${mode} ${wclass}`,
    unit,
    mode,
    wclass,
    cof,
    cofPath: cp,
    layers,
    active,
    fps: anim ? animFps(anim.speed) : 12.5,
    anim
  }
  const dir = keep ? Math.min(state.dir, cof.directions - 1) : 0
  setState({ doc, loadingMsg: null, zoom: keep ? state.zoom : 5, paletteName: state.paletteName, ...resetEditState(), dir, screen: 'editor', inspectorTab: keep ? state.inspectorTab : 'parts' })
  pushRecent({ kind: 'anim', title: `:  `, base: unit.base, token: unit.token, mode, wclass })
}

/** Show the current (edited) layers on a different body/unit with the same mode + weapon class. */
export async function switchBody(unit: UnitEntry): Promise<void> {
  const d = state.doc
  if (d?.kind !== 'anim') return
  const wclasses = unit.modes[d.mode]
  if (!wclasses?.includes(d.wclass)) return toast(`${unit.label} has no ${d.mode} ${d.wclass} animation`)
  await openAnim(unit, d.mode, d.wclass, d.layers)
}

export async function setLayerSource(composit: number, src: { base: string; token: string }, armtype: string): Promise<void> {
  const d = state.doc
  if (d?.kind !== 'anim') return
  const layer = d.layers.find((l) => l.composit === composit)
  if (!layer) return
  if (layer.dirty && !window.confirm('This layer has unsaved edits. Replace it?')) return
  layer.src = src
  layer.armtype = armtype
  layer.dirty = false
  await loadLayerSprite(layer, d.mode)
  setState({ doc: { ...d }, version: state.version + 1, undo: state.undo.filter((u) => !u.frames.some((f) => f.key.startsWith(`${composit}:`))) })
}

/** Give a layer with no DCC a blank sprite so it can be painted from scratch (e.g. a new armtype). */
export function createBlankLayer(composit: number, armtype: string): void {
  const d = state.doc
  if (d?.kind !== 'anim') return
  const layer = d.layers.find((l) => l.composit === composit)
  if (!layer) return
  const code = armtype.trim().toUpperCase()
  if (!/^[A-Z0-9]{1,3}$/.test(code)) return toast('Armtype codes are 1–3 letters/digits, e.g. LIT, MED, or a custom code like XYZ.')
  layer.armtype = code
  layer.format = 'dcc'
  layer.dc6Meta = null
  layer.path = layerPath(layer.src, COMPOSITS[composit], code, d.mode, layer.weaponClass)
  layer.sprite = {
    directions: d.cof.directions,
    framesPerDir: d.cof.framesPerDir,
    frames: Array.from({ length: d.cof.directions }, () =>
      Array.from({ length: d.cof.framesPerDir }, () => ({ width: 0, height: 0, offsetX: 0, offsetY: 0, pixels: new Uint8Array(0) }))
    )
  }
  layer.original = cloneSprite(layer.sprite)
  layer.frameMeta = null
  layer.missing = false
  layer.dirty = true
  setState({ doc: { ...d, active: composit }, version: state.version + 1 })
}

/** Rename the armtype a layer exports as (e.g. save an edited LIT torso as a new custom armtype). */
export function setExportArmtype(composit: number, armtype: string): void {
  const d = state.doc
  if (d?.kind !== 'anim') return
  const layer = d.layers.find((l) => l.composit === composit)
  const code = armtype.trim().toUpperCase()
  if (!layer || !/^[A-Z0-9]{1,3}$/.test(code)) return
  layer.armtype = code
  layer.path = layerPath({ base: d.unit.base, token: d.unit.token }, COMPOSITS[composit], code, d.mode, layer.weaponClass, layer.format)
  layer.dirty = true
  setState({ doc: { ...d }, version: state.version + 1 })
}

/** Replace a body part with an imported sprite (e.g. from 3D renders), saved under `armtype`. */
export function setLayerSprite(composit: number, sprite: Sprite, armtype: string): void {
  const d = state.doc
  if (d?.kind !== 'anim') return
  const layer = d.layers.find((l) => l.composit === composit)
  const code = armtype.trim().toUpperCase()
  if (!layer || !/^[A-Z0-9]{1,3}$/.test(code)) return toast('Style codes are 1–3 letters or digits, e.g. NEW.')
  layer.armtype = code
  layer.src = { base: d.unit.base, token: d.unit.token }
  layer.format = 'dcc'
  layer.dc6Meta = null
  layer.path = layerPath(layer.src, COMPOSITS[composit], code, d.mode, layer.weaponClass)
  if (!layer.original) layer.original = { ...sprite, frames: sprite.frames.map((dir) => dir.map(() => ({ width: 0, height: 0, offsetX: 0, offsetY: 0, pixels: new Uint8Array(0) }))) }
  layer.sprite = sprite
  layer.frameMeta = null
  layer.missing = false
  layer.visible = true
  layer.dirty = true
  setState({
    doc: { ...d, active: composit },
    undo: state.undo.filter((u) => !u.frames.some((f) => f.key.startsWith(`${composit}:`))),
    redo: [],
    version: state.version + 1
  })
}

export function updateDoc(patch: Partial<AnimDoc> | Partial<ItemDoc>): void {
  if (!state.doc) return
  setState({ doc: { ...state.doc, ...patch } as Doc, version: state.version + 1 })
}

// ---------------------------------------------------------------------------------------------
// Frame access and editing

export function activeSprite(s: State = state): Sprite | null {
  const d = s.doc
  if (!d) return null
  if (d.kind === 'item') return d.sprite
  return d.layers.find((l) => l.composit === d.active)?.sprite ?? null
}

export function frameKey(dir: number, frame: number, s: State = state): string {
  const d = s.doc
  return `${d?.kind === 'anim' ? d.active : 'item'}:${dir}:${frame}`
}

export function getFrame(dir = state.dir, frame = state.frame): Frame | null {
  const sp = activeSprite()
  return sp?.frames[dir]?.[frame] ?? null
}

function markDirty(): void {
  const d = state.doc
  if (!d) return
  if (d.kind === 'item') d.dirty = true
  else {
    const l = d.layers.find((x) => x.composit === d.active)
    if (l) l.dirty = true
  }
}

function putFrameByKey(key: string, f: Frame): void {
  const [layer, dir, frame] = key.split(':')
  const d = state.doc
  if (!d) return
  const sp = d.kind === 'item' ? d.sprite : d.layers.find((l) => String(l.composit) === layer)?.sprite
  if (sp) sp.frames[+dir][+frame] = f
}

/** Replace a frame of the active sprite, recording undo and the transfer baseline. */
export function commitFrame(dir: number, frame: number, before: Frame, after: Frame): void {
  commitFrames([{ dir, frame, before, after }])
}

/** Replace several frames of the active sprite as a single undo step. */
export function commitFrames(list: { dir: number; frame: number; before: Frame; after: Frame }[]): void {
  if (!list.length) return
  const frames = list.map((e) => {
    const key = frameKey(e.dir, e.frame)
    if (!state.baselines.has(key)) state.baselines.set(key, cloneFrame(e.before))
    putFrameByKey(key, e.after)
    return { key, before: e.before, after: cloneFrame(e.after) }
  })
  markDirty()
  setState({ undo: [...state.undo.slice(-199), { frames }], redo: [], version: state.version + 1 })
}

export function setFrameLive(dir: number, frame: number, f: Frame): void {
  putFrameByKey(frameKey(dir, frame), f)
  setState({ version: state.version + 1 })
}

export function undo(): void {
  if (state.floating) return cancelFloating()
  const e = state.undo[state.undo.length - 1]
  if (!e) return
  for (const f of e.frames) putFrameByKey(f.key, cloneFrame(f.before))
  setState({ undo: state.undo.slice(0, -1), redo: [...state.redo, e], version: state.version + 1 })
}

export function redo(): void {
  const e = state.redo[state.redo.length - 1]
  if (!e) return
  for (const f of e.frames) putFrameByKey(f.key, cloneFrame(f.after))
  setState({ redo: state.redo.slice(0, -1), undo: [...state.undo, e], version: state.version + 1 })
}

/** Original (game file) frame of the active sprite, if any. */
export function originalFrame(dir = state.dir, frame = state.frame): Frame | null {
  const d = state.doc
  if (!d) return null
  const sp = d.kind === 'item' ? d.original : d.layers.find((l) => l.composit === d.active)?.original
  return sp?.frames[dir]?.[frame] ?? null
}

/** The (dir, frame) pairs the current scope setting covers, starting with the current frame. */
export function scopeTargets(): { dir: number; frame: number }[] {
  const nD = directions()
  const nF = framesPerDir()
  const out: { dir: number; frame: number }[] = [{ dir: state.dir, frame: state.frame }]
  const dirs = state.scope === 'all' ? Array.from({ length: nD }, (_, d) => d) : state.scope === 'dir' ? [state.dir] : []
  for (const d of dirs) for (let f = 0; f < nF; f++) if (d !== state.dir || f !== state.frame) out.push({ dir: d, frame: f })
  return out
}

/** Apply a frame transform across the current scope as one undo step. Returns frames changed. */
export function applyToScope(fn: (f: Frame, dir: number, frame: number) => Frame | null): number {
  const sp = activeSprite()
  if (!sp) return 0
  const list: { dir: number; frame: number; before: Frame; after: Frame }[] = []
  for (const t of scopeTargets()) {
    const cur = sp.frames[t.dir]?.[t.frame]
    if (!cur) continue
    const raw = fn(cur, t.dir, t.frame)
    if (!raw) continue
    // Compare after trimming: operations that grow the canvas (outline) shouldn't count as changes
    const next = state.doc?.kind === 'anim' ? trimFrame(raw) : raw
    const base = state.doc?.kind === 'anim' ? trimFrame(cur) : cur
    const changed = next.width !== base.width || next.height !== base.height || next.offsetX !== base.offsetX || next.offsetY !== base.offsetY || next.pixels.some((v, i) => v !== base.pixels[i])
    if (changed) list.push({ ...t, before: cloneFrame(cur), after: next })
  }
  commitFrames(list)
  return list.length
}

// ---------------------------------------------------------------------------------------------
// Selection, floating pixels and clipboard

export function selectionContains(sel: Selection | null, x: number, y: number): boolean {
  if (!sel) return true
  const lx = x - sel.x0
  const ly = y - sel.y0
  return lx >= 0 && ly >= 0 && lx < sel.w && ly < sel.h && sel.mask[ly * sel.w + lx] === 1
}

/** Copy the selected pixels of a frame into a clip (sprite-space). */
function clipFrom(f: Frame, sel: Selection | null): Clip | null {
  const s = sel ?? { x0: f.offsetX, y0: f.offsetY, w: f.width, h: f.height, mask: new Uint8Array(f.width * f.height).fill(1) }
  const px = new Uint8Array(s.w * s.h)
  let any = false
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      if (!s.mask[y * s.w + x]) continue
      const lx = s.x0 + x - f.offsetX
      const ly = s.y0 + y - f.offsetY
      if (lx < 0 || ly < 0 || lx >= f.width || ly >= f.height) continue
      const v = f.pixels[ly * f.width + lx]
      px[y * s.w + x] = v
      if (v) any = true
    }
  return any ? { x: s.x0, y: s.y0, w: s.w, h: s.h, pixels: px } : null
}

function eraseSelected(f: Frame, sel: Selection | null): Frame {
  const px = f.pixels.slice()
  for (let i = 0; i < px.length; i++) if (selectionContains(sel, f.offsetX + (i % f.width), f.offsetY + Math.floor(i / f.width))) px[i] = 0
  return { ...f, pixels: px }
}

export function copySelection(): void {
  if (state.floating) {
    const fl = state.floating
    setState({ clipboard: { x: fl.x, y: fl.y, w: fl.w, h: fl.h, pixels: fl.pixels.slice() } })
    return toast('Copied floating pixels')
  }
  const f = getFrame()
  if (!f) return
  const clip = clipFrom(f, state.selection)
  if (!clip) return toast('Nothing to copy: the selection is empty')
  setState({ clipboard: clip })
  toast(state.selection ? 'Copied selection' : 'Copied whole frame')
}

export function cutSelection(): void {
  copySelection()
  deleteSelection()
}

export function deleteSelection(): void {
  if (state.floating) {
    const fl = state.floating
    setFrameLive(fl.dir, fl.frame, fl.before)
    commitFrame(fl.dir, fl.frame, cloneFrame(fl.before), cloneFrame(getFrame(fl.dir, fl.frame)!))
    setState({ floating: null })
    // the hole left by lifting is the result
    return
  }
  const f = getFrame()
  if (!f || !state.selection) return
  commitFrame(state.dir, state.frame, cloneFrame(f), eraseSelected(f, state.selection))
}

/** Lift the selected pixels into a floating layer so they can be moved/flipped. */
export function liftSelection(): boolean {
  if (state.floating) return true
  const f = getFrame()
  if (!f) return false
  const clip = clipFrom(f, state.selection)
  if (!clip) return false
  const before = cloneFrame(f)
  setFrameLive(state.dir, state.frame, eraseSelected(f, state.selection))
  setState({ floating: { dir: state.dir, frame: state.frame, key: frameKey(state.dir, state.frame), ...clip, before } })
  return true
}

export function pasteClip(clip: Clip | null = state.clipboard, at?: { x: number; y: number }): void {
  if (!clip) return toast('Clipboard is empty. Copy a selection with Ctrl+C first.')
  commitFloating()
  const f = getFrame()
  if (!f) return
  setState({
    tool: 'select',
    selection: null,
    floating: { dir: state.dir, frame: state.frame, key: frameKey(state.dir, state.frame), x: at?.x ?? clip.x, y: at?.y ?? clip.y, w: clip.w, h: clip.h, pixels: clip.pixels.slice(), before: cloneFrame(f) },
    version: state.version + 1
  })
}

export function moveFloating(dx: number, dy: number): void {
  const fl = state.floating
  if (!fl) return
  setState({ floating: { ...fl, x: fl.x + dx, y: fl.y + dy }, version: state.version + 1 })
}

export function flipFloating(axis: 'h' | 'v'): void {
  if (!state.floating && !liftSelection()) return
  const fl = state.floating!
  const px = new Uint8Array(fl.pixels.length)
  for (let y = 0; y < fl.h; y++)
    for (let x = 0; x < fl.w; x++) {
      const tx = axis === 'h' ? fl.w - 1 - x : x
      const ty = axis === 'v' ? fl.h - 1 - y : y
      px[ty * fl.w + tx] = fl.pixels[y * fl.w + x]
    }
  setState({ floating: { ...fl, pixels: px }, version: state.version + 1 })
}

/** Merge the floating pixels into their frame (one undo step). */
export function commitFloating(): void {
  const fl = state.floating
  if (!fl) return
  const d = state.doc
  const sp = activeSprite()
  const cur = sp?.frames[fl.dir]?.[fl.frame]
  setState({ floating: null })
  if (!cur || !d) return
  let out: Frame
  if (d.kind === 'anim') {
    const x0 = Math.min(cur.width ? cur.offsetX : fl.x, fl.x)
    const y0 = Math.min(cur.height ? cur.offsetY : fl.y, fl.y)
    const x1 = Math.max(cur.width ? cur.offsetX + cur.width : fl.x + fl.w, fl.x + fl.w)
    const y1 = Math.max(cur.height ? cur.offsetY + cur.height : fl.y + fl.h, fl.y + fl.h)
    out = expandFrame(cur, x0, y0, x1, y1)
  } else out = cloneFrame(cur)
  for (let y = 0; y < fl.h; y++)
    for (let x = 0; x < fl.w; x++) {
      const v = fl.pixels[y * fl.w + x]
      if (!v) continue
      const lx = fl.x + x - out.offsetX
      const ly = fl.y + y - out.offsetY
      if (lx < 0 || ly < 0 || lx >= out.width || ly >= out.height) continue
      out.pixels[ly * out.width + lx] = v
    }
  if (d.kind === 'anim') out = trimFrame(out)
  // restore pre-lift state, then commit the merged result as a single step
  putFrameByKey(fl.key, fl.before)
  commitFrame(fl.dir, fl.frame, cloneFrame(fl.before), out)
  // keep the moved pixels selected
  const mask = new Uint8Array(fl.w * fl.h)
  for (let i = 0; i < mask.length; i++) mask[i] = fl.pixels[i] ? 1 : 0
  setState({ selection: { x0: fl.x, y0: fl.y, w: fl.w, h: fl.h, mask } })
}

export function cancelFloating(): void {
  const fl = state.floating
  if (!fl) return
  putFrameByKey(fl.key, fl.before)
  setState({ floating: null, version: state.version + 1 })
}

export function selectAll(): void {
  commitFloating()
  const f = getFrame()
  if (!f || !f.width) return
  const mask = new Uint8Array(f.width * f.height)
  for (let i = 0; i < mask.length; i++) mask[i] = f.pixels[i] ? 1 : 0
  setState({ selection: { x0: f.offsetX, y0: f.offsetY, w: f.width, h: f.height, mask }, version: state.version + 1 })
}

export function clearSelection(): void {
  commitFloating()
  setState({ selection: null, version: state.version + 1 })
}

/**
 * Copy the selection (or whole frame) mirrored left/right about the unit's origin into the
 * mirror-image direction (e.g. SW -> SE), as a floating paste you can adjust before committing.
 */
export function pasteToMirrorDirection(): void {
  const src = state.floating
    ? { x: state.floating.x, y: state.floating.y, w: state.floating.w, h: state.floating.h, pixels: state.floating.pixels }
    : (() => {
        const f = getFrame()
        return f ? clipFrom(f, state.selection) : null
      })()
  if (!src) return toast('Nothing to mirror')
  commitFloating()
  const nD = directions()
  const target = mirrorDir(nD, state.dir)
  if (target === state.dir) return toast(`Direction ${state.dir} faces straight up/down: it has no left/right mirror`)
  const px = new Uint8Array(src.pixels.length)
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) px[y * src.w + (src.w - 1 - x)] = src.pixels[y * src.w + x]
  setState({ dir: target, selection: null })
  pasteClip({ x: -(src.x + src.w), y: src.y, w: src.w, h: src.h, pixels: px })
  toast(`Mirrored into direction ${target}. Adjust it with the Select tool, then press Enter to place it.`)
}

// ---------------------------------------------------------------------------------------------
// Reference image

export async function loadReference(): Promise<void> {
  const file = await api.openFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }])
  if (!file) return
  const url = URL.createObjectURL(new Blob([file.data.slice()]))
  const img = new Image()
  img.src = url
  await img.decode()
  const f = getFrame()
  const prev = state.reference
  if (prev) URL.revokeObjectURL(prev.url)
  setState({
    reference: {
      url,
      name: file.name,
      width: img.naturalWidth,
      height: img.naturalHeight,
      x: f?.width ? f.offsetX : -Math.round(img.naturalWidth / 2),
      y: f?.height ? f.offsetY : -img.naturalHeight,
      scale: 1,
      opacity: 0.5,
      above: false,
      visible: true,
      moving: false
    },
    version: state.version + 1
  })
}

export function updateReference(patch: Partial<Reference>): void {
  if (!state.reference) return
  setState({ reference: { ...state.reference, ...patch }, version: state.version + 1 })
}

export function removeReference(): void {
  if (state.reference) URL.revokeObjectURL(state.reference.url)
  setState({ reference: null, version: state.version + 1 })
}

export function resetBaseline(dir = state.dir, frame = state.frame): void {
  state.baselines.delete(frameKey(dir, frame))
  setState({ version: state.version + 1 })
}

export function revertActive(): void {
  const d = state.doc
  if (!d || !window.confirm('Revert all edits on this sprite/layer to the original game file?')) return
  if (d.kind === 'item') {
    d.sprite = cloneSprite(d.original)
    d.dirty = false
  } else {
    const l = d.layers.find((x) => x.composit === d.active)
    if (l?.original) {
      l.sprite = cloneSprite(l.original)
      l.dirty = false
    }
  }
  setState({ doc: { ...d }, undo: [], redo: [], baselines: new Map(), version: state.version + 1 })
}

export function framesPerDir(): number {
  const d = state.doc
  if (!d) return 1
  if (d.kind === 'item') return d.sprite.framesPerDir
  return d.cof.framesPerDir
}

export function directions(): number {
  const d = state.doc
  if (!d) return 1
  if (d.kind === 'item') return d.sprite.directions
  return d.cof.directions
}

export function stepFrame(delta: number): void {
  const n = framesPerDir()
  setState({ frame: (state.frame + delta + n) % n })
}

/** Layer inputs for compositing the current animation doc. */
export function layerInputs(ghostActive = false): Map<number, LayerInput> {
  const m = new Map<number, LayerInput>()
  const d = state.doc
  if (d?.kind !== 'anim') return m
  for (const l of d.layers)
    m.set(l.composit, {
      sprite: l.sprite,
      visible: l.visible,
      alpha: ghostActive && l.composit !== d.active ? state.view.ghostAlpha : 1
    })
  return m
}
