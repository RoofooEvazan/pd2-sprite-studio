import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { decodeDt1, encodeDt1, tileImage } from '../src/core/dt1'
import { indexedToRgba, palettePath, parsePalDat } from '../src/core/palette'
import { writePng } from './pngNode'

const { vfs } = openGameVfs(defaultGameLocation())
const files = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) if (/\.dt1$/i.test(f)) files.add(f.toLowerCase())
console.log('DT1 files:', files.size)

let ok = 0
let exact = 0
const bad: string[] = []
const orient = new Map<number, number>()
const fmt = new Map<number, number>()
const wallStats = new Map<number, { hMin: number; hMax: number; yMin: number; yMax: number; xMin: number; xMax: number; widths: Set<number> }>()
const floorPos = new Set<string>()
for (const f of files) {
  const d = vfs.read(f)
  if (!d) continue
  try {
    const t = decodeDt1(d)
    ok++
    const re = encodeDt1(t)
    if (re.length === d.length && re.every((v, i) => v === d[i])) exact++
    else {
      const t2 = decodeDt1(re)
      const same = t.tiles.every((tt, i) => tt.blocks.every((b, j) => b.pixels.every((v, k) => v === t2.tiles[i].blocks[j].pixels[k])))
      if (!same) bad.push(f)
    }
    for (const tile of t.tiles) {
      orient.set(tile.orientation, (orient.get(tile.orientation) ?? 0) + 1)
      for (const b of tile.blocks) fmt.set(b.format, (fmt.get(b.format) ?? 0) + 1)
      if (tile.orientation === 0 && floorPos.size < 40) for (const b of tile.blocks) floorPos.add(`${b.x},${b.y}`)
      const s = wallStats.get(tile.orientation) ?? { hMin: 1e9, hMax: -1e9, yMin: 1e9, yMax: -1e9, xMin: 1e9, xMax: -1e9, widths: new Set<number>() }
      s.hMin = Math.min(s.hMin, tile.height)
      s.hMax = Math.max(s.hMax, tile.height)
      s.widths.add(tile.width)
      for (const b of tile.blocks) {
        s.yMin = Math.min(s.yMin, b.y)
        s.yMax = Math.max(s.yMax, b.y)
        s.xMin = Math.min(s.xMin, b.x)
        s.xMax = Math.max(s.xMax, b.x)
      }
      wallStats.set(tile.orientation, s)
    }
  } catch (e) {
    bad.push(`${f}: ${(e as Error).message}`)
  }
}
console.log(`decoded ${ok}, byte-exact ${exact}, pixel-mismatch/errors ${bad.length}`, bad.slice(0, 5))
console.log('orientations', [...orient.entries()].sort((a, b) => a[0] - b[0]))
console.log('block formats', [...fmt.entries()])
console.log('floor block positions', [...floorPos].sort().join(' '))
for (const [o, s] of [...wallStats.entries()].sort((a, b) => a[0] - b[0]))
  console.log(`orient ${o}: height ${s.hMin}..${s.hMax} widths ${[...s.widths].join(',')} block x ${s.xMin}..${s.xMax} y ${s.yMin}..${s.yMax}`)

// Dump a few tiles from an Act 1 set for a look
const pal = parsePalDat(vfs.read(palettePath('ACT1'))!)
const sample = [...files].find((f) => f.includes('act1') && f.includes('outdoors') && f.includes('stonewall')) ?? [...files].find((f) => f.includes('act1'))!
const d = decodeDt1(vfs.read(sample)!)
console.log('sample', sample, d.tiles.length, 'tiles')
const picks = [0, 1, 2, 15].map((o) => d.tiles.find((t) => t.orientation === o)).filter(Boolean)
picks.forEach((t, i) => {
  const im = tileImage(t!)
  writePng(`out-test/dt1_o${t!.orientation}_${i}.png`, im.width, im.height, indexedToRgba(im.pixels, pal))
  console.log(`tile o=${t!.orientation} main=${t!.mainIndex} sub=${t!.subIndex} h=${t!.height} w=${t!.width} dir=${t!.direction} roof=${t!.roofHeight} img ${im.width}x${im.height} origin ${im.originX},${im.originY} blocks ${t!.blocks.length}`)
})
