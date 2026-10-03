// Generates build/icon.png (256x256): a pixel-art sword and brush on a dark rounded tile.
import fs from 'node:fs'
import { writePng } from './pngNode'

const N = 32
const S = 8
const grid: (string | null)[][] = Array.from({ length: N }, () => Array(N).fill(null))
const set = (x: number, y: number, c: string) => {
  if (x >= 0 && y >= 0 && x < N && y < N) grid[y][x] = c
}

// Tile background with rounded corners and a gold rim
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const cx = Math.min(x, N - 1 - x)
    const cy = Math.min(y, N - 1 - y)
    if (cx + cy < 3) continue // rounded corner
    const rim = cx === 0 || cy === 0 || cx + cy === 3
    set(x, y, rim ? '#8a6a2a' : '#17181c')
  }

// Sword blade: diagonal from top-right to centre
for (let i = 0; i < 15; i++) {
  set(24 - i, 5 + i, '#e8e8ee')
  set(25 - i, 5 + i, '#b9bcc6')
  set(24 - i, 6 + i, '#8d909b')
}
set(25, 4, '#ffffff')
// Crossguard
for (let i = -3; i <= 3; i++) set(10 + i, 18 + i, '#dcab4f')
for (let i = -3; i <= 3; i++) set(11 + i, 18 + i, '#a8782c')
// Grip and pommel
for (let i = 0; i < 5; i++) {
  set(8 - i, 21 + i, '#6b3f1f')
  set(9 - i, 21 + i, '#8a5429')
}
set(3, 26, '#dcab4f')
set(4, 26, '#dcab4f')
set(3, 27, '#a8782c')

// Brush: bottom-right, handle going up-right
for (let i = 0; i < 8; i++) {
  set(19 + i, 26 - i, '#c9803f')
  set(20 + i, 26 - i, '#9b5d2a')
}
set(18, 27, '#cfcfd6')
set(19, 27, '#cfcfd6')
set(18, 28, '#dcab4f')
set(17, 28, '#dcab4f')
set(17, 29, '#e9bd66')
set(16, 29, '#e9bd66')

const px = new Uint8Array(N * S * N * S * 4)
for (let y = 0; y < N * S; y++)
  for (let x = 0; x < N * S; x++) {
    const c = grid[Math.floor(y / S)][Math.floor(x / S)]
    if (!c) continue
    const o = (y * N * S + x) * 4
    px[o] = parseInt(c.slice(1, 3), 16)
    px[o + 1] = parseInt(c.slice(3, 5), 16)
    px[o + 2] = parseInt(c.slice(5, 7), 16)
    px[o + 3] = 255
  }
fs.mkdirSync('build', { recursive: true })
writePng('build/icon.png', N * S, N * S, px)
console.log('wrote build/icon.png')
