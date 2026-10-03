// DS1 round trip over every map preset, plus a rendered map to check tile placement conventions.
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { decodeDs1, encodeDs1, Ds1 } from '../src/core/ds1'
import { decodeDt1, Dt1Tile } from '../src/core/dt1'
import { palettePath, parsePalDat } from '../src/core/palette'
import { writePng } from './pngNode'

const { vfs } = openGameVfs(defaultGameLocation())
const all = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) all.add(f.toLowerCase())
const ds1s = [...all].filter((f) => f.endsWith('.ds1'))
let ok = 0
let exact = 0
const bad: string[] = []
const versions = new Map<number, number>()
for (const f of ds1s) {
  const d = vfs.read(f)
  if (!d) continue
  try {
    const m = decodeDs1(d)
    ok++
    versions.set(m.version, (versions.get(m.version) ?? 0) + 1)
    const re = encodeDs1(m)
    if (re.length === d.length && re.every((v, i) => v === d[i])) exact++
    else bad.push(`${f} (len ${d.length} vs ${re.length})`)
  } catch (e) {
    bad.push(`${f}: ${(e as Error).message}`)
  }
}
console.log(`DS1: ${ds1s.length} files, decoded ${ok}, byte-exact ${exact}`, bad.slice(0, 5))
console.log('versions', [...versions.entries()].sort((a, b) => a[0] - b[0]))

// Render a map to check how floors and walls line up
const target = process.argv[2] ?? ds1s.find((f) => f.includes('act1\\court')) ?? ds1s.find((f) => f.includes('act1'))!
const wallOffset = +(process.argv[3] ?? 80)
const map = decodeDs1(vfs.read(target)!)
console.log('render', target, `${map.width}x${map.height} act ${map.act} walls ${map.walls.length} floors ${map.floors.length}`, map.files.slice(0, 8))
const tiles = new Map<string, Dt1Tile>()
for (const f of map.files) {
  const p = f.replace(/^.*?data\\global/i, 'data\\global').replace(/\.tg1$/i, '.dt1')
  const d = vfs.read(p)
  if (!d) continue
  try {
    for (const t of decodeDt1(d).tiles) {
      const k = `${t.orientation}:${t.mainIndex}:${t.subIndex}`
      if (!tiles.has(k)) tiles.set(k, t)
    }
  } catch {
    /* skip */
  }
}
console.log('tiles available', tiles.size)
const pal = parsePalDat(vfs.read(palettePath(`ACT${map.act}`))!)
const W = (map.width + map.height) * 80 + 160
const H = (map.width + map.height) * 40 + 600
const ox = map.height * 80
const oy = 400
const img = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < img.length; i += 4) img.set([20, 20, 24, 255], i)
const draw = (t: Dt1Tile, sx: number, sy: number) => {
  for (const b of t.blocks) {
    const rows = b.format === 1 ? 15 : 32
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < 32; x++) {
        const v = b.pixels[y * 32 + x]
        if (!v) continue
        const X = sx + b.x + x
        const Y = sy + b.y + y
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue
        img.set([pal[v * 4], pal[v * 4 + 1], pal[v * 4 + 2], 255], (Y * W + X) * 4)
      }
  }
}
const at = (m: Ds1, x: number, y: number) => y * m.width + x
let missing = 0
// floors, then walls in back-to-front order
for (let y = 0; y < map.height; y++)
  for (let x = 0; x < map.width; x++)
    for (const fl of map.floors) {
      const c = fl[at(map, x, y)]
      if (!c.prop1) continue
      const t = tiles.get(`0:${c.style}:${c.sequence}`)
      if (!t) {
        missing++
        continue
      }
      draw(t, ox + (x - y) * 80, oy + (x + y) * 40)
    }
for (let y = 0; y < map.height; y++)
  for (let x = 0; x < map.width; x++)
    for (const w of map.walls) {
      const c = w.cells[at(map, x, y)]
      const o = w.orientations[at(map, x, y)] & 0xff
      if (!c.prop1 || o === 0 || o === 10 || o === 11) continue
      const t = tiles.get(`${o}:${c.style}:${c.sequence}`)
      if (!t) {
        missing++
        continue
      }
      draw(t, ox + (x - y) * 80, oy + (x + y) * 40 + (o >= 16 ? 0 : wallOffset))
      if (o === 3) {
        const t4 = tiles.get(`4:${c.style}:${c.sequence}`)
        if (t4) draw(t4, ox + (x - y) * 80, oy + (x + y) * 40 + wallOffset)
      }
    }
console.log('missing tiles', missing)
writePng(`out-test/ds1_render_${wallOffset}.png`, W, H, img)
console.log(`wrote out-test/ds1_render_${wallOffset}.png ${W}x${H}`)
