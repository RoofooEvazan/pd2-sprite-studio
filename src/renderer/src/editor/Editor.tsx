import { useState } from 'react'
import { IconMaximize, IconRepeat, IconX, IconZoomIn, IconZoomOut, IconBulb } from '@tabler/icons-react'
import { COMPOSITS } from '../../../core/cof'
import { directionBounds } from '../../../core/composite'
import { PixelCanvas } from '../components/PixelCanvas'
import { frameKey, framesPerDir, getState, layerInputs, setState, useStore } from '../store'
import { PART_LABELS } from '../names'
import { TopBar } from './TopBar'
import { ToolRail } from './ToolRail'
import { ToolOptions } from './ToolOptions'
import { Timeline } from './Timeline'
import { Inspector } from './Inspector'
import { PreviewCard } from './PreviewCard'
import { IconButton } from '../ui'

function fitZoom(): void {
  const s = getState()
  const d = s.doc
  const el = document.querySelector('.canvas-scroll') as HTMLElement | null
  if (!d || !el) return
  let w = 1
  let h = 1
  if (d.kind === 'anim') {
    const b = directionBounds(d.cof, layerInputs(), s.dir)
    w = b.x1 - b.x0 + 24
    h = b.y1 - b.y0 + 24
  } else {
    const f = d.sprite.frames[s.dir][s.frame]
    w = f.width
    h = f.height
  }
  setState({ zoom: Math.max(1, Math.min(24, Math.floor(Math.min((el.clientWidth - 60) / w, (el.clientHeight - 60) / h)))) })
}

function CanvasOverlays() {
  const doc = useStore((s) => s.doc)
  const zoom = useStore((s) => s.zoom)
  const dir = useStore((s) => s.dir)
  const frame = useStore((s) => s.frame)
  const baselines = useStore((s) => s.baselines)
  const showOriginal = useStore((s) => s.showOriginal)
  useStore((s) => s.version)
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!doc) return null
  const key = frameKey(dir, frame)
  const edited = baselines.has(key)
  const activeName = doc.kind === 'anim' ? PART_LABELS[COMPOSITS[doc.active]] ?? COMPOSITS[doc.active] : null
  const showTransfer = doc.kind === 'anim' && edited && framesPerDir() > 1 && dismissed !== key

  return (
    <>
      {activeName && (
        <button className="canvas-chip top-left" onClick={() => setState({ inspectorTab: 'parts' })} data-tip="Change which part you're editing in Body parts">
          Editing: <b>{activeName}</b>
        </button>
      )}
      {showOriginal && <div className="canvas-chip top-center warn">Showing the original game picture</div>}
      {showTransfer && (
        <div className="canvas-chip bottom-center accent">
          <IconRepeat size={16} stroke={1.75} />
          You changed this frame.
          <button className="link-btn" onClick={() => setState({ showTransfer: true })}>
            Copy the change to the other frames
          </button>
          <button className="x-btn" aria-label="Dismiss" onClick={() => setDismissed(key)}>
            <IconX size={14} />
          </button>
        </div>
      )}
      <div className="zoom-box">
        <IconButton icon={IconZoomOut} label="Zoom out" tip="Zoom out (−)" size={16} onClick={() => setState({ zoom: Math.max(1, zoom - 1) })} />
        <span className="zoom-val">{zoom * 100}%</span>
        <IconButton icon={IconZoomIn} label="Zoom in" tip="Zoom in (+ or Ctrl+wheel)" size={16} onClick={() => setState({ zoom: Math.min(32, zoom + 1) })} />
        <IconButton icon={IconMaximize} label="Fit" tip="Fit to window" size={16} onClick={fitZoom} />
      </div>
    </>
  )
}

const TIPS_KEY = 'pd2ss.tipsSeen'

function Onboarding() {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(TIPS_KEY) === '1'
    } catch {
      return true
    }
  })
  const doc = useStore((s) => s.doc)
  if (seen || !doc) return null
  const close = () => {
    try {
      localStorage.setItem(TIPS_KEY, '1')
    } catch {
      /* ignore */
    }
    setSeen(true)
  }
  return (
    <div className="coach">
      <div className="coach-head">
        <IconBulb size={18} stroke={1.75} /> Quick tour
        <button className="x-btn" aria-label="Close" onClick={close}>
          <IconX size={14} />
        </button>
      </div>
      <ol>
        <li>
          <b>Tools</b> are on the left. Hover any of them to see what it does.
        </li>
        {doc.kind === 'anim' && (
          <li>
            <b>Body parts</b> on the right: click one (like Torso) to edit just that part.
          </li>
        )}
        <li>
          <b>Frames</b> are at the bottom. Press play, or change which way the character faces.
        </li>
        <li>
          Hold <b>Compare</b> to see the original, and use <b>Save to game</b> when you're done.
        </li>
      </ol>
      <button className="primary-btn small" onClick={close}>
        Got it
      </button>
    </div>
  )
}

export function Editor({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="editor">
      <TopBar onSettings={onSettings} />
      <div className="editor-main">
        <ToolRail />
        <div className="work">
          <ToolOptions />
          <div className="canvas-area">
            <PixelCanvas />
            <CanvasOverlays />
            <PreviewCard />
            <Onboarding />
          </div>
          <Timeline />
        </div>
        <Inspector />
      </div>
    </div>
  )
}
