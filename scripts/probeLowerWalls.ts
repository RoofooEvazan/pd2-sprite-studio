// Find real maps with lower walls (orientations 16-19), gather their tile conventions, and render one
// with candidate placements so the correct one can be seen.
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { decodeDs1, Ds1 } from '../src/core/ds1'
import { decodeDt1, Dt1Tile } from '../src/core/dt1'
import { drawTile, indexTiles, tileKey } from '../src/core/mapRender'
import { newRgba } from '../src/core/composite'
import { palettePath, parsePalDat } from '../src/core/palette'
import { writePng } from './pngNode'

const { vfs } = openGameVfs(defaultGameLocation())
const all = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) all.add(f.toLowerCase())
const ds1s = [...all].filter((f) => f.endsWith('.ds1'))

const withLower: { f: string; n: number; size: number }[] = []
const prop = new Map<string, number>()
for (const f of ds1s) {
  let m: Ds1
  try {
    m = decodeDs1(vfs.read(f)!)
  } catch {
    continue
  }
  let n = 0
  for (const w of m.walls)
    w.cells.forEach((c, i) => {
      const o = w.orientations[i] & 0xff
      if (c.prop1 && o >= 16) {
        n++
        prop.set(`${o}:${c.prop1}`, (prop.get(`${o}:${c.prop1}`) ?? 0) + 1)
      }
    })
  if (n) withLower.push({ f, n, size: m.width * m.height })
}
console.log(`${withLower.length} maps use lower walls; prop1 values:`, [...prop].sort((a, b) => b[1] - a[1]).slice(0, 8))
withLower.sort((a, b) => b.n / b.size - a.n / a.size)
console.log('densest:', withLower.slice(0, 6).map((x) => `${x.f} (${x.n})`))

const dirs = new Map<string, number>()
const flags = new Map<string, number>()
for (const f of [...all].filter((x) => x.endsWith('.dt1')))
  try {
    for (const t of decodeDt1(vfs.read(f)!).tiles)
      if (t.orientation >= 16) {
        dirs.set(`o${t.orientation} dir${t.direction} fmt${t.blocks[0]?.format}`, (dirs.get(`o${t.orientation} dir${t.direction} fmt${t.blocks[0]?.format}`) ?? 0) + 1)
        const any = t.subtileFlags.some((v) => v)
        flags.set(`o${t.orientation} ${any ? 'has flags' : 'no flags'}`, (flags.get(`o${t.orientation} ${any ? 'has flags' : 'no flags'}`) ?? 0) + 1)
      }
  } catch {
    /* legacy */
  }
console.log('lower wall tiles (orientation, direction, block format):', [...dirs])
console.log('lower wall subtile flags:', [...flags])

// Render the densest small map three ways: lower walls at +0 or +80, drawn before or after floors
const pick = process.argv[2] ?? withLower.filter((x) => x.size < 900)[0].f
const map = decodeDs1(vfs.read(pick)!)
const tiles = new Map<string, Dt1Tile>()
for (const f of map.files) {
  const p = f.replace(/^.*?data\\global/i, 'data\\global').replace(/\.tg1$/i, '.dt1')
  const d = vfs.read(p)
  if (!d) continue
  try {
    indexTiles(decodeDt1(d).tiles, tiles)
  } catch {
    /* skip */
  }
}
const pal = parsePalDat(vfs.read(palettePath(`ACT${map.act}`))!)
console.log('render', pick, `${map.width}x${map.height} act ${map.act}`)
for (const [label, lowerOffset, lowerFirst] of [
  ['lower+0_before', 0, true],
  ['lower+80_before', 80, true],
  ['lower+0_after', 0, false]
] as [string, number, boolean][]) {
  const img = newRgba(-map.height * 80 - 40, -500, (map.width + map.height) * 80 + 240, (map.width + map.height) * 40 + 1400)
  for (let i = 0; i < img.data.length; i += 4) img.data.set([24, 24, 28, 255], i)
  const at = (x: number, y: number) => y * map.width + x
  const lower = () => {
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (const w of map.walls) {
          const c = w.cells[at(x, y)]
          const o = w.orientations[at(x, y)] & 0xff
          if (!c.prop1 || o < 16) continue
          const t = tiles.get(tileKey(o, c.style, c.sequence))
          if (t) drawTile(img, t, (x - y) * 80, (x + y) * 40 + lowerOffset, pal)
        }
  }
  if (lowerFirst) lower()
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      for (const fl of map.floors) {
        const c = fl[at(x, y)]
        const t = c.prop1 ? tiles.get(tileKey(0, c.style, c.sequence)) : undefined
        if (t) drawTile(img, t, (x - y) * 80, (x + y) * 40, pal)
      }
  if (!lowerFirst) lower()
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      for (const w of map.walls) {
        const c = w.cells[at(x, y)]
        const o = w.orientations[at(x, y)] & 0xff
        if (!c.prop1 || o === 0 || o >= 13) continue
        const t = tiles.get(tileKey(o, c.style, c.sequence))
        if (t) drawTile(img, t, (x - y) * 80, (x + y) * 40 + 80, pal)
      }
  writePng(`out-test/lower_${label}.png`, img.width, img.height, img.data)
}
console.log('wrote out-test/lower_*.png')
