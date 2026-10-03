import { useEffect, useRef, useState } from 'react'
import { IconChevronDown, IconChevronUp, IconMovie } from '@tabler/icons-react'
import { compositeFrame, directionBounds, frameToRgba } from '../../../core/composite'
import { framesPerDir, getState, layerInputs, palette, setState, tintTable, useStore } from '../store'
import { Segmented } from '../ui'

/** Floating live preview of the animation, always playing, independent of the frame being edited. */
export function PreviewCard() {
  const doc = useStore((s) => s.doc)
  const show = useStore((s) => s.showPreview)
  const dir = useStore((s) => s.dir)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(2)
  const [speed, setSpeed] = useState(1)
  const frameRef = useRef(0)

  useEffect(() => {
    if (!doc || !show) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    let lastVersion = -1
    let lastFrame = -1
    const fps = doc.kind === 'anim' ? doc.fps : 12
    const tick = (now: number) => {
      const s = getState()
      const n = framesPerDir()
      acc += ((now - last) / 1000) * fps * speed
      last = now
      while (acc >= 1) {
        acc -= 1
        frameRef.current = (frameRef.current + 1) % n
      }
      const f = frameRef.current
      if (f !== lastFrame || s.version !== lastVersion) {
        lastFrame = f
        lastVersion = s.version
        const cv = canvasRef.current
        const d = s.doc
        if (cv && d) {
          const pal = palette()
          let img
          if (d.kind === 'anim') {
            const li = layerInputs(false)
            img = compositeFrame(d.cof, li, pal, dir, f, { bounds: directionBounds(d.cof, li, dir) })
          } else img = frameToRgba(d.sprite.frames[Math.min(dir, d.sprite.directions - 1)][f], pal, tintTable())
          cv.width = Math.max(1, img.width)
          cv.height = Math.max(1, img.height)
          cv.style.width = `${cv.width * scale}px`
          cv.style.height = `${cv.height * scale}px`
          cv.getContext('2d')!.putImageData(new ImageData(img.data, cv.width, cv.height), 0, 0)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [doc, show, dir, scale, speed])

  if (!doc || framesPerDir() <= 1) return null
  return (
    <div className={`preview-card${show ? '' : ' collapsed'}`}>
      <button className="pc-head" onClick={() => setState({ showPreview: !show })} data-tip="A live preview that always plays, so you can see your changes in motion">
        <IconMovie size={15} stroke={1.75} /> Preview {show ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
      </button>
      {show && (
        <>
          <div className="pc-stage">
            <canvas ref={canvasRef} />
          </div>
          <div className="pc-controls">
            <Segmented small options={[1, 2, 3].map((v) => ({ value: v, label: `${v}×` }))} value={scale} onChange={setScale} />
            <Segmented
              small
              options={[
                { value: 0.5, label: 'Slow' },
                { value: 1, label: 'Game speed' }
              ]}
              value={speed}
              onChange={setSpeed}
            />
          </div>
        </>
      )}
    </div>
  )
}
