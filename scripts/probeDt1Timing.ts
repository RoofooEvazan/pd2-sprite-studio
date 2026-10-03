import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { decodeDt1 } from '../src/core/dt1'

const { vfs } = openGameVfs(defaultGameLocation())
const files = new Set<string>()
for (const a of vfs.archives) for (const f of a.listfile()) if (/\.dt1$/i.test(f)) files.add(f.toLowerCase())
let i = 0
for (const f of files) {
  if (i++ >= 25) break
  const t0 = Date.now()
  const d = vfs.read(f)
  const t1 = Date.now()
  let n = -1
  try {
    n = decodeDt1(d!).tiles.length
  } catch (e) {
    n = -2
  }
  console.log(`${f} ${d?.length} bytes read ${t1 - t0}ms decode ${Date.now() - t1}ms tiles ${n} from ${vfs.sourceOf(f)}`)
}
