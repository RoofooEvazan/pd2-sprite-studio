import { IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp, IconPhoto, IconTrash } from '@tabler/icons-react'
import { getFrame, loadReference, removeReference, updateReference, useStore } from '../store'

/** A picture to trace over (concept art, another sprite…). Never exported. */
export function ReferenceTab() {
  const ref = useStore((s) => s.reference)
  const nudge = (dx: number, dy: number) => ref && updateReference({ x: ref.x + dx, y: ref.y + dy })
  if (!ref)
    return (
      <div className="insp-section empty-tab">
        <IconPhoto size={34} stroke={1.3} className="muted" />
        <div>Trace over a picture</div>
        <div className="insp-help center">Load concept art, a screenshot or another sprite. It shows faintly behind your work and is never saved into the game.</div>
        <button className="primary-btn" onClick={loadReference}>
          Load a picture…
        </button>
      </div>
    )
  return (
    <div className="insp-section ref-tab">
      <div className="ref-name" title={ref.name}>
        {ref.name} <span className="muted">{ref.width}×{ref.height}</span>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={ref.visible} onChange={(e) => updateReference({ visible: e.target.checked })} /> Show it
      </label>
      <label className="check-row">
        <input type="checkbox" checked={ref.above} onChange={(e) => updateReference({ above: e.target.checked })} /> Draw it on top of the sprite
      </label>
      <label className={`check-row${ref.moving ? ' accent' : ''}`}>
        <input type="checkbox" checked={ref.moving} onChange={(e) => updateReference({ moving: e.target.checked })} /> Drag on the canvas to move it
      </label>
      <label className="field-row">
        <span>See-through</span>
        <input type="range" min={0.05} max={1} step={0.05} value={ref.opacity} onChange={(e) => updateReference({ opacity: +e.target.value })} />
      </label>
      <label className="field-row">
        <span>Size {ref.scale.toFixed(2)}×</span>
        <input type="range" min={0.1} max={4} step={0.05} value={ref.scale} onChange={(e) => updateReference({ scale: +e.target.value })} />
      </label>
      <div className="nudge">
        <span className="muted small">Nudge</span>
        <button className="ibtn" onClick={() => nudge(-1, 0)} aria-label="Left">
          <IconArrowLeft size={15} />
        </button>
        <button className="ibtn" onClick={() => nudge(1, 0)} aria-label="Right">
          <IconArrowRight size={15} />
        </button>
        <button className="ibtn" onClick={() => nudge(0, -1)} aria-label="Up">
          <IconArrowUp size={15} />
        </button>
        <button className="ibtn" onClick={() => nudge(0, 1)} aria-label="Down">
          <IconArrowDown size={15} />
        </button>
      </div>
      <div className="btn-row">
        <button
          className="chip-btn"
          onClick={() => {
            const f = getFrame()
            if (!f?.width) return
            updateReference({ scale: Math.min(f.width / ref.width, f.height / ref.height), x: f.offsetX, y: f.offsetY })
          }}
        >
          Fit to the frame
        </button>
        <button className="chip-btn" onClick={loadReference}>
          Replace…
        </button>
        <button className="chip-btn" onClick={removeReference}>
          <IconTrash size={15} /> Remove
        </button>
      </div>
    </div>
  )
}
