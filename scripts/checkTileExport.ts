// Independently decode an exported Tile Maker map piece: reads the DS1, loads every DT1 it lists, renders it.
import fs from 'node:fs'
import path from 'node:path'
import { decodeDt1, Dt1Tile, ORIENTATION_NAMES } from '../src/core/dt1'
import { decodeDs1 } from '../src/core/ds1'
import { indexTiles, renderMap } from '../src/core/mapRender'
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { palettePath, parsePalDat } from '../src/core/palette'
import { writePng } from './pngNode'

const root = 'out-test/pd2-export'
const ds1Path = process.argv[2] ?? `${root}/data/global/tiles/act1/mytiles/mytiles.ds1`
const ds1 = decodeDs1(new Uint8Array(fs.readFileSync(ds1Path)))
console.log(`DS1 v${ds1.version}: ${ds1.width}x${ds1.height}, act ${ds1.act}, ${ds1.walls.length} wall layers`)
const tiles = new Map<string, Dt1Tile>()
for (const f of ds1.files) {
  // DS1 lists \d2\data\global\...; resolve against the export root like the game resolves against its data
  const file = path.join(root, f.replace(/^\\d2\\/i, '').replace(/\\/g, '/'))
  const dt1 = decodeDt1(new Uint8Array(fs.readFileSync(file)))
  const kinds = new Map<number, number>()
  for (const t of dt1.tiles) kinds.set(t.orientation, (kinds.get(t.orientation) ?? 0) + 1)
  console.log(`  ${f} -> ${dt1.tiles.length} tiles (${[...kinds].map(([o, n]) => `${n} ${ORIENTATION_NAMES[o]}`).join(', ')})`)
  indexTiles(dt1.tiles, tiles)
}
const { vfs } = openGameVfs(defaultGameLocation())
const pal = parsePalDat(vfs.read(palettePath(`ACT${ds1.act}`))!)
const { image, missing } = renderMap(ds1, tiles, pal, { background: [14, 15, 17, 255] })
console.log(`missing tile references: ${missing}`)
writePng('out-test/tile_export_check.png', image.width, image.height, image.data)
console.log('wrote out-test/tile_export_check.png')
