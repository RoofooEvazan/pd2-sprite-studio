import { useEffect, useMemo, useRef, useState } from 'react'
import { frameToRgba, newRgba, overlay, Rgba } from '../../../core/composite'
import { EditTransfer, TransferMode, TransferResult } from '../../../core/propagate'
import { cloneFrame, Frame } from '../../../core/sprite'
import { activeSprite, commitFrames, frameKey, getFrame, getState, palette, resetBaseline, setState, toast, useStore } from '../store'

type Scope = 'following' | 'allInDir' | 'allDirs'

interface Row {
  dir: number
  frame: number
  result: TransferResult
  before: Rgba
  after: Rgba
  accept: boolean
}

function Img({ img, scale }: { img: Rgba; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = Math.max(1, img.width)
    c.height = Math.max(1, img.height)
    c.getContext('2d')!.putImageData(new ImageData(img.data, c.width, c.height), 0, 0)
  }, [img])
  return <canvas ref={ref} style={{ width: img.width * scale, height: img.height * scale, imageRendering: 'pixelated' }} />
}

/** Put before/after on a shared canvas so both line up. */
function pair(a: Rgba, b: Rgba): [Rgba, Rgba] {
  const x0 = Math.min(a.x0, b.x0)
  const y0 = Math.min(a.y0, b.y0)
  const x1 = Math.max(a.x0 + a.width, b.x0 + b.width)
  const y1 = Math.max(a.y0 + a.height, b.y0 + b.height)
  const A = newRgba(x0, y0, x1 - x0, y1 - y0)
  const B = newRgba(x0, y0, x1 - x0, y1 - y0)
  overlay(A, a, a.x0 - x0, a.y0 - y0)
  overlay(B, b, b.x0 - x0, b.y0 - y0)
  return [A, B]
}

export function TransferDialog() {
  const show = useStore((s) => s.showTransfer)
  const dir = useStore((s) => s.dir)
  const frame = useStore((s) => s.frame)
  const baselines = useStore((s) => s.baselines)
  const doc = useStore((s) => s.doc)
  useStore((s) => s.version)
  const [mode, setMode] = useState<TransferMode | 'auto'>('auto')
  const [scope, setScope] = useState<Scope>('following')
  const [search, setSearch] = useState(8)
  const [minConf, setMinConf] = useState(0.2)
  const [strict, setStrict] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [info, setInfo] = useState('')

  const baseline = show ? baselines.get(frameKey(dir, frame)) : undefined
  const current = show ? getFrame(dir, frame) : null

  const analysis = useMemo(() => {
    if (!baseline || !current) return null
    const t = new EditTransfer(baseline, current, { mode: 'track' })
    return { changes: t.changes.length, suggested: t.suggestedMode(), purity: t.purity }
  }, [baseline, current])

  useEffect(() => setRows(null), [show, dir, frame, mode, scope, search, minConf, strict])

  if (!show || !doc) return null
  const close = () => setState({ showTransfer: false })

  const compute = () => {
    const sp = activeSprite()
    if (!sp || !baseline || !current) return
    const effMode: TransferMode = mode === 'auto' ? analysis!.suggested : mode
    const n = sp.framesPerDir
    const targets: { dir: number; frame: number }[] = []
    const dirs = scope === 'allDirs' ? Array.from({ length: sp.directions }, (_, d) => d) : [dir]
    for (const d of dirs) {
      if (d !== dir) {
        for (let f = 0; f < n; f++) targets.push({ dir: d, frame: f })
        continue
      }
      const count = scope === 'following' ? n - frame - 1 : n - 1
      for (let k = 1; k <= count; k++) targets.push({ dir: d, frame: (frame + k) % n })
    }
    const pal = palette()
    const out: Row[] = []
    let transfer: EditTransfer | null = null
    let lastDir = -1
    for (const t of targets) {
      // Tracking restarts per direction (different view angle)
      if (!transfer || t.dir !== lastDir) transfer = new EditTransfer(baseline, current, { mode: effMode, search, minConfidence: minConf, strictRecolor: strict })
      lastDir = t.dir
      const tf = sp.frames[t.dir][t.frame]
      const result = transfer.apply(tf)
      const [b, a] = pair(frameToRgba(tf, pal), frameToRgba(result.frame, pal))
      out.push({ ...t, result, before: b, after: a, accept: result.applied > 0 && (effMode !== 'track' || result.confidence >= minConf) })
    }
    setRows(out)
    setInfo(`Mode: ${effMode}. ${out.filter((r) => r.result.applied).length}/${out.length} frames received changes.`)
  }

  const apply = () => {
    if (!rows) return
    const s = getState()
    const list: { dir: number; frame: number; before: Frame; after: Frame }[] = []
    for (const r of rows) {
      if (!r.accept) continue
      const cur = activeSprite(s)?.frames[r.dir][r.frame]
      if (cur) list.push({ dir: r.dir, frame: r.frame, before: cloneFrame(cur), after: r.result.frame })
    }
    commitFrames(list)
    const n = list.length
    resetBaseline(dir, frame)
    setState({ showTransfer: false })
    toast(`Applied edits to ${n} frame${n === 1 ? '' : 's'} (one undo step).`)
  }

  const scale = 2
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Copy your changes from frame {frame + 1} to other frames
          <button className="x" onClick={close}>
            ×
          </button>
        </div>
        {!baseline || !analysis || analysis.changes === 0 ? (
          <div className="pad">
            <p>There are no edits on this frame to transfer yet.</p>
            <p className="muted">
              Paint on the current frame first. The editor snapshots the frame when you start editing it, and those changes are what get carried over to the other frames.
            </p>
          </div>
        ) : (
          <>
            <div className="transfer-opts">
              <div className="muted small">
                {analysis.changes} changed pixels · looks like a <b>{analysis.suggested === 'recolor' ? 'recolour' : 'shape edit'}</b> ({Math.round(analysis.purity * 100)}% consistent colour mapping)
              </div>
              <label>
                Method
                <select value={mode} onChange={(e) => setMode(e.target.value as TransferMode | 'auto')}>
                  <option value="auto">Auto ({analysis.suggested === 'recolor' ? 'recolour' : 'motion tracking'})</option>
                  <option value="track">Follow the movement: find where the edited area moved</option>
                  <option value="recolor">Recolour: swap the same colours everywhere</option>
                  <option value="fixed">Same spot: copy to exactly the same position</option>
                </select>
              </label>
              <label>
                Frames
                <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  <option value="following">The frames after this one</option>
                  <option value="allInDir">Every other frame facing this way</option>
                  <option value="allDirs">Every frame in every facing (best for recolours)</option>
                </select>
              </label>
              <label title="How far (px) an edited area may move between frames">
                Search radius {search}px
                <input type="range" min={2} max={24} value={search} onChange={(e) => setSearch(+e.target.value)} />
              </label>
              <label title="Areas that match worse than this are skipped">
                Min. match {Math.round(minConf * 100)}%
                <input type="range" min={0} max={0.9} step={0.05} value={minConf} onChange={(e) => setMinConf(+e.target.value)} />
              </label>
              <label className="check">
                <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} /> Strict: only recolour pixels with the original colour
              </label>
              <button className="primary-btn" onClick={compute}>
                Show me the result
              </button>
            </div>
            {rows && (
              <>
                <div className="muted small pad-x">{info} Uncheck any frame you don't want changed.</div>
                <div className="transfer-grid">
                  {rows.map((r, i) => (
                    <label key={i} className={`transfer-cell${r.accept ? ' on' : ''}`}>
                      <div className="tc-head">
                        <input
                          type="checkbox"
                          checked={r.accept}
                          onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, accept: e.target.checked } : x)))}
                        />
                        {scope === 'allDirs' ? `d${r.dir} ` : ''}f{r.frame + 1}
                        <span
                          className={`conf ${r.result.confidence > 0.4 ? 'good' : r.result.confidence > 0.2 ? 'ok' : 'bad'}`}
                          title="How closely the area around your edit matches in this frame. Animated parts rotate and re-shade between frames, so 30–50% is usually a correct match. Check the thumbnails."
                        >
                          {r.result.applied ? `${Math.round(r.result.confidence * 100)}%` : 'no change'}
                        </span>
                      </div>
                      <div className="tc-imgs">
                        <Img img={r.before} scale={scale} />
                        <span className="arrow">→</span>
                        <Img img={r.after} scale={scale} />
                      </div>
                      {r.result.regions.some((g) => g.skipped) && <div className="warn tiny">{r.result.regions.filter((g) => g.skipped).length} area(s) skipped: low match</div>}
                    </label>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setRows(rows.map((r) => ({ ...r, accept: false })))}>
                    Uncheck all
                  </button>
                  <button className="primary-btn" onClick={apply}>
                    Apply to {rows.filter((r) => r.accept).length} frames
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
