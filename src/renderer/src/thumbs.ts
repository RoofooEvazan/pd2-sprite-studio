// Composite previews of units for the pickers (portraits and small animated previews).

import { UnitEntry, cofPath, dccPath } from '../../core/catalog'
import { animFps, COMPOSITS, decodeCof } from '../../core/cof'
import { compositeFrame, directionBounds, LayerInput, Rgba } from '../../core/composite'
import { decodeDcc } from '../../core/dcc'
import { decodeDc6 } from '../../core/dc6'
import { indexedToRgba } from '../../core/palette'
import { prefetch, readGameFile } from './api'
import { defaultArmtype, getState, palette } from './store'

export interface AnimPreview {
  frames: Rgba[]
  fps: number
}

const animCache = new Map<string, Promise<AnimPreview | null>>()

/** Preferred facing for previews: toward the viewer ("down") when the unit has one. */
export function previewDir(dirs: number): number {
  return dirs >= 8 ? 4 : 0
}

export function loadAnimPreview(unit: UnitEntry, mode: string, wclass: string): Promise<AnimPreview | null> {
  const key = `${unit.base}/${unit.token}/${mode}/${wclass}`
  let p = animCache.get(key)
  if (!p) {
    p = (async () => {
      const cofData = await readGameFile(cofPath(unit, mode, wclass))
      if (!cofData) return null
      const cof = decodeCof(cofData)
      const dir = previewDir(cof.directions)
      const paths = cof.layers.map((l) => {
        const comp = COMPOSITS[l.composit]
        const arm = defaultArmtype(unit, comp, mode, l.weaponClass)
        return arm ? dccPath(unit, comp, arm, mode, l.weaponClass) : null
      })
      await prefetch(paths.filter((x): x is string => !!x))
      const layers = new Map<number, LayerInput>()
      await Promise.all(
        cof.layers.map(async (l, i) => {
          const path = paths[i]
          const data = path ? await readGameFile(path) : null
          let sprite = null
          if (data) {
            try {
              const d = decodeDcc(data, dir)
              sprite = { directions: d.directions, framesPerDir: d.framesPerDir, frames: d.frames }
            } catch {
              sprite = null
            }
          }
          layers.set(l.composit, { sprite, visible: true })
        })
      )
      const pal = palette()
      const b = directionBounds(cof, layers, dir)
      const frames = Array.from({ length: cof.framesPerDir }, (_, f) => compositeFrame(cof, layers, pal, dir, f, { bounds: b }))
      const ad = getState().animData?.get(`${unit.token}${mode}${wclass}`.toUpperCase())
      return { frames, fps: ad ? animFps(ad.speed) : 12 }
    })().catch(() => null)
    animCache.set(key, p)
  }
  return p
}

/** The animation that best represents a unit standing still. */
export function portraitAnim(unit: UnitEntry): { mode: string; wclass: string } | null {
  for (const [mode, wc] of [
    ['TN', 'HTH'],
    ['NU', 'HTH'],
    ['NU', ''],
    ['TN', ''],
    ['WL', ''],
    ['ON', ''],
    ['OP', ''],
    ['NU', '']
  ]) {
    const list = unit.modes[mode]
    if (!list?.length) continue
    if (wc && !list.includes(wc)) continue
    return { mode, wclass: wc || list[0] }
  }
  const m = Object.keys(unit.modes)[0]
  return m ? { mode: m, wclass: unit.modes[m][0] } : null
}

const urlCache = new Map<string, Promise<string | null>>()

export function rgbaToUrl(im: Rgba): string {
  const c = document.createElement('canvas')
  c.width = Math.max(1, im.width)
  c.height = Math.max(1, im.height)
  c.getContext('2d')!.putImageData(new ImageData(im.data, c.width, c.height), 0, 0)
  return c.toDataURL()
}

export function unitPortrait(unit: UnitEntry): Promise<string | null> {
  const key = `${unit.base}/${unit.token}`
  let p = urlCache.get(key)
  if (!p) {
    const a = portraitAnim(unit)
    p = a ? loadAnimPreview(unit, a.mode, a.wclass).then((r) => (r?.frames[0] ? rgbaToUrl(r.frames[0]) : null)) : Promise.resolve(null)
    urlCache.set(key, p)
  }
  return p
}

export function itemThumb(path: string): Promise<string | null> {
  let p = urlCache.get(path)
  if (!p) {
    p = readGameFile(path).then((data) => {
      if (!data) return null
      try {
        const f = decodeDc6(data).frames[0][0]
        const c = document.createElement('canvas')
        c.width = Math.max(1, f.width)
        c.height = Math.max(1, f.height)
        c.getContext('2d')!.putImageData(new ImageData(indexedToRgba(f.pixels, palette()), c.width, c.height), 0, 0)
        return c.toDataURL()
      } catch {
        return null
      }
    })
    urlCache.set(path, p)
  }
  return p
}
