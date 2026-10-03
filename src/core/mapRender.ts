// Render a DS1 map with its DT1 tiles to RGBA, using the game's placement rules:
// cell (x, y) sits at screen ((x - y) * 80, (x + y) * 40); floors draw from the top of that 160x80 box,
// walls stand on the diamond's bottom point (80 px lower); roofs are floor-like tiles raised by roofHeight.

import { Ds1 } from './ds1'
import { Dt1Tile } from './dt1'
import { Palette } from './palette'
import { newRgba, Rgba } from './composite'

export function tileKey(orientation: number, main: number, sub: number): string {
  return `${orientation}:${main}:${sub}`
}

export function indexTiles(tiles: Dt1Tile[], into = new Map<string, Dt1Tile>()): Map<string, Dt1Tile> {
  for (const t of tiles) {
    const k = tileKey(t.orientation, t.mainIndex, t.subIndex)
    if (!into.has(k)) into.set(k, t)
  }
  return into
}

export function drawTile(img: Rgba, t: Dt1Tile, sx: number, sy: number, pal: Palette): void {
  for (const b of t.blocks) {
    const rows = b.format === 1 ? 15 : 32
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < 32; x++) {
        const v = b.pixels[y * 32 + x]
        if (!v) continue
        const X = sx + b.x + x - img.x0
        const Y = sy + b.y + y - img.y0
        if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) continue
        const o = (Y * img.width + X) * 4
        img.data[o] = pal[v * 4]
        img.data[o + 1] = pal[v * 4 + 1]
        img.data[o + 2] = pal[v * 4 + 2]
        img.data[o + 3] = 255
      }
  }
}

export interface MapRenderOptions {
  roofs?: boolean
  background?: [number, number, number, number]
}

export function renderMap(map: Ds1, tiles: Map<string, Dt1Tile>, pal: Palette, opts: MapRenderOptions = {}): { image: Rgba; missing: number } {
  // Bounds: walls can rise far above the map
  let top = 0
  let bottom = 0
  for (const t of tiles.values()) {
    top = Math.min(top, t.height + 80, -(t.roofHeight || 0))
    for (const b of t.blocks) bottom = Math.max(bottom, b.y + 32) // lower walls extend below their base line
  }
  const x0 = -map.height * 80
  const y0 = top - 40
  const w = (map.width + map.height) * 80 + 160
  const h = (map.width + map.height) * 40 + 120 - top + Math.max(0, bottom)
  const img = newRgba(x0, y0, w, h)
  if (opts.background) for (let i = 0; i < img.data.length; i += 4) img.data.set(opts.background, i)
  let missing = 0
  const at = (x: number, y: number) => y * map.width + x
  const sx = (x: number, y: number) => (x - y) * 80
  const sy = (x: number, y: number) => (x + y) * 40
  // Lower walls (16-19) hang below floor edges: drawn first, on the same base line as walls, so floors cover their tops
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      for (const wl of map.walls) {
        const c = wl.cells[at(x, y)]
        const o = wl.orientations[at(x, y)] & 0xff
        if (!c.prop1 || o < 16) continue
        const t = tiles.get(tileKey(o, c.style, c.sequence))
        if (!t) {
          missing++
          continue
        }
        drawTile(img, t, sx(x, y), sy(x, y) + 80, pal)
      }
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      for (const fl of map.floors) {
        const c = fl[at(x, y)]
        if (!c.prop1) continue
        const t = tiles.get(tileKey(0, c.style, c.sequence))
        if (!t) {
          missing++
          continue
        }
        drawTile(img, t, sx(x, y), sy(x, y), pal)
      }
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      for (const wl of map.walls) {
        const c = wl.cells[at(x, y)]
        const o = wl.orientations[at(x, y)] & 0xff
        if (!c.prop1 || o === 0 || o === 10 || o === 11 || o === 13 || o >= 16) continue
        if (o === 15) continue // roofs last
        const t = tiles.get(tileKey(o, c.style, c.sequence))
        if (!t) {
          missing++
          continue
        }
        drawTile(img, t, sx(x, y), sy(x, y) + 80, pal)
        if (o === 3) {
          const t4 = tiles.get(tileKey(4, c.style, c.sequence))
          if (t4) drawTile(img, t4, sx(x, y), sy(x, y) + 80, pal)
        }
      }
  if (opts.roofs !== false)
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (const wl of map.walls) {
          const c = wl.cells[at(x, y)]
          if (!c.prop1 || (wl.orientations[at(x, y)] & 0xff) !== 15) continue
          const t = tiles.get(tileKey(15, c.style, c.sequence))
          if (t) drawTile(img, t, sx(x, y), sy(x, y) - t.roofHeight, pal)
        }
  return { image: img, missing }
}
