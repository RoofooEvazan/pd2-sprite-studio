// Decode an exported DCC and write a strip of one direction's frames (4x) for visual checking.
import fs from 'node:fs'
import { decodeDcc } from '../src/core/dcc'
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { indexedToRgba, palettePath, parsePalDat } from '../src/core/palette'
import { spriteBounds } from '../src/core/sprite'
import { writePng } from './pngNode'

const file = process.argv[2] ?? 'out-test/pd2-export/data/global/chars/BA/SH/BASHNEWA11HS.dcc'
const dir = +(process.argv[3] ?? 7)
const { vfs } = openGameVfs(defaultGameLocation())
const pal = parsePalDat(vfs.read(palettePath('ACT1'))!)
const dcc = decodeDcc(new Uint8Array(fs.readFileSync(file)))
console.log(`${file}: ${dcc.directions} dirs x ${dcc.framesPerDir} frames, ${fs.statSync(file).size} bytes`)
const frames = dcc.frames[dir].slice(0, 8)
const b = spriteBounds(frames)
const cw = b.x1 - b.x0
const ch = b.y1 - b.y0
const S = 4
const W = cw * frames.length * S
const H = ch * S
const out = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < out.length; i += 4) out.set([24, 25, 28, 255], i)
frames.forEach((f, k) => {
  const px = indexedToRgba(f.pixels, pal)
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++) {
      const o = (y * f.width + x) * 4
      if (!px[o + 3]) continue
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const tx = (k * cw + f.offsetX - b.x0 + x) * S + sx
          const ty = (f.offsetY - b.y0 + y) * S + sy
          out.set(px.subarray(o, o + 4), (ty * W + tx) * 4)
        }
    }
})
writePng('out-test/import_check.png', W, H, out)
console.log('wrote out-test/import_check.png')
