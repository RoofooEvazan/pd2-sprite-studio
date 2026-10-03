import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'

const { vfs, loaded, missing } = openGameVfs(defaultGameLocation())
console.log('loaded', loaded, 'missing', missing)
for (const a of vfs.archives) {
  let lf: string[] = []
  try {
    lf = a.listfile()
  } catch (e) {
    console.log(a.name, 'listfile error', (e as Error).message)
  }
  console.log(a.name, 'listfile entries:', lf.length, lf.slice(0, 3))
}
const tests = [
  'data\\global\\palette\\ACT1\\pal.dat',
  'data\\global\\excel\\weapons.txt',
  'data\\global\\excel\\armor.txt',
  'data\\global\\excel\\misc.txt',
  'data\\global\\excel\\uniqueitems.txt',
  'data\\global\\items\\invaxe.dc6',
  'data\\global\\chars\\BA\\cof\\BANUHTH.cof',
  'data\\global\\chars\\BA\\HD\\BAHDLITNUHTH.dcc',
  'data\\global\\animdata.d2'
]
for (const t of tests) {
  const d = vfs.read(t)
  console.log(t, d ? `${d.length} bytes from ${vfs.sourceOf(t)}` : 'MISSING')
}
const w = vfs.read('data\\global\\excel\\weapons.txt')
if (w) console.log(new TextDecoder().decode(w).split('\n')[0].slice(0, 400))
