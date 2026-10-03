import { useEffect, useRef, useState } from 'react'
import { frameToRgba, newRgba, overlay, Rgba } from '../../../core/composite'
import { addOutline, cleanStrays, darkenEdges } from '../../../core/edit'
import { paletteToHex } from '../../../core/palette'
import { Frame } from '../../../core/sprite'
import { applyToScope, getFrame, getState, originalFrame, palette, selectionContains, setState, toast, useStore } from '../store'

type Mode = 'outer' | 'inner' | 'clean'
type Where = 'all' | 'edits'

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

/** Sprite-space predicate: within `radius` px of a pixel that differs from the original frame. */
function nearEdits(cur: Frame, orig: Frame | null, radius: number): (x: number, y: number) => boolean {
  const at = (f: Frame | null, x: number, y: number) => {
    if (!f) return 0
    const lx = x - f.offsetX
    const ly = y - f.offsetY
    return lx >= 0 && ly >= 0 && lx < f.width && ly < f.height ? f.pixels[ly * f.width + lx] : 0
  }
  const x0 = Math.min(cur.offsetX, orig?.offsetX ?? cur.offsetX) - radius
  const y0 = Math.min(cur.offsetY, orig?.offsetY ?? cur.offsetY) - radius
  const x1 = Math.max(cur.offsetX + cur.width, orig ? orig.offsetX + orig.width : 0) + radius
  const y1 = Math.max(cur.offsetY + cur.height, orig ? orig.offsetY + orig.height : 0) + radius
  const w = x1 - x0
  const h = y1 - y0
  const m = new Uint8Array(w * h)
  for (let y = y0 + radius; y < y1 - radius; y++)
    for (let x = x0 + radius; x < x1 - radius; x++)
      if (at(cur, x, y) !== at(orig, x, y))
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) m[(y + dy - y0) * w + (x + dx - x0)] = 1
  return (x, y) => x >= x0 && y >= y0 && x < x1 && y < y1 && m[(y - y0) * w + (x - x0)] === 1
}

function pair(a: Rgba, b: Rgba): [Rgba, Rgba] {
  const x0 = Math.min(a.x0, b.x0)
  const y0 = Math.min(a.y0, b.y0)
  const w = Math.max(a.x0 + a.width, b.x0 + b.width) - x0
  const h = Math.max(a.y0 + a.height, b.y0 + b.height) - y0
  const A = newRgba(x0, y0, w, h)
  const B = newRgba(x0, y0, w, h)
  overlay(A, a, a.x0 - x0, a.y0 - y0)
  overlay(B, b, b.x0 - x0, b.y0 - y0)
  return [A, B]
}

export function OutlineDialog() {
  const show = useStore((s) => s.showOutline)
  const doc = useStore((s) => s.doc)
  const primary = useStore((s) => s.primary)
  const scope = useStore((s) => s.scope)
  const selection = useStore((s) => s.selection)
  useStore((s) => s.version)
  const [mode, setMode] = useState<Mode>('outer')
  const [auto, setAuto] = useState(true)
  const [diagonal, setDiagonal] = useState(false)
  const [steps, setSteps] = useState(1)
  const [where, setWhere] = useState<Where>('edits')
  const cur = show ? getFrame() : null
  if (!show || !doc || !cur) return null
  const pal = palette()
  const close = () => setState({ showOutline: false })

  const transform = (f: Frame, dir: number, frame: number): Frame => {
    const sel = getState().selection
    const near = where === 'edits' ? nearEdits(f, originalFrame(dir, frame), 2) : null
    const allow = (x: number, y: number) => (!near || near(x, y)) && selectionContains(sel, x, y)
    if (mode === 'outer') return addOutline(f, pal, auto ? { kind: 'auto' } : { kind: 'fixed', index: primary }, diagonal, allow, doc.kind === 'anim')
    if (mode === 'inner') return darkenEdges(f, pal, steps, allow)
    return cleanStrays(f, allow).frame
  }

  const s = getState()
  const preview = transform(cur, s.dir, s.frame)
  const [before, after] = pair(frameToRgba(cur, pal), frameToRgba(preview, pal))
  const scale = Math.max(1, Math.min(4, Math.floor(280 / Math.max(before.width, before.height, 1))))

  const apply = () => {
    const n = applyToScope((f, d, fr) => transform(f, d, fr))
    toast(n ? `Updated ${n} frame${n === 1 ? '' : 's'}` : 'Nothing changed')
    close()
  }

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Outline &amp; clean-up
          <button className="x" onClick={close}>
            ×
          </button>
        </div>
        <div className="export-body">
          <section>
            <div className="opt-grid">
              <label className="check">
                <input type="radio" checked={mode === 'outer'} onChange={() => setMode('outer')} /> Add outline
              </label>
              <label className="check">
                <input type="radio" checked={mode === 'inner'} onChange={() => setMode('inner')} /> Darken edges
              </label>
              <label className="check">
                <input type="radio" checked={mode === 'clean'} onChange={() => setMode('clean')} /> Clean stray pixels &amp; pinholes
              </label>
            </div>
            {mode === 'outer' && (
              <div className="opt-grid">
                <label className="check" title="Uses the darkest shade of the neighbouring pixel’s own ramp, like Diablo II’s own dark edges">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Automatic dark shade
                </label>
                {!auto && (
                  <span className="small">
                    using active colour <span className="sw-inline" style={{ background: paletteToHex(pal, primary) }} /> {primary}
                  </span>
                )}
                <label className="check">
                  <input type="checkbox" checked={diagonal} onChange={(e) => setDiagonal(e.target.checked)} /> Include diagonals (thicker)
                </label>
              </div>
            )}
            {mode === 'inner' && (
              <div className="opt-grid">
                <label>
                  Darken by
                  <select value={steps} onChange={(e) => setSteps(+e.target.value)}>
                    <option value={1}>1 step</option>
                    <option value={2}>2 steps</option>
                    <option value={3}>3 steps</option>
                  </select>
                </label>
              </div>
            )}
            {mode === 'clean' && <div className="muted small">Removes lone pixels with no neighbours, and fills 1-pixel holes with the most common surrounding colour.</div>}
          </section>
          <section>
            <div className="opt-grid">
              <label className="check" title="Only around pixels that differ from the original game file, so original art is left alone">
                <input type="radio" checked={where === 'edits'} onChange={() => setWhere('edits')} /> Only around my edits
              </label>
              <label className="check">
                <input type="radio" checked={where === 'all'} onChange={() => setWhere('all')} /> Whole sprite
              </label>
              <span className="muted small">
                {selection ? 'Inside the selection · ' : ''}
                {scope === 'frame' ? 'this frame' : scope === 'dir' ? 'all frames in this direction' : 'all frames, all directions'} (set with Apply to)
              </span>
            </div>
            <div className="tc-imgs ramp-preview">
              <Img img={before} scale={scale} />
              <span className="arrow">→</span>
              <Img img={after} scale={scale} />
            </div>
          </section>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="primary-btn" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
