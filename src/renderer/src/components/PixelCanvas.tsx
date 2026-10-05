import { useEffect, useMemo, useRef, useState } from 'react'
import { blitIndexed, compositeFrame, directionBounds, frameAt, newRgba } from '../../../core/composite'
import { bestCellAnchor, cellColorViolations } from '../../../core/dcc'
import { floodFill, line, plot, rect, replaceColor } from '../../../core/draw'
import { rampOf, shadeStep } from '../../../core/edit'
import { cloneFrame, expandFrame, Frame, trimFrame } from '../../../core/sprite'
import { paletteToHex } from '../../../core/palette'
import { linePoints, polygonSelection, rectSelection, unionSelection } from '../selectionShapes'
import {
  activeSprite,
  applyToScope,
  commitFloating,
  commitFrame,
  frameKey,
  getFrame,
  getState,
  layerInputs,
  liftSelection,
  moveFloating,
  originalFrame,
  palette,
  pixLassoAdd,
  pixLassoUndo,
  selectionContains,
  Selection,
  setFrameLive,
  setState,
  tintTable,
  toast,
  updateReference,
  useStore
} from '../store'

interface Stage {
  x0: number
  y0: number
  x1: number
  y1: number
}

const PAD = 12

function computeStage(): Stage {
  const s = getState()
  const d = s.doc
  if (!d) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  if (d.kind === 'item') {
    const f = d.sprite.frames[s.dir]?.[s.frame]
    if (!f) return { x0: 0, y0: 0, x1: 1, y1: 1 }
    return { x0: f.offsetX, y0: f.offsetY, x1: f.offsetX + Math.max(1, f.width), y1: f.offsetY + Math.max(1, f.height) }
  }
  const b = directionBounds(d.cof, layerInputs(), s.dir)
  let st = { x0: b.x0 - PAD, y0: b.y0 - PAD, x1: b.x1 + PAD, y1: b.y1 + PAD }
  const fl = s.floating
  if (fl) st = { x0: Math.min(st.x0, fl.x - 2), y0: Math.min(st.y0, fl.y - 2), x1: Math.max(st.x1, fl.x + fl.w + 2), y1: Math.max(st.y1, fl.y + fl.h + 2) }
  return st
}

/** Cell-grid anchor the DCC encoder will use for the active layer's current direction. */
function activeDirBox(): { x: number; y: number } | null {
  const s = getState()
  const frames = activeSprite(s)?.frames[s.dir]
  if (!frames || !frames.some((f) => f.width)) return null
  return bestCellAnchor(frames)
}
function pixelAt(f: Frame | null, x: number, y: number): number {
  if (!f) return 0
  const lx = x - f.offsetX
  const ly = y - f.offsetY
  return lx >= 0 && ly >= 0 && lx < f.width && ly < f.height ? f.pixels[ly * f.width + lx] : 0
}

const imageCache = new Map<string, HTMLImageElement>()
function refImage(url: string, onLoad: () => void): HTMLImageElement | null {
  let img = imageCache.get(url)
  if (!img) {
    img = new Image()
    img.onload = onLoad
    img.src = url
    imageCache.set(url, img)
  }
  return img.complete && img.naturalWidth ? img : null
}

type Drag =
  | { kind: 'rect'; start: { x: number; y: number }; cur: { x: number; y: number }; add: boolean }
  | { kind: 'lasso'; points: { x: number; y: number }[]; add: boolean }
  | { kind: 'moveFloat'; last: { x: number; y: number } }
  | { kind: 'moveRef'; last: { x: number; y: number } }
  | { kind: 'pixTrace' }

export function PixelCanvas() {
  const doc = useStore((s) => s.doc)
  const version = useStore((s) => s.version)
  const zoom = useStore((s) => s.zoom)
  const dir = useStore((s) => s.dir)
  const frame = useStore((s) => s.frame)
  const view = useStore((s) => s.view)
  const paletteName = useStore((s) => s.paletteName)
  const selection = useStore((s) => s.selection)
  const floating = useStore((s) => s.floating)
  const reference = useStore((s) => s.reference)
  const showOriginal = useStore((s) => s.showOriginal)
  const tool = useStore((s) => s.tool)
  const pixLasso = useStore((s) => s.pixLasso)
  const tintOn = useStore((s) => s.view.tint && !!s.colormap && !!s.tintCode)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [diffCount, setDiffCount] = useState(0)
  const drag = useRef<Drag | null>(null)
  const stroke = useRef<{
    button: number
    before: Frame
    base: Frame
    work: Frame
    start: { x: number; y: number }
    last: { x: number; y: number }
    stage: Stage
    visited: Set<number>
  } | null>(null)

  // A half-traced pixel lasso is dropped when another tool is picked
  useEffect(() => {
    if (tool !== 'pixlasso' && getState().pixLasso) setState({ pixLasso: null })
  }, [tool])

  // Floating pixels belong to one frame: place them if the user moves to another frame/layer
  useEffect(() => {
    const fl = getState().floating
    if (fl && fl.key !== frameKey(dir, frame)) commitFloating()
  }, [dir, frame, doc])

  const stage = useMemo(() => (stroke.current ? stroke.current.stage : computeStage()), [doc, dir, version, floating]) // eslint-disable-line react-hooks/exhaustive-deps
  const W = stage.x1 - stage.x0
  const H = stage.y1 - stage.y0

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !doc) return
    const s = getState()
    const pal = palette()
    const img = newRgba(stage.x0, stage.y0, W, H)
    const active = doc.kind === 'anim' ? doc.layers.find((l) => l.composit === doc.active) : null
    const orig = showOriginal ? originalFrame(dir, frame) : null
    if (doc.kind === 'anim') {
      if (view.onion && active?.sprite && !showOriginal) {
        const n = doc.cof.framesPerDir
        const prev = frameAt(active.sprite, dir, (frame - 1 + n) % n)
        const next = frameAt(active.sprite, dir, (frame + 1) % n)
        if (next) blitIndexed(img, next, pal, { alpha: 0.18 })
        if (prev) blitIndexed(img, prev, pal, { alpha: 0.3 })
      }
      const layered = compositeFrame(doc.cof, layerInputs(true), pal, dir, frame, {
        bounds: stage,
        filter: view.ghostLayers ? undefined : (c) => c === doc.active,
        override: showOriginal ? (c) => (c === doc.active ? (orig ?? { width: 0, height: 0, offsetX: 0, offsetY: 0, pixels: new Uint8Array(0) }) : undefined) : undefined
      })
      for (let i = 0; i < layered.data.length; i += 4) {
        const a = layered.data[i + 3] / 255
        if (!a) continue
        for (let k = 0; k < 3; k++) img.data[i + k] = layered.data[i + k] * a + img.data[i + k] * (1 - a)
        img.data[i + 3] = Math.max(img.data[i + 3], layered.data[i + 3])
      }
    } else {
      const f = showOriginal ? orig : doc.sprite.frames[dir]?.[frame]
      if (f) blitIndexed(img, f, pal, { remap: tintTable() })
    }
    if (floating && !showOriginal)
      blitIndexed(img, { width: floating.w, height: floating.h, offsetX: floating.x, offsetY: floating.y, pixels: floating.pixels }, pal)

    cv.width = W * zoom
    cv.height = H * zoom
    const ctx = cv.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, cv.width, cv.height)

    const drawRef = () => {
      if (!reference?.visible) return
      const im = refImage(reference.url, () => setTick((t) => t + 1))
      if (!im) return
      ctx.save()
      ctx.globalAlpha = reference.opacity
      ctx.drawImage(im, (reference.x - stage.x0) * zoom, (reference.y - stage.y0) * zoom, reference.width * reference.scale * zoom, reference.height * reference.scale * zoom)
      ctx.restore()
    }
    if (reference && !reference.above) drawRef()

    const off = new OffscreenCanvas(Math.max(1, W), Math.max(1, H))
    off.getContext('2d')!.putImageData(new ImageData(img.data, Math.max(1, W), Math.max(1, H)), 0, 0)
    ctx.drawImage(off, 0, 0, W * zoom, H * zoom)
    if (reference?.above) drawRef()

    if (view.grid && zoom >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= W; x++) {
        ctx.moveTo(x * zoom + 0.5, 0)
        ctx.lineTo(x * zoom + 0.5, H * zoom)
      }
      for (let y = 0; y <= H; y++) {
        ctx.moveTo(0, y * zoom + 0.5)
        ctx.lineTo(W * zoom, y * zoom + 0.5)
      }
      ctx.stroke()
    }

    // Changed-pixel highlight vs the original game file
    const af = getFrame(dir, frame)
    if (view.diff && !showOriginal) {
      const o = originalFrame(dir, frame)
      let n = 0
      ctx.fillStyle = 'rgba(255,0,200,0.5)'
      for (let y = stage.y0; y < stage.y1; y++)
        for (let x = stage.x0; x < stage.x1; x++)
          if (pixelAt(af, x, y) !== pixelAt(o, x, y)) {
            n++
            ctx.fillRect((x - stage.x0) * zoom, (y - stage.y0) * zoom, zoom, zoom)
          }
      setDiffCount(n)
    }

    if (af && af.width && doc.kind === 'anim') {
      ctx.strokeStyle = 'rgba(199,179,119,0.55)'
      ctx.setLineDash([4, 3])
      ctx.strokeRect((af.offsetX - stage.x0) * zoom + 0.5, (af.offsetY - stage.y0) * zoom + 0.5, af.width * zoom, af.height * zoom)
      ctx.setLineDash([])
    }

    // The 4-colours-per-cell limit is a DCC thing; DC6 parts (e.g. Mephisto) have no such limit
    if (view.cellWarn && doc.kind === 'anim' && doc.layers.find((l) => l.composit === doc.active)?.format !== 'dc6' && af && af.width && !stroke.current && !showOriginal) {
      const box = activeDirBox()
      if (box) {
        ctx.strokeStyle = 'rgba(255,60,60,0.95)'
        ctx.lineWidth = 2
        for (const c of cellColorViolations(af, box.x, box.y))
          ctx.strokeRect((af.offsetX + c.x - stage.x0) * zoom + 1, (af.offsetY + c.y - stage.y0) * zoom + 1, c.w * zoom - 2, c.h * zoom - 2)
        ctx.lineWidth = 1
      }
    }

    // Selection outline (edges of the mask), or the one being dragged
    const dg = drag.current
    const selShown: Selection | null =
      dg?.kind === 'rect' ? rectSelection(dg.start, dg.cur) : dg?.kind === 'lasso' ? null : floating ? null : selection
    const outlineMask = (sel: Selection, color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < sel.w && y < sel.h && sel.mask[y * sel.w + x] === 1
      for (let y = 0; y < sel.h; y++)
        for (let x = 0; x < sel.w; x++) {
          if (!at(x, y)) continue
          const px = (sel.x0 + x - stage.x0) * zoom
          const py = (sel.y0 + y - stage.y0) * zoom
          if (!at(x, y - 1)) (ctx.moveTo(px, py + 0.5), ctx.lineTo(px + zoom, py + 0.5))
          if (!at(x, y + 1)) (ctx.moveTo(px, py + zoom - 0.5), ctx.lineTo(px + zoom, py + zoom - 0.5))
          if (!at(x - 1, y)) (ctx.moveTo(px + 0.5, py), ctx.lineTo(px + 0.5, py + zoom))
          if (!at(x + 1, y)) (ctx.moveTo(px + zoom - 0.5, py), ctx.lineTo(px + zoom - 0.5, py + zoom))
        }
      ctx.stroke()
    }
    if (selShown) {
      ctx.setLineDash([4, 4])
      outlineMask(selShown, '#000')
      ctx.lineDashOffset = 4
      outlineMask(selShown, '#fff')
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
    }
    if (dg?.kind === 'lasso' && dg.points.length > 1) {
      ctx.strokeStyle = '#fff'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      dg.points.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (p.x - stage.x0 + 0.5) * zoom, (p.y - stage.y0 + 0.5) * zoom))
      ctx.stroke()
      ctx.setLineDash([])
    }
    // Pixel lasso being traced: the outline so far, a preview to the cursor, and the first pixel (click it to close)
    if (pixLasso) {
      const pts = pixLasso.points
      const cell = (x: number, y: number) => ctx.fillRect((x - stage.x0) * zoom, (y - stage.y0) * zoom, zoom, zoom)
      ctx.fillStyle = 'rgba(90,209,255,0.55)'
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[i + 1] ?? a
        for (const [x, y] of linePoints(a.x, a.y, b.x, b.y)) cell(x, y)
      }
      const last = pts[pts.length - 1]
      if (hover && (hover.x !== last.x || hover.y !== last.y)) {
        ctx.fillStyle = 'rgba(90,209,255,0.25)'
        for (const [x, y] of linePoints(last.x, last.y, hover.x, hover.y).slice(1)) cell(x, y)
      }
      const first = pts[0]
      const closing = hover && pts.length >= 3 && hover.x === first.x && hover.y === first.y
      ctx.strokeStyle = closing ? '#7dff8a' : '#fff'
      ctx.lineWidth = 2
      ctx.strokeRect((first.x - stage.x0) * zoom - 1, (first.y - stage.y0) * zoom - 1, zoom + 2, zoom + 2)
      ctx.lineWidth = 1
    }
    if (floating) {
      ctx.strokeStyle = '#5ad1ff'
      ctx.setLineDash([5, 3])
      ctx.strokeRect((floating.x - stage.x0) * zoom + 0.5, (floating.y - stage.y0) * zoom + 0.5, floating.w * zoom - 1, floating.h * zoom - 1)
      ctx.setLineDash([])
    }

    if (view.origin && doc.kind === 'anim') {
      const ox = (0 - stage.x0) * zoom
      const oy = (0 - stage.y0) * zoom
      ctx.strokeStyle = 'rgba(90,200,255,0.6)'
      ctx.beginPath()
      ctx.moveTo(ox - 10, oy + 0.5)
      ctx.lineTo(ox + 10, oy + 0.5)
      ctx.moveTo(ox + 0.5, oy - 10)
      ctx.lineTo(ox + 0.5, oy + 10)
      ctx.stroke()
    }


    if (hover && zoom >= 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      const size = s.tool === 'pencil' || s.tool === 'eraser' || s.tool === 'shade' ? s.brush : 1
      const r0 = -Math.floor((size - 1) / 2)
      ctx.strokeRect((hover.x + r0 - stage.x0) * zoom + 0.5, (hover.y + r0 - stage.y0) * zoom + 0.5, size * zoom - 1, size * zoom - 1)
    }
  }, [doc, version, zoom, dir, frame, view, paletteName, tintOn, hover, stage, W, H, selection, floating, reference, showOriginal, tick, pixLasso])

  const toSprite = (e: React.MouseEvent | MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: Math.floor((e.clientX - r.left) / zoom) + stage.x0, y: Math.floor((e.clientY - r.top) / zoom) + stage.y0 }
  }

  /** Revert changes the paint lock or selection forbids. */
  const enforceLock = () => {
    const st = stroke.current
    const s = getState()
    if (!st || (s.lock === 'off' && !s.selection)) return
    const rampSet = s.lock === 'ramp' ? new Set(rampOf(palette(), s.lockColor)) : null
    const w = st.work
    const b = st.base
    for (let i = 0; i < w.pixels.length; i++) {
      if (w.pixels[i] === b.pixels[i]) continue
      const base = b.pixels[i]
      let ok = true
      if (s.lock === 'opaque') ok = base !== 0
      else if (s.lock === 'transparent') ok = base === 0
      else if (s.lock === 'color') ok = base === s.lockColor
      else if (s.lock === 'ramp') ok = rampSet!.has(base)
      if (ok && s.selection) ok = selectionContains(s.selection, w.offsetX + (i % w.width), w.offsetY + Math.floor(i / w.width))
      if (!ok) w.pixels[i] = base
    }
  }

  const applyTool = (p: { x: number; y: number }, first: boolean) => {
    const st = stroke.current
    if (!st) return
    const s = getState()
    const color = s.tool === 'eraser' ? 0 : st.button === 2 ? s.secondary : s.primary
    const w = st.work
    const lx = (x: number) => x - w.offsetX
    const ly = (y: number) => y - w.offsetY
    switch (s.tool) {
      case 'pencil':
      case 'eraser':
        if (first) plot(w, lx(p.x), ly(p.y), color, s.brush)
        else line(w, lx(st.last.x), ly(st.last.y), lx(p.x), ly(p.y), color, s.brush)
        break
      case 'shade': {
        // left = lighter, right = darker; each pixel shifts at most once per stroke
        const pal = palette()
        const step = st.button === 2 ? 1 : -1
        const r0 = -Math.floor((s.brush - 1) / 2)
        for (const [cx, cy] of first ? [[p.x, p.y] as [number, number]] : linePoints(st.last.x, st.last.y, p.x, p.y))
          for (let dy = r0; dy < r0 + s.brush; dy++)
            for (let dx = r0; dx < r0 + s.brush; dx++) {
              const x = lx(cx + dx)
              const y = ly(cy + dy)
              if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue
              const i = y * w.width + x
              if (st.visited.has(i) || !st.base.pixels[i]) continue
              st.visited.add(i)
              w.pixels[i] = shadeStep(pal, st.base.pixels[i], step)
            }
        break
      }
      case 'fill':
        if (first) floodFill(w, lx(p.x), ly(p.y), color, true)
        break
      case 'line':
      case 'rect':
      case 'rectFill':
        w.pixels.set(st.base.pixels)
        if (s.tool === 'line') line(w, lx(st.start.x), ly(st.start.y), lx(p.x), ly(p.y), color, s.brush)
        else rect(w, lx(st.start.x), ly(st.start.y), lx(p.x), ly(p.y), color, s.tool === 'rectFill')
        break
      case 'move': {
        const dx = p.x - st.start.x
        const dy = p.y - st.start.y
        st.work = { ...st.before, offsetX: st.before.offsetX + dx, offsetY: st.before.offsetY + dy }
        break
      }
    }
    if (s.tool !== 'move') enforceLock()
    st.last = p
    setFrameLive(s.dir, s.frame, st.work)
  }

  const onDown = (e: React.MouseEvent) => {
    const s = getState()
    const d = s.doc
    if (!d || (e.button !== 0 && e.button !== 2)) return
    const p = toSprite(e)
    const cur = getFrame()

    if (s.reference?.moving) {
      drag.current = { kind: 'moveRef', last: p }
      return
    }
    if (e.altKey) {
      const idx = pixelAt(cur, p.x, p.y)
      setState({ lockColor: idx, lock: s.lock === 'off' ? 'color' : s.lock })
      toast(`Paint lock colour set to ${idx}${idx ? '' : ' (transparent)'}`)
      return
    }
    if (!cur) return
    if (s.tool === 'picker') {
      const idx = pixelAt(cur, p.x, p.y)
      setState(e.button === 2 ? { secondary: idx } : { primary: idx })
      return
    }
    if (s.tool === 'ramp') {
      const idx = pixelAt(cur, p.x, p.y)
      if (!idx) return toast('Click a coloured pixel of the material you want to recolour')
      setState({ rampDialog: { index: idx, x: p.x, y: p.y } })
      return
    }
    if (s.tool === 'select') {
      const fl = s.floating
      if (fl && p.x >= fl.x && p.y >= fl.y && p.x < fl.x + fl.w && p.y < fl.y + fl.h) {
        drag.current = { kind: 'moveFloat', last: p }
        return
      }
      if (!fl && s.selection && selectionContains(s.selection, p.x, p.y) && liftSelection()) {
        drag.current = { kind: 'moveFloat', last: p }
        return
      }
      commitFloating()
      drag.current = { kind: 'rect', start: p, cur: p, add: e.shiftKey }
      setTick((t) => t + 1)
      return
    }
    if (s.tool === 'pixlasso') {
      // Left: add pixels (click, or hold and drag over them); right: take back the last one
      if (e.button === 2) return pixLassoUndo()
      if (!s.pixLasso) commitFloating()
      pixLassoAdd(p, e.shiftKey)
      drag.current = { kind: 'pixTrace' }
      return
    }
    if (s.tool === 'lasso') {
      commitFloating()
      drag.current = { kind: 'lasso', points: [p], add: e.shiftKey }
      return
    }
    if (s.tool === 'wand') {
      commitFloating()
      const lx = p.x - cur.offsetX
      const ly = p.y - cur.offsetY
      if (lx < 0 || ly < 0 || lx >= cur.width || ly >= cur.height) return
      const f = cloneFrame(cur)
      const target = f.pixels[ly * f.width + lx]
      // Mark the contiguous region by filling with a sentinel value, then read it back as a mask
      const marker = target === 255 ? 254 : 255
      floodFill(f, lx, ly, marker, !e.ctrlKey)
      const mask = new Uint8Array(f.width * f.height)
      for (let i = 0; i < mask.length; i++) mask[i] = f.pixels[i] === marker && cur.pixels[i] === target ? 1 : 0
      const sel: Selection = { x0: f.offsetX, y0: f.offsetY, w: f.width, h: f.height, mask }
      setState({ selection: e.shiftKey ? unionSelection(s.selection, sel) : sel })
      return
    }
    commitFloating()
    const curNow = getFrame()!
    if ((s.tool === 'replace' || s.tool === 'fillAll') && s.scope !== 'frame') {
      const from = pixelAt(curNow, p.x, p.y)
      const to = e.button === 2 ? s.secondary : s.primary
      const n = applyToScope((f) => {
        const out = cloneFrame(f)
        for (let i = 0; i < out.pixels.length; i++)
          if (out.pixels[i] === from && selectionContains(s.selection, f.offsetX + (i % f.width), f.offsetY + Math.floor(i / f.width))) out.pixels[i] = to
        return out
      })
      toast(`Replaced colour ${from} → ${to} in ${n} frame${n === 1 ? '' : 's'}`)
      return
    }
    if (s.tool === 'replace' || s.tool === 'fillAll') {
      const from = pixelAt(curNow, p.x, p.y)
      const before = cloneFrame(curNow)
      const work = cloneFrame(curNow)
      replaceColor(work, from, e.button === 2 ? s.secondary : s.primary)
      stroke.current = { button: e.button, before, base: before, work, start: p, last: p, stage, visited: new Set() }
      enforceLock()
      setFrameLive(s.dir, s.frame, work)
      return
    }
    const before = cloneFrame(curNow)
    // Animated layers can be painted anywhere on the stage; item frames keep their size.
    const work = d.kind === 'anim' && s.tool !== 'move' ? expandFrame(before, stage.x0, stage.y0, stage.x1, stage.y1) : cloneFrame(before)
    stroke.current = { button: e.button, before, base: cloneFrame(work), work, start: p, last: p, stage, visited: new Set() }
    applyTool(p, true)
  }

  const finish = () => {
    const dg = drag.current
    if (dg) {
      drag.current = null
      const s = getState()
      if (dg.kind === 'rect') {
        const moved = dg.start.x !== dg.cur.x || dg.start.y !== dg.cur.y
        const sel = moved ? rectSelection(dg.start, dg.cur) : null
        setState({ selection: dg.add ? unionSelection(s.selection, sel) : sel, version: s.version + 1 })
      } else if (dg.kind === 'lasso') {
        const sel = polygonSelection(dg.points)
        setState({ selection: dg.add ? unionSelection(s.selection, sel) : sel, version: s.version + 1 })
      }
      return
    }
    const st = stroke.current
    if (!st) return
    stroke.current = null
    const s = getState()
    const after = s.doc?.kind === 'anim' && s.tool !== 'move' ? trimFrame(st.work) : st.work
    const changed =
      after.offsetX !== st.before.offsetX ||
      after.offsetY !== st.before.offsetY ||
      after.width !== st.before.width ||
      after.height !== st.before.height ||
      after.pixels.some((v, i) => v !== st.before.pixels[i])
    if (changed) commitFrame(s.dir, s.frame, st.before, after)
    else setFrameLive(s.dir, s.frame, st.before)
  }

  const onMove = (e: React.MouseEvent) => {
    const p = toSprite(e)
    if (!hover || hover.x !== p.x || hover.y !== p.y) setHover(p)
    const dg = drag.current
    if (dg) {
      if (dg.kind === 'rect') {
        dg.cur = p
        setTick((t) => t + 1)
      } else if (dg.kind === 'lasso') {
        const last = dg.points[dg.points.length - 1]
        if (last.x !== p.x || last.y !== p.y) dg.points.push(p)
        setTick((t) => t + 1)
      } else if (dg.kind === 'pixTrace') {
        if (getState().pixLasso) pixLassoAdd(p)
      } else if (dg.kind === 'moveFloat') {
        if (p.x !== dg.last.x || p.y !== dg.last.y) moveFloating(p.x - dg.last.x, p.y - dg.last.y)
        dg.last = p
      } else if (dg.kind === 'moveRef') {
        const r = getState().reference
        if (r && (p.x !== dg.last.x || p.y !== dg.last.y)) updateReference({ x: r.x + p.x - dg.last.x, y: r.y + p.y - dg.last.y })
        dg.last = p
      }
      return
    }
    if (stroke.current) applyTool(p, false)
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    const z = getState().zoom
    setState({ zoom: Math.max(1, Math.min(32, e.deltaY < 0 ? z + (z >= 8 ? 2 : 1) : z - (z > 8 ? 2 : 1))) })
  }

  useEffect(() => {
    window.addEventListener('mouseup', finish)
    return () => window.removeEventListener('mouseup', finish)
  })

  if (!doc) return null
  const hf = hover ? getFrame() : null
  const hIdx = hf && hover ? pixelAt(hf, hover.x, hover.y) : null
  const cursor = reference?.moving ? 'move' : tool === 'select' && floating ? 'move' : 'crosshair'

  return (
    <div className="canvas-wrap">
      <div className="canvas-scroll" onWheel={onWheel}>
        <div className="canvas-center">
          <canvas
            ref={canvasRef}
            className="pixel-canvas"
            style={{ backgroundSize: `${zoom * 2}px ${zoom * 2}px`, backgroundPosition: `0 0, ${zoom}px ${zoom}px`, cursor }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>
      <div className="statusbar">
        <span>
          {hover ? `x ${hover.x}, y ${hover.y}` : '—'}
          {hIdx !== null && hIdx !== undefined ? (
            <>
              {'  ·  index '}
              {hIdx}
              {hIdx ? <span className="sw-inline" style={{ background: paletteToHex(palette(), hIdx) }} /> : ' (transparent)'}
            </>
          ) : null}
          {selection && !floating ? `  ·  selection ${selection.w}×${selection.h}` : ''}
          {floating ? '  ·  moving pixels: drag them, then press Enter to place (Esc cancels)' : ''}
          {pixLasso ? `  ·  outline ${pixLasso.points.length} point${pixLasso.points.length === 1 ? '' : 's'}: click the first pixel or press Enter to close` : ''}
        </span>
        <span>
          {view.diff ? <span className="diffcount">{diffCount} px changed · </span> : null}
          {W}×{H} px
        </span>
      </div>
    </div>
  )
}
