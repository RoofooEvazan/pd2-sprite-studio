import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { decodeDt1 } from '../src/core/dt1'
import { decodeDs1 } from '../src/core/ds1'

const { vfs } = openGameVfs(defaultGameLocation())
const all = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) all.add(f.toLowerCase())
const fmtByOrient = new Map<number, Map<number, number>>()
const flagSamples = new Map<number, Map<string, number>>()
const dirByOrient = new Map<number, Map<number, number>>()
const rarity = new Map<number, number>()
for (const f of [...all].filter((x) => x.endsWith('.dt1') && x.includes('act1'))) {
  let d
  try {
    d = decodeDt1(vfs.read(f)!)
  } catch {
    continue
  }
  for (const t of d.tiles) {
    const m = fmtByOrient.get(t.orientation) ?? new Map()
    for (const b of t.blocks) m.set(b.format, (m.get(b.format) ?? 0) + 1)
    fmtByOrient.set(t.orientation, m)
    const dm = dirByOrient.get(t.orientation) ?? new Map()
    dm.set(t.direction, (dm.get(t.direction) ?? 0) + 1)
    dirByOrient.set(t.orientation, dm)
    if (t.orientation === 0) rarity.set(t.rarity, (rarity.get(t.rarity) ?? 0) + 1)
    if (t.orientation === 1 || t.orientation === 2) {
      const grid = Array.from({ length: 5 }, (_, j) => Array.from({ length: 5 }, (_, i) => (t.subtileFlags[j * 5 + i] ? t.subtileFlags[j * 5 + i].toString(16).padStart(2, '0') : '..')).join(' ')).join(' | ')
      const fm = flagSamples.get(t.orientation) ?? new Map()
      fm.set(grid, (fm.get(grid) ?? 0) + 1)
      flagSamples.set(t.orientation, fm)
    }
  }
}
for (const [o, m] of [...fmtByOrient].sort((a, b) => a[0] - b[0])) console.log(`orient ${o} formats`, [...m.entries()], 'directions', [...dirByOrient.get(o)!.entries()])
console.log('floor rarity', [...rarity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6))
for (const [o, m] of flagSamples) {
  console.log(`orient ${o} most common subtile flag grids (row j = 0..4, col i = 0..4):`)
  for (const [g, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`  ${n}x  ${g}`)
}
// DS1 prop1 values
const prop = new Map<string, number>()
let files = 0
for (const f of [...all].filter((x) => x.endsWith('.ds1') && x.includes('act1'))) {
  if (files++ > 60) break
  const m = decodeDs1(vfs.read(f)!)
  for (const c of m.floors[0]) if (c.prop1) prop.set(`floor:${c.prop1}`, (prop.get(`floor:${c.prop1}`) ?? 0) + 1)
  for (const w of m.walls) w.cells.forEach((c, i) => c.prop1 && prop.set(`wall${w.orientations[i] & 0xff}:${c.prop1}`, (prop.get(`wall${w.orientations[i] & 0xff}:${c.prop1}`) ?? 0) + 1))
}
console.log('DS1 prop1 values', [...prop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14))
