// DCC: Diablo II's cell-based, delta-compressed animation format (characters, monsters, objects).
// Decoder follows Paul Siramy's DCC specification. The encoder emits a valid (not maximally compact)
// stream: it uses the equal-cell stream to reuse unchanged cells, and displacement-coded pixel values.
//
// Format constraint: every 4x4 cell of every frame may use at most 4 distinct palette indices
// (transparent counts as one). The encoder reduces colours in cells that violate this; the editor
// can highlight such cells via `cellColorViolations`.

import { BitReader, BitWriter } from './bits'
import { expandFrame, Frame, Sprite } from './sprite'
import { dccDirectionCells, exceedsUnitFrameLimit, MAX_DCC_DIRECTION_CELLS, MAX_UNIT_FRAME } from './unitSplit'

const CRAZY_BITS = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 26, 28, 30, 32]

export interface DccFrameMeta {
  variable0: number
  optionalData: Uint8Array
  codedBytes: number
  bottomUp: boolean
}

export interface Dcc extends Sprite {
  version: number
  frameMeta: DccFrameMeta[][]
}

interface Box {
  xMin: number
  yMin: number
  xMax: number // inclusive
  yMax: number // inclusive
}

interface Cell {
  x0: number // relative to direction box
  y0: number
  w: number
  h: number
}

interface CellLayout {
  cells: Cell[]
  nbW: number
  nbH: number
  cellX0: number // direction-cell coordinates of the first cell
  cellY0: number
}

function frameCells(fb: Box, db: Box): CellLayout {
  const split = (fMin: number, dMin: number, size: number) => {
    const first = 4 - ((fMin - dMin) % 4)
    let nb: number
    if (size - first <= 1) nb = 1
    else {
      const tmp = size - first - 1
      nb = 2 + Math.floor(tmp / 4)
      if (tmp % 4 === 0) nb--
    }
    const sizes: number[] = []
    if (nb === 1) sizes.push(size)
    else {
      sizes.push(first)
      for (let i = 1; i < nb - 1; i++) sizes.push(4)
      sizes.push(size - first - 4 * (nb - 2))
    }
    return sizes
  }
  const fw = fb.xMax - fb.xMin + 1
  const fh = fb.yMax - fb.yMin + 1
  const ws = split(fb.xMin, db.xMin, fw)
  const hs = split(fb.yMin, db.yMin, fh)
  const cells: Cell[] = []
  let y0 = fb.yMin - db.yMin
  for (const h of hs) {
    let x0 = fb.xMin - db.xMin
    for (const w of ws) {
      cells.push({ x0, y0, w, h })
      x0 += w
    }
    y0 += h
  }
  return {
    cells,
    nbW: ws.length,
    nbH: hs.length,
    cellX0: Math.floor((fb.xMin - db.xMin) / 4),
    cellY0: Math.floor((fb.yMin - db.yMin) / 4)
  }
}

interface PbEntry {
  val: number[]
  frame: number
  cellIndex: number
}

/** Decode a DCC. With onlyDir, other directions are left empty (much faster for thumbnails). */
export function decodeDcc(data: Uint8Array, onlyDir?: number): Dcc {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data[0] !== 0x74) throw new Error('DCC: bad signature')
  const version = data[1]
  const directions = data[2]
  const framesPerDir = dv.getUint32(3, true)
  const dirOffsets: number[] = []
  for (let d = 0; d < directions; d++) dirOffsets.push(dv.getUint32(15 + d * 4, true))

  const frames: Frame[][] = []
  const frameMeta: DccFrameMeta[][] = []
  for (let d = 0; d < directions; d++) {
    if (onlyDir !== undefined && d !== onlyDir) {
      frames.push([])
      frameMeta.push([])
      continue
    }
    const end = d + 1 < directions ? dirOffsets[d + 1] : data.length
    const r = decodeDirection(data.subarray(dirOffsets[d], end), framesPerDir)
    frames.push(r.frames)
    frameMeta.push(r.meta)
  }
  return { version, directions, framesPerDir, frames, frameMeta }
}

function decodeDirection(buf: Uint8Array, nFrames: number): { frames: Frame[]; meta: DccFrameMeta[] } {
  const br = new BitReader(buf)
  br.bits(32) // outsize coded
  const compression = br.bits(2)
  const v0Bits = CRAZY_BITS[br.bits(4)]
  const wBits = CRAZY_BITS[br.bits(4)]
  const hBits = CRAZY_BITS[br.bits(4)]
  const xBits = CRAZY_BITS[br.bits(4)]
  const yBits = CRAZY_BITS[br.bits(4)]
  const optBits = CRAZY_BITS[br.bits(4)]
  const codedBits = CRAZY_BITS[br.bits(4)]

  const meta: DccFrameMeta[] = []
  const boxes: Box[] = []
  const optSizes: number[] = []
  for (let f = 0; f < nFrames; f++) {
    const variable0 = br.bits(v0Bits)
    const w = br.bits(wBits)
    const h = br.bits(hBits)
    const x = br.signed(xBits)
    const y = br.signed(yBits)
    const opt = br.bits(optBits)
    const codedBytes = br.bits(codedBits)
    const bottomUp = br.bits(1) === 1
    const box: Box = bottomUp
      ? { xMin: x, xMax: x + w - 1, yMin: y, yMax: y + h - 1 }
      : { xMin: x, xMax: x + w - 1, yMin: y - h + 1, yMax: y }
    boxes.push(box)
    optSizes.push(opt)
    meta.push({ variable0, optionalData: new Uint8Array(0), codedBytes, bottomUp })
  }
  if (optSizes.some((s) => s > 0)) {
    br.alignByte()
    for (let f = 0; f < nFrames; f++) {
      const bytes = new Uint8Array(optSizes[f])
      for (let i = 0; i < bytes.length; i++) bytes[i] = br.bits(8)
      meta[f].optionalData = bytes
    }
  }

  const equalCellSize = compression & 2 ? br.bits(20) : 0
  const pixelMaskSize = br.bits(20)
  let encTypeSize = 0
  let rawPixelSize = 0
  if (compression & 1) {
    encTypeSize = br.bits(20)
    rawPixelSize = br.bits(20)
  }
  const pixelValues: number[] = []
  for (let i = 0; i < 256; i++) if (br.bits(1)) pixelValues.push(i)

  const equalCell = new BitReader(buf, br.pos)
  const pixelMask = new BitReader(buf, br.pos + equalCellSize)
  const encType = new BitReader(buf, pixelMask.pos + pixelMaskSize)
  const rawPixel = new BitReader(buf, encType.pos + encTypeSize)
  const pixelCode = new BitReader(buf, rawPixel.pos + rawPixelSize)

  // Direction box
  const db: Box = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
  for (const b of boxes) {
    db.xMin = Math.min(db.xMin, b.xMin)
    db.yMin = Math.min(db.yMin, b.yMin)
    db.xMax = Math.max(db.xMax, b.xMax)
    db.yMax = Math.max(db.yMax, b.yMax)
  }
  const dirW = db.xMax - db.xMin + 1
  const dirH = db.yMax - db.yMin + 1
  const bufW = 1 + Math.floor((dirW - 1) / 4)
  const bufH = 1 + Math.floor((dirH - 1) / 4)
  const layouts = boxes.map((b) => frameCells(b, db))

  // Stage 1: fill the pixel buffer
  const cellBuf: (PbEntry | null)[] = new Array(bufW * bufH).fill(null)
  const pb: PbEntry[] = []
  for (let f = 0; f < nFrames; f++) {
    const L = layouts[f]
    for (let y = 0; y < L.nbH; y++) {
      for (let x = 0; x < L.nbW; x++) {
        const cur = L.cellX0 + x + (L.cellY0 + y) * bufW
        let mask = 0x0f
        const old = cellBuf[cur]
        if (old) {
          const eq = equalCellSize ? equalCell.bits(1) : 0
          if (eq) continue
          mask = pixelMask.bits(4)
        }
        const read = [0, 0, 0, 0]
        let last = 0
        let decoded = 0
        const nb = ((mask >> 0) & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)
        const enc = mask && encTypeSize ? encType.bits(1) : 0
        for (let i = 0; i < nb; i++) {
          if (enc) read[i] = rawPixel.bits(8)
          else {
            read[i] = last
            let disp: number
            do {
              disp = pixelCode.bits(4)
              read[i] += disp
            } while (disp === 15)
          }
          if (read[i] === last) {
            read[i] = 0
            break
          }
          last = read[i]
          decoded++
        }
        const entry: PbEntry = { val: [0, 0, 0, 0], frame: f, cellIndex: x + y * L.nbW }
        let idx = decoded - 1
        for (let i = 0; i < 4; i++) {
          if (mask & (1 << i)) entry.val[i] = idx >= 0 ? read[idx--] : 0
          else entry.val[i] = old ? old.val[i] : 0
        }
        cellBuf[cur] = entry
        pb.push(entry)
      }
    }
  }
  for (const e of pb) for (let i = 0; i < 4; i++) e.val[i] = pixelValues[e.val[i]] ?? 0

  // Stage 2: build frames
  const dirBmp = new Uint8Array(dirW * dirH)
  const lastCell: (Cell | null)[] = new Array(bufW * bufH).fill(null)
  let pbIdx = 0
  const frames: Frame[] = []
  for (let f = 0; f < nFrames; f++) {
    const L = layouts[f]
    L.cells.forEach((cell, c) => {
      const cx = L.cellX0 + (c % L.nbW)
      const cy = L.cellY0 + Math.floor(c / L.nbW)
      const cur = cx + cy * bufW
      const pbe = pb[pbIdx]
      if (!pbe || pbe.frame !== f || pbe.cellIndex !== c) {
        const prev = lastCell[cur]
        if (!prev || prev.w !== cell.w || prev.h !== cell.h) {
          for (let y = 0; y < cell.h; y++) dirBmp.fill(0, (cell.y0 + y) * dirW + cell.x0, (cell.y0 + y) * dirW + cell.x0 + cell.w)
        } else if (prev.x0 !== cell.x0 || prev.y0 !== cell.y0) {
          for (let y = 0; y < cell.h; y++)
            dirBmp.copyWithin((cell.y0 + y) * dirW + cell.x0, (prev.y0 + y) * dirW + prev.x0, (prev.y0 + y) * dirW + prev.x0 + cell.w)
        }
      } else {
        if (pbe.val[0] === pbe.val[1]) {
          for (let y = 0; y < cell.h; y++)
            dirBmp.fill(pbe.val[0], (cell.y0 + y) * dirW + cell.x0, (cell.y0 + y) * dirW + cell.x0 + cell.w)
        } else {
          const nbBit = pbe.val[1] === pbe.val[2] ? 1 : 2
          for (let y = 0; y < cell.h; y++)
            for (let x = 0; x < cell.w; x++) dirBmp[(cell.y0 + y) * dirW + cell.x0 + x] = pbe.val[pixelCode.bits(nbBit)]
        }
        pbIdx++
      }
      lastCell[cur] = cell
    })
    const b = boxes[f]
    const w = b.xMax - b.xMin + 1
    const h = b.yMax - b.yMin + 1
    const px = new Uint8Array(w * h)
    const ox = b.xMin - db.xMin
    const oy = b.yMin - db.yMin
    for (let y = 0; y < h; y++) px.set(dirBmp.subarray((oy + y) * dirW + ox, (oy + y) * dirW + ox + w), y * w)
    frames.push({ width: w, height: h, offsetX: b.xMin, offsetY: b.yMin, pixels: px })
  }
  return { frames, meta }
}

// ---------------------------------------------------------------------------------------------
// Encoder

function bitsIndexFor(maxUnsigned: number): number {
  for (let i = 0; i < CRAZY_BITS.length; i++) if (maxUnsigned < 2 ** CRAZY_BITS[i]) return i
  return 15
}

function signedBitsIndexFor(values: number[]): number {
  for (let i = 0; i < CRAZY_BITS.length; i++) {
    const b = CRAZY_BITS[i]
    if (b === 0) {
      if (values.every((v) => v === 0)) return i
      continue
    }
    if (values.every((v) => v >= -(2 ** (b - 1)) && v < 2 ** (b - 1))) return i
  }
  return 15
}

/** Find 4x4 cells using more than 4 distinct indices (the DCC limit). Returns cells in frame-local pixel coords. */
export function cellColorViolations(f: Frame, dirXMin: number, dirYMin: number): { x: number; y: number; w: number; h: number; colors: number }[] {
  const out: { x: number; y: number; w: number; h: number; colors: number }[] = []
  if (!f.width || !f.height) return out
  const L = frameCells({ xMin: f.offsetX, yMin: f.offsetY, xMax: f.offsetX + f.width - 1, yMax: f.offsetY + f.height - 1 }, { xMin: dirXMin, yMin: dirYMin, xMax: 0, yMax: 0 })
  const fx = f.offsetX - dirXMin
  const fy = f.offsetY - dirYMin
  for (const c of L.cells) {
    const set = new Set<number>()
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) set.add(f.pixels[(c.y0 - fy + y) * f.width + (c.x0 - fx + x)])
    if (set.size > 4) out.push({ x: c.x0 - fx, y: c.y0 - fy, w: c.w, h: c.h, colors: set.size })
  }
  return out
}

/**
 * The DCC cell grid is anchored at the direction box's top-left (the minimum over all frames).
 * Growing any frame past that minimum shifts the grid for every frame and re-slices original art
 * into new cells, which can push cells over the 4-colour limit. The encoder may pad the direction
 * box by 0–3 px on each axis; this picks the anchor with the fewest violations (preferring no pad).
 */
export function bestCellAnchor(frames: Frame[]): { x: number; y: number; violations: number } {
  let minX = Infinity
  let minY = Infinity
  for (const f of frames)
    if (f.width && f.height) {
      minX = Math.min(minX, f.offsetX)
      minY = Math.min(minY, f.offsetY)
    }
  if (minX === Infinity) return { x: 0, y: 0, violations: 0 }
  let best = { x: minX, y: minY, violations: Infinity }
  for (let py = 0; py < 4; py++)
    for (let px = 0; px < 4; px++) {
      let v = 0
      for (const f of frames) {
        if (!f.width || !f.height) continue
        v += cellColorViolations(f, minX - px, minY - py).length
        if (v >= best.violations) break
      }
      if (v < best.violations) best = { x: minX - px, y: minY - py, violations: v }
      if (v === 0) return best
    }
  return best
}

/** Reduce a cell's colours to <= 4 (keeps the most frequent, maps others to nearest kept by palette distance). */
function reduceCell(px: number[], palette?: Uint8Array): number[] {
  const counts = new Map<number, number>()
  for (const p of px) counts.set(p, (counts.get(p) ?? 0) + 1)
  if (counts.size <= 4) return px
  // Transparency is never traded for a colour: when a cell has transparent pixels, 0 is always one of the four kept.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
  const keep = counts.has(0) ? [0, ...ranked.filter((v) => v !== 0).slice(0, 3)] : ranked.slice(0, 4)
  const dist = (a: number, b: number) => {
    if (a === 0 || b === 0) return a === b ? 0 : 1e9
    if (!palette) return Math.abs(a - b)
    const dr = palette[a * 4] - palette[b * 4]
    const dg = palette[a * 4 + 1] - palette[b * 4 + 1]
    const db = palette[a * 4 + 2] - palette[b * 4 + 2]
    return dr * dr + dg * dg + db * db
  }
  return px.map((p) => (keep.includes(p) ? p : keep.reduce((best, k) => (dist(p, k) < dist(p, best) ? k : best), keep[0])))
}

export interface DccEncodeOptions {
  /** Palette used to pick nearest colours when a cell must be reduced to 4 colours. */
  palette?: Uint8Array
  frameMeta?: DccFrameMeta[][]
}

/**
 * A frame's size in DC6 run-length form. The game sizes its DCC decode buffers from these (frame CodedBytes,
 * direction OutSizeCoded, file FinalDc6Size); wrong values crash it with "Sprite Decompression Error".
 * Per row: transparent runs as one byte (0x80|n), opaque runs as n plus n bytes (runs of up to 127), no trailing
 * transparent run, then an 0x80 end-of-row byte.
 */
export function dc6CodedSize(f: Frame): number {
  let size = 0
  for (let y = 0; y < f.height; y++) {
    const row = y * f.width
    let end = f.width
    while (end > 0 && f.pixels[row + end - 1] === 0) end--
    let x = 0
    while (x < end) {
      const opaque = f.pixels[row + x] !== 0
      let n = 0
      while (x < end && n < 127 && (f.pixels[row + x] !== 0) === opaque) {
        x++
        n++
      }
      size += opaque ? 1 + n : 1
    }
    size += 1
  }
  return size
}

export function encodeDcc(s: Sprite, opts: DccEncodeOptions = {}): Uint8Array {
  // D2CMP.dll halts ("LINE: 1454") on unit frames over 256 px; such art must be split (unitSplit.ts: splitSprite + addTileLayers).
  if (exceedsUnitFrameLimit(s)) console.warn(`encodeDcc: a frame is larger than ${MAX_UNIT_FRAME}×${MAX_UNIT_FRAME} px; the game will not load this DCC. Split the layer first (unitSplit.splitSprite).`)
  // D2CMP.dll overruns a static buffer (ACCESS_VIOLATION) when a direction's frames span more than ~5,625 4x4 cells.
  if (dccDirectionCells(s) > MAX_DCC_DIRECTION_CELLS) console.warn(`encodeDcc: a direction spans ${dccDirectionCells(s)} 4x4 cells (limit ${MAX_DCC_DIRECTION_CELLS}); the game crashes on it. Save it as DC6 instead.`)
  const dirs = s.frames.map((fs, d) => encodeDirection(fs, opts.frameMeta?.[d], opts.palette))
  const headerSize = 15 + 4 * s.directions
  let total = headerSize
  for (const b of dirs) total += b.bytes.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  out[0] = 0x74
  out[1] = 6
  out[2] = s.directions
  dv.setUint32(3, s.framesPerDir, true)
  dv.setUint32(7, 1, true)
  // FinalDc6Size: the whole sprite as a DC6 (24-byte header, then per frame a 4-byte pointer, 32-byte header, data, 3-byte terminator).
  dv.setUint32(11, 24 + dirs.reduce((a, d) => a + d.coded.reduce((x, y) => x + y + 39, 0), 0), true)
  let p = headerSize
  dirs.forEach((b, d) => {
    dv.setUint32(15 + d * 4, p, true)
    out.set(b.bytes, p)
    p += b.bytes.length
  })
  return out
}

function encodeDirection(framesIn: Frame[], meta: DccFrameMeta[] | undefined, palette?: Uint8Array): { bytes: Uint8Array; coded: number[] } {
  // Empty frames still need a 1x1 box in DCC; represent them as a single transparent pixel.
  const frames = framesIn.map((f) =>
    f.width && f.height ? f : { width: 1, height: 1, offsetX: f.offsetX, offsetY: f.offsetY, pixels: new Uint8Array(1) }
  )
  // Anchor the cell grid where it causes the fewest 4-colour violations, by padding the frame(s)
  // that define the direction box's left/top edge with transparent pixels.
  const minX = Math.min(...frames.map((f) => f.offsetX))
  const minY = Math.min(...frames.map((f) => f.offsetY))
  // A direction with no opaque frame has nothing to anchor: (0,0) would stretch its 1x1 placeholders to the origin.
  const anchor = framesIn.some((f) => f.width && f.height) ? bestCellAnchor(framesIn) : { x: minX, y: minY, violations: 0 }
  if (anchor.x < minX) {
    const i = frames.findIndex((f) => f.offsetX === minX)
    const f = frames[i]
    frames[i] = expandFrame(f, anchor.x, f.offsetY, f.offsetX + f.width, f.offsetY + f.height)
  }
  if (anchor.y < minY) {
    const i = frames.findIndex((f) => f.offsetY === minY)
    const f = frames[i]
    frames[i] = expandFrame(f, f.offsetX, anchor.y, f.offsetX + f.width, f.offsetY + f.height)
  }
  const boxes: Box[] = frames.map((f) => ({ xMin: f.offsetX, yMin: f.offsetY, xMax: f.offsetX + f.width - 1, yMax: f.offsetY + f.height - 1 }))
  const db: Box = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
  for (const b of boxes) {
    db.xMin = Math.min(db.xMin, b.xMin)
    db.yMin = Math.min(db.yMin, b.yMin)
    db.xMax = Math.max(db.xMax, b.xMax)
    db.yMax = Math.max(db.yMax, b.yMax)
  }
  const dirW = db.xMax - db.xMin + 1
  const dirH = db.yMax - db.yMin + 1
  const bufW = 1 + Math.floor((dirW - 1) / 4)
  const bufH = 1 + Math.floor((dirH - 1) / 4)
  const layouts = boxes.map((b) => frameCells(b, db))

  // Gather cell pixel contents (after 4-colour reduction), and the set of used palette indices.
  const cellPixels: number[][][] = frames.map((f, fi) =>
    layouts[fi].cells.map((c) => {
      const px: number[] = []
      const ox = boxes[fi].xMin - db.xMin
      const oy = boxes[fi].yMin - db.yMin
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) px.push(f.pixels[(c.y0 - oy + y) * f.width + (c.x0 - ox + x)])
      return reduceCell(px, palette)
    })
  )
  const used = new Set<number>([0])
  for (const fc of cellPixels) for (const c of fc) for (const p of c) used.add(p)
  const pixelValues = [...used].sort((a, b) => a - b)
  const code = new Map(pixelValues.map((v, i) => [v, i]))

  const equalCell = new BitWriter()
  const pixelMask = new BitWriter()
  const pixelCode1 = new BitWriter() // stage 1 displacements
  const pixelCode2 = new BitWriter() // stage 2 per-pixel codes

  // Emulate the decoder's direction bitmap so equal-cell reuse produces exactly the intended image
  // (edge cells may be up to 5 px wide and overlap neighbours, so we compare against real state).
  const dirBmp = new Uint8Array(dirW * dirH)
  const cellSeen: boolean[] = new Array(bufW * bufH).fill(false)
  const lastCell: (Cell | null)[] = new Array(bufW * bufH).fill(null)
  const writeCell = (cell: Cell, px: number[]) => {
    for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) dirBmp[(cell.y0 + y) * dirW + cell.x0 + x] = px[y * cell.w + x]
  }
  for (let f = 0; f < frames.length; f++) {
    const L = layouts[f]
    L.cells.forEach((cell, c) => {
      const cx = L.cellX0 + (c % L.nbW)
      const cy = L.cellY0 + Math.floor(c / L.nbW)
      const cur = cx + cy * bufW
      const px = cellPixels[f][c]
      const prev = lastCell[cur]
      if (cellSeen[cur]) {
        // What the decoder would show if we flagged this cell as "equal"
        const reuse: number[] = []
        const sameSize = prev !== null && prev.w === cell.w && prev.h === cell.h
        for (let y = 0; y < cell.h; y++)
          for (let x = 0; x < cell.w; x++) reuse.push(sameSize ? dirBmp[(prev!.y0 + y) * dirW + prev!.x0 + x] : 0)
        if (reuse.every((v, i) => v === px[i])) {
          equalCell.bits(1, 1)
          writeCell(cell, px)
          lastCell[cur] = cell
          return
        }
        equalCell.bits(0, 1)
        pixelMask.bits(0x0f, 4)
      }
      cellSeen[cur] = true
      writeCell(cell, px)
      // Distinct codes in ascending order, excluding code 0 (implied by early termination).
      const codes = [...new Set(px.map((p) => code.get(p)!))].sort((a, b) => a - b)
      const nonZero = codes.filter((v) => v !== 0)
      let last = 0
      for (const v of nonZero) {
        let disp = v - last
        while (disp >= 15) {
          pixelCode1.bits(15, 4)
          disp -= 15
        }
        pixelCode1.bits(disp, 4)
        last = v
      }
      if (nonZero.length < 4) pixelCode1.bits(0, 4) // terminator
      // Decoder assigns val[] = decoded values in reverse, then zeros.
      const val = [0, 0, 0, 0]
      for (let i = 0; i < nonZero.length; i++) val[i] = nonZero[nonZero.length - 1 - i]
      if (val[0] !== val[1]) {
        const nbBit = val[1] === val[2] ? 1 : 2
        for (const p of px) {
          const k = code.get(p)!
          pixelCode2.bits(val.indexOf(k), nbBit)
        }
      }
      lastCell[cur] = cell
    })
  }

  const m = (f: number) => meta?.[f]
  const v0 = frames.map((_, f) => m(f)?.variable0 ?? 0)
  // Measure the frames as encoded: 4-colour reduction can turn transparent pixels opaque.
  const coded = frames.map((f, fi) => {
    const pixels = new Uint8Array(f.width * f.height)
    const ox = boxes[fi].xMin - db.xMin
    const oy = boxes[fi].yMin - db.yMin
    layouts[fi].cells.forEach((c, ci) => {
      let k = 0
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) pixels[(c.y0 - oy + y) * f.width + (c.x0 - ox + x)] = cellPixels[fi][ci][k++]
    })
    return dc6CodedSize({ ...f, pixels })
  })
  const opt = frames.map((_, f) => m(f)?.optionalData ?? new Uint8Array(0))
  const v0I = bitsIndexFor(Math.max(0, ...v0))
  const wI = bitsIndexFor(Math.max(...frames.map((f) => f.width)))
  const hI = bitsIndexFor(Math.max(...frames.map((f) => f.height)))
  const xI = signedBitsIndexFor(boxes.map((b) => b.xMin))
  const yI = signedBitsIndexFor(boxes.map((b) => b.yMax))
  const optI = bitsIndexFor(Math.max(0, ...opt.map((o) => o.length)))
  const codedI = bitsIndexFor(Math.max(0, ...coded))

  const bw = new BitWriter()
  // OutSizeCoded: the direction as DC6 frames (each frame's data plus its 32-byte header and 3-byte terminator).
  bw.bits(coded.reduce((a, c) => a + c + 35, 0), 32)
  bw.bits(2, 2) // compression: equal-cell stream present, no raw pixel stream
  for (const i of [v0I, wI, hI, xI, yI, optI, codedI]) bw.bits(i, 4)
  frames.forEach((f, i) => {
    bw.bits(v0[i], CRAZY_BITS[v0I])
    bw.bits(f.width, CRAZY_BITS[wI])
    bw.bits(f.height, CRAZY_BITS[hI])
    bw.signed(boxes[i].xMin, CRAZY_BITS[xI])
    bw.signed(boxes[i].yMax, CRAZY_BITS[yI])
    bw.bits(opt[i].length, CRAZY_BITS[optI])
    bw.bits(coded[i], CRAZY_BITS[codedI])
    bw.bits(0, 1) // top-down
  })
  if (opt.some((o) => o.length)) {
    bw.alignByte()
    for (const o of opt) for (const b of o) bw.bits(b, 8)
  }
  if (equalCell.pos >= 2 ** 20 || pixelMask.pos >= 2 ** 20) throw new Error('DCC: direction too large to encode')
  bw.bits(equalCell.pos, 20)
  bw.bits(pixelMask.pos, 20)
  for (let i = 0; i < 256; i++) bw.bits(used.has(i) ? 1 : 0, 1)
  bw.append(equalCell)
  bw.append(pixelMask)
  bw.append(pixelCode1)
  bw.append(pixelCode2)
  return { bytes: bw.bytes(), coded }
}
