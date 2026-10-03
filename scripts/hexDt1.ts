import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
const { vfs } = openGameVfs(defaultGameLocation())
for (const f of ['data\\global\\tiles\\act1\\barracks\\gargtrap.dt1', 'data\\global\\tiles\\act1\\barracks\\floor.dt1', 'data\\global\\tiles\\act1\\barracks\\barracks.dt1']) {
  const d = vfs.read(f)!
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const nz: string[] = []
  for (let i = 8; i < 280; i += 4) if (dv.getInt32(i, true)) nz.push(`@${i}=${dv.getInt32(i, true)}`)
  console.log(f, d.length, 'v', dv.getInt32(0, true), dv.getInt32(4, true), 'nonzero dwords 8..280:', nz.join(' '))
  const nTiles = dv.getInt32(268, true)
  const tp = dv.getInt32(272, true)
  for (let t = 0; t < Math.min(3, nTiles); t++) {
    const p = tp + t * 96
    const words: number[] = []
    for (let k = 0; k < 96; k += 4) words.push(dv.getInt32(p + k, true))
    console.log(`  tile ${t} @${p}:`, words.join(' '))
    const bp = dv.getInt32(p + 72, true)
    const hb: number[] = []
    for (let k = 0; k < 40; k += 2) hb.push(dv.getInt16(bp + k, true))
    console.log(`    first block headers (int16) @${bp}:`, hb.join(' '))
  }
}
