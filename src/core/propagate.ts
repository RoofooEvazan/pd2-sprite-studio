// Intelligent edit transfer: carry pixel edits made on one animation frame over to other frames.
//
// 1. Diff the source frame before/after editing (sprite space) into changed pixels.
// 2. Group changed pixels into connected regions (with a small dilation so nearby strokes group).
// 3. For each target frame, track each region: search offsets around the previous frame's best offset
//    for the position where the region's surrounding *original* pixels match the target best.
// 4. Re-apply each change at the tracked position with semantics matching the kind of edit:
//    recolour (opaque -> opaque), add (transparent -> opaque), erase (opaque -> transparent).

import { Frame, expandFrame, trimFrame } from './sprite'

export type TransferMode = 'track' | 'recolor' | 'fixed'

export interface TransferOptions {
  mode: TransferMode
  /** Search radius (px) around the predicted offset per frame. */
  search?: number
  /** Context padding (px) around each edited region used for matching. */
  pad?: number
  /** Regions whose match confidence is below this are skipped. */
  minConfidence?: number
  /** Recolour only target pixels whose original colour matches the source's original colour. */
  strictRecolor?: boolean
}

export interface Change {
  x: number
  y: number
  from: number
  to: number
}

export interface RegionResult {
  offset: { dx: number; dy: number }
  confidence: number
  applied: number
  skipped: boolean
}

export interface TransferResult {
  frame: Frame
  applied: number
  regions: RegionResult[]
  confidence: number
}

function pxAt(f: Frame, x: number, y: number): number {
  const lx = x - f.offsetX
  const ly = y - f.offsetY
  if (lx < 0 || ly < 0 || lx >= f.width || ly >= f.height) return 0
  return f.pixels[ly * f.width + lx]
}

export function diffFrames(before: Frame, after: Frame): Change[] {
  const x0 = Math.min(before.offsetX, after.offsetX)
  const y0 = Math.min(before.offsetY, after.offsetY)
  const x1 = Math.max(before.offsetX + before.width, after.offsetX + after.width)
  const y1 = Math.max(before.offsetY + before.height, after.offsetY + after.height)
  const out: Change[] = []
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const a = pxAt(before, x, y)
      const b = pxAt(after, x, y)
      if (a !== b) out.push({ x, y, from: a, to: b })
    }
  return out
}

/** Consistent colour mapping implied by the edit, if it is (mostly) a pure recolour. */
export function recolorMap(changes: Change[]): { map: Map<number, number>; purity: number } {
  const votes = new Map<number, Map<number, number>>()
  let opaque = 0
  for (const c of changes) {
    if (!c.from || !c.to) continue
    opaque++
    const m = votes.get(c.from) ?? new Map<number, number>()
    m.set(c.to, (m.get(c.to) ?? 0) + 1)
    votes.set(c.from, m)
  }
  const map = new Map<number, number>()
  let consistent = 0
  for (const [from, m] of votes) {
    let best = 0
    let bestN = 0
    for (const [to, n] of m)
      if (n > bestN) {
        best = to
        bestN = n
      }
    map.set(from, best)
    consistent += bestN
  }
  return { map, purity: changes.length ? consistent / changes.length : 0 }
}

function groupChanges(changes: Change[], link = 2): Change[][] {
  const groups: Change[][] = []
  const parent = changes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const cellSize = link + 1
  const buckets = new Map<string, number[]>()
  changes.forEach((c, i) => {
    const k = `${Math.floor(c.x / cellSize)},${Math.floor(c.y / cellSize)}`
    const b = buckets.get(k) ?? []
    b.push(i)
    buckets.set(k, b)
  })
  changes.forEach((c, i) => {
    const bx = Math.floor(c.x / cellSize)
    const by = Math.floor(c.y / cellSize)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          const o = changes[j]
          if (j !== i && Math.abs(o.x - c.x) <= link && Math.abs(o.y - c.y) <= link) parent[find(i)] = find(j)
        }
  })
  const byRoot = new Map<number, Change[]>()
  changes.forEach((c, i) => {
    const r = find(i)
    const g = byRoot.get(r) ?? []
    g.push(c)
    byRoot.set(r, g)
  })
  for (const g of byRoot.values()) groups.push(g)
  return groups
}

function matchScore(before: Frame, target: Frame, bx0: number, by0: number, bx1: number, by1: number, dx: number, dy: number): number {
  let score = 0
  let weight = 0
  for (let y = by0; y < by1; y++)
    for (let x = bx0; x < bx1; x++) {
      const a = pxAt(before, x, y)
      const b = pxAt(target, x + dx, y + dy)
      if (a) {
        weight++
        if (a === b) score += 1
        else if (b) score += 0.35
        else score -= 0.5
      } else if (b) score -= 0.15
    }
  return weight ? score / weight : 0
}

interface Track {
  group: Change[]
  box: { x0: number; y0: number; x1: number; y1: number }
  dx: number
  dy: number
}

export class EditTransfer {
  readonly changes: Change[]
  private tracks: Track[]
  private readonly map: Map<number, number>
  readonly purity: number

  constructor(
    private readonly before: Frame,
    after: Frame,
    private readonly opts: TransferOptions
  ) {
    this.changes = diffFrames(before, after)
    const rc = recolorMap(this.changes)
    this.map = rc.map
    this.purity = rc.purity
    const pad = opts.pad ?? 5
    this.tracks = groupChanges(this.changes).map((g) => {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const c of g) {
        x0 = Math.min(x0, c.x)
        y0 = Math.min(y0, c.y)
        x1 = Math.max(x1, c.x + 1)
        y1 = Math.max(y1, c.y + 1)
      }
      return { group: g, box: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }, dx: 0, dy: 0 }
    })
  }

  /** Suggest the most suitable mode for this edit. */
  suggestedMode(): TransferMode {
    const addsOrErases = this.changes.filter((c) => !c.from || !c.to).length
    if (addsOrErases > 0 || this.purity < 0.95 || this.map.size > 12) return 'track'
    // A true recolour changes (nearly) every pixel of each affected colour; painting a patch doesn't.
    const total = new Map<number, number>()
    for (const p of this.before.pixels) if (this.map.has(p)) total.set(p, (total.get(p) ?? 0) + 1)
    const changed = new Map<number, number>()
    for (const c of this.changes) changed.set(c.from, (changed.get(c.from) ?? 0) + 1)
    for (const [from, n] of total) if ((changed.get(from) ?? 0) / n < 0.8) return 'track'
    return 'recolor'
  }

  /** Apply to the next target frame. Call in frame order so tracking can follow motion. */
  apply(target: Frame): TransferResult {
    const { mode } = this.opts
    if (mode === 'recolor') return this.applyRecolor(target)
    const search = this.opts.search ?? 8
    const minConf = this.opts.minConfidence ?? 0.3
    const writes: Change[] = []
    const regions: RegionResult[] = []
    for (const t of this.tracks) {
      let bestDx = 0
      let bestDy = 0
      let best = -Infinity
      if (mode === 'fixed') best = matchScore(this.before, target, t.box.x0, t.box.y0, t.box.x1, t.box.y1, 0, 0)
      else {
        for (let dy = t.dy - search; dy <= t.dy + search; dy++)
          for (let dx = t.dx - search; dx <= t.dx + search; dx++) {
            // Slight preference for small movement relative to the previous frame
            const s = matchScore(this.before, target, t.box.x0, t.box.y0, t.box.x1, t.box.y1, dx, dy) - 0.002 * (Math.abs(dx - t.dx) + Math.abs(dy - t.dy))
            if (s > best) {
              best = s
              bestDx = dx
              bestDy = dy
            }
          }
        t.dx = bestDx
        t.dy = bestDy
      }
      const skipped = mode !== 'fixed' && best < minConf
      let applied = 0
      if (!skipped) {
        for (const c of t.group) {
          const x = c.x + bestDx
          const y = c.y + bestDy
          const cur = pxAt(target, x, y)
          let to: number | null = null
          if (c.from && c.to) {
            // recolour / paint-over: only onto opaque pixels
            if (cur === c.from) to = c.to
            else if (cur && this.map.has(cur)) to = this.map.get(cur)!
            else if (cur && !this.opts.strictRecolor) to = c.to
          } else if (!c.from && c.to) to = c.to // added pixel
          else if (c.from && !c.to) {
            if (cur && (cur === c.from || !this.opts.strictRecolor)) to = 0 // erase
          }
          if (to !== null && to !== cur) {
            writes.push({ x, y, from: cur, to })
            applied++
          }
        }
      }
      regions.push({ offset: { dx: bestDx, dy: bestDy }, confidence: Math.max(0, Math.min(1, best)), applied, skipped })
    }
    const frame = writeFrame(target, writes)
    const conf = regions.length ? regions.reduce((s, r) => s + r.confidence * r.applied, 0) / Math.max(1, regions.reduce((s, r) => s + r.applied, 0)) : 1
    return { frame, applied: writes.length, regions, confidence: conf }
  }

  private applyRecolor(target: Frame): TransferResult {
    const out = { ...target, pixels: target.pixels.slice() }
    let n = 0
    for (let i = 0; i < out.pixels.length; i++) {
      const m = this.map.get(out.pixels[i])
      if (m !== undefined && out.pixels[i]) {
        out.pixels[i] = m
        n++
      }
    }
    return { frame: out, applied: n, regions: [], confidence: this.purity }
  }
}

function writeFrame(target: Frame, writes: Change[]): Frame {
  if (!writes.length) return { ...target, pixels: target.pixels.slice() }
  let x0 = target.width ? target.offsetX : Infinity
  let y0 = target.height ? target.offsetY : Infinity
  let x1 = target.width ? target.offsetX + target.width : -Infinity
  let y1 = target.height ? target.offsetY + target.height : -Infinity
  for (const w of writes) {
    x0 = Math.min(x0, w.x)
    y0 = Math.min(y0, w.y)
    x1 = Math.max(x1, w.x + 1)
    y1 = Math.max(y1, w.y + 1)
  }
  const f = expandFrame(target, x0, y0, x1, y1)
  for (const w of writes) f.pixels[(w.y - f.offsetY) * f.width + (w.x - f.offsetX)] = w.to
  return trimFrame(f)
}
