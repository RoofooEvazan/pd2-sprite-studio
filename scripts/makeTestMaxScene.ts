// A "3ds Max style" scene: centimetres, Z-up, 1 tile = 200 cm. Written as OBJ (named objects) to test
// the Tile Maker's unit guessing and "Stand upright".
import fs from 'node:fs'

let out = '# test scene, centimetres, Z up\n'
let vbase = 1
// Axis-aligned box from (x0,y0,z0) to (x1,y1,z1) in Max coordinates (Z up)
const box = (name: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
  out += `o ${name}\n`
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ]
  for (const p of v) out += `v ${p[0]} ${p[1]} ${p[2]}\n`
  const f = [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]]
  for (const q of f) out += `f ${q.map((i) => i + vbase - 1).join(' ')}\n`
  vbase += 8
}
const T = 200 // cm per tile
// Floor 5 x 4 tiles, as separate slabs
for (let x = 0; x < 5; x++) for (let y = 0; y < 4; y++) box(`floor_${x}_${y}`, x * T + 2, y * T + 2, -6, (x + 1) * T - 2, (y + 1) * T - 2, 0)
// Walls: along x = 0 (running in y) and along y = 0 (running in x), 440 cm tall
box('wall_west', 0, 0, 0, 30, 4 * T, 440)
box('wall_north', 0, 0, 0, 5 * T, 30, 440)
box('column', 3 * T + 60, 2 * T + 60, 0, 3 * T + 140, 2 * T + 140, 400)
box('roof_corner', 0, 0, 440, 2 * T, 2 * T, 470)
fs.mkdirSync('out-test/models', { recursive: true })
for (const f of fs.readdirSync('out-test/models')) if (/\.(glb|obj|fbx)$/i.test(f)) fs.renameSync(`out-test/models/${f}`, `out-test/models/${f}.bak`)
fs.writeFileSync('out-test/models/max_scene.obj', out)
console.log('wrote out-test/models/max_scene.obj')
