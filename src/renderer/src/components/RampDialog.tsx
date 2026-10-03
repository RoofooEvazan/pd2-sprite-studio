import { useEffect, useMemo, useRef, useState } from 'react'
import { sortedPalette } from '../../../core/color'
import { frameToRgba, Rgba } from '../../../core/composite'
import { applyMap, connectedRegion, hsvShiftMap, rampOf, rampSwapMap } from '../../../core/edit'
import { paletteToHex } from '../../../core/palette'
import { Frame } from '../../../core/sprite'
import { applyToScope, commitFrame, getFrame, getState, palette, selectionContains, setState, toast, useStore } from '../store'
import { cloneFrame } from '../../../core/sprite'

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

/** Ramp shift: recolour a whole material (its shading ramp) at once, keeping the shading. */
export function RampDialog() {
  const rd = useStore((s) => s.rampDialog)
  const primary = useStore((s) => s.primary)
  const scope = useStore((s) => s.scope)
  const selection = useStore((s) => s.selection)
  const [mode, setMode] = useState<'swap' | 'adjust'>('swap')
  const [target, setTarget] = useState(primary)
  const [hue, setHue] = useState(0)
  const [sat, setSat] = useState(1)
  const [val, setVal] = useState(0)
  const [area, setArea] = useState<'connected' | 'scope'>('connected')
  useEffect(() => {
    if (rd) setTarget(getState().primary)
  }, [rd])
  const pal = palette()
  const order = useMemo(() => sortedPalette(pal, 'hue').filter((i) => i), [pal])

  const src = rd ? rampOf(pal, rd.index) : []
  const map = useMemo(() => {
    if (!rd) return new Map<number, number>()
    return mode === 'swap' ? rampSwapMap(pal, rd.index, target) : hsvShiftMap(pal, rampOf(pal, rd.index), hue, sat, val)
  }, [rd, mode, target, hue, sat, val, pal])

  const cur = rd ? getFrame() : null
  const region = useMemo(() => {
    if (!rd || !cur) return null
    return connectedRegion(cur, rd.x - cur.offsetX, rd.y - cur.offsetY, new Set(src))
  }, [rd, cur, src.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const transform = (f: Frame, isCurrent: boolean): Frame => {
    const sel = getState().selection
    if (area === 'connected' && isCurrent && region) {
      const px = f.pixels.slice()
      for (const i of region) {
        const to = map.get(px[i])
        if (to !== undefined) px[i] = to
      }
      return { ...f, pixels: px }
    }
    return applyMap(f, map, sel ? (x, y) => selectionContains(sel, x, y) : undefined)
  }

  if (!rd || !cur) return null
  const close = () => setState({ rampDialog: null })
  const preview = transform(cur, true)
  const before = frameToRgba(cur, pal)
  const after = frameToRgba(preview, pal)
  const scale = Math.max(1, Math.min(4, Math.floor(260 / Math.max(cur.width, cur.height, 1))))

  const apply = () => {
    if (area === 'connected') {
      commitFrame(getState().dir, getState().frame, cloneFrame(cur), preview)
      toast('Recoloured the connected area')
    } else {
      const n = applyToScope((f) => transform(f, false))
      toast(`Recoloured ${n} frame${n === 1 ? '' : 's'}`)
    }
    close()
  }

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Recolour a material
          <button className="x" onClick={close}>
            ×
          </button>
        </div>
        <div className="export-body">
          <section>
            <div className="muted small">Source ramp (from the clicked pixel, colour {rd.index}), light to dark:</div>
            <div className="ramp-map">
              {src.map((i) => (
                <div key={i} className="rm-col" title={`${i} → ${map.get(i)}`}>
                  <div className="rm-sw" style={{ background: paletteToHex(pal, i) }} />
                  <div className="rm-arrow">↓</div>
                  <div className="rm-sw" style={{ background: paletteToHex(pal, map.get(i) ?? i) }} />
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="opt-grid">
              <label className="check">
                <input type="radio" checked={mode === 'swap'} onChange={() => setMode('swap')} /> Swap to another ramp
              </label>
              <label className="check">
                <input type="radio" checked={mode === 'adjust'} onChange={() => setMode('adjust')} /> Adjust hue / saturation / brightness
              </label>
            </div>
            {mode === 'swap' ? (
              <>
                <div className="muted small">Pick the colour the clicked shade should become. Its ramp supplies the other shades.</div>
                <div className="mini-palette">
                  {order.map((i) => (
                    <div key={i} className={`mp-sw${i === target ? ' on' : ''}`} style={{ background: paletteToHex(pal, i) }} title={`${i}`} onMouseDown={() => setTarget(i)} />
                  ))}
                </div>
              </>
            ) : (
              <div className="opt-grid">
                <label>
                  Hue {hue > 0 ? '+' : ''}
                  {hue}°
                  <input type="range" min={-180} max={180} value={hue} onChange={(e) => setHue(+e.target.value)} />
                </label>
                <label>
                  Saturation ×{sat.toFixed(2)}
                  <input type="range" min={0} max={2} step={0.05} value={sat} onChange={(e) => setSat(+e.target.value)} />
                </label>
                <label>
                  Brightness {val > 0 ? '+' : ''}
                  {Math.round(val * 100)}%
                  <input type="range" min={-0.5} max={0.5} step={0.02} value={val} onChange={(e) => setVal(+e.target.value)} />
                </label>
              </div>
            )}
          </section>
          <section>
            <div className="opt-grid">
              <label className="check" title="Only the connected patch of this material you clicked, in this frame">
                <input type="radio" checked={area === 'connected'} onChange={() => setArea('connected')} /> Connected area you clicked (this frame)
              </label>
              <label className="check" title="Every pixel of these colours, across the toolbar's “Apply to” scope">
                <input type="radio" checked={area === 'scope'} onChange={() => setArea('scope')} /> All of these colours:{' '}
                {scope === 'frame' ? 'this frame' : scope === 'dir' ? 'every frame in this direction' : 'every frame, every direction'}
                {selection ? ', inside the selection' : ''}
              </label>
            </div>
            <div className="tc-imgs ramp-preview">
              <Img img={before} scale={scale} />
              <span className="arrow">→</span>
              <Img img={after} scale={scale} />
            </div>
            <div className="muted small">
              Tip: for a whole-animation recolour, pick “All of these colours” with Apply to set to All directions. If the same colours appear on other parts
              (skin and leather share browns, for example), select the part first or use the Material lock.
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
