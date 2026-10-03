import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconArrowBackUp,
  IconBox,
  IconCircle,
  IconCone,
  IconCylinder,
  IconFolderOpen,
  IconHome,
  IconPill,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
  IconCube,
  IconPhoto,
  IconWand
} from '@tabler/icons-react'
import { COMPOSITS } from '../../../core/cof'
import { compositeFrame, directionBounds, LayerInput, newRgba, blitIndexed } from '../../../core/composite'
import { PaletteLut, renderToFrame } from '../../../core/renderImport'
import { Frame, Sprite } from '../../../core/sprite'
import { api } from '../api'
import { rgbaToBytes } from '../imageExport'
import { AnimDoc, goTo, palette, setLayerSprite, setState, toast, useStore } from '../store'
import { IconButton, Popover, MenuItem, Segmented } from '../ui'
import { FacingPicker } from '../editor/Timeline'
import { facingName, modeName, PART_LABELS } from '../names'
import { GAME_CANVAS, Lighting, ShapeKind, studio } from './engine'

function useStudio() {
  useSyncExternalStore(
    (l) => studio.subscribe(l),
    () => studio.version
  )
  return studio
}

const SHAPES: { kind: ShapeKind; label: string; icon: typeof IconBox }[] = [
  { kind: 'box', label: 'Box', icon: IconBox },
  { kind: 'cylinder', label: 'Cylinder (handles, poles)', icon: IconCylinder },
  { kind: 'sphere', label: 'Sphere', icon: IconCircle },
  { kind: 'cone', label: 'Cone (spikes, tips)', icon: IconCone },
  { kind: 'capsule', label: 'Capsule', icon: IconPill }
]

function Viewport() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    studio.mount(el)
    return () => studio.unmount()
  }, [])
  return <div className="st-viewport" ref={ref} />
}

/** Live picture of the current pose in the game's colours and size (optionally on the open body). */
function GamePreview({ onBody, anim, part }: { onBody: boolean; anim: AnimDoc | null; part: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const lut = useMemo(() => new PaletteLut(palette()), [])
  useEffect(() => {
    const id = setInterval(() => {
      const c = ref.current
      if (!c || !studio.objects.length) return
      const s = studio.settings
      const img = studio.renderGame(s.previewDir, s.time)
      const ss = studio.supersample
      const fr = renderToFrame(img, lut, { originX: img.width / 2, originY: img.height / 2, scale: 1 / ss, alphaThreshold: 128, dither: false })
      const pal = palette()
      let out
      if (onBody && anim) {
        const layers = new Map<number, LayerInput>()
        for (const l of anim.layers) layers.set(l.composit, { sprite: l.sprite, visible: l.composit === part || l.visible })
        const dir = Math.min(s.previewDir, anim.cof.directions - 1)
        const frameIdx = Math.floor((s.time / studio.duration) * anim.cof.framesPerDir) % anim.cof.framesPerDir
        const b = directionBounds(anim.cof, layers, dir)
        const bb = { x0: Math.min(b.x0, fr.offsetX), y0: Math.min(b.y0, fr.offsetY), x1: Math.max(b.x1, fr.offsetX + fr.width), y1: Math.max(b.y1, fr.offsetY + fr.height) }
        out = compositeFrame(anim.cof, layers, pal, dir, frameIdx, { bounds: bb, override: (comp) => (comp === part ? fr : undefined) })
      } else {
        out = newRgba(-60, -110, 120, 130)
        blitIndexed(out, fr, pal)
      }
      c.width = out.width
      c.height = out.height
      c.getContext('2d')!.putImageData(new ImageData(out.data, out.width, out.height), 0, 0)
    }, 120)
    return () => clearInterval(id)
  }, [lut, onBody, anim, part])
  return <canvas ref={ref} className="st-game-canvas" />
}

export function Studio3D() {
  const st = useStudio()
  const doc = useStore((s) => s.doc)
  const anim = doc?.kind === 'anim' ? doc : null
  const s = st.settings
  const sel = st.selectedObject
  const [part, setPart] = useState<number>(() => anim?.active ?? 0)
  const [code, setCode] = useState('NEW')
  const [freeFrames, setFreeFrames] = useState(8)
  const [onBody, setOnBody] = useState(true)
  const [progress, setProgress] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useStore((s) => s.version)
  // The engine animates without re-rendering React; refresh the timeline readout a few times a second
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => studio.settings.playing && setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  // Match the open animation's number of facings
  useEffect(() => {
    if (anim && s.directions !== anim.cof.directions) st.set({ directions: anim.cof.directions === 16 ? 16 : 8 })
  }, [anim]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (anim) setPart(anim.active)
  }, [anim?.active]) // eslint-disable-line react-hooks/exhaustive-deps

  const clips = st.animatedModel?.clips ?? []
  const attachPoints = useMemo(() => st.attachPoints(), [st.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const frames = anim ? anim.cof.framesPerDir : freeFrames

  const loadModel = async () => {
    const f = await api.open3d()
    if (!f) return
    setLoading(true)
    try {
      const o = await st.loadModel(f)
      toast(`Loaded ${o.name}${o.clips.length ? ` with ${o.clips.length} animation${o.clips.length === 1 ? '' : 's'}` : ''}`)
    } catch (e) {
      toast(`Couldn't open that model: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
    }
  }

  const renderAll = async (toFolder: boolean) => {
    if (!st.objects.length) return toast('Load a model or add a shape first.')
    const dirs = anim && !toFolder ? anim.cof.directions : s.directions
    const nFrames = frames
    const times = st.frameTimes(nFrames)
    const lut = new PaletteLut(palette())
    const ss = st.supersample
    const wasPlaying = s.playing
    st.set({ playing: false })
    const out: Frame[][] = []
    const files: { name: string; data: Uint8Array }[] = []
    try {
      for (let d = 0; d < dirs; d++) {
        setProgress(`Rendering facing ${d + 1} of ${dirs}…`)
        await new Promise((r) => setTimeout(r, 0))
        const row: Frame[] = []
        for (let f = 0; f < nFrames; f++) {
          const img = st.renderGame(d, times[f])
          if (toFolder) {
            const rgba = { x0: 0, y0: 0, width: img.width, height: img.height, data: new Uint8ClampedArray(img.rgba) }
            files.push({ name: `sprite_d${String(d).padStart(2, '0')}_f${String(f).padStart(3, '0')}.png`, data: await rgbaToBytes(rgba, 'image/png') })
          } else row.push(renderToFrame(img, lut, { originX: img.width / 2, originY: img.height / 2, scale: 1 / ss, alphaThreshold: 128, dither: false }))
        }
        out.push(row)
      }
      if (toFolder) {
        const px = GAME_CANVAS * ss
        files.push({
          name: 'd2_render.json',
          data: new TextEncoder().encode(JSON.stringify({ tool: '3d-studio', directions: dirs, frames: nFrames, width: px, height: px, originX: px / 2, originY: px / 2 }, null, 2))
        })
        setProgress('Saving…')
        const where = await api.saveRenderFolder(files)
        if (where) toast(`Saved ${files.length - 1} renders to ${where}. Import them with More › Import 3D renders (size 50%).`)
      } else if (anim) {
        const sprite: Sprite = { directions: dirs, framesPerDir: nFrames, frames: out }
        setLayerSprite(part, sprite, code)
        setState({ screen: 'editor' })
        toast(`Rendered ${dirs} facings × ${nFrames} frames into the ${PART_LABELS[COMPOSITS[part]]?.toLowerCase() ?? 'part'} (style ${code}).`)
      }
    } catch (e) {
      toast(`Rendering failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setProgress(null)
      st.set({ playing: wasPlaying })
    }
  }

  return (
    <div className="studio">
      <div className="topbar">
        <IconButton icon={IconHome} label="Home" onClick={() => goTo('home')} />
        <div className="crumbs">
          <span className="crumb current">3D Studio</span>
          {anim ? (
            <button className="crumb" onClick={() => setState({ screen: 'editor' })} data-tip="Back to the sprite editor">
              <IconArrowBackUp size={15} /> Back to {anim.unit.label}: {modeName(anim.mode).toLowerCase()}
            </button>
          ) : null}
        </div>
      </div>
      <div className="studio-main">
        <aside className="st-left">
          <div className="insp-section">
            <div className="insp-label">Scene</div>
            <div className="btn-row">
              <button className="primary-btn small" onClick={loadModel} disabled={loading}>
                <IconFolderOpen size={16} /> {loading ? 'Loading…' : 'Load model…'}
              </button>
              <Popover
                trigger={(open, toggle) => (
                  <button className={`chip-btn${open ? ' accent' : ''}`} onClick={toggle}>
                    <IconCube size={15} /> Add shape
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {SHAPES.map((sh) => (
                      <MenuItem key={sh.kind} icon={sh.icon} label={sh.label} onClick={() => (close(), st.addShape(sh.kind))} />
                    ))}
                  </>
                )}
              </Popover>
            </div>
            <div className="insp-help">FBX (3ds Max, Mixamo), GLB/glTF (Blender) and OBJ. Put textures next to the model file.</div>
          </div>
          <div className="st-objects">
            {st.objects.length === 0 && <div className="insp-help pad-x">Nothing here yet. Load a model, or add shapes to build a simple weapon or prop.</div>}
            {st.objects.map((o) => (
              <div key={o.id} className={`st-obj${o.id === st.selected ? ' on' : ''}`} onClick={() => st.select(o.id)}>
                {o.kind === 'model' ? <IconCube size={16} stroke={1.75} /> : <IconBox size={16} stroke={1.75} />}
                <span className="st-obj-name">{o.name}</span>
                {o.clips.length > 0 && <span className="part-badge">{o.clips.length} anim</span>}
                <button
                  className="part-eye"
                  data-tip="Remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    st.remove(o.id)
                  }}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
          </div>
          {sel && (
            <div className="insp-section">
              <div className="insp-label">{sel.name}</div>
              <Segmented
                small
                options={[
                  { value: 'translate', label: 'Move' },
                  { value: 'rotate', label: 'Rotate' },
                  { value: 'scale', label: 'Resize' }
                ]}
                value={s.gizmo}
                onChange={(v) => st.set({ gizmo: v })}
              />
              <div className="insp-help">Drag the handles in the view. “Free look” is easiest for placing things.</div>
              {sel.kind === 'shape' && (
                <>
                  <label className="field-row">
                    <span>Colour</span>
                    <input type="color" value={sel.color ?? '#b9a27a'} onChange={(e) => st.setColor(sel.id, e.target.value)} />
                  </label>
                  <label className="field-row">
                    <span>Metal</span>
                    <input type="range" min={0} max={1} step={0.05} defaultValue={0.2} onChange={(e) => st.setMetal(sel.id, +e.target.value)} />
                  </label>
                </>
              )}
              {sel.kind === 'shape' && attachPoints.length > 0 && (
                <label className="field-row" data-tip="Hang this shape from a part of the model so it moves with it, like a sword in a hand">
                  <span>Held by</span>
                  <select value={sel.attachedTo ?? ''} onChange={(e) => st.attach(sel.id, e.target.value || null)}>
                    <option value="">Nothing</option>
                    {attachPoints.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </aside>

        <div className="st-center">
          <Viewport />
          <div className="st-view-bar">
            <Segmented
              small
              options={[
                { value: 'game', label: 'Game camera', tip: 'Exactly the angle the sprites are rendered from' },
                { value: 'free', label: 'Free look', tip: 'Orbit with the mouse: left-drag turns, right-drag pans, wheel zooms' }
              ]}
              value={s.view}
              onChange={(v) => st.set({ view: v })}
            />
            <label className="check">
              <input type="checkbox" checked={s.showGrid} onChange={(e) => st.set({ showGrid: e.target.checked })} /> Ground grid
            </label>
            <span className="muted small">The gold arrow shows where “down-left” (the first facing) points.</span>
          </div>
          <div className="st-timeline">
            <button className="play-btn" onClick={() => st.set({ playing: !s.playing })} disabled={!st.clip} data-tip={s.playing ? 'Pause' : 'Play'}>
              {s.playing ? <IconPlayerPause size={20} /> : <IconPlayerPlay size={20} />}
            </button>
            {clips.length > 1 && (
              <select value={s.clipIndex} onChange={(e) => st.set({ clipIndex: +e.target.value })}>
                {clips.map((c, i) => (
                  <option key={i} value={i}>
                    {c.name || `Animation ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            <input
              className="st-scrub"
              type="range"
              min={0}
              max={st.duration}
              step={0.001}
              value={s.time}
              disabled={!st.clip}
              onChange={(e) => st.set({ time: +e.target.value, playing: false })}
            />
            <span className="tl-count small">{st.clip ? `${s.time.toFixed(2)}s / ${st.duration.toFixed(2)}s` : 'No animation'}</span>
            <Segmented
              small
              options={[
                { value: 0.5, label: '½×' },
                { value: 1, label: '1×' }
              ]}
              value={s.speed}
              onChange={(v) => st.set({ speed: v })}
            />
          </div>
          {progress && (
            <div className="st-progress">
              <span className="lazy-spin" /> {progress}
            </div>
          )}
        </div>

        <aside className="st-right">
          <div className="insp-section">
            <div className="insp-label">In the game</div>
            <div className="st-game">
              <GamePreview onBody={onBody && !!anim} anim={anim} part={part} />
            </div>
            {anim && (
              <label className="check-row">
                <input type="checkbox" checked={onBody} onChange={(e) => setOnBody(e.target.checked)} /> Show on {anim.unit.label} ({PART_LABELS[COMPOSITS[part]]?.toLowerCase()})
              </label>
            )}
          </div>
          <div className="insp-section">
            <div className="insp-label">Facing: {facingName(s.directions, s.previewDir)}</div>
            <div className="st-facing">
              <FacingPicker value={s.previewDir} count={s.directions} onChange={(d) => st.set({ previewDir: d })} />
            </div>
            <label className="field-row" data-tip="Turn the model so it faces the gold arrow when Facing is down-left">
              <span>Turn model {s.yaw}°</span>
              <input type="range" min={-180} max={180} step={5} value={s.yaw} onChange={(e) => st.set({ yaw: +e.target.value })} />
            </label>
            {!anim && (
              <label className="field-row">
                <span>Facings</span>
                <Segmented
                  small
                  options={[
                    { value: 8, label: '8 (monster)' },
                    { value: 16, label: '16 (character)' }
                  ]}
                  value={s.directions}
                  onChange={(v) => st.set({ directions: v, previewDir: 0 })}
                />
              </label>
            )}
          </div>
          <div className="insp-section">
            <label className="field-row">
              <span>Height in game {s.heightPx}px</span>
              <input
                type="range"
                min={20}
                max={200}
                step={1}
                value={s.heightPx}
                onChange={(e) => {
                  st.set({ heightPx: +e.target.value })
                  st.fitSize()
                }}
              />
            </label>
            <div className="insp-help">Diablo II characters are about 70–90 px tall. Big monsters can be 150+.</div>
            <label className="field-row">
              <span>Lighting</span>
              <Segmented<Lighting>
                small
                options={[
                  { value: 'diablo', label: 'Diablo II' },
                  { value: 'bright', label: 'Bright' },
                  { value: 'dungeon', label: 'Torchlight' }
                ]}
                value={s.lighting}
                onChange={(v) => st.set({ lighting: v })}
              />
            </label>
            <label className="field-row">
              <span>Light strength</span>
              <input type="range" min={0.3} max={2} step={0.05} value={s.lightStrength} onChange={(e) => st.set({ lightStrength: +e.target.value })} />
            </label>
          </div>
          <div className="insp-section">
            <div className="insp-label">Render</div>
            {anim ? (
              <>
                <label className="field-row">
                  <span>Into part</span>
                  <select value={part} onChange={(e) => setPart(+e.target.value)}>
                    {anim.layers.map((l) => (
                      <option key={l.composit} value={l.composit}>
                        {PART_LABELS[COMPOSITS[l.composit]] ?? COMPOSITS[l.composit]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-row" data-tip="A new code (like NEW) adds a look without replacing the original">
                  <span>Style code</span>
                  <input value={code} maxLength={3} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: 80 }} />
                </label>
                <div className="insp-help">
                  {anim.cof.directions} facings × {anim.cof.framesPerDir} frames, matching {anim.unit.label}'s {modeName(anim.mode).toLowerCase()} animation.
                </div>
                <button className="primary-btn full" onClick={() => renderAll(false)} disabled={!!progress || !/^[A-Z0-9]{1,3}$/.test(code)}>
                  <IconWand size={17} /> Render into {PART_LABELS[COMPOSITS[part]]?.toLowerCase() ?? 'part'}
                </button>
              </>
            ) : (
              <>
                <label className="field-row">
                  <span>Frames per facing</span>
                  <input type="number" min={1} max={64} value={freeFrames} onChange={(e) => setFreeFrames(Math.max(1, Math.min(64, +e.target.value || 1)))} style={{ width: 70 }} />
                </label>
                <div className="insp-help">To render straight into a sprite, open a character or monster animation first, then come back here.</div>
                <button className="primary-btn full" onClick={() => goTo('chars')}>
                  Choose an animation to put it in
                </button>
              </>
            )}
            <button className="chip-btn st-png" onClick={() => renderAll(true)} disabled={!!progress}>
              <IconPhoto size={15} /> Save as PNG files instead…
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
