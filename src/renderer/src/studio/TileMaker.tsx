import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBrandBlender,
  IconCube,
  IconDeviceFloppy,
  IconFileImport,
  IconHome,
  IconLayoutGrid,
  IconRotate,
  IconRotateClockwise,
  IconTrash,
  IconArrowBarToDown,
  IconWand
} from '@tabler/icons-react'
import { encodeDs1 } from '../../../core/ds1'
import { encodeDt1 } from '../../../core/dt1'
import { indexTiles, renderMap } from '../../../core/mapRender'
import { PaletteLut } from '../../../core/renderImport'
import { sliceScene, SliceResult, TileKind } from '../../../core/tileSlicer'
import { api } from '../api'
import { goTo, toast, useStore } from '../store'
import { Segmented, IconButton } from '../ui'
import { Lighting } from './engine'
import { ROLE_INFO, TileRole, tileStudio } from './tiles'

function useTiles() {
  useSyncExternalStore(
    (l) => tileStudio.subscribe(l),
    () => tileStudio.version
  )
  return tileStudio
}

const ROLES = Object.keys(ROLE_INFO) as TileRole[]

const Dot = ({ role }: { role: TileRole }) => <i className="tm-dot" style={{ background: ROLE_INFO[role].color }} />

function RoleLegend() {
  return (
    <div className="tm-legend">
      {ROLES.map((r) => (
        <div key={r} className="tm-legend-row">
          <Dot role={r} />
          <b className={`role-${r}`}>{ROLE_INFO[r].label}</b>
          <span>{ROLE_INFO[r].hint}</span>
        </div>
      ))}
    </div>
  )
}

function Viewport() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    tileStudio.mount(el)
    return () => tileStudio.unmount()
  }, [])
  return <div className="st-viewport" ref={ref} />
}

function Img({ data, width, height }: { data: Uint8ClampedArray; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = width
    c.height = height
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  }, [data, width, height])
  return <canvas ref={ref} className="tm-result-canvas" />
}

function ExportHelp() {
  return (
    <div className="tm-export-help">
      <div>
        <b>
          <IconBrandBlender size={14} /> Blender
        </b>
        : File › Export › glTF 2.0 (.glb). Leave “Compression” off.
      </div>
      <div>
        <b>
          <IconCube size={14} /> 3ds Max
        </b>
        : File › Export › FBX. Put textures next to the .fbx file.
      </div>
      <div className="muted">Name parts “floor…”, “wall…”, “cliff…” or “roof…” and they’re sorted automatically.</div>
    </div>
  )
}

export function TileMaker() {
  const ts = useTiles()
  const palettes = useStore((s) => s.palettes)
  const status = useStore((s) => s.status)
  const t = ts.tile
  const s = ts.settings
  const models = ts.objects.filter((o) => o.kind === 'model')
  const sel = ts.selectedObject?.kind === 'model' ? ts.selectedObject : (models[models.length - 1] ?? null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [split, setSplit] = useState(true)
  const [result, setResult] = useState<{ res: SliceResult; preview: { data: Uint8ClampedArray; width: number; height: number } } | null>(null)
  const parts = useMemo(() => ts.parts(), [ts.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const units = sel ? ts.unitsOf(sel.id) : 1
  const below = sel ? ts.depthBelowGround(sel.id) : 0
  const [unitsText, setUnitsText] = useState(String(units))
  useEffect(() => setUnitsText(String(units)), [units, sel?.id])

  const pal = palettes[`ACT${t.act}`] ?? palettes.ACT1
  const folder = `data\\global\\tiles\\act${t.act}\\${t.name}`
  const fileName = (kind: TileKind | 'all') => `${t.name.toLowerCase()}${kind === 'all' ? '' : `_${kind}`}.dt1`

  const importModel = async () => {
    const f = await api.open3d()
    if (!f) return
    setLoading(true)
    try {
      const o = await ts.loadModel(f, { normalize: false })
      const n = ts.parts().filter((p) => p.owner === o).length
      const u = ts.unitsOf(o.id)
      toast(`Imported ${o.name}: ${n} part${n === 1 ? '' : 's'}, read as ${u === 1 ? '1 unit' : `${u} units`} per tile. Check the grid and each part's role.`)
    } catch (e) {
      toast(`Couldn't open that file: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
    }
  }

  const make = () => {
    if (!parts.some((p) => p.role !== 'ignore')) return toast('Import a scene from Blender or 3ds Max first.')
    if (!/^[a-z0-9_]{1,24}$/i.test(t.name)) return toast('Give the tile set a short name using letters, digits or _.')
    setBusy(true)
    setTimeout(() => {
      try {
        const input = ts.renderSliceInput(new PaletteLut(pal))
        const res = sliceScene(input, {
          name: t.name,
          act: t.act,
          mainIndex: t.mainIndex,
          split,
          dt1Path: (kind) => `\\d2\\${folder.toLowerCase()}\\${fileName(kind)}`
        })
        const { image } = renderMap(res.ds1, indexTiles(res.dt1.tiles), pal, { background: [14, 15, 17, 255] })
        setResult({ res, preview: { data: image.data, width: image.width, height: image.height } })
      } catch (e) {
        toast(`Splitting failed: ${e instanceof Error ? e.message : e}`)
      } finally {
        setBusy(false)
      }
    }, 30)
  }

  const save = async () => {
    if (!result) return
    const files = [
      ...result.res.files.map((f) => ({ rel: `${folder}\\${fileName(f.kind)}`, data: encodeDt1(f.dt1) })),
      { rel: `${folder}\\${t.name.toLowerCase()}.ds1`, data: encodeDs1(result.res.ds1) }
    ]
    const r = await api.exportPd2(files)
    toast(`Saved ${files.length} files to ${r.root}\\${folder}. Open ${t.name.toLowerCase()}.ds1 in ds1-studio.`)
    if (r.written[0]) api.reveal(r.written[0])
  }

  return (
    <div className="studio">
      <div className="topbar">
        <IconButton icon={IconHome} label="Home" onClick={() => goTo('home')} />
        <div className="crumbs">
          <span className="crumb current">Tile Maker</span>
          <span className="muted small">Import a scene from Blender or 3ds Max, split it into DT1 tiles and a DS1 map</span>
        </div>
      </div>
      <div className="studio-main">
        <aside className="st-left">
          <div className="insp-section">
            <div className="tm-step">
              <span className="tm-step-n">1</span> Import
            </div>
            <button className="primary-btn full" onClick={importModel} disabled={loading}>
              <IconFileImport size={17} /> {loading ? 'Importing…' : 'Import from Blender or 3ds Max…'}
            </button>
            <ExportHelp />
          </div>

          {sel && (
            <div className="insp-section">
              <div className="tm-step">
                <span className="tm-step-n">2</span> Line up with the grid
              </div>
              {models.length > 1 && (
                <label className="field-row">
                  <span>Model</span>
                  <select value={sel.id} onChange={(e) => ts.select(e.target.value)}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field-row" data-tip="How many of your model's units make one map tile. Blender metres: about 2. 3ds Max centimetres: about 200.">
                <span>1 tile =</span>
                <span className="row">
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={unitsText}
                    onChange={(e) => {
                      setUnitsText(e.target.value)
                      const v = parseFloat(e.target.value)
                      if (v > 0) ts.setUnits(sel.id, v)
                    }}
                    style={{ width: 80 }}
                  />
                  <span className="muted small">model units</span>
                </span>
              </label>
              <div className="tm-align">
                <button className="chip-btn" onClick={() => ts.turn(sel.id, 'left')} data-tip="Turn 90° left">
                  <IconRotate size={15} /> 90°
                </button>
                <button className="chip-btn" onClick={() => ts.turn(sel.id, 'right')} data-tip="Turn 90° right">
                  <IconRotateClockwise size={15} /> 90°
                </button>
                <button className="chip-btn" onClick={() => ts.turn(sel.id, 'upright')} data-tip="For models that come in lying down (Z-up, common from 3ds Max)">
                  Stand upright
                </button>
              </div>
              <div className="tm-nudge">
                <span className="muted small">Move by a tile</span>
                <button className="ibtn" aria-label="Left" onClick={() => ts.nudge(sel.id, 0, 1)} data-tip="Toward the bottom-left">
                  <IconArrowLeft size={15} />
                </button>
                <button className="ibtn" aria-label="Right" onClick={() => ts.nudge(sel.id, 0, -1)} data-tip="Toward the top-right">
                  <IconArrowRight size={15} />
                </button>
                <button className="ibtn" aria-label="Up" onClick={() => ts.nudge(sel.id, -1, 0)} data-tip="Toward the top-left">
                  <IconArrowUp size={15} />
                </button>
                <button className="ibtn" aria-label="Down" onClick={() => ts.nudge(sel.id, 1, 0)} data-tip="Toward the bottom-right">
                  <IconArrowDown size={15} />
                </button>
                <button className="ibtn" aria-label="Snap" onClick={() => ts.snapToGrid(sel.id)} data-tip="Put its main floor on the ground, at the grid's corner">
                  <IconArrowBarToDown size={15} />
                </button>
              </div>
              <div className="tm-ground" data-tip="The grid is the ground the player walks on. Snap puts your main floor there; use these if another floor should be ground level.">
                <span className="muted small grow">
                  Ground level
                  {below > 0.02 && <> · model reaches {+below.toFixed(2)} tiles below it</>}
                </span>
                <button className="ibtn" aria-label="Raise model" onClick={() => ts.raise(sel.id, 0.25)} data-tip="Raise the model a quarter tile">
                  <IconArrowUp size={15} />
                </button>
                <button className="ibtn" aria-label="Lower model" onClick={() => ts.raise(sel.id, -0.25)} data-tip="Lower the model a quarter tile">
                  <IconArrowDown size={15} />
                </button>
              </div>
              <div className="insp-help">
                Walls should run along the grid lines. That's where they get split into wall tiles. Anything below the ground (cliffs, platform sides) becomes lower walls.
              </div>
            </div>
          )}

          <div className="insp-section tm-parts-head">
            <div className="tm-step">
              <span className="tm-step-n">3</span> Parts
            </div>
            <div className="insp-help">Choose what each part becomes:</div>
            <RoleLegend />
            <label className="check-row">
              <input type="checkbox" checked={ts.roleColours} onChange={(e) => ts.setRoleColours(e.target.checked)} /> Colour the scene by role
            </label>
            <div className="insp-help">A wall that goes down past the ground is split for you: the part above becomes wall tiles, the part below lower-wall tiles.</div>
          </div>
          <div className="tm-parts">
            {models.length === 0 && <div className="insp-help pad-x">Nothing imported yet.</div>}
            {models.map((o) => (
              <div key={o.id} className={`tm-obj${o.id === sel?.id ? ' on' : ''}`}>
                <div className="st-obj" onClick={() => ts.select(o.id)}>
                  <IconCube size={16} stroke={1.75} />
                  <span className="st-obj-name">{o.name}</span>
                  <button
                    className="part-eye"
                    data-tip="Remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      ts.remove(o.id)
                    }}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
                {parts.filter((p) => p.owner === o).length > 1 && (
                  <div className="tm-all">
                    Set every part to
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) ts.setModelRole(o.id, e.target.value as TileRole)
                      }}
                    >
                      <option value="">…</option>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_INFO[r].label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {parts
                  .filter((p) => p.owner === o)
                  .slice(0, 200)
                  .map((p, i) => (
                    <div key={i} className="tm-part">
                      <Dot role={p.role} />
                      <span className="tm-part-name" title={p.label}>
                        {p.label}
                      </span>
                      {p.role === 'lower' && p.mesh.userData.d2roleAuto && (
                        <span className="tm-auto" data-tip="Made a lower wall automatically: this part is below the ground" aria-label="Below ground">
                          <IconArrowBarToDown size={12} />
                        </span>
                      )}
                      <select
                        className={`role-${p.role}`}
                        value={p.role}
                        title={ROLE_INFO[p.role].hint}
                        onChange={(e) => ts.setRole(p.mesh, e.target.value as TileRole)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_INFO[r].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </aside>

        <div className="st-center">
          <Viewport />
          <div className="st-view-bar">
            <Segmented
              small
              options={[
                { value: 'game', label: 'Game view' },
                { value: 'free', label: 'Free look' }
              ]}
              value={s.view}
              onChange={(v) => ts.set({ view: v })}
            />
            <span className="muted small">Each grid square is one game tile (160×80 px). Gold outline = the map piece.</span>
          </div>
          {models.length === 0 && (
            <div className="tm-empty">
              <IconFileImport size={34} stroke={1.3} />
              <div>Import a scene you made in Blender or 3ds Max</div>
              <button className="primary-btn" onClick={importModel}>
                Import…
              </button>
            </div>
          )}
          {busy && (
            <div className="st-progress">
              <span className="lazy-spin" /> Rendering and splitting into tiles…
            </div>
          )}
        </div>

        <aside className="st-right">
          <div className="insp-section">
            <div className="insp-label">Map piece</div>
            <label className="field-row">
              <span>Size (tiles)</span>
              <span className="row">
                <input type="number" min={1} max={20} value={t.mapW} onChange={(e) => ts.setTile({ mapW: +e.target.value })} style={{ width: 60 }} />
                ×
                <input type="number" min={1} max={20} value={t.mapH} onChange={(e) => ts.setTile({ mapH: +e.target.value })} style={{ width: 60 }} />
              </span>
            </label>
            <button className="chip-btn" onClick={() => ts.fitGridToScene()}>
              <IconLayoutGrid size={15} /> Fit grid to scene
            </button>
            <label className="field-row">
              <span>Act (colours)</span>
              <select value={t.act} onChange={(e) => ts.setTile({ act: +e.target.value })}>
                {[1, 2, 3, 4, 5].map((a) => (
                  <option key={a} value={a}>
                    Act {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-row" data-tip="Used for the file names and folder">
              <span>Tile set name</span>
              <input value={t.name} maxLength={24} onChange={(e) => ts.setTile({ name: e.target.value.replace(/[^a-z0-9_]/gi, '') })} style={{ width: 130 }} />
            </label>
            <label className="field-row" data-tip="The game finds tiles by index. Pick a number the area's other tile sets don't use (0–63).">
              <span>Start index</span>
              <input type="number" min={0} max={63} value={t.mainIndex} onChange={(e) => ts.setTile({ mainIndex: +e.target.value })} style={{ width: 70 }} />
            </label>
            <label className="field-row">
              <span>DT1 files</span>
              <Segmented
                small
                options={[
                  { value: 'split', label: 'By kind', tip: 'Floors, walls and roofs in separate .dt1 files, like the game’s own tile folders' },
                  { value: 'one', label: 'One file' }
                ]}
                value={split ? 'split' : 'one'}
                onChange={(v) => setSplit(v === 'split')}
              />
            </label>
          </div>
          <div className="insp-section">
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
                onChange={(v) => ts.set({ lighting: v })}
              />
            </label>
            <label className="field-row">
              <span>Light strength</span>
              <input type="range" min={0.3} max={2} step={0.05} value={s.lightStrength} onChange={(e) => ts.set({ lightStrength: +e.target.value })} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={t.dither} onChange={(e) => ts.setTile({ dither: e.target.checked })} /> Smooth gradients (dithering)
            </label>
          </div>
          <div className="insp-section">
            <button className="primary-btn full" onClick={make} disabled={busy || models.length === 0}>
              <IconWand size={17} /> Split into DT1 + DS1
            </button>
            <div className="insp-help">
              Floors become floor tiles. Walls are split along the grid lines into left and right wall tiles (with walkability set), and lower walls into
              left and right lower-wall tiles. Roofs become roof tiles.
              The .ds1 map piece places them all exactly as in your scene.
            </div>
          </div>
        </aside>
      </div>

      {result && (
        <div className="modal-back" onMouseDown={() => setResult(null)}>
          <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">
              Your map piece, drawn the way the game draws it
              <button className="x" onClick={() => setResult(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="export-body">
              <div className="tm-result">
                <Img {...result.preview} />
              </div>
              <div className="tm-stats">
                <span>
                  <b>{result.res.stats.floors}</b> floor tiles
                </span>
                <span>
                  <b>{result.res.stats.walls}</b> wall tiles
                </span>
                <span>
                  <b>{result.res.stats.lowerWalls}</b> lower-wall tiles
                </span>
                <span>
                  <b>{result.res.stats.roofs}</b> roof tiles
                </span>
                <span>
                  <b>{result.res.stats.unique}</b> unique (repeats are shared)
                </span>
                <span>
                  <b>{result.res.stats.blockedSubtiles}</b> blocked walk spots
                </span>
              </div>
              <ul className="file-list">
                {result.res.files.map((f) => (
                  <li key={f.kind}>
                    <b>{fileName(f.kind)}</b> <span className="muted">· {f.dt1.tiles.length} tiles</span>
                  </li>
                ))}
                <li>
                  <b>{t.name.toLowerCase()}.ds1</b>{' '}
                  <span className="muted">
                    · {result.res.ds1.width}×{result.res.ds1.height} map piece using {result.res.files.length === 1 ? 'that DT1' : `these ${result.res.files.length} DT1s`}
                  </span>
                </li>
              </ul>
              <div className="save-folder">
                <div>
                  <div className="small">Saved into</div>
                  <div className="mono small">
                    {status?.exportRoot}\{folder}
                  </div>
                </div>
              </div>
              <div className="insp-help">Open the .ds1 in ds1-studio to place this piece into your maps and fine-tune tiles or walkability.</div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setResult(null)}>
                Back to the scene
              </button>
              <button className="primary-btn" onClick={save}>
                <IconDeviceFloppy size={17} /> Save DT1 + DS1
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

