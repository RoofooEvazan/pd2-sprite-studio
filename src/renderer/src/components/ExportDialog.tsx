import { useState } from 'react'
import { encodeLayerFile, layerPath } from '../../../core/unitLayer'
import { COMPOSITS } from '../../../core/cof'
import { compositeFrame, directionBounds, frameToRgba, LayerInput, overlayAll, Rgba, sheet } from '../../../core/composite'
import { encodeDc6 } from '../../../core/dc6'
import { bestCellAnchor } from '../../../core/dcc'
import { dccDirectionCells, exceedsUnitFrameLimit, maxFrameSize, MAX_DCC_DIRECTION_CELLS, MAX_UNIT_FRAME } from '../../../core/unitSplit'
import { armtypeName, PART_LABELS } from '../names'
import { api } from '../api'
import { Background, encodeGif, rgbaToBytes, saveBytes, scaleRgba, withBackground } from '../imageExport'
import { AnimDoc, getState, ItemDoc, palette, setState, tintTable, toast, useStore } from '../store'

type Source = 'composite' | 'layer'

function layersFor(d: AnimDoc, source: Source): Map<number, LayerInput> {
  const m = new Map<number, LayerInput>()
  for (const l of d.layers) m.set(l.composit, { sprite: l.sprite, visible: source === 'layer' ? l.composit === d.active : l.visible })
  return m
}

function animFrame(d: AnimDoc, source: Source, dir: number, f: number, bounds?: { x0: number; y0: number; x1: number; y1: number }): Rgba {
  const li = layersFor(d, source)
  return compositeFrame(d.cof, li, palette(), dir, f, { bounds: bounds ?? directionBounds(d.cof, li, dir) })
}

function stem(d: AnimDoc | ItemDoc): string {
  if (d.kind === 'item') return d.path.substring(d.path.lastIndexOf('\\') + 1).replace(/\.dc6$/i, '')
  return `${d.unit.token}${d.mode}${d.wclass}`
}

export function ExportDialog() {
  const show = useStore((s) => s.showExport)
  const doc = useStore((s) => s.doc)
  const status = useStore((s) => s.status)
  const [scale, setScale] = useState(2)
  const [bgKind, setBgKind] = useState<'transparent' | 'color'>('transparent')
  const [bgColor, setBgColor] = useState('#000000')
  const [source, setSource] = useState<Source>('composite')
  const [allDirs, setAllDirs] = useState(false)
  const [overlayAlpha, setOverlayAlpha] = useState(0.6)
  const [busy, setBusy] = useState(false)
  const [includeAll, setIncludeAll] = useState(false)
  const [includeCof, setIncludeCof] = useState(false)
  if (!show || !doc) return null
  const close = () => setState({ showExport: false })
  const bg: Background = bgKind === 'transparent' ? { kind: 'transparent' } : { kind: 'color', rgb: [1, 3, 5].map((i) => parseInt(bgColor.substr(i, 2), 16)) as [number, number, number] }
  const s = getState()
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(`Export failed: ${e}`)
    } finally {
      setBusy(false)
    }
  }
  const saved = (p: string | null) => p && toast(`Saved ${p}`)

  const currentImage = (): Rgba => {
    if (doc.kind === 'item') return frameToRgba(doc.sprite.frames[s.dir][s.frame], palette(), tintTable())
    return animFrame(doc, source, s.dir, s.frame)
  }

  const exportImage = (type: 'png' | 'jpeg') =>
    run(async () => {
      let im = scaleRgba(currentImage(), scale)
      if (type === 'jpeg') im = withBackground(im, bgKind === 'color' ? bg : { kind: 'color', rgb: [0, 0, 0] })
      else im = withBackground(im, bg)
      const bytes = await rgbaToBytes(im, type === 'png' ? 'image/png' : 'image/jpeg')
      saved(await saveBytes(`${stem(doc)}_d${s.dir}_f${s.frame + 1}.${type === 'png' ? 'png' : 'jpg'}`, bytes, type === 'png' ? 'png' : 'jpg', type.toUpperCase()))
    })

  const exportGif = () =>
    run(async () => {
      if (doc.kind !== 'anim') return
      const dirs = allDirs ? Array.from({ length: doc.cof.directions }, (_, i) => i) : [s.dir]
      const frames: Rgba[] = []
      // Common bounds across the chosen directions keep the character still
      const li = layersFor(doc, source)
      const bs = dirs.map((d) => directionBounds(doc.cof, li, d))
      const b = { x0: Math.min(...bs.map((x) => x.x0)), y0: Math.min(...bs.map((x) => x.y0)), x1: Math.max(...bs.map((x) => x.x1)), y1: Math.max(...bs.map((x) => x.y1)) }
      for (const d of dirs) for (let f = 0; f < doc.cof.framesPerDir; f++) frames.push(scaleRgba(animFrame(doc, source, d, f, b), scale))
      const bytes = encodeGif(frames, doc.fps, bg)
      saved(await saveBytes(`${stem(doc)}${allDirs ? '_all' : `_d${s.dir}`}.gif`, bytes, 'gif', 'GIF'))
    })

  const exportSheet = () =>
    run(async () => {
      let rows: Rgba[][]
      if (doc.kind === 'anim') {
        const dirs = allDirs ? Array.from({ length: doc.cof.directions }, (_, i) => i) : [s.dir]
        rows = dirs.map((d) => Array.from({ length: doc.cof.framesPerDir }, (_, f) => animFrame(doc, source, d, f)))
      } else rows = doc.sprite.frames.map((dir) => dir.map((f) => frameToRgba(f, palette(), tintTable())))
      const im = withBackground(scaleRgba(sheet(rows, 2), scale), bg)
      saved(await saveBytes(`${stem(doc)}_sheet.png`, await rgbaToBytes(im, 'image/png'), 'png', 'PNG'))
    })

  const exportOverlay = () =>
    run(async () => {
      if (doc.kind !== 'anim') return
      const frames = Array.from({ length: doc.cof.framesPerDir }, (_, f) => animFrame(doc, source, s.dir, f))
      const im = withBackground(scaleRgba(overlayAll(frames, overlayAlpha), scale), bg)
      saved(await saveBytes(`${stem(doc)}_d${s.dir}_positions.png`, await rgbaToBytes(im, 'image/png'), 'png', 'PNG'))
    })

  const dc6Bytes = (d: ItemDoc) => encodeDc6(d.sprite, d.meta)

  const layerFiles = (d: AnimDoc) => {
    const files: { rel: string; data: Uint8Array }[] = []
    let violations = 0
    for (const l of d.layers) {
      if (!l.sprite || (!l.dirty && !includeAll)) continue
      if (exceedsUnitFrameLimit(l.sprite)) {
        const m = maxFrameSize(l.sprite)
        throw new Error(`${PART_LABELS[COMPOSITS[l.composit]] ?? COMPOSITS[l.composit]} has frames up to ${m.width}×${m.height} px. The game can't load frames over ${MAX_UNIT_FRAME}×${MAX_UNIT_FRAME}, so nothing was saved. Make it smaller, or split it across spare body-part slots (S1–S8).`)
      }
      if (l.format === 'dcc' && dccDirectionCells(l.sprite) > MAX_DCC_DIRECTION_CELLS)
        throw new Error(`${COMPOSITS[l.composit]}: one direction spans ${dccDirectionCells(l.sprite)} 4×4 cells (all its frames together); the game crashes above about ${MAX_DCC_DIRECTION_CELLS} cells for a DCC. Nothing was written. Keep the frames closer together, or save this layer as DC6.`)
      if (l.format === 'dcc') for (const dir of l.sprite.frames) violations += bestCellAnchor(dir).violations
      files.push({
        rel: layerPath({ base: d.unit.base, token: d.unit.token }, COMPOSITS[l.composit], l.armtype, d.mode, l.weaponClass, l.format),
        data: encodeLayerFile(l.sprite, l.format, { palette: palette(), frameMeta: l.frameMeta, dc6Meta: l.dc6Meta })
      })
    }
    return { files, violations }
  }

  const exportPd2 = () =>
    run(async () => {
      let files: { rel: string; data: Uint8Array }[] = []
      let note = ''
      if (doc.kind === 'item') files = [{ rel: doc.path, data: dc6Bytes(doc) }]
      else {
        const r = layerFiles(doc)
        files = r.files
        if (includeCof) {
          const cof = await api.read(doc.cofPath)
          if (cof) files.push({ rel: doc.cofPath, data: cof.data })
        }
        if (r.violations) note = ` ${r.violations} small area(s) used more than 4 colours and were simplified.`
      }
      if (!files.length) return toast("Nothing to save yet. You haven't changed any part.")
      const res = await api.exportPd2(files)
      toast(`Saved ${res.written.length} file${res.written.length === 1 ? '' : 's'} to ${res.root}.${note}`)
      close()
      if (res.written[0]) api.reveal(res.written[0])
      if (doc.kind === 'item') doc.dirty = false
      else for (const l of doc.layers) l.dirty = false
      setState({ version: getState().version + 1 })
    })

  const saveNative = () =>
    run(async () => {
      if (doc.kind === 'item') saved(await saveBytes(`${stem(doc)}.dc6`, dc6Bytes(doc), 'dc6', 'DC6 sprite'))
      else {
        const l = doc.layers.find((x) => x.composit === doc.active)
        if (!l?.sprite) return toast('Active layer is empty')
        const name = `${doc.unit.token}${COMPOSITS[l.composit]}${l.armtype}${doc.mode}${l.weaponClass}.${l.format}`
        const data = encodeLayerFile(l.sprite, l.format, { palette: palette(), frameMeta: l.frameMeta, dc6Meta: l.dc6Meta })
        saved(await saveBytes(name, data, l.format, l.format === 'dc6' ? 'DC6 animation' : 'DCC animation'))
      }
    })

  const isAnim = doc.kind === 'anim'
  const mode = s.exportMode
  const editedParts = isAnim ? doc.layers.filter((l) => l.dirty && l.sprite) : []
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {mode === 'game' ? 'Save to game' : 'Save a picture'}
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        {mode === 'game' ? (
          <div className="export-body">
            <section>
              {isAnim ? (
                editedParts.length ? (
                  <>
                    <p>These edited parts will be saved as game files:</p>
                    <ul className="file-list">
                      {editedParts.map((l) => (
                        <li key={l.composit}>
                          <b>{PART_LABELS[COMPOSITS[l.composit]] ?? COMPOSITS[l.composit]}</b>{' '}
                          <span className="muted">({armtypeName(s.catalog, COMPOSITS[l.composit], l.armtype)})</span>
                          <div className="muted tiny mono">{layerPath({ base: doc.unit.base, token: doc.unit.token }, COMPOSITS[l.composit], l.armtype, doc.mode, l.weaponClass, l.format)}</div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="muted">You haven't changed any part of this animation yet.</p>
                )
              ) : (
                <>
                  <p>
                    <b>{doc.title}</b> will be saved as a game file.
                  </p>
                  <div className="muted tiny mono">{doc.path}</div>
                </>
              )}
              <div className="save-folder">
                <div>
                  <div className="small">Saved into</div>
                  <div className="mono small">{status?.exportRoot}</div>
                </div>
                <button className="chip-btn" onClick={async () => (await api.pickExportRoot()) && setState({ status: await api.status() })}>
                  Change folder…
                </button>
              </div>
              <div className="insp-help">
                Files keep the game's own folder layout (data\global\…), ready to pack into your mod. Your game install is never changed.
              </div>
            </section>
            <details className="advanced">
              <summary>Advanced</summary>
              {isAnim && (
                <div className="opt-grid">
                  <label className="check">
                    <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} /> Also save parts I didn't change
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={includeCof} onChange={(e) => setIncludeCof(e.target.checked)} /> Also save the animation's layer file (.cof)
                  </label>
                </div>
              )}
              <div className="btn-row">
                <button className="btn" disabled={busy} onClick={saveNative}>
                  Save {isAnim ? 'just the part being edited' : 'the .dc6 file'} somewhere else…
                </button>
              </div>
            </details>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="primary-btn" disabled={busy || (isAnim && !editedParts.length && !includeAll)} onClick={exportPd2}>
                Save files
              </button>
            </div>
          </div>
        ) : (
          <div className="export-body">
            <section>
              <div className="opt-grid">
                <label>
                  Size
                  <select value={scale} onChange={(e) => setScale(+e.target.value)}>
                    {[1, 2, 3, 4, 6, 8].map((v) => (
                      <option key={v} value={v}>
                        {v}× {v === 1 ? '(actual pixels)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Background
                  <select value={bgKind} onChange={(e) => setBgKind(e.target.value as 'transparent' | 'color')}>
                    <option value="transparent">See-through</option>
                    <option value="color">Solid colour</option>
                  </select>
                  {bgKind === 'color' && <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />}
                </label>
                {isAnim && (
                  <label>
                    Show
                    <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
                      <option value="composite">The whole body</option>
                      <option value="layer">Only the part being edited</option>
                    </select>
                  </label>
                )}
                {isAnim && (
                  <label className="check">
                    <input type="checkbox" checked={allDirs} onChange={(e) => setAllDirs(e.target.checked)} /> Every facing (GIF and sprite sheet)
                  </label>
                )}
              </div>
            </section>
            <section>
              <div className="export-grid">
                <button className="export-tile" disabled={busy} onClick={() => exportImage('png')}>
                  <b>This frame</b>
                  <span className="muted small">PNG (keeps transparency)</span>
                </button>
                <button className="export-tile" disabled={busy} onClick={() => exportImage('jpeg')}>
                  <b>This frame</b>
                  <span className="muted small">JPEG</span>
                </button>
                {isAnim && (
                  <button className="export-tile" disabled={busy} onClick={exportGif}>
                    <b>Animated GIF</b>
                    <span className="muted small">Plays at game speed</span>
                  </button>
                )}
                <button className="export-tile" disabled={busy} onClick={exportSheet}>
                  <b>Sprite sheet</b>
                  <span className="muted small">Every frame in a grid</span>
                </button>
                {isAnim && (
                  <button className="export-tile" disabled={busy} onClick={exportOverlay}>
                    <b>All frames in one picture</b>
                    <span className="muted small">Each frame at its in-game position</span>
                  </button>
                )}
              </div>
              {isAnim && (
                <label className="field-row">
                  <span>“All frames in one picture” see-through</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={overlayAlpha} onChange={(e) => setOverlayAlpha(+e.target.value)} />
                </label>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}