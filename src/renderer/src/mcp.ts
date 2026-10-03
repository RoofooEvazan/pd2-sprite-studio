// Runs the tools AI assistants call over MCP (see core/mcpTools.ts) against the live app state.
// Every edit goes through the same store functions as the UI, so it is visible, undoable and exportable.

import * as THREE from 'three'
import { api } from './api'
import {
  activeSprite,
  applyToScope,
  commitFrame,
  commitFrames,
  directions,
  frameKey,
  framesPerDir,
  getFrame,
  getState,
  goTo,
  layerInputs,
  openAnim,
  openItem,
  originalFrame,
  palette,
  redo,
  resetBaseline,
  Scope,
  Screen,
  setExportArmtype,
  setLayerSource,
  setState,
  toast,
  undo,
  updateDoc,
  AnimDoc,
  ItemDoc
} from './store'
import { COMPOSITS } from '../../core/cof'
import { compositeFrame, frameToRgba, LayerInput, newRgba, Rgba, sheet } from '../../core/composite'
import { cloneFrame, expandFrame, Frame, trimFrame } from '../../core/sprite'
import { floodFill, line, rect } from '../../core/draw'
import { addOutline, applyMap, cleanStrays, darkenEdges, hsvShiftMap, rampSwapMap } from '../../core/edit'
import { hexToRgb, nearestIndices, shadeRamp } from '../../core/color'
import { nearestIndex, PALETTE_NAMES, paletteToHex } from '../../core/palette'
import { EditTransfer, TransferMode } from '../../core/propagate'
import { encodeDc6 } from '../../core/dc6'
import { bestCellAnchor, encodeDcc } from '../../core/dcc'
import { dccPath } from '../../core/catalog'
import { encodeDs1 } from '../../core/ds1'
import { encodeDt1 } from '../../core/dt1'
import { indexTiles, renderMap } from '../../core/mapRender'
import { PaletteLut } from '../../core/renderImport'
import { sliceScene, SliceResult, TileKind } from '../../core/tileSlicer'
import { decodeImage, encodeGif, rgbaToBytes, scaleRgba, withBackground } from './imageExport'
import { tileStudio, TileRole } from './studio/tiles'

type Args = Record<string, unknown>
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface ToolResult {
  content: Content[]
  isError?: boolean
}

class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg)
}

// ------------------------------------------------------------------ argument helpers

const optInt = (a: Args, k: string): number | undefined => {
  const v = a[k]
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) fail(`${k} must be a number`)
  return Math.round(n)
}
const optNum = (a: Args, k: string): number | undefined => {
  const v = a[k]
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) fail(`${k} must be a number`)
  return n
}
const optStr = (a: Args, k: string): string | undefined => (a[k] === undefined || a[k] === null ? undefined : String(a[k]))
const index = (a: Args, k: string): number => {
  const v = optInt(a, k)
  if (v === undefined || v < 0 || v > 255) fail(`${k} must be a palette index 0-255`)
  return v!
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const BG: [number, number, number] = [58, 58, 64]

/** PNG image content, upscaled with hard pixels (sprites) or downscaled to fit (big maps). */
async function image(im: Rgba, scale = 1, bg: [number, number, number] | null = BG, maxSide = 1600): Promise<Content> {
  let out = scale > 1 ? scaleRgba(im, scale) : im
  if (bg) out = withBackground(out, { kind: 'color', rgb: bg })
  if (Math.max(out.width, out.height) > maxSide) {
    const k = maxSide / Math.max(out.width, out.height)
    const src = document.createElement('canvas')
    src.width = out.width
    src.height = out.height
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0)
    const dst = document.createElement('canvas')
    dst.width = Math.max(1, Math.round(out.width * k))
    dst.height = Math.max(1, Math.round(out.height * k))
    const ctx = dst.getContext('2d')!
    ctx.drawImage(src, 0, 0, dst.width, dst.height)
    const id = ctx.getImageData(0, 0, dst.width, dst.height)
    out = { x0: 0, y0: 0, width: dst.width, height: dst.height, data: id.data }
  }
  return { type: 'image', data: b64(await rgbaToBytes(out, 'image/png')), mimeType: 'image/png' }
}
const text = (t: string): Content => ({ type: 'text', text: t })

// ------------------------------------------------------------------ document helpers

function needDoc(): AnimDoc | ItemDoc {
  const d = getState().doc
  if (!d) fail('No sprite is open. Use search_sprites, then open_item or open_animation.')
  if (getState().screen !== 'editor') goTo('editor')
  return getState().doc!
}

function needAnim(): AnimDoc {
  const d = needDoc()
  if (d.kind !== 'anim') fail('This works on animations only; the open sprite is an item graphic.')
  return d as AnimDoc
}

function isDirty(): boolean {
  const d = getState().doc
  return !!d && (d.kind === 'item' ? d.dirty : d.layers.some((l) => l.dirty))
}

/** Move the editor to the requested direction/frame (so the user sees what the AI works on). */
function target(a: Args): { dir: number; frame: number } {
  needDoc()
  const nD = directions()
  const nF = framesPerDir()
  const s = getState()
  const dir = optInt(a, 'direction') ?? s.dir
  const frame = optInt(a, 'frame') ?? s.frame
  if (dir < 0 || dir >= nD) fail(`direction must be 0-${nD - 1}`)
  if (frame < 0 || frame >= nF) fail(`frame must be 0-${nF - 1}`)
  if (dir !== s.dir || frame !== s.frame) setState({ dir, frame, playing: false })
  return { dir, frame }
}

function scopeOf(a: Args): Scope {
  const s = optStr(a, 'scope') ?? 'frame'
  return s === 'all' ? 'all' : s === 'direction' ? 'dir' : 'frame'
}

/** Run a frame transform over the requested scope as one undo step. */
function applyScoped(a: Args, fn: (f: Frame) => Frame | null): number {
  const prev = getState().scope
  setState({ scope: scopeOf(a) })
  try {
    return applyToScope((f) => fn(f))
  } finally {
    setState({ scope: prev })
  }
}

function boundsText(f: Frame | null): string {
  if (!f || !f.width || !f.height) return 'The frame is empty.'
  return `Frame bounds (sprite space): x ${f.offsetX}..${f.offsetX + f.width - 1}, y ${f.offsetY}..${f.offsetY + f.height - 1} (${f.width}×${f.height}).`
}

function layerName(c: number): string {
  return COMPOSITS[c] ?? String(c)
}

function compositeOf(d: AnimDoc, dir: number, frame: number, original = false): Rgba {
  const layers: Map<number, LayerInput> = original ? new Map(d.layers.map((l) => [l.composit, { sprite: l.original, visible: l.visible }])) : layerInputs()
  return compositeFrame(d.cof, layers, palette(), dir, frame)
}

function layerImage(f: Frame | null): Rgba {
  return f && f.width ? frameToRgba(f, palette()) : newRgba(0, 0, 1, 1)
}

function autoScale(im: Rgba, max = 8): number {
  return Math.max(1, Math.min(max, Math.floor(400 / Math.max(im.width, im.height, 1))))
}

function docSummary(): string {
  const s = getState()
  const d = s.doc
  if (!d) return 'No sprite open.'
  const lines: string[] = []
  if (d.kind === 'item') {
    const f = d.sprite.frames[0]?.[0]
    lines.push(`Item graphic "${d.title}" (${d.path}), ${f?.width}×${f?.height}, ${d.sprite.directions} direction(s) × ${d.sprite.framesPerDir} frame(s).${d.dirty ? ' Has unsaved edits.' : ''}`)
  } else {
    lines.push(`Animation "${d.title}": unit ${d.unit.token} (${d.unit.base}), mode ${d.mode}, weapon class ${d.wclass}, ${d.cof.directions} directions × ${d.cof.framesPerDir} frames, ${d.fps.toFixed(1)} fps.`)
    lines.push(`Editing part: ${layerName(d.active)}. Parts:`)
    for (const l of d.layers)
      lines.push(
        `  ${layerName(l.composit)} style ${l.armtype || '—'}${l.missing ? ' (no graphic)' : ''}${l.visible ? '' : ' (hidden)'}${l.dirty ? ' (edited)' : ''}; styles available: ${(d.unit.armtypes[layerName(l.composit)] ?? []).join(', ') || 'none'}`
      )
  }
  lines.push(`Showing direction ${s.dir}, frame ${s.frame}. Palette ${s.paletteName}. Undo steps: ${s.undo.length}.`)
  return lines.join('\n')
}

// ------------------------------------------------------------------ tile maker state

let lastSplit: { res: SliceResult; folder: string; name: string } | null = null

function tilesScreen(): void {
  if (getState().screen !== 'tiles') goTo('tiles')
}

function partsList(): string {
  const parts = tileStudio.parts()
  if (!parts.length) return 'The scene is empty.'
  const f = (n: number) => (Math.round(n * 100) / 100).toString()
  return parts
    .map((p, i) => {
      const b = new THREE.Box3().setFromObject(p.mesh)
      const auto = p.mesh.userData.d2roleAuto ? ' (auto)' : ''
      return `#${i} ${p.label} [${p.owner.name}] role=${p.role}${auto}; x ${f(b.min.x)}..${f(b.max.x)}, y ${f(b.min.y)}..${f(b.max.y)}, z ${f(b.min.z)}..${f(b.max.z)}`
    })
    .join('\n')
}

function tileSettingsText(): string {
  const t = tileStudio.tile
  return `Map ${t.mapW}×${t.mapH} tiles, act ${t.act}, name "${t.name}", start index ${t.mainIndex}, lighting ${tileStudio.settings.lighting}, dithering ${t.dither ? 'on' : 'off'}, colour by role ${tileStudio.roleColours ? 'on' : 'off'}.`
}

const tileFolder = () => `data\\global\\tiles\\act${tileStudio.tile.act}\\${tileStudio.tile.name}`
const tileFileName = (kind: TileKind | 'all') => `${tileStudio.tile.name.toLowerCase()}${kind === 'all' ? '' : `_${kind}`}.dt1`

// ------------------------------------------------------------------ tools

const tools: Record<string, (a: Args) => Promise<Content[]> | Content[]> = {
  get_state: () => {
    const s = getState()
    const out = [
      `Screen: ${s.screen}. Game archives: ${s.status?.loaded.length ?? 0} loaded${s.catalog ? '' : ' (still indexing)'}. Export folder: ${s.status?.exportRoot ?? '?'}.`,
      docSummary(),
      `Tile Maker: ${tileStudio.parts().length} part(s). ${tileSettingsText()}`
    ]
    return [text(out.join('\n'))]
  },

  go_to_screen: (a) => {
    const screen = optStr(a, 'screen') as Screen
    if (screen === 'editor' && !getState().doc) fail('Nothing is open for the editor yet.')
    goTo(screen)
    return [text(`Now on ${screen}.`)]
  },

  search_sprites: (a) => {
    const cat = getState().catalog ?? fail('The sprite database is still loading (or the game folders are not set).')
    const words = (optStr(a, 'query') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const kind = optStr(a, 'kind') ?? 'any'
    const limit = Math.min(100, optInt(a, 'limit') ?? 20)
    const match = (hay: string) => words.every((w) => hay.includes(w))
    const out: string[] = []
    if (kind !== 'items') {
      const units = cat!.units.filter((u) => match(`${u.label} ${u.token} ${u.base}`.toLowerCase())).slice(0, limit)
      if (units.length) out.push('Units (open with open_animation token + mode + weapon_class):')
      for (const u of units) {
        const modes = Object.entries(u.modes)
          .map(([m, w]) => `${m}[${w.join(',')}]`)
          .join(' ')
        out.push(`  ${u.token} (${u.base}) "${u.label}": ${modes.length > 300 ? modes.slice(0, 300) + '…' : modes}`)
      }
    }
    if (kind !== 'units') {
      const items = cat!.items.filter((i) => match(`${i.name} ${i.code} ${i.invfile} ${i.kind}`.toLowerCase())).slice(0, limit)
      if (items.length) out.push('Items (open with open_item path or code):')
      for (const i of items) out.push(`  "${i.name}" code ${i.code} (${i.kind}) ${i.path}`)
    }
    return [text(out.length ? out.join('\n') : 'No matches.')]
  },

  open_item: async (a) => {
    const cat = getState().catalog ?? fail('The sprite database is still loading.')
    if (isDirty() && !a.discard_changes) fail('The open sprite has unsaved edits. Export them first (export_pd2) or pass discard_changes: true.')
    const code = optStr(a, 'code')?.toLowerCase()
    let path = optStr(a, 'path')
    const item = cat!.items.find((i) => (path && i.path.toLowerCase() === path.toLowerCase()) || (code && i.code.toLowerCase() === code)) ?? null
    path = path ?? item?.path ?? fail('Give a path or a known item code.')
    const d = getState().doc
    if (d) d.kind === 'item' ? (d.dirty = false) : d.layers.forEach((l) => (l.dirty = false))
    await openItem(item, path!)
    if (getState().doc?.kind !== 'item' || (getState().doc as ItemDoc).path !== path) fail(`Could not open ${path}.`)
    const f = getFrame(0, 0)
    return [text(docSummary() + '\n' + boundsText(f)), await image(layerImage(f), autoScale(layerImage(f)))]
  },

  open_animation: async (a) => {
    const cat = getState().catalog ?? fail('The sprite database is still loading.')
    if (isDirty() && !a.discard_changes) fail('The open sprite has unsaved edits. Export them first (export_pd2) or pass discard_changes: true.')
    const token = (optStr(a, 'token') ?? '').toUpperCase()
    const base = optStr(a, 'base')
    const unit = cat!.units.find((u) => u.token.toUpperCase() === token && (!base || u.base === base)) ?? fail(`No unit with token ${token}. Use search_sprites.`)
    const mode = (optStr(a, 'mode') ?? 'NU').toUpperCase()
    const classes = unit!.modes[mode] ?? fail(`${unit!.token} has no ${mode} animation. Modes: ${Object.keys(unit!.modes).join(', ')}`)
    const wc = (optStr(a, 'weapon_class') ?? (classes!.includes('HTH') ? 'HTH' : classes![0])).toUpperCase()
    if (!classes!.includes(wc)) fail(`${unit!.token} ${mode} weapon classes: ${classes!.join(', ')}`)
    const d = getState().doc
    if (d) d.kind === 'item' ? (d.dirty = false) : d.layers.forEach((l) => (l.dirty = false))
    await openAnim(unit!, mode, wc)
    const doc = getState().doc
    if (doc?.kind !== 'anim' || doc.unit !== unit) fail('Could not open that animation.')
    const im = compositeOf(doc as AnimDoc, 0, 0)
    return [text(docSummary()), await image(im, autoScale(im))]
  },

  set_layer: async (a) => {
    const d = needAnim()
    const code = (optStr(a, 'part') ?? '').toUpperCase()
    const composit = COMPOSITS.indexOf(code as never)
    const layer = d.layers.find((l) => l.composit === composit) ?? fail(`This animation has no ${code} part. Parts: ${d.layers.map((l) => layerName(l.composit)).join(', ')}`)
    const style = optStr(a, 'style')?.toUpperCase()
    if (style) {
      const avail = d.unit.armtypes[code] ?? []
      if (!avail.includes(style)) fail(`${code} styles available: ${avail.join(', ')}`)
      layer!.dirty = false
      await setLayerSource(composit, { base: d.unit.base, token: d.unit.token }, style)
    }
    const saveAs = optStr(a, 'save_as_style')
    if (saveAs) {
      if (!/^[A-Za-z0-9]{1,3}$/.test(saveAs)) fail('Style codes are 1-3 letters or digits.')
      setExportArmtype(composit, saveAs)
    }
    const cur = getState().doc as AnimDoc
    const l = cur.layers.find((x) => x.composit === composit)!
    if (typeof a.visible === 'boolean') l.visible = a.visible
    updateDoc({ active: composit })
    return [text(docSummary())]
  },

  view_frame: async (a) => {
    const d = needDoc()
    const { dir, frame } = target(a)
    const original = !!a.original
    const what = optStr(a, 'what') ?? 'layer'
    const f = original ? originalFrame(dir, frame) : getFrame(dir, frame)
    const im = what === 'composite' && d.kind === 'anim' ? compositeOf(d, dir, frame, original) : layerImage(f)
    const scale = Math.max(1, Math.min(8, optInt(a, 'scale') ?? autoScale(im)))
    const info = `Direction ${dir}/${directions()}, frame ${frame}/${framesPerDir()}${d.kind === 'anim' ? `, part ${layerName(d.active)}` : ''}${original ? ' (original)' : ''}. ${boundsText(f)} Image: ${scale}× scale; its top-left pixel is sprite (${im.x0}, ${im.y0}). Grey = transparent.`
    return [text(info), await image(im, scale)]
  },

  view_sheet: async (a) => {
    const d = needDoc()
    const { dir, frame } = target(a)
    const layout = optStr(a, 'layout') ?? 'direction_frames'
    const what = optStr(a, 'what') ?? 'composite'
    const scale = Math.max(1, Math.min(4, optInt(a, 'scale') ?? 2))
    const pic = (dd: number, ff: number) =>
      what === 'composite' && d.kind === 'anim' ? compositeOf(d, dd, ff) : layerImage(activeSprite()?.frames[dd]?.[ff] ?? null)
    const cells = layout === 'all_directions' ? Array.from({ length: directions() }, (_, i) => ({ d: i, f: frame })) : Array.from({ length: framesPerDir() }, (_, i) => ({ d: dir, f: i }))
    const perRow = 8
    const rows: Rgba[][] = []
    for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow).map((c) => pic(c.d, c.f)))
    const im = sheet(rows, 6, [BG[0], BG[1], BG[2], 255])
    const label = layout === 'all_directions' ? `Frame ${frame} of directions 0-${directions() - 1}` : `Frames 0-${framesPerDir() - 1} of direction ${dir}`
    return [text(`${label}, left to right, ${perRow} per row, ${scale}× scale.`), await image(im, scale, null)]
  },

  read_pixels: (a) => {
    needDoc()
    const { dir, frame } = target(a)
    const f = getFrame(dir, frame)
    if (!f || !f.width) return [text('The frame is empty.')]
    const x0 = optInt(a, 'x') ?? f.offsetX
    const y0 = optInt(a, 'y') ?? f.offsetY
    const w = Math.min(96, optInt(a, 'width') ?? f.width)
    const h = Math.min(96, optInt(a, 'height') ?? f.height)
    const lines = [`${boundsText(f)} Region x ${x0}..${x0 + w - 1}, y ${y0}..${y0 + h - 1}. Each line: y, then palette indices left to right ("." = transparent).`]
    for (let y = y0; y < y0 + h; y++) {
      const row: string[] = []
      for (let x = x0; x < x0 + w; x++) {
        const lx = x - f.offsetX
        const ly = y - f.offsetY
        const v = lx >= 0 && ly >= 0 && lx < f.width && ly < f.height ? f.pixels[ly * f.width + lx] : 0
        row.push(v ? String(v) : '.')
      }
      lines.push(`${y}: ${row.join(' ')}`)
    }
    return [text(lines.join('\n'))]
  },

  palette: (a) => {
    const name = optStr(a, 'name')?.toUpperCase()
    if (name) {
      if (!getState().palettes[name]) fail(`Palettes: ${PALETTE_NAMES.filter((n) => getState().palettes[n]).join(', ')}`)
      setState({ paletteName: name, version: getState().version + 1 })
    }
    const p = palette()
    const hex = optStr(a, 'near_hex')
    const idx = optInt(a, 'index')
    if (hex) {
      const rgb = hexToRgb(hex) ?? fail('near_hex must look like #a03020')
      return [text(`Closest in ${getState().paletteName}: ` + nearestIndices(p, rgb!, 8).map((n) => `${n.index} ${paletteToHex(p, n.index)} (ΔE ${n.dist.toFixed(1)})`).join(', '))]
    }
    if (idx !== undefined) {
      const ramp = shadeRamp(p, idx)
      return [text(`Shades of ${idx} ${paletteToHex(p, idx)}, light to dark: ` + ramp.map((i) => `${i} ${paletteToHex(p, i)}`).join(', '))]
    }
    const rows: string[] = []
    for (let i = 0; i < 256; i += 8)
      rows.push(
        Array.from({ length: 8 }, (_, k) => `${i + k}:${paletteToHex(p, i + k)}`)
          .join(' ')
      )
    return [text(`Palette ${getState().paletteName} (index 0 = transparent):\n${rows.join('\n')}`)]
  },

  draw_pixels: async (a) => {
    const d = needDoc()
    const { dir, frame } = target(a)
    const cur = getFrame(dir, frame) ?? fail('No frame there.')
    const list = (Array.isArray(a.pixels) ? a.pixels : fail('pixels must be a list of [x, y, index]')) as unknown[]
    const pts = list.map((p) => {
      if (!Array.isArray(p) || p.length !== 3) fail('Each pixel is [x, y, index]')
      const [x, y, c] = (p as unknown[]).map(Number)
      if (![x, y, c].every(Number.isFinite) || c < 0 || c > 255) fail('Each pixel is [x, y, index 0-255]')
      return { x: Math.round(x), y: Math.round(y), c: Math.round(c) }
    })
    let f = cloneFrame(cur!)
    if (d.kind === 'anim') {
      const add = pts.filter((p) => p.c)
      if (add.length) {
        const xs = add.map((p) => p.x)
        const ys = add.map((p) => p.y)
        const x0 = Math.min(...xs, cur!.width ? cur!.offsetX : Infinity)
        const y0 = Math.min(...ys, cur!.height ? cur!.offsetY : Infinity)
        const x1 = Math.max(...xs.map((x) => x + 1), cur!.width ? cur!.offsetX + cur!.width : -Infinity)
        const y1 = Math.max(...ys.map((y) => y + 1), cur!.height ? cur!.offsetY + cur!.height : -Infinity)
        f = expandFrame(cur!, x0, y0, x1, y1)
      }
    }
    let clipped = 0
    for (const p of pts) {
      const lx = p.x - f.offsetX
      const ly = p.y - f.offsetY
      if (lx < 0 || ly < 0 || lx >= f.width || ly >= f.height) {
        clipped++
        continue
      }
      f.pixels[ly * f.width + lx] = p.c
    }
    if (d.kind === 'anim') f = trimFrame(f)
    if (pts.length > clipped) commitFrame(dir, frame, cloneFrame(cur!), f)
    return [text(`Set ${pts.length - clipped} pixel(s) on direction ${dir} frame ${frame}${clipped ? `; ${clipped} fell outside the item's frame and were skipped` : ''}. ${boundsText(f)}`)]
  },

  draw_shape: (a) => {
    const d = needDoc()
    const { dir, frame } = target(a)
    const cur = getFrame(dir, frame) ?? fail('No frame there.')
    const shape = optStr(a, 'shape')
    const c = index(a, 'index')
    const x0 = optInt(a, 'x0') ?? fail('x0 is required')
    const y0 = optInt(a, 'y0') ?? fail('y0 is required')
    const x1 = optInt(a, 'x1') ?? x0
    const y1 = optInt(a, 'y1') ?? y0
    const size = Math.max(1, Math.min(8, optInt(a, 'size') ?? 1))
    let f = cloneFrame(cur!)
    if (d.kind === 'anim' && c && (shape === 'line' || shape === 'rect' || shape === 'filled_rect')) {
      const r = Math.ceil(size / 2)
      f = expandFrame(
        cur!,
        Math.min(x0!, x1, cur!.width ? cur!.offsetX : Infinity) - r,
        Math.min(y0!, y1, cur!.height ? cur!.offsetY : Infinity) - r,
        Math.max(x0!, x1, cur!.width ? cur!.offsetX + cur!.width - 1 : -Infinity) + r + 1,
        Math.max(y0!, y1, cur!.height ? cur!.offsetY + cur!.height - 1 : -Infinity) + r + 1
      )
    }
    const L = (x: number, y: number) => [x - f.offsetX, y - f.offsetY] as const
    const [a0, b0] = L(x0!, y0!)
    const [a1, b1] = L(x1, y1)
    if (shape === 'line') line(f, a0, b0, a1, b1, c, size)
    else if (shape === 'rect' || shape === 'filled_rect') rect(f, a0, b0, a1, b1, c, shape === 'filled_rect')
    else if (shape === 'fill' || shape === 'fill_all_matching') {
      if (a0 < 0 || b0 < 0 || a0 >= f.width || b0 >= f.height) fail(`(${x0}, ${y0}) is outside the frame. ${boundsText(cur!)}`)
      floodFill(f, a0, b0, c, shape === 'fill')
    } else fail('shape must be line, rect, filled_rect, fill or fill_all_matching')
    if (d.kind === 'anim') f = trimFrame(f)
    commitFrame(dir, frame, cloneFrame(cur!), f)
    return [text(`Drew ${shape} with index ${c}. ${boundsText(f)}`)]
  },

  replace_color: (a) => {
    needDoc()
    const from = index(a, 'from')
    const to = index(a, 'to')
    const n = applyScoped(a, (f) => applyMap(f, new Map([[from, to]])))
    return [text(`Replaced ${from} → ${to} on ${n} frame(s).`)]
  },

  recolor_material: (a) => {
    needDoc()
    const map = rampSwapMap(palette(), index(a, 'from_index'), index(a, 'to_index'))
    const n = applyScoped(a, (f) => applyMap(f, map))
    const pairs = [...map].map(([s, t]) => `${s}→${t}`).join(', ')
    return [text(`Recoloured the material on ${n} frame(s). Mapping: ${pairs}`)]
  },

  hsv_shift: (a) => {
    needDoc()
    const idx = ((Array.isArray(a.indices) ? a.indices : fail('indices must be a list')) as unknown[]).map(Number).filter((n) => n > 0 && n < 256)
    const map = hsvShiftMap(palette(), idx, optNum(a, 'hue') ?? 0, optNum(a, 'saturation') ?? 1, optNum(a, 'value') ?? 0)
    const n = applyScoped(a, (f) => applyMap(f, map))
    return [text(`Shifted ${map.size} colour(s) on ${n} frame(s): ${[...map].map(([s, t]) => `${s}→${t}`).join(', ')}`)]
  },

  outline: (a) => {
    const d = needDoc()
    const action = optStr(a, 'action')
    const p = palette()
    const idx = optInt(a, 'index')
    let n = 0
    if (action === 'outline') n = applyScoped(a, (f) => addOutline(f, p, idx ? { kind: 'fixed', index: idx } : { kind: 'auto' }, false, undefined, d.kind === 'anim'))
    else if (action === 'darken_edges') n = applyScoped(a, (f) => darkenEdges(f, p, 1))
    else if (action === 'remove_strays') n = applyScoped(a, (f) => cleanStrays(f).frame)
    else fail('action must be outline, darken_edges or remove_strays')
    return [text(`${action} changed ${n} frame(s).`)]
  },

  transfer_edits: async (a) => {
    needDoc()
    const { dir, frame } = target(a)
    const s = getState()
    const baseline = s.baselines.get(frameKey(dir, frame)) ?? fail(`Direction ${dir} frame ${frame} has no edits to carry over yet (edit it first; each transfer starts a new baseline).`)
    const current = getFrame(dir, frame)!
    const sp = activeSprite()!
    const probe = new EditTransfer(baseline!, current, { mode: 'track' })
    if (!probe.changes.length) fail('That frame has no changes compared with before it was edited.')
    const asked = optStr(a, 'mode') ?? 'auto'
    const mode: TransferMode = asked === 'auto' ? probe.suggestedMode() : (asked as TransferMode)
    const to = optStr(a, 'to') ?? 'direction'
    const n = sp.framesPerDir
    const targets: { dir: number; frame: number }[] = []
    const dirs = to === 'all_directions' ? Array.from({ length: sp.directions }, (_, i) => i) : [dir]
    for (const dd of dirs) {
      if (dd !== dir) for (let f = 0; f < n; f++) targets.push({ dir: dd, frame: f })
      else for (let k = 1; k <= (to === 'following' ? n - frame - 1 : n - 1); k++) targets.push({ dir: dd, frame: (frame + k) % n })
    }
    const list: { dir: number; frame: number; before: Frame; after: Frame }[] = []
    let transfer: EditTransfer | null = null
    let lastDir = -1
    let lowConf = 0
    for (const t of targets) {
      if (!transfer || t.dir !== lastDir) transfer = new EditTransfer(baseline!, current, { mode, search: 8, minConfidence: 0.2 })
      lastDir = t.dir
      const tf = sp.frames[t.dir][t.frame]
      const r = transfer.apply(tf)
      if (r.applied > 0 && (mode !== 'track' || r.confidence >= 0.2)) list.push({ ...t, before: cloneFrame(tf), after: r.frame })
      else if (r.applied > 0) lowConf++
    }
    commitFrames(list)
    resetBaseline(dir, frame)
    const pics = list.slice(0, 16).map((e) => layerImage(e.after))
    const rows: Rgba[][] = []
    for (let i = 0; i < pics.length; i += 8) rows.push(pics.slice(i, i + 8))
    const out: Content[] = [
      text(
        `Mode ${mode}: changed ${list.length} of ${targets.length} frame(s) as one undo step${lowConf ? `; ${lowConf} frame(s) skipped for low tracking confidence` : ''}. ${list.length ? `Changed frames: ${list.map((e) => `d${e.dir}f${e.frame}`).join(' ')}` : ''}`
      )
    ]
    if (rows.length) out.push(await image(sheet(rows, 6, [BG[0], BG[1], BG[2], 255]), 2, null))
    return out
  },

  import_image: async (a) => {
    const d = needDoc()
    const { dir, frame } = target(a)
    const cur = getFrame(dir, frame) ?? fail('No frame there.')
    const file = await api.mcpReadFile(optStr(a, 'path') ?? fail('path is required'), 'image')
    const img = await decodeImage(file.data)
    const pal = palette()
    const cache = new Map<number, number>()
    const px = new Uint8Array(img.width * img.height)
    for (let i = 0; i < px.length; i++) px[i] = img.data[i * 4 + 3] < 128 ? 0 : nearestIndex(pal, img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], cache)
    const x = optInt(a, 'x') ?? (cur!.width ? cur!.offsetX : -Math.round(img.width / 2))
    const y = optInt(a, 'y') ?? (cur!.height ? cur!.offsetY : -img.height)
    const pic: Frame = { width: img.width, height: img.height, offsetX: x, offsetY: y, pixels: px }
    let f: Frame
    if ((optStr(a, 'blend') ?? 'over') === 'replace') f = d.kind === 'item' ? { ...pic, offsetX: cur!.offsetX, offsetY: cur!.offsetY } : pic
    else {
      f = d.kind === 'anim' ? expandFrame(cur!, Math.min(x, cur!.width ? cur!.offsetX : x), Math.min(y, cur!.height ? cur!.offsetY : y), Math.max(x + img.width, cur!.offsetX + cur!.width), Math.max(y + img.height, cur!.offsetY + cur!.height)) : cloneFrame(cur!)
      for (let yy = 0; yy < img.height; yy++)
        for (let xx = 0; xx < img.width; xx++) {
          const v = px[yy * img.width + xx]
          const lx = x + xx - f.offsetX
          const ly = y + yy - f.offsetY
          if (v && lx >= 0 && ly >= 0 && lx < f.width && ly < f.height) f.pixels[ly * f.width + lx] = v
        }
    }
    if (d.kind === 'anim') f = trimFrame(f)
    commitFrame(dir, frame, cloneFrame(cur!), f)
    return [text(`Imported ${file.name} (${img.width}×${img.height}) at (${x}, ${y}). ${boundsText(f)}`), await image(layerImage(f), autoScale(layerImage(f)))]
  },

  undo: (a) => {
    const n = Math.max(1, Math.min(50, optInt(a, 'steps') ?? 1))
    for (let i = 0; i < n; i++) undo()
    return [text(`Undid ${n} step(s). ${getState().undo.length} left.`)]
  },

  redo: (a) => {
    const n = Math.max(1, Math.min(50, optInt(a, 'steps') ?? 1))
    for (let i = 0; i < n; i++) redo()
    return [text(`Redid ${n} step(s).`)]
  },

  export_pd2: async (a) => {
    const d = needDoc()
    let files: { rel: string; data: Uint8Array }[] = []
    let violations = 0
    if (d.kind === 'item') files = [{ rel: d.path, data: encodeDc6(d.sprite, d.meta) }]
    else {
      for (const l of d.layers) {
        if (!l.sprite || (!l.dirty && !a.all_parts)) continue
        for (const dd of l.sprite.frames) violations += bestCellAnchor(dd).violations
        files.push({
          rel: dccPath({ base: d.unit.base, token: d.unit.token }, COMPOSITS[l.composit], l.armtype, d.mode, l.weaponClass),
          data: encodeDcc(l.sprite, { palette: palette(), frameMeta: l.frameMeta ?? undefined })
        })
      }
      if (a.include_cof) {
        const cof = await api.read(d.cofPath)
        if (cof) files.push({ rel: d.cofPath, data: cof.data })
      }
    }
    if (!files.length) fail('Nothing edited to export (pass all_parts: true to write every part).')
    const res = await api.exportPd2(files)
    if (d.kind === 'item') d.dirty = false
    else for (const l of d.layers) l.dirty = false
    setState({ version: getState().version + 1 })
    toast(`AI assistant saved ${res.written.length} file(s) to ${res.root}`)
    return [text(`Wrote ${res.written.length} file(s):\n${res.written.join('\n')}${violations ? `\n${violations} 4×4 area(s) used more than 4 colours (a DCC limit) and were simplified.` : ''}`)]
  },

  export_image: async (a) => {
    const d = needDoc()
    const { dir, frame } = target(a)
    const fmt = optStr(a, 'format')
    const scale = Math.max(1, Math.min(8, optInt(a, 'scale') ?? 1))
    const name = (optStr(a, 'name') ?? `${d.kind === 'anim' ? `${d.unit.token}_${d.mode}_${d.wclass}` : d.title}_d${dir}`).replace(/[^\w.-]+/g, '_')
    const pic = (ff: number) => (d.kind === 'anim' ? compositeOf(d, dir, ff) : layerImage(getFrame(dir, ff)))
    let bytes: Uint8Array
    let ext: string
    if (fmt === 'png') [bytes, ext] = [await rgbaToBytes(scaleRgba(pic(frame), scale), 'image/png'), 'png']
    else if (fmt === 'sheet') [bytes, ext] = [await rgbaToBytes(scaleRgba(sheet([Array.from({ length: framesPerDir() }, (_, i) => pic(i))], 4), scale), 'image/png'), 'png']
    else if (fmt === 'gif') {
      if (d.kind !== 'anim') fail('GIFs are for animations.')
      ;[bytes, ext] = [encodeGif(Array.from({ length: framesPerDir() }, (_, i) => scaleRgba(pic(i), scale)), (d as AnimDoc).fps, { kind: 'transparent' }), 'gif']
    } else fail('format must be png, sheet or gif')
    const res = await api.exportPd2([{ rel: `mcp-output\\${name}.${ext!}`, data: bytes! }])
    return [text(`Saved ${res.written[0]}`)]
  },

  // ---------------------------------------------------------------- tile maker

  tiles_add_block: (a) => {
    tilesScreen()
    const vec = (k: string) => {
      const v = a[k]
      if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isFinite(Number(n)))) fail(`${k} must be [x, y, z]`)
      return (v as unknown[]).map(Number)
    }
    const role = optStr(a, 'role') as TileRole | undefined
    if (role && !['floor', 'wall', 'lower', 'roof', 'ignore'].includes(role)) fail('role must be floor, wall, lower, roof or ignore')
    const shape = (optStr(a, 'shape') ?? 'box') as 'box'
    if (!['box', 'cylinder', 'cone', 'sphere', 'ramp'].includes(shape)) fail('shape must be box, cylinder, cone, sphere or ramp')
    const color = optStr(a, 'color')
    if (color && !hexToRgb(color)) fail('color must look like #8a7f6a')
    const mesh = tileStudio.addBlock({ shape, position: vec('position'), size: vec('size'), color, role, name: optStr(a, 'name'), rotationY: optNum(a, 'rotation_y') })
    // Grow the map to include the scene
    const box = tileStudio.sceneBox()
    const t = tileStudio.tile
    if (box.max.x > t.mapW + 1e-3 || box.max.z > t.mapH + 1e-3) tileStudio.setTile({ mapW: Math.max(t.mapW, Math.ceil(box.max.x - 1e-3)), mapH: Math.max(t.mapH, Math.ceil(box.max.z - 1e-3)) })
    const warn = box.min.x < -1e-3 || box.min.z < -1e-3 ? ' Warning: part of the scene is at negative X/Z, outside the map (the map starts at 0,0).' : ''
    return [text(`Added "${mesh.name}" as ${mesh.userData.d2role}${mesh.userData.d2roleAuto ? ' (guessed)' : ''}. ${tileStudio.parts().length} part(s); ${tileSettingsText()}${warn}`)]
  },

  tiles_import_model: async (a) => {
    tilesScreen()
    const file = await api.mcpReadFile(optStr(a, 'path') ?? fail('path is required'), 'model')
    const o = await tileStudio.loadModel(file, { normalize: false })
    const u = optNum(a, 'units_per_tile')
    if (u && u > 0) tileStudio.setUnits(o.id, u)
    return [text(`Imported ${o.name} at ${tileStudio.unitsOf(o.id)} unit(s) per tile. ${tileSettingsText()}\n${partsList()}`)]
  },

  tiles_list_parts: () => [text(`${partsList()}\n${tileSettingsText()}`)],

  tiles_set_role: (a) => {
    const role = optStr(a, 'role') as TileRole
    if (!['floor', 'wall', 'lower', 'roof', 'ignore'].includes(role)) fail('role must be floor, wall, lower, roof or ignore')
    const parts = tileStudio.parts()
    const i = optInt(a, 'part')
    const nameHas = optStr(a, 'name_contains')?.toLowerCase()
    const pick = i !== undefined ? (parts[i] ? [parts[i]] : fail(`No part #${i}`)) : nameHas ? parts.filter((p) => p.label.toLowerCase().includes(nameHas)) : fail('Give part or name_contains')
    for (const p of pick!) tileStudio.setRole(p.mesh, role)
    return [text(`Set ${pick!.length} part(s) to ${role}.`)]
  },

  tiles_clear: () => {
    for (const o of [...tileStudio.objects]) tileStudio.remove(o.id)
    lastSplit = null
    return [text('The Tile Maker scene is empty.')]
  },

  tiles_settings: (a) => {
    tilesScreen()
    const patch: Partial<typeof tileStudio.tile> = {}
    const w = optInt(a, 'map_width')
    const h = optInt(a, 'map_height')
    const act = optInt(a, 'act')
    const name = optStr(a, 'name')
    const idx = optInt(a, 'start_index')
    if (w !== undefined) patch.mapW = w
    if (h !== undefined) patch.mapH = h
    if (act !== undefined) {
      if (act < 1 || act > 5) fail('act must be 1-5')
      patch.act = act
    }
    if (name !== undefined) {
      if (!/^[a-z0-9_]{1,24}$/i.test(name)) fail('name: 1-24 letters, digits or _')
      patch.name = name
    }
    if (idx !== undefined) patch.mainIndex = idx
    if (typeof a.dither === 'boolean') patch.dither = a.dither
    tileStudio.setTile(patch)
    if (a.fit_to_scene) tileStudio.fitGridToScene()
    const lighting = optStr(a, 'lighting')
    if (lighting) tileStudio.set({ lighting: lighting as 'diablo' })
    if (typeof a.color_by_role === 'boolean') tileStudio.setRoleColours(a.color_by_role)
    return [text(tileSettingsText())]
  },

  tiles_split: async (a) => {
    tilesScreen()
    const t = tileStudio.tile
    if (!tileStudio.parts().some((p) => p.role !== 'ignore')) fail('The scene is empty. Add blocks or import a model first.')
    const pal = getState().palettes[`ACT${t.act}`] ?? getState().palettes.ACT1 ?? fail('Palettes are not loaded.')
    const folder = tileFolder()
    const res = sliceScene(tileStudio.renderSliceInput(new PaletteLut(pal!)), {
      name: t.name,
      act: t.act,
      mainIndex: t.mainIndex,
      split: !a.one_file,
      dt1Path: (kind) => `\\d2\\${folder.toLowerCase()}\\${tileFileName(kind)}`
    })
    lastSplit = { res, folder, name: t.name }
    const { image: im } = renderMap(res.ds1, indexTiles(res.dt1.tiles), pal!, { background: [14, 15, 17, 255] })
    const st = res.stats
    const summary = `${st.floors} floor, ${st.walls} wall, ${st.lowerWalls} lower-wall and ${st.roofs} roof tiles (${st.unique} unique), ${st.blockedSubtiles} blocked walk spots${st.droppedOverlaps ? `, ${st.droppedOverlaps} overlapping wall piece(s) dropped (more than 4 layers in a cell)` : ''}. Files: ${res.files.map((f) => `${tileFileName(f.kind)} (${f.dt1.tiles.length} tiles)`).join(', ')}, ${t.name.toLowerCase()}.ds1 (${res.ds1.width}×${res.ds1.height}). The picture is the map drawn with the game's rules. Call tiles_save to write them.`
    return [text(summary), await image(im, 1, null)]
  },

  tiles_save: async () => {
    const s = lastSplit ?? fail('Run tiles_split first.')
    const files = [
      ...s!.res.files.map((f) => ({ rel: `${s!.folder}\\${tileFileName(f.kind)}`, data: encodeDt1(f.dt1) })),
      { rel: `${s!.folder}\\${s!.name.toLowerCase()}.ds1`, data: encodeDs1(s!.res.ds1) }
    ]
    const r = await api.exportPd2(files)
    toast(`AI assistant saved ${files.length} tile files to ${r.root}\\${s!.folder}`)
    return [text(`Wrote:\n${r.written.join('\n')}`)]
  }
}

/** Run one tool call; never throws (errors come back as tool errors the model can read). */
export async function runTool(name: string, args: Args): Promise<ToolResult> {
  const fn = tools[name]
  if (!fn) return { content: [text(`Unknown tool ${name}`)], isError: true }
  try {
    return { content: await fn(args ?? {}) }
  } catch (e) {
    return { content: [text(e instanceof Error ? e.message : String(e))], isError: true }
  }
}

/** Connect to the main process (Electron) so AI assistants' tool calls reach this window. */
export function startMcpBridge(): void {
  ;(window as unknown as { __pd2Mcp: typeof runTool }).__pd2Mcp = runTool // for scripted testing
  const w = window.api
  if (!w?.onMcpCall || !w.mcpResult) return
  w.onMcpCall(async (msg) => w.mcpResult!({ id: msg.id, result: await runTool(msg.name, msg.args) }))
}
