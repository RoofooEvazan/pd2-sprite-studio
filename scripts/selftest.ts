// Self-test against the local game install: decode/encode round trips and PNG dumps to out-test/.
import fs from 'node:fs'
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { decodeDc6, encodeDc6 } from '../src/core/dc6'
import { indexedToRgba, palettePath, parsePalDat } from '../src/core/palette'
import { writePng } from './pngNode'
import { COMPOSITS, decodeCof, encodeCof, decodeAnimData } from '../src/core/cof'
import { buildCatalog, cofPath } from '../src/core/catalog'
import { decodeLayerFile, encodeLayerFile, layerFormat, layerPath } from '../src/core/unitLayer'
import { compositeFrame, LayerInput } from '../src/core/composite'
import { frameToTile, sameTilePixels, tileToFrame } from '../src/core/tileEdit'
import { decodeDcc, encodeDcc } from '../src/core/dcc'
import { addTileLayers, dccDirectionCells, exceedsUnitFrameLimit, MAX_DCC_DIRECTION_CELLS, MAX_UNIT_FRAME, splitSprite } from '../src/core/unitSplit'
import { expandFrame, spriteBounds } from '../src/core/sprite'
import { PX_PER_HEIGHT, sliceScene } from '../src/core/tileSlicer'
import { decodeDt1, encodeDt1 } from '../src/core/dt1'
import { decodeDs1, encodeDs1 } from '../src/core/ds1'
import { indexTiles, renderMap } from '../src/core/mapRender'
import { mapDirections, mapFrames, PaletteLut, renderToFrame } from '../src/core/renderImport'
import { addOutline, cleanStrays, flipH, mirrorDir, rampOf, rampSwapMap, shadeStep } from '../src/core/edit'

const OUT = 'out-test'
fs.mkdirSync(OUT, { recursive: true })
const { vfs } = openGameVfs(defaultGameLocation())
const pal = parsePalDat(vfs.read(palettePath('ACT1'))!)

let failures = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}

// --- DC6 round trip over every inventory DC6 in all listfiles
const dc6Files = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) if (/\\items\\inv.*\.dc6$/i.test(f)) dc6Files.add(f.toLowerCase())
let rtOk = 0
let byteExact = 0
const bad: string[] = []
for (const f of dc6Files) {
  const data = vfs.read(f)
  if (!data) continue
  try {
    const s = decodeDc6(data)
    const re = encodeDc6(s, s.meta)
    const s2 = decodeDc6(re)
    const same = s.frames.flat().every((fr, i) => {
      const g = s2.frames.flat()[i]
      return fr.width === g.width && fr.height === g.height && fr.offsetX === g.offsetX && fr.offsetY === g.offsetY && fr.pixels.every((v, j) => v === g.pixels[j])
    })
    if (same) rtOk++
    else bad.push(f)
    if (re.length === data.length && re.every((v, i) => v === data[i])) byteExact++
  } catch (e) {
    bad.push(`${f}: ${(e as Error).message}`)
  }
}
check(bad.length === 0, `DC6 round trip: ${rtOk}/${dc6Files.size} pixel-identical, ${byteExact} byte-identical ${bad.slice(0, 5).join(', ')}`)

const axe = decodeDc6(vfs.read('data\\global\\items\\invaxe.dc6')!)
const fr = axe.frames[0][0]
writePng(`${OUT}/invaxe.png`, fr.width, fr.height, indexedToRgba(fr.pixels, pal))
console.log(`invaxe: ${fr.width}x${fr.height} offset ${fr.offsetX},${fr.offsetY}`)

// --- COF parse over all COFs
const allFiles = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) allFiles.add(f.toLowerCase())
// amblxbow.cof is a known-corrupt 72-byte stub in vanilla D2
const cofs = [...allFiles].filter((f) => f.endsWith('.cof') && !f.endsWith('amblxbow.cof'))
let cofOk = 0
const cofBad: string[] = []
for (const f of cofs) {
  const d = vfs.read(f)
  if (!d) continue
  try {
    const c = decodeCof(d)
    const re = encodeCof(c)
    if (re.length <= d.length && re.every((v, i) => v === d[i])) cofOk++
    else cofBad.push(`${f} (len ${d.length} vs ${re.length})`)
  } catch (e) {
    cofBad.push(`${f}: ${(e as Error).message}`)
  }
}
check(cofBad.length === 0, `COF parse+rewrite: ${cofOk}/${cofs.length} ${cofBad.slice(0, 3).join(', ')}`)

const ad = decodeAnimData(vfs.read('data\\global\\animdata.d2')!)
const banu = ad.get('BANUHTH')
check(!!banu, `animdata: ${ad.size} records, BANUHTH frames=${banu?.framesPerDir} speed=${banu?.speed}`)

// --- DCC decode + encode round trip on a sample of char/monster DCCs
const dccs = [...allFiles].filter((f) => f.endsWith('.dcc'))
const sample = dccs.filter((_, i) => i % Math.max(1, Math.floor(dccs.length / 250)) === 0)
let dccOk = 0
let dccRt = 0
let sizeOrig = 0
let sizeNew = 0
const dccBad: string[] = []
const t0 = Date.now()
for (const f of sample) {
  const d = vfs.read(f)
  if (!d) continue
  try {
    const s = decodeDcc(d)
    dccOk++
    const re = encodeDcc(s, { frameMeta: s.frameMeta })
    const s2 = decodeDcc(re)
    const same = s.frames.flat().every((fr, i) => {
      const g = s2.frames.flat()[i]
      return fr.width === g.width && fr.height === g.height && fr.offsetX === g.offsetX && fr.offsetY === g.offsetY && fr.pixels.every((v, j) => v === g.pixels[j])
    })
    if (same) dccRt++
    else dccBad.push(`${f} (roundtrip differs)`)
    sizeOrig += d.length
    sizeNew += re.length
  } catch (e) {
    dccBad.push(`${f}: ${(e as Error).message}`)
  }
}
check(
  dccBad.length === 0,
  `DCC: decoded ${dccOk}/${sample.length} of ${dccs.length}, round trip ${dccRt}, size ratio ${(sizeNew / sizeOrig).toFixed(2)}, ${Date.now() - t0}ms ${dccBad.slice(0, 4).join(', ')}`
)

// --- Dump a barbarian torso (neutral, 1-hand-swing) direction 0 strip
const tr = decodeDcc(vfs.read('data\\global\\chars\\BA\\TR\\BATRLITNUHTH.dcc')!)
{
  const fs0 = tr.frames[0]
  const b = spriteBounds(fs0)
  const W = (b.x1 - b.x0) * fs0.length
  const H = b.y1 - b.y0
  const rgba = new Uint8ClampedArray(W * H * 4)
  fs0.forEach((fr, i) => {
    const px = indexedToRgba(fr.pixels, pal)
    for (let y = 0; y < fr.height; y++)
      for (let x = 0; x < fr.width; x++) {
        const tx = i * (b.x1 - b.x0) + fr.offsetX - b.x0 + x
        const ty = fr.offsetY - b.y0 + y
        rgba.set(px.subarray((y * fr.width + x) * 4, (y * fr.width + x) * 4 + 4), (ty * W + tx) * 4)
      }
  })
  writePng(`${OUT}/batr_nu_dir0.png`, W, H, rgba)
  console.log(`BATRLITNUHTH: ${tr.directions} dirs x ${tr.framesPerDir} frames`)
}

// --- Editing operations
{
  check(mirrorDir(8, 0) === 3 && mirrorDir(8, 1) === 2 && mirrorDir(8, 5) === 7 && mirrorDir(8, 4) === 4, 'mirrorDir 8: SW<->SE, NW<->NE, W<->E, S=S')
  check([...Array(16).keys()].every((d) => mirrorDir(16, mirrorDir(16, d)) === d), 'mirrorDir 16 is an involution')
  const idx = decodeDcc(vfs.read('data\\global\\chars\\BA\\TR\\BATRLITNUHTH.dcc')!).frames[0][0].pixels.find((p) => p > 0)!
  const ramp = rampOf(pal, idx)
  check(ramp.length >= 3 && ramp.includes(idx), `shade ramp for ${idx}: ${ramp.join(',')}`)
  const lighter = shadeStep(pal, idx, -1)
  const darker = shadeStep(pal, idx, 1)
  const L = (i: number) => 0.3 * pal[i * 4] + 0.59 * pal[i * 4 + 1] + 0.11 * pal[i * 4 + 2]
  check(L(lighter) >= L(idx) && L(darker) <= L(idx), `shadeStep lighter ${lighter} / darker ${darker} brackets ${idx}`)
  const swap = rampSwapMap(pal, idx, 151)
  check(swap.get(idx) === 151 && swap.size === ramp.length, 'rampSwapMap anchors clicked colour to target')
  const dot = { width: 3, height: 3, offsetX: 0, offsetY: 0, pixels: new Uint8Array([0, 0, 0, 0, 5, 0, 0, 0, 0]) }
  const ol = addOutline(dot, pal, { kind: 'fixed', index: 9 }, false)
  check(ol.width === 5 && ol.pixels.filter((p) => p === 9).length === 4, 'addOutline adds 4-way outline and grows frame')
  const cs = cleanStrays(dot)
  check(cs.removed === 1 && cs.frame.pixels.every((p) => !p), 'cleanStrays removes isolated pixel')
  const hole = { width: 3, height: 3, offsetX: 0, offsetY: 0, pixels: new Uint8Array([7, 7, 7, 7, 0, 7, 7, 7, 7]) }
  check(cleanStrays(hole).filled === 1, 'cleanStrays fills pinhole')
  const fh = flipH({ width: 2, height: 1, offsetX: 3, offsetY: 0, pixels: new Uint8Array([1, 2]) }, true)
  check(fh.pixels[0] === 2 && fh.offsetX === -5, 'flipH around origin')

  // Growing a frame past the direction box must not degrade untouched art (cell grid anchoring)
  const src = decodeDcc(vfs.read('data\\global\\chars\\BA\\TR\\BATRLITA11HS.dcc')!)
  const dir0 = src.frames[0]
  const minY = Math.min(...dir0.map((f) => f.offsetY))
  const f0 = dir0[0]
  const grown = expandFrame(f0, f0.offsetX, minY - 3, f0.offsetX + f0.width, f0.offsetY + f0.height)
  grown.pixels[0] = 12 // one new pixel 3px above the whole direction
  const edited = { ...src, frames: src.frames.map((d, i) => (i === 0 ? [grown, ...d.slice(1)] : d)) }
  const back = decodeDcc(encodeDcc(edited))
  const px = (f: { width: number; height: number; offsetX: number; offsetY: number; pixels: Uint8Array }, x: number, y: number) => {
    const lx = x - f.offsetX
    const ly = y - f.offsetY
    return lx >= 0 && ly >= 0 && lx < f.width && ly < f.height ? f.pixels[ly * f.width + lx] : 0
  }
  let lost = 0
  dir0.forEach((orig, i) => {
    const want = i === 0 ? grown : orig
    for (let y = want.offsetY; y < want.offsetY + want.height; y++)
      for (let x = want.offsetX; x < want.offsetX + want.width; x++) if (px(want, x, y) !== px(back.frames[0][i], x, y)) lost++
  })
  check(lost === 0, `grow-above-direction edit re-encodes losslessly (${lost} px differ)`)
}

// --- 3D render import
{
  check(mapDirections(16, 16).every((v, i) => v === i), 'render import: 16→16 facings map one to one')
  const m816 = mapDirections(8, 16)
  check(m816.slice(0, 8).every((v, i) => v === i) && m816.every((v) => v >= 0 && v < 8), 'render import: 8 rendered facings fill 16 (exact ones kept)')
  const m168 = mapDirections(16, 8)
  check(m168.every((v, i) => v === i), 'render import: 16→8 picks the matching facings')
  check(mapFrames(8, 16).join() === '0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,7' && mapFrames(16, 16).every((v, i) => v === i), 'render import: frames resample to target count')
  // 20x20 render, opaque 4x5 block at x 8-11, y 5-9, feet (origin) at (10,10)
  const rgba = new Uint8ClampedArray(20 * 20 * 4)
  for (let y = 5; y < 10; y++)
    for (let x = 8; x < 12; x++) rgba.set([200, 40, 30, 255], (y * 20 + x) * 4)
  const lut = new PaletteLut(pal)
  const fr = renderToFrame({ dir: 0, frame: 0, width: 20, height: 20, rgba }, lut, { originX: 10, originY: 10, scale: 1, alphaThreshold: 128, dither: false })
  check(fr.width === 4 && fr.height === 5 && fr.offsetX === -2 && fr.offsetY === -5 && fr.pixels.every((p) => p > 0), 'render import: frame placed relative to ground point')
  const half = renderToFrame({ dir: 0, frame: 0, width: 20, height: 20, rgba }, lut, { originX: 10, originY: 10, scale: 0.5, alphaThreshold: 100, dither: true })
  check(half.width >= 2 && half.width <= 3 && half.offsetY + half.height === 0, `render import: 50% scale keeps feet on the ground (${half.width}x${half.height} @ ${half.offsetX},${half.offsetY})`)
}

// --- Units whose body parts are DC6 instead of DCC (Mephisto, parts of Diablo, …)
{
  const files: string[] = []
  for (const a of vfs.archives) files.push(...a.listfile())
  const cat = buildCatalog(files, (n) => vfs.read(`data\\global\\excel\\${n}.txt`))
  const mp = cat.units.find((u) => u.base === 'monsters' && u.token === 'MP')!
  check(!!mp && mp.dc6.length > 30 && (mp.armtypes.TR ?? []).includes('LIT'), `catalog: Mephisto's ${mp?.dc6.length} DC6 parts are indexed`)
  let ok = 0
  let total = 0
  const badParts: string[] = []
  for (const u of cat.units)
    for (const stem of u.dc6) {
      const comp = COMPOSITS.find((c) => stem.startsWith(c) && u.armtypes[c]?.some((a) => stem.startsWith(c + a)))
      if (!comp) continue
      const rest = stem.slice(comp.length)
      const arm = rest.slice(0, rest.length - 5)
      const path = layerPath(u, comp, arm, rest.slice(-5, -3), rest.slice(-3), layerFormat(u, comp, arm, rest.slice(-5, -3), rest.slice(-3)))
      const data = vfs.read(path)
      if (!data) continue
      total++
      try {
        const a = decodeLayerFile(data, 'dc6')
        const b = decodeLayerFile(encodeLayerFile(a.sprite, 'dc6', { palette: pal, dc6Meta: a.dc6Meta }), 'dc6')
        const same = a.sprite.frames.flat().every((f, i) => {
          const g = b.sprite.frames.flat()[i]
          return f.width === g.width && f.height === g.height && f.offsetX === g.offsetX && f.offsetY === g.offsetY && f.pixels.every((v, j) => v === g.pixels[j])
        })
        if (same) ok++
        else badParts.push(path)
      } catch (e) {
        badParts.push(`${path}: ${(e as Error).message}`)
      }
    }
  check(total > 60 && ok === total, `DC6 body parts: ${ok}/${total} decode → encode → decode pixel-identical ${badParts.slice(0, 3).join(', ')}`)

  // Mephisto's neutral animation composites into a real picture
  const cof = decodeCof(vfs.read(cofPath(mp, 'NU', 'HTH'))!)
  const layers = new Map<number, LayerInput>()
  for (const l of cof.layers) {
    const comp = COMPOSITS[l.composit]
    const arm = (mp.armtypes[comp] ?? []).find((a) => mp.dccs.includes(`${comp}${a}NU${l.weaponClass}`))
    const data = arm ? vfs.read(layerPath(mp, comp, arm, 'NU', l.weaponClass, layerFormat(mp, comp, arm, 'NU', l.weaponClass))) : null
    layers.set(l.composit, { sprite: data ? decodeLayerFile(data, layerFormat(mp, comp, arm!, 'NU', l.weaponClass)).sprite : null, visible: true })
  }
  const im = compositeFrame(cof, layers, pal, 0, 0)
  let opaque = 0
  for (let i = 3; i < im.data.length; i += 4) if (im.data[i]) opaque++
  writePng(`${OUT}/mephisto_nu_d0.png`, im.width, im.height, im.data)
  check(opaque > 3000, `Mephisto NU composite: ${im.width}x${im.height}, ${opaque} opaque px (out-test/mephisto_nu_d0.png)`)
}

// --- DT1 tiles in the sprite editor: tile → picture → tile is exact; new art above a wall gets its own blocks
{
  const dt1s = new Set<string>()
  for (const a of vfs.archives) for (const f of a.listfile()) if (/\.dt1$/i.test(f)) dt1s.add(f.toLowerCase())
  const sample = [...dt1s].filter((_, i) => i % 4 === 0)
  let tiles = 0
  let exact = 0
  let files = 0
  let filesExact = 0
  for (const f of sample) {
    const data = vfs.read(f)
    if (!data) continue
    let d
    try {
      d = decodeDt1(data)
    } catch {
      continue // legacy v4 files
    }
    files++
    const back = { ...d, tiles: d.tiles.map((t) => frameToTile(t, tileToFrame(t))) }
    for (let i = 0; i < d.tiles.length; i++) {
      tiles++
      if (sameTilePixels(d.tiles[i], back.tiles[i])) exact++
    }
    const a = encodeDt1(d)
    const b = encodeDt1(back)
    if (a.length === b.length && a.every((v, i) => v === b[i])) filesExact++
  }
  check(tiles > 1000 && exact === tiles && filesExact === files, `DT1 tile editing: ${exact}/${tiles} tiles in ${files} files round-trip through the editor picture, ${filesExact}/${files} files byte-identical`)
  const wall = decodeDt1(vfs.read('data\\global\\tiles\\guild\\house1\\int.dt1')!).tiles.find((t) => t.orientation === 2)!
  const fr = tileToFrame(wall)
  const topY = Math.min(...wall.blocks.map((b) => b.y))
  const px = 120
  const py = topY - 10 // in the headroom above the wall
  fr.pixels[(py - fr.offsetY) * fr.width + (px - fr.offsetX)] = 200
  const edited = decodeDt1(encodeDt1({ version1: 7, version2: 6, tiles: [frameToTile(wall, fr)] })).tiles[0]
  const back = tileToFrame(edited)
  const got = back.pixels[(py - back.offsetY) * back.width + (px - back.offsetX)]
  check(got === 200 && edited.height <= wall.height, `DT1 tile editing: a pixel painted above a wall is saved in a new block (height ${wall.height} → ${edited.height})`)
}

// --- Tile Maker: slice a synthetic scene, write DT1 + DS1, re-render with game rules, compare
{
  const W = 3
  const H = 3
  const ox = 260
  const oy = 220
  const iw = 540
  const ih = 660
  const floor = new Uint8Array(iw * ih)
  const wall = new Uint8Array(iw * ih)
  const wallPos = new Float32Array(iw * ih * 4)
  const lower = new Uint8Array(iw * ih)
  const lowerPos = new Float32Array(iw * ih * 4)
  const below = new Uint8Array(iw * ih) // wall-role pixels under the ground (auto lower walls)
  const K = PX_PER_HEIGHT
  for (let py = 0; py < ih; py++)
    for (let px = 0; px < iw; px++) {
      const i = py * iw + px
      const a = (px + 0.5 - ox) / 80 // X - Z
      const b = (py + 0.5 - oy) / 40 // X + Z (on the ground)
      const X = (a + b) / 2
      const Z = (b - a) / 2
      if (X >= 0 && Z >= 0 && X < W && Z < H) floor[i] = 1 + ((Math.floor(X) * 3 + Math.floor(Z)) * 11 + ((Math.floor(X * 5) + Math.floor(Z * 5)) % 2) * 5)
      // left wall on plane X = 0 (2 units tall), right wall on plane Z = 0
      const zL = -(px + 0.5 - ox) / 80
      const yL = (zL * 40 - (py + 0.5 - oy)) / K
      if (zL >= 0 && zL < H && yL >= 0 && yL < 2) {
        wall[i] = 120 + (Math.floor(zL * 4) % 4) * 8 + (Math.floor(yL * 4) % 4)
        wallPos.set([0.001, yL, zL, 1], i * 4)
      }
      const xR = (px + 0.5 - ox) / 80
      const yR = (xR * 40 - (py + 0.5 - oy)) / K
      if (xR >= 0 && xR < W && yR >= 0 && yR < 2) {
        wall[i] = 170 + (Math.floor(xR * 4) % 4) * 8 + (Math.floor(yR * 4) % 4)
        wallPos.set([xR, yR, 0.001, 1], i * 4)
      }
      // Lower-wall part: a cliff face hanging 1.5 tiles below the front-right edge (plane X = 3)
      const zC = 3 - (px + 0.5 - ox) / 80
      const yC = ((3 + zC) * 40 - (py + 0.5 - oy)) / K
      if (zC >= 0 && zC < H && yC < 0 && yC >= -1.5) {
        lower[i] = 60 + (Math.floor(zC * 4) % 4) * 6 + (Math.floor(-yC * 4) % 4)
        lowerPos.set([3, yC, zC, 1], i * 4)
      }
      // Wall-role part below the ground along the front-left edge (plane Z = 3): must become lower walls by height.
      // (Parts lying entirely below ground are auto-marked "Lower wall" by the engine; this band starts just below
      // the ground tolerance to exercise the per-pixel split used for parts that cross the ground.)
      const xD = 3 + (px + 0.5 - ox) / 80
      const yD = ((xD + 3) * 40 - (py + 0.5 - oy)) / K
      if (xD >= 0 && xD < W && yD < -0.03 && yD >= -1) {
        wall[i] = 90 + (Math.floor(xD * 4) % 4) * 6 + (Math.floor(-yD * 4) % 4)
        wallPos.set([xD, yD, 3, 1], i * 4)
        below[i] = 1
      }
    }
  const res = sliceScene(
    { mapWidth: W, mapHeight: H, imageWidth: iw, imageHeight: ih, originX: ox, originY: oy, floor, wall, wallPos, lower, lowerPos, roof: null, roofPx: 0 },
    { name: 'test', act: 1, mainIndex: 30, split: true, dt1Path: (k) => `\\d2\\data\\global\\tiles\\act1\\test\\test_${k}.dt1` }
  )
  check(res.files.map((f) => f.kind).join() === 'floor,walls' && res.ds1.files.length === 2, `tile maker: split into ${res.files.map((f) => f.path.split('\\').pop()).join(' + ')}`)
  // Re-read each written file separately, as the game would
  const dt1 = { tiles: res.files.flatMap((f) => decodeDt1(encodeDt1(f.dt1)).tiles) }
  const ds1 = decodeDs1(encodeDs1(res.ds1))
  const { image, missing } = renderMap(ds1, indexTiles(dt1.tiles), pal)
  let compared = 0
  let wrong = 0
  for (let py = 0; py < ih; py++)
    for (let px = 0; px < iw; px++) {
      // Game draw order: lower walls, then floors, then walls
      const i0 = py * iw + px
      const upper = below[i0] ? 0 : wall[i0]
      const low = lower[i0] || (below[i0] ? wall[i0] : 0)
      const v = upper || floor[i0] || low
      if (!v) continue
      if (!upper && floor[i0]) {
        // Diamond floor blocks stop one pixel short of the scene's outer rim (same as game tiles)
        const X = ((px + 0.5 - ox) / 80 + (py + 0.5 - oy) / 40) / 2
        const Z = ((py + 0.5 - oy) / 40 - (px + 0.5 - ox) / 80) / 2
        if (X > W - 0.03 || Z > H - 0.03) continue
      }
      const X = px - (ox - 80) - image.x0
      const Y = py - oy - image.y0
      if (X < 0 || Y < 0 || X >= image.width || Y >= image.height) continue
      compared++
      const o = (Y * image.width + X) * 4
      if (image.data[o + 3] === 0 || image.data[o] !== pal[v * 4] || image.data[o + 1] !== pal[v * 4 + 1] || image.data[o + 2] !== pal[v * 4 + 2]) {
        wrong++
        if (process.env.TM_DEBUG && wrong <= 12)
          console.log(`  mismatch at scene px ${px},${py} (${wall[py * iw + px] ? 'wall' : 'floor'} ${v}) rendered alpha ${image.data[o + 3]}; rel to origin ${px - ox},${py - oy}`)
      }
    }
  check(missing === 0 && res.stats.floors === 9 && res.stats.walls === 6 && res.stats.lowerWalls === 6, `tile maker: ${res.stats.floors} floor + ${res.stats.walls} wall + ${res.stats.lowerWalls} lower-wall tiles (${res.stats.unique} unique), DS1 ${ds1.width}x${ds1.height}, ${res.stats.blockedSubtiles} blocked subtiles`)
  check(wrong === 0 && compared > 50000, `tile maker: game-rule re-render matches the scene (${compared - wrong}/${compared} px)`)
  const leftWall = dt1.tiles.find((t) => t.orientation === 1)!
  check([0, 5, 10, 15, 20].every((i) => leftWall.subtileFlags[i] === 7), 'tile maker: left wall blocks its edge column like the game does')
  const lowers = dt1.tiles.filter((t) => t.orientation >= 16)
  check(lowers.length > 0 && lowers.every((t) => (t.orientation === 16 ? t.direction === 6 : t.direction === 7) && t.subtileFlags.every((f) => !f)), 'tile maker: lower walls use the game conventions (orientation 16/17, direction 6/7, no walk flags)')
  check(res.stats.droppedOverlaps === 0 && ds1.walls.length === 4, 'tile maker: walls, lower walls and roofs fit the 4 wall layers')
  writePng('out-test/tilemaker_selftest.png', image.width, image.height, image.data)
}

// --- Unit frame limit: art over 256 px is split into tiles that encode within the limit and re-assemble exactly
{
  // The Overseer's whip arm (Act 5, frames up to 189 px wide) at 2x, as the boss scaler would make it
  const src = decodeDcc(vfs.read('data\\global\\monsters\\OS\\LH\\OSLHLITA2HTH.dcc')!)
  const up = (k: number) => ({
    directions: src.directions,
    framesPerDir: src.framesPerDir,
    frames: src.frames.map((d) =>
      d.map((f) => {
        const w = f.width * k, h = f.height * k, px = new Uint8Array(w * h)
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = f.pixels[Math.floor(y / k) * f.width + Math.floor(x / k)]
        return { width: w, height: h, offsetX: f.offsetX * k, offsetY: f.offsetY * k, pixels: px }
      })
    )
  })
  const big = up(2)
  const tiles = splitSprite(big)
  const decoded = tiles.map((t) => decodeDcc(encodeDcc(t)))
  const within = decoded.every((t) => !exceedsUnitFrameLimit(t))
  let same = exceedsUnitFrameLimit(big)
  for (let d = 0; d < big.directions && same; d++)
    for (let fr = 0; fr < big.framesPerDir && same; fr++) {
      const o = big.frames[d][fr]
      const m = new Map<string, number>()
      for (const t of decoded) {
        const g = t.frames[d][fr]
        for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (g.pixels[y * g.width + x]) m.set(`${g.offsetX + x},${g.offsetY + y}`, g.pixels[y * g.width + x])
      }
      let n = 0
      for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) { const v = o.pixels[y * o.width + x]; if (v) { n++; if (m.get(`${o.offsetX + x},${o.offsetY + y}`) !== v) same = false } }
      if (n !== m.size) same = false
    }
  const biggest = Math.max(...big.frames.flat().map((f) => Math.max(f.width, f.height)))
  check(tiles.length > 1 && within && same, `unit split: 2x Overseer whip arm (frames up to ${biggest} px) → ${tiles.length} tiles, all ≤${MAX_UNIT_FRAME} px after DCC encoding, re-assembled pixel-exact`)
  const cof = decodeCof(vfs.read('data\\global\\monsters\\ZM\\COF\\ZMNUHTH.cof')!)
  const tr = cof.layers.findIndex((l) => l.composit === 1)
  const c2 = decodeCof(encodeCof(addTileLayers(cof, 1, [15, 14])))
  const orderOk = c2.order.every((dir) => dir.every((fr) => { const i = fr.indexOf(1); return fr[i + 1] === 15 && fr[i + 2] === 14 }))
  check(tr >= 0 && c2.layers.length === cof.layers.length + 2 && c2.framesPerDir === cof.framesPerDir && c2.directions === cof.directions && orderOk && c2.layers[c2.layers.length - 1].drawEffect === cof.layers[tr].drawEffect, 'unit split: COF gets the tile layers right after the split layer, same counts and draw effect')
  // D2CMP's static DCC cell buffer holds 5,625 4x4 cells per direction; the game's widest monster direction (this whip) uses 5,429
  const whipCells = dccDirectionCells(src)
  check(whipCells > 5000 && whipCells < 5625 && MAX_DCC_DIRECTION_CELLS <= 5625 && whipCells <= MAX_DCC_DIRECTION_CELLS && dccDirectionCells(big) > MAX_DCC_DIRECTION_CELLS, `unit split: DCC direction cell measure (the game's Overseer whip: ${whipCells} cells, within the limit; 2x: ${dccDirectionCells(big)} > limit ${MAX_DCC_DIRECTION_CELLS})`)
}

console.log(failures ? `${failures} FAILURES` : 'ALL PASSED')
process.exit(failures ? 1 : 0)
