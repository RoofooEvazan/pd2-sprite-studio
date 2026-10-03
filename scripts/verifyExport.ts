// Decode an exported DCC and compare to the game original: reports frames changed + dumps a strip.
import fs from 'node:fs'
import { decodeDcc } from '../src/core/dcc'
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { indexedToRgba, palettePath, parsePalDat } from '../src/core/palette'
import { writePng } from './pngNode'

const rel = process.argv[2] ?? 'data\\global\\chars\\BA\\TR\\BATRLITA11HS.dcc'
const file = `out-test/pd2-export/${rel.replace(/\\/g, '/')}`
const { vfs } = openGameVfs(defaultGameLocation())
const orig = decodeDcc(vfs.read(rel)!)
const bytes = fs.readFileSync(file)
const ed = decodeDcc(new Uint8Array(bytes))
console.log(`exported ${bytes.length} bytes (original ${vfs.read(rel)!.length}); dirs ${ed.directions} frames ${ed.framesPerDir}`)
let changed = 0
ed.frames.forEach((d, di) =>
  d.forEach((f, fi) => {
    const o = orig.frames[di][fi]
    if (f.width !== o.width || f.height !== o.height || f.pixels.some((v, i) => v !== o.pixels[i])) changed++
  })
)
console.log(`frames differing from original: ${changed}`)
const pal = parsePalDat(vfs.read(palettePath('ACT1'))!)
const fr = ed.frames[0]
const W = fr.reduce((s, f) => s + f.width + 2, 0)
const H = Math.max(...fr.map((f) => f.height))
const rgba = new Uint8ClampedArray(W * H * 4)
let x0 = 0
for (const f of fr) {
  const px = indexedToRgba(f.pixels, pal)
  for (let y = 0; y < f.height; y++) rgba.set(px.subarray(y * f.width * 4, (y + 1) * f.width * 4), ((y * W) + x0) * 4)
  x0 += f.width + 2
}
writePng('out-test/export_check.png', W, H, rgba)
