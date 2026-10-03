// Unit body-part graphics come as DCC (almost everything) or DC6 (e.g. Mephisto, parts of Diablo and a few
// other monsters and objects). The game takes whichever file exists; these helpers pick the right one.

import { dccPath } from './catalog'
import { decodeDc6, Dc6Meta, encodeDc6 } from './dc6'
import { DccFrameMeta, decodeDcc, encodeDcc } from './dcc'
import { Palette } from './palette'
import { Sprite } from './sprite'

export type LayerFormat = 'dcc' | 'dc6'

/** Which format a unit's part graphic uses, from the catalog (DCC when unknown). */
export function layerFormat(u: { dc6?: string[] } | null | undefined, comp: string, armtype: string, mode: string, wclass: string): LayerFormat {
  return u?.dc6?.includes(`${comp}${armtype}${mode}${wclass}`.toUpperCase()) ? 'dc6' : 'dcc'
}

/** Archive path of a part graphic, e.g. data\global\monsters\MP\TR\MPTRLITNUHTH.dc6 */
export function layerPath(u: { base: string; token: string }, comp: string, armtype: string, mode: string, wclass: string, format: LayerFormat = 'dcc'): string {
  const p = dccPath(u, comp, armtype, mode, wclass)
  return format === 'dc6' ? p.replace(/\.dcc$/i, '.dc6') : p
}

export interface DecodedLayer {
  sprite: Sprite
  frameMeta: DccFrameMeta[][] | null
  dc6Meta: Dc6Meta | null
}

/** Decode a part graphic of either format (onlyDir: DCC can decode just one direction, for previews). */
export function decodeLayerFile(data: Uint8Array, format: LayerFormat, onlyDir?: number): DecodedLayer {
  if (format === 'dc6') {
    const { meta, ...sprite } = decodeDc6(data)
    return { sprite, frameMeta: null, dc6Meta: meta }
  }
  const d = decodeDcc(data, onlyDir)
  return { sprite: { directions: d.directions, framesPerDir: d.framesPerDir, frames: d.frames }, frameMeta: d.frameMeta, dc6Meta: null }
}

/** Encode a part graphic back into the format it came in. */
export function encodeLayerFile(sprite: Sprite, format: LayerFormat, opts: { palette: Palette; frameMeta?: DccFrameMeta[][] | null; dc6Meta?: Dc6Meta | null }): Uint8Array {
  return format === 'dc6' ? encodeDc6(sprite, opts.dc6Meta ?? undefined) : encodeDcc(sprite, { palette: opts.palette, frameMeta: opts.frameMeta ?? undefined })
}
