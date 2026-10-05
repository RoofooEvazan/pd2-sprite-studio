import { useEffect, useMemo, useState } from 'react'
import { IconArrowLeft, IconSearch } from '@tabler/icons-react'
import { decodeDt1, Dt1, isFloorLike, ORIENTATION_NAMES, tileImage } from '../../../core/dt1'
import { readGameFile } from '../api'
import { getState, goTo, hasTileEdits, openTile, tilePalette, useStore } from '../store'
import { LazyImg, Segmented } from '../ui'

type Kind = 'all' | 'floor' | 'wall' | 'roof' | 'other'
const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'floor', label: 'Floors' },
  { value: 'wall', label: 'Walls' },
  { value: 'roof', label: 'Roofs' },
  { value: 'other', label: 'Other' }
]
const kindOf = (o: number): Kind => (o === 0 ? 'floor' : o === 15 ? 'roof' : (o >= 1 && o <= 9) || (o >= 16 && o <= 19) ? 'wall' : 'other')

const thumbCache = new Map<string, Promise<string | null>>()

/** A tile drawn in its tile set's palette, as a data URL. */
function tileThumb(path: string, dt1: Dt1, index: number): Promise<string | null> {
  const key = `${path}#${index}`
  let p = thumbCache.get(key)
  if (!p) {
    p = Promise.resolve().then(() => {
      const pal = getState().palettes[tilePalette(path)] ?? getState().palettes.ACT1
      if (!pal) return null
      const m = tileImage(dt1.tiles[index])
      const c = document.createElement('canvas')
      c.width = m.width
      c.height = m.height
      const ctx = c.getContext('2d')!
      const id = ctx.createImageData(m.width, m.height)
      for (let i = 0; i < m.pixels.length; i++) {
        const v = m.pixels[i]
        if (!v) continue
        id.data.set([pal[v * 4], pal[v * 4 + 1], pal[v * 4 + 2], 255], i * 4)
      }
      ctx.putImageData(id, 0, 0)
      return c.toDataURL()
    })
    thumbCache.set(key, p)
  }
  return p
}

export function TilePicker() {
  const catalog = useStore((s) => s.catalog)
  const [q, setQ] = useState('')
  const [path, setPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem('pd2ss.lastDt1')
    } catch {
      return null
    }
  })
  const [dt1, setDt1] = useState<Dt1 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('all')

  const files = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (catalog?.dt1Files ?? []).filter((f) => !n || f.toLowerCase().includes(n))
  }, [catalog, q])

  useEffect(() => {
    if (!path) return
    let live = true
    setDt1(null)
    setError(null)
    readGameFile(path).then((data) => {
      if (!live) return
      if (!data) return setError('Not found in the game archives')
      try {
        setDt1(decodeDt1(data))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
    try {
      localStorage.setItem('pd2ss.lastDt1', path)
    } catch {
      /* per-viewer convenience */
    }
    return () => {
      live = false
    }
  }, [path])

  const tiles = (dt1?.tiles ?? []).map((t, i) => ({ t, i })).filter(({ t }) => kind === 'all' || kindOf(t.orientation) === kind)
  const short = (f: string) => f.replace(/^data\\global\\tiles\\/i, '')

  return (
    <div className="picker">
      <div className="picker-head">
        <button className="back" onClick={() => goTo('home')}>
          <IconArrowLeft size={18} stroke={1.75} /> Home
        </button>
        <div className="picker-title">
          <h2>Map tiles</h2>
          <span className="muted">{catalog?.dt1Files.length ?? 0} tile sets (.dt1)</span>
        </div>
        <div className="search-small">
          <IconSearch size={16} stroke={1.75} />
          <input autoFocus placeholder="Search tile sets, e.g. guild or act1\cathedrl" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tp-main">
        <div className="tp-files">
          {files.slice(0, 600).map((f) => (
            <button key={f} className={`tp-file${f === path ? ' on' : ''}`} onClick={() => setPath(f)} title={f}>
              {short(f)}
              {hasTileEdits(f) && <span className="tp-edited">edited</span>}
            </button>
          ))}
          {files.length > 600 && <div className="muted small pad">{files.length - 600} more: narrow the search</div>}
          {!files.length && <div className="muted small pad">No tile sets match.</div>}
        </div>
        <div className="tp-tiles">
          {!path && <div className="muted pad">Pick a tile set on the left.</div>}
          {error && <div className="pad error-text">{error}</div>}
          {path && dt1 && (
            <>
              <div className="picker-filters">
                <Segmented options={KINDS} value={kind} onChange={setKind} />
                <span className="muted small">
                  {short(path)} · {dt1.tiles.length} tiles · palette {tilePalette(path)}
                </span>
              </div>
              <div className="tp-grid">
                {tiles.map(({ t, i }) => (
                  <button key={i} className="tp-tile" onClick={() => openTile(path, i)} title={`Tile ${i}: ${ORIENTATION_NAMES[t.orientation] ?? t.orientation}, index ${t.mainIndex}/${t.subIndex}${t.rarity ? `, rarity ${t.rarity}` : ''}`}>
                    <LazyImg className={`tp-pic${isFloorLike(t.orientation) ? ' floor' : ''}`} load={() => tileThumb(path, dt1, i)} />
                    <span className="tp-label">
                      {ORIENTATION_NAMES[t.orientation] ?? `Orientation ${t.orientation}`}
                      <span className="muted">
                        {' '}
                        {t.mainIndex}/{t.subIndex}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
