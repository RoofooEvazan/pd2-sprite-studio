import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { IconBrandBlender, IconCube, IconFolderOpen } from '@tabler/icons-react'
import { COMPOSITS } from '../../../core/cof'
import { compositeFrame, directionBounds, LayerInput } from '../../../core/composite'
import { buildSpriteFromRenders, mapDirections, PaletteLut, parseRenderName, RenderImage, RenderManifest } from '../../../core/renderImport'
import { api } from '../api'
import { decodeImage } from '../imageExport'
import { AnimDoc, getState, palette, setLayerSprite, setState, toast, useStore } from '../store'
import { AnimCanvas } from '../ui'
import { PART_LABELS, facingName } from '../names'
import blenderScript from '../../../../render-scripts/d2_render_blender.py?raw'
import maxScript from '../../../../render-scripts/d2_render_3dsmax.ms?raw'

interface Loaded {
  dir: string
  images: RenderImage[]
  manifest: RenderManifest | null
  srcDirs: number
  srcFrames: number
  width: number
  height: number
}

async function loadFolder(): Promise<Loaded | null> {
  const r = await api.openRenderFolder()
  if (!r) return null
  if (!r.files.length) {
    toast('That folder has no PNG files in it.')
    return null
  }
  const manifest = (r.manifest ?? null) as RenderManifest | null
  const named = r.files.map((f) => ({ f, id: parseRenderName(f.name) }))
  let ids: { dir: number; frame: number }[]
  if (named.every((n) => n.id)) ids = named.map((n) => n.id!)
  else {
    // No _dXX_fYYY names: assume files sorted direction by direction
    const sorted = [...r.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const dirs = manifest?.directions ?? getAnimDoc()?.cof.directions ?? 8
    const per = Math.max(1, Math.floor(sorted.length / dirs))
    r.files = sorted
    ids = sorted.map((_, i) => ({ dir: Math.floor(i / per), frame: i % per }))
  }
  const images: RenderImage[] = []
  for (let i = 0; i < r.files.length; i++) {
    const img = await decodeImage(r.files[i].data)
    images.push({ ...ids[i], width: img.width, height: img.height, rgba: img.data })
  }
  const srcDirs = Math.max(...images.map((i) => i.dir)) + 1
  const srcFrames = Math.max(...images.map((i) => i.frame)) + 1
  return { dir: r.dir, images, manifest, srcDirs, srcFrames, width: images[0].width, height: images[0].height }
}

function getAnimDoc(): AnimDoc | null {
  const d = getState().doc
  return d?.kind === 'anim' ? d : null
}

function SourcePreview({ img, ox, oy }: { img: RenderImage | undefined; ox: number; oy: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !img) return
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
    ctx.strokeStyle = '#5ad1ff'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ox - 8, oy + 0.5)
    ctx.lineTo(ox + 8, oy + 0.5)
    ctx.moveTo(ox + 0.5, oy - 8)
    ctx.lineTo(ox + 0.5, oy + 8)
    ctx.stroke()
  }, [img, ox, oy])
  if (!img) return null
  const s = Math.min(1.5, 220 / Math.max(img.width, img.height))
  return <canvas ref={ref} className="ri-source" style={{ width: img.width * s, height: img.height * s }} />
}

export function RenderImportDialog() {
  const req = useStore((s) => s.renderImport)
  const doc = useStore((s) => s.doc)
  const dir = useStore((s) => s.dir)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [composit, setComposit] = useState(0)
  const [code, setCode] = useState('NEW')
  const [originX, setOriginX] = useState(0)
  const [originY, setOriginY] = useState(0)
  const [scale, setScale] = useState(1)
  const [alpha, setAlpha] = useState(128)
  const [dither, setDither] = useState(false)

  useEffect(() => {
    if (req) setComposit(req.composit)
  }, [req])

  const lut = useMemo(() => (req ? new PaletteLut(palette()) : null), [req])
  const opts = useDeferredValue({ originX, originY, scale, alphaThreshold: alpha, dither })

  const anim = doc?.kind === 'anim' ? doc : null
  const preview = useMemo(() => {
    if (!loaded || !anim || !lut) return null
    const sprite = buildSpriteFromRenders(loaded.images, lut, opts, { directions: anim.cof.directions, framesPerDir: anim.cof.framesPerDir }, dir)
    const layers = new Map<number, LayerInput>()
    for (const l of anim.layers) layers.set(l.composit, { sprite: l.composit === composit ? sprite : l.sprite, visible: l.composit === composit || l.visible })
    const b = directionBounds(anim.cof, layers, dir)
    const pal = palette()
    const frames = Array.from({ length: anim.cof.framesPerDir }, (_, f) => compositeFrame(anim.cof, layers, pal, dir, f, { bounds: b }))
    const own = sprite.frames[dir].filter((f) => f.height)
    const height = own.length ? Math.max(...own.map((f) => f.offsetY + f.height)) - Math.min(...own.map((f) => f.offsetY)) : 0
    return { preview: { frames, fps: anim.fps }, height }
  }, [loaded, anim, lut, opts, composit, dir])

  if (!req || !anim) return null
  const close = () => {
    setState({ renderImport: null })
  }
  const bodyHeight = (() => {
    const li = new Map<number, LayerInput>()
    for (const l of anim.layers) li.set(l.composit, { sprite: l.sprite, visible: l.visible })
    const b = directionBounds(anim.cof, li, dir)
    return b.y1 - b.y0
  })()

  const choose = async () => {
    setBusy(true)
    try {
      const l = await loadFolder()
      if (l) {
        setLoaded(l)
        setOriginX(Math.round(l.manifest?.originX ?? l.width / 2))
        setOriginY(Math.round(l.manifest?.originY ?? l.height / 2))
        // Suggest a scale that makes the render about as tall as the current body
        setScale(1)
      }
    } catch (e) {
      toast(`Couldn't read the renders: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!loaded || !lut) return
    setBusy(true)
    setTimeout(() => {
      const sprite = buildSpriteFromRenders(loaded.images, lut, { originX, originY, scale, alphaThreshold: alpha, dither }, { directions: anim.cof.directions, framesPerDir: anim.cof.framesPerDir })
      setLayerSprite(composit, sprite, code)
      setBusy(false)
      setLoaded(null)
      close()
      toast(`Your renders are now the ${PART_LABELS[COMPOSITS[composit]]?.toLowerCase() ?? 'part'} (style ${code.toUpperCase()}). Check every facing, then Save to game.`)
    }, 20)
  }

  const saveScript = async (which: 'blender' | 'max') => {
    const p = await api.saveText(which === 'blender' ? { defaultName: 'd2_render_blender.py', text: blenderScript } : { defaultName: 'd2_render_3dsmax.ms', text: maxScript })
    if (p) toast(`Saved ${p}`)
  }

  const dmap = loaded ? mapDirections(loaded.srcDirs, anim.cof.directions) : []
  const srcImg = loaded?.images.find((i) => i.dir === dmap[dir] && i.frame === 0)

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal wide ri" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Import 3D renders
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        {!loaded ? (
          <div className="export-body ri-start">
            <section>
              <p>
                Render your model from the game's camera angle in every facing, then bring the pictures in here. They're converted to the game's colours, lined up
                on the body, and turned into a body part you can keep editing.
              </p>
              <ol className="ri-steps">
                <li>
                  <b>Get the camera script</b> for your 3D program. It sets up Diablo II's exact camera and renders every facing with the right file names.
                  <div className="btn-row">
                    <button className="chip-btn" onClick={() => saveScript('blender')}>
                      <IconBrandBlender size={15} /> Blender script
                    </button>
                    <button className="chip-btn" onClick={() => saveScript('max')}>
                      <IconCube size={15} /> 3ds Max script
                    </button>
                  </div>
                </li>
                <li>Put your model's feet at the world origin, run the script once, turn the model to face bottom-left, then run it again to render.</li>
                <li>Choose the folder the renders went into.</li>
              </ol>
              <div className="insp-help">
                Using other software? Any PNGs with a transparent background work. Name them like <code>name_d00_f000.png</code> (facing, frame), or put them in order,
                facing by facing.
              </div>
            </section>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="primary-btn" onClick={choose} disabled={busy}>
                <IconFolderOpen size={17} /> {busy ? 'Reading…' : 'Choose render folder…'}
              </button>
            </div>
          </div>
        ) : (
          <div className="ri-body">
            <div className="ri-options">
              <div className="ri-summary">
                <b>
                  {loaded.srcDirs} facings × {loaded.srcFrames} frames
                </b>{' '}
                <span className="muted">
                  ({loaded.width}×{loaded.height}
                  {loaded.manifest?.tool ? `, from ${loaded.manifest.tool === '3dsmax' ? '3ds Max' : 'Blender'}` : ''})
                </span>
                {loaded.srcDirs !== anim.cof.directions && (
                  <div className="warn small">
                    This animation has {anim.cof.directions} facings. The nearest rendered facing is used for each.
                  </div>
                )}
                {loaded.srcFrames !== anim.cof.framesPerDir && (
                  <div className="warn small">
                    This animation has {anim.cof.framesPerDir} frames. Your {loaded.srcFrames} frames will be spread to fit, so rendering exactly{' '}
                    {anim.cof.framesPerDir} gives the best result.
                  </div>
                )}
              </div>
              <label className="field-row">
                <span>Becomes the</span>
                <select value={composit} onChange={(e) => setComposit(+e.target.value)}>
                  {anim.layers.map((l) => (
                    <option key={l.composit} value={l.composit}>
                      {PART_LABELS[COMPOSITS[l.composit]] ?? COMPOSITS[l.composit]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-row" data-tip="The game picks graphics by this code. Use a new one (like NEW) to add a look without replacing the original.">
                <span>Style code</span>
                <input value={code} maxLength={3} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: 80 }} />
              </label>
              <label className="field-row" data-tip="Where the unit's feet are in your render. The scripts put this at the centre.">
                <span>Ground point</span>
                <span className="row">
                  <input type="number" value={originX} onChange={(e) => setOriginX(+e.target.value)} style={{ width: 70 }} />
                  <input type="number" value={originY} onChange={(e) => setOriginY(+e.target.value)} style={{ width: 70 }} />
                </span>
              </label>
              <label className="field-row">
                <span>Size {Math.round(scale * 100)}%</span>
                <input type="range" min={0.2} max={1} step={0.05} value={scale} onChange={(e) => setScale(+e.target.value)} />
              </label>
              <div className="insp-help">
                Result is about <b>{preview?.height ?? '…'} px</b> tall. The current body is about {bodyHeight} px.
              </div>
              <label className="field-row" data-tip="How solid a pixel must be to be kept. Raise it if edges look fuzzy.">
                <span>Edge cut-off</span>
                <input type="range" min={16} max={250} step={1} value={alpha} onChange={(e) => setAlpha(+e.target.value)} />
              </label>
              <label className="check-row" data-tip="Mixes nearby game colours to imitate shades the palette doesn't have">
                <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} /> Smooth gradients (dithering)
              </label>
              <button className="chip-btn" onClick={choose}>
                <IconFolderOpen size={15} /> Choose a different folder…
              </button>
            </div>
            <div className="ri-previews">
              <div className="ri-panel">
                <div className="insp-label">Your render, facing {facingName(anim.cof.directions, dir)}</div>
                <SourcePreview img={srcImg} ox={originX} oy={originY} />
                <div className="insp-help">The blue cross is the ground point.</div>
              </div>
              <div className="ri-panel grow">
                <div className="insp-label">In the game's colours, on the body</div>
                <div className="ri-anim">{preview ? <AnimCanvas preview={preview.preview} scale={2} /> : <span className="lazy-spin" />}</div>
                <div className="insp-help">Turn the character with ↑ ↓ after importing to check every facing.</div>
              </div>
            </div>
            <div className="modal-actions ri-actions">
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="primary-btn" onClick={apply} disabled={busy || !/^[A-Z0-9]{1,3}$/.test(code)}>
                {busy ? 'Converting…' : `Use as ${PART_LABELS[COMPOSITS[composit]]?.toLowerCase() ?? 'part'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
