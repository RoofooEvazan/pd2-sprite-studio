import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
const { vfs } = openGameVfs(defaultGameLocation())
for (const n of ['grey', 'grey2', 'gold', 'brown', 'greybrown', 'invgrey', 'invgrey2', 'invgreybrown'])
  console.log(n, vfs.read(`data\\global\\items\\palette\\${n}.dat`)?.length, vfs.sourceOf(`data\\global\\items\\palette\\${n}.dat`))
const txt = (n: string) => new TextDecoder('latin1').decode(vfs.read(`data\\global\\excel\\${n}.txt`)!).split(/\r?\n/)
for (const t of ['weapons', 'armor', 'misc', 'uniqueitems', 'setitems', 'monstats', 'colors', 'playerclass']) {
  const rows = txt(t)
  const hdr = rows[0].split('\t')
  const want = hdr.map((h, i) => [h, i] as const).filter(([h]) => /^(name|code|invfile|invtrans|invtransform|transform|index|id|namestr|uniqueinvfile|setinvfile|item|transform color|inv transform|\*?code|base|class|player class|lvl|code)$/i.test(h))
  console.log(`\n== ${t} (${rows.length} rows)`, want)
  for (const r of rows.slice(1, 4)) {
    const c = r.split('\t')
    console.log('  ', want.map(([h, i]) => `${h}=${c[i]}`).join(' | '))
  }
}
const bases = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) {
  const m = /^data\\global\\([^\\]+)\\/i.exec(f)
  if (m && /\.(dcc|dc6|cof)$/i.test(f)) bases.add(m[1].toLowerCase() + ':' + f.split('.').pop()!.toLowerCase())
}
console.log([...bases].sort().join(' '))
