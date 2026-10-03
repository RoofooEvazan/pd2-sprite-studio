// Synthetic "3D renders" in the render scripts' output layout, for testing the importer:
// out-test/renders/sprite_dXX_fYYY.png + d2_render.json. A shaded capsule with a red nose that
// points the way each Diablo II direction faces, bobbing over the frames.
import fs from 'node:fs'
import path from 'node:path'
import { writePng } from './pngNode'

const DIRS = 16
const FRAMES = 16
const RES = 192
const SS = 3 // supersampling for soft edges like a real render
const OUT = 'out-test/renders'
const HEADING = [135, 225, 315, 45, 90, 180, 270, 0, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5]

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const ox = RES / 2
const oy = RES / 2

for (let d = 0; d < DIRS; d++) {
  const h = (HEADING[d] * Math.PI) / 180
  for (let f = 0; f < FRAMES; f++) {
    const bob = Math.sin((f / FRAMES) * Math.PI * 2) * 4
    const acc = new Float32Array(RES * RES * 4)
    for (let y = 0; y < RES * SS; y++)
      for (let x = 0; x < RES * SS; x++) {
        const px = x / SS + 0.5 / SS
        const py = y / SS + 0.5 / SS
        let col: [number, number, number] | null = null
        // body: capsule standing on the ground point, ~64 px tall
        const bx = (px - ox) / 16
        const top = oy - 64 + bob
        if (py >= top && py <= oy && Math.abs(bx) <= 1) {
          const shade = 0.45 + 0.55 * (1 - (bx + 1) / 2) // lit from the left
          const v = 0.6 + 0.4 * (1 - (py - top) / 64)
          col = [60 * shade * v + 20, 110 * shade * v + 20, 200 * shade * v + 30]
        }
        // nose: disc 14 px out along the facing direction (2:1 ground projection), at chest height
        const nx = ox + Math.cos(h) * 18
        const ny = oy - 40 + bob + Math.sin(h) * 9
        if ((px - nx) ** 2 + (py - ny) ** 2 <= 36) col = [210, 40, 30]
        if (!col) continue
        const o = (Math.floor(py) * RES + Math.floor(px)) * 4
        acc[o] += col[0]
        acc[o + 1] += col[1]
        acc[o + 2] += col[2]
        acc[o + 3] += 1
      }
    const rgba = new Uint8ClampedArray(RES * RES * 4)
    for (let i = 0; i < RES * RES; i++) {
      const n = acc[i * 4 + 3]
      if (!n) continue
      rgba[i * 4] = acc[i * 4] / n
      rgba[i * 4 + 1] = acc[i * 4 + 1] / n
      rgba[i * 4 + 2] = acc[i * 4 + 2] / n
      rgba[i * 4 + 3] = (n / (SS * SS)) * 255
    }
    writePng(path.join(OUT, `sprite_d${String(d).padStart(2, '0')}_f${String(f).padStart(3, '0')}.png`), RES, RES, rgba)
  }
}
fs.writeFileSync(
  path.join(OUT, 'd2_render.json'),
  JSON.stringify({ tool: 'blender', name: 'sprite', directions: DIRS, frames: FRAMES, width: RES, height: RES, originX: ox, originY: oy, fps: 25 }, null, 2)
)
console.log(`wrote ${DIRS * FRAMES} renders to ${OUT}`)
