import { useDeferredValue, useEffect, useRef } from 'react'
import { IconChevronLeft, IconChevronRight, IconPlayerPause, IconPlayerPlay, IconArrowUp } from '@tabler/icons-react'
import { compositeFrame, directionBounds, frameToRgba, Rgba } from '../../../core/composite'
import { directions, framesPerDir, getState, layerInputs, palette, setState, stepFrame, tintTable, useStore } from '../store'
import { facingAngle, facingName, facingOrder } from '../names'
import { Popover } from '../ui'

function Thumb({ img, active, onClick, label, edited }: { img: Rgba; active: boolean; onClick: () => void; label: string; edited: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = Math.max(1, img.width)
    c.height = Math.max(1, img.height)
    c.getContext('2d')!.putImageData(new ImageData(img.data, c.width, c.height), 0, 0)
  }, [img])
  return (
    <button className={`tl-frame${active ? ' on' : ''}`} onClick={onClick} data-tip={edited ? `Frame ${label} (edited)` : `Frame ${label}`}>
      <canvas ref={ref} />
      {edited && <span className="tl-edited" />}
    </button>
  )
}

/** Arrow pointing the way the character faces. */
export function FacingArrow({ count, dir, size = 16 }: { count: number; dir: number; size?: number }) {
  const a = facingAngle(count, dir)
  return <IconArrowUp size={size} stroke={2} style={{ transform: `rotate(${(a ?? 0) + 90}deg)` }} />
}

export function FacingPicker({ value, count, onChange }: { value: number; count: number; onChange: (d: number) => void }) {
  const size = 150
  const r = size / 2 - 16
  if (count <= 1) return null
  return (
    <div className="facing-picker" style={{ width: size, height: size }}>
      <div className="fp-center">
        <FacingArrow count={count} dir={value} size={22} />
      </div>
      {Array.from({ length: count }, (_, d) => {
        const a = facingAngle(count, d)
        const ang = ((a ?? (d * 360) / count) * Math.PI) / 180
        return (
          <button
            key={d}
            className={`fp-dot${d === value ? ' on' : ''}`}
            style={{ left: size / 2 + Math.cos(ang) * r - 11, top: size / 2 + Math.sin(ang) * r * 0.8 - 11 }}
            data-tip={`Facing ${facingName(count, d)}`}
            onClick={() => onChange(d)}
          >
            <FacingArrow count={count} dir={d} size={13} />
          </button>
        )
      })}
    </div>
  )
}

export function Timeline() {
  const doc = useStore((s) => s.doc)
  const dir = useStore((s) => s.dir)
  const frame = useStore((s) => s.frame)
  const playing = useStore((s) => s.playing)
  const version = useDeferredValue(useStore((s) => s.version))
  const baselines = useStore((s) => s.baselines)

  // Play through the frames in the editor at the game's speed
  useEffect(() => {
    if (!playing || !doc) return
    const fps = doc.kind === 'anim' ? doc.fps : 12
    const id = setInterval(() => stepFrame(1), 1000 / Math.max(1, fps))
    return () => clearInterval(id)
  }, [playing, doc])

  if (!doc) return null
  const nF = framesPerDir()
  const nD = directions()
  if (nF <= 1 && nD <= 1) return null
  const pal = palette()
  void version
  let thumbs: Rgba[]
  if (doc.kind === 'anim') {
    const li = layerInputs(true)
    const b = directionBounds(doc.cof, li, dir)
    thumbs = Array.from({ length: nF }, (_, f) => compositeFrame(doc.cof, li, pal, dir, f, { bounds: b }))
  } else thumbs = Array.from({ length: nF }, (_, f) => frameToRgba(doc.sprite.frames[dir][f], pal, tintTable()))
  const order = facingOrder(nD)
  const rotate = (delta: number) => {
    const i = order.indexOf(getState().dir)
    setState({ dir: order[(i + delta + order.length) % order.length] })
  }
  const keyOf = (f: number) => `${doc.kind === 'anim' ? doc.active : 'item'}:${dir}:${f}`

  return (
    <div className="timeline">
      {nF > 1 && (
        <div className="tl-controls">
          <button className="play-btn" onClick={() => setState({ playing: !playing })} data-tip={playing ? 'Pause' : 'Play the animation here'}>
            {playing ? <IconPlayerPause size={20} stroke={1.75} /> : <IconPlayerPlay size={20} stroke={1.75} />}
          </button>
          <button className="ibtn" onClick={() => stepFrame(-1)} data-tip="Previous frame (← or ,)">
            <IconChevronLeft size={18} />
          </button>
          <span className="tl-count">
            {frame + 1}
            <span className="muted"> / {nF}</span>
          </span>
          <button className="ibtn" onClick={() => stepFrame(1)} data-tip="Next frame (→ or .)">
            <IconChevronRight size={18} />
          </button>
        </div>
      )}
      <div className="tl-strip">
        {thumbs.map((t, f) => (
          <Thumb key={f} img={t} active={f === frame} label={String(f + 1)} edited={baselines.has(keyOf(f))} onClick={() => setState({ frame: f, playing: false })} />
        ))}
      </div>
      {nD > 1 && (
        <div className="tl-facing">
          <button className="ibtn" onClick={() => rotate(-1)} data-tip="Turn (↑)">
            <IconChevronLeft size={16} />
          </button>
          <Popover
            align="right"
            trigger={(open, toggle) => (
              <button className={`facing-btn${open ? ' on' : ''}`} onClick={toggle} data-tip="Which way the character faces">
                <FacingArrow count={nD} dir={dir} />
                <span>
                  <span className="muted small">Facing</span>
                  <br />
                  {facingName(nD, dir)}
                </span>
              </button>
            )}
          >
            {(close) => (
              <FacingPicker
                value={dir}
                count={nD}
                onChange={(d) => {
                  setState({ dir: d })
                  close()
                }}
              />
            )}
          </Popover>
          <button className="ibtn" onClick={() => rotate(1)} data-tip="Turn (↓)">
            <IconChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
