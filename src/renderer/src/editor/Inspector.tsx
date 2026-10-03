import { useMemo, useState } from 'react'
import { IconArrowsExchange, IconCube, IconEye, IconEyeOff, IconPencil, IconPlus, IconUsers, IconDeviceFloppy } from '@tabler/icons-react'
import { COMPOSITS } from '../../../core/cof'
import { PaletteSort, sortedPalette } from '../../../core/color'
import { COLORMAP_FILES, paletteToHex } from '../../../core/palette'
import {
  AnimDoc,
  askText,
  createBlankLayer,
  getFrame,
  getState,
  palette,
  setExportArmtype,
  setLayerSource,
  setState,
  switchBody,
  updateDoc,
  useStore
} from '../store'
import { armtypeName, PART_LABELS } from '../names'
import { ColorSelector } from '../components/ColorSelector'
import { ReferenceTab } from './ReferenceTab'
import { Segmented } from '../ui'

export function Inspector() {
  const doc = useStore((s) => s.doc)
  const tab = useStore((s) => s.inspectorTab)
  if (!doc) return null
  const tabs: { value: 'parts' | 'colours' | 'reference'; label: string }[] = [
    ...(doc.kind === 'anim' ? [{ value: 'parts' as const, label: 'Body parts' }] : []),
    { value: 'colours', label: 'Colours' },
    { value: 'reference', label: 'Reference' }
  ]
  const current = tabs.some((t) => t.value === tab) ? tab : 'colours'
  return (
    <aside className="inspector">
      <div className="insp-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.value} role="tab" aria-selected={current === t.value} className={current === t.value ? 'on' : ''} onClick={() => setState({ inspectorTab: t.value })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="insp-body">
        {current === 'parts' && doc.kind === 'anim' && <PartsTab doc={doc} />}
        {current === 'colours' && <ColoursTab />}
        {current === 'reference' && <ReferenceTab />}
      </div>
    </aside>
  )
}

function PartsTab({ doc }: { doc: AnimDoc }) {
  const catalog = useStore((s) => s.catalog)
  useStore((s) => s.version)
  const bodies = useMemo(() => (catalog ? catalog.units.filter((u) => u.modes[doc.mode]?.includes(doc.wclass)) : []), [catalog, doc.mode, doc.wclass])
  if (!catalog) return null
  return (
    <div className="parts">
      <div className="insp-section">
        <div className="insp-label">
          <IconUsers size={15} stroke={1.75} /> Show on
        </div>
        <select
          className="full"
          value={`${doc.unit.base}/${doc.unit.token}`}
          onChange={(e) => {
            const u = catalog.units.find((x) => `${x.base}/${x.token}` === e.target.value)
            if (u) switchBody(u)
          }}
        >
          {bodies.map((u) => (
            <option key={u.base + u.token} value={`${u.base}/${u.token}`}>
              {u.label}
            </option>
          ))}
        </select>
        <div className="insp-help">Try your edited parts on a different class or monster. Your changes come along.</div>
      </div>
      <div className="insp-label pad-x">Parts: click one to edit it</div>
      <div className="part-list">
        {doc.layers.map((l) => {
          const comp = COMPOSITS[l.composit]
          const on = doc.active === l.composit
          const srcUnit = catalog.units.find((u) => u.base === l.src.base && u.token === l.src.token)
          const styles = (srcUnit?.armtypes[comp] ?? []).filter((a) => srcUnit!.dccs.includes(`${comp}${a}${doc.mode}${l.weaponClass}`))
          const sources = catalog.units.filter((u) => u.base === doc.unit.base && u.dccs.some((s) => s.startsWith(comp) && s.endsWith(`${doc.mode}${l.weaponClass}`)))
          return (
            <div key={l.composit} className={`part${on ? ' on' : ''}${l.missing ? ' missing' : ''}`}>
              <div className="part-row" onClick={() => updateDoc({ active: l.composit })}>
                <button
                  className="part-eye"
                  data-tip={l.visible ? 'Hide this part' : 'Show this part'}
                  onClick={(e) => {
                    e.stopPropagation()
                    l.visible = !l.visible
                    setState({ version: getState().version + 1 })
                  }}
                >
                  {l.visible ? <IconEye size={16} stroke={1.75} /> : <IconEyeOff size={16} stroke={1.75} />}
                </button>
                <span className="part-name" title={`Code: ${comp}`}>
                  {PART_LABELS[comp] ?? comp}
                </span>
                {l.dirty && <span className="part-badge">edited</span>}
                <span className="part-style">{l.missing ? 'none' : armtypeName(catalog, comp, l.armtype)}</span>
                {on && <IconPencil size={15} stroke={1.75} className="part-editing" />}
              </div>
              {on && (
                <div className="part-detail">
                  {l.missing ? (
                    <div className="insp-help">
                      This part has no picture in this animation.
                      <button
                        className="chip-btn"
                        onClick={async () => {
                          const v = await askText('Give the new part a style code (1–3 letters, e.g. NEW)', l.armtype || 'NEW')
                          if (v) createBlankLayer(l.composit, v)
                        }}
                      >
                        <IconPlus size={15} /> Draw a new one
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="field-row">
                        <span>Style</span>
                        <select value={l.armtype} onChange={(e) => setLayerSource(l.composit, l.src, e.target.value)}>
                          {!styles.includes(l.armtype) && <option value={l.armtype}>{armtypeName(catalog, comp, l.armtype)}</option>}
                          {styles.map((a) => (
                            <option key={a} value={a}>
                              {armtypeName(catalog, comp, a)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {sources.length > 1 && (
                        <label className="field-row" data-tip="Borrow this part from another class or monster">
                          <span>Taken from</span>
                          <select
                            value={`${l.src.base}/${l.src.token}`}
                            onChange={(e) => {
                              const u = catalog.units.find((x) => `${x.base}/${x.token}` === e.target.value)!
                              const opts = (u.armtypes[comp] ?? []).filter((a) => u.dccs.includes(`${comp}${a}${doc.mode}${l.weaponClass}`))
                              setLayerSource(l.composit, { base: u.base, token: u.token }, opts.includes(l.armtype) ? l.armtype : (opts[0] ?? ''))
                            }}
                          >
                            {sources.map((u) => (
                              <option key={u.token} value={`${u.base}/${u.token}`}>
                                {u.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <button
                        className="chip-btn"
                        data-tip="Save your version as an extra style instead of replacing the original one"
                        onClick={async () => {
                          const v = await askText('Save this part as a new style code (1–3 letters)', l.armtype)
                          if (v) setExportArmtype(l.composit, v)
                        }}
                      >
                        <IconDeviceFloppy size={15} /> Save as a new style…
                      </button>
                    </>
                  )}
                  <button className="chip-btn" data-tip="Replace this part with pictures rendered in Blender or 3ds Max" onClick={() => setState({ renderImport: { composit: l.composit } })}>
                    <IconCube size={15} /> Use 3D renders…
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="insp-help pad-x">
        <IconArrowsExchange size={14} stroke={1.75} /> Tip: hide parts with the eye to see what's underneath.
      </div>
    </div>
  )
}

const PALETTE_LABELS: Record<string, string> = {
  ACT1: 'Act 1 (default)',
  ACT2: 'Act 2',
  ACT3: 'Act 3',
  ACT4: 'Act 4',
  ACT5: 'Act 5',
  UNITS: 'Units',
  STATIC: 'Static',
  MENU0: 'Menu',
  LOADING: 'Loading screen'
}

function ColoursTab() {
  const palettes = useStore((s) => s.palettes)
  const paletteName = useStore((s) => s.paletteName)
  const primary = useStore((s) => s.primary)
  const secondary = useStore((s) => s.secondary)
  const version = useStore((s) => s.version)
  const dir = useStore((s) => s.dir)
  const frame = useStore((s) => s.frame)
  const doc = useStore((s) => s.doc)
  const colormap = useStore((s) => s.colormap)
  const tintCode = useStore((s) => s.tintCode)
  const tint = useStore((s) => s.view.tint)
  const catalog = useStore((s) => s.catalog)
  const [sort, setSort] = useState<PaletteSort>('hue')
  const pal = palette()
  const order = useMemo(() => sortedPalette(pal, sort), [pal, sort])
  const used = useMemo(() => {
    const set = new Set<number>()
    const f = getFrame(dir, frame)
    if (f) for (const p of f.pixels) set.add(p)
    return set
  }, [version, dir, frame, doc]) // eslint-disable-line react-hooks/exhaustive-deps

  const Swatch = ({ i, label }: { i: number; label: string }) => (
    <div className="cur-color">
      <div className={`cur-sw${i ? '' : ' transparent'}`} style={i ? { background: paletteToHex(pal, i) } : undefined} />
      <div>
        <div className="small">{label}</div>
        <div className="muted tiny">{i ? paletteToHex(pal, i) : 'transparent'}</div>
      </div>
    </div>
  )

  return (
    <div className="colours">
      <div className="insp-section cur-colors">
        <Swatch i={primary} label="Left click" />
        <button className="ibtn" data-tip="Swap colours (X)" onClick={() => setState({ primary: secondary, secondary: primary })}>
          <IconArrowsExchange size={16} />
        </button>
        <Swatch i={secondary} label="Right click" />
      </div>
      <div className="insp-section">
        <div className="insp-label">Choose any colour</div>
        <ColorSelector />
      </div>
      <div className="insp-section">
        <div className="insp-label spread">
          Game colours
          <Segmented<PaletteSort>
            small
            options={[
              { value: 'hue', label: 'By colour' },
              { value: 'light', label: 'By brightness' },
              { value: 'index', label: 'Game order' }
            ]}
            value={sort}
            onChange={setSort}
          />
        </div>
        <div className="swatches">
          {order.map((i) => (
            <div
              key={i}
              className={`sw${i === primary ? ' p' : ''}${i === secondary ? ' s' : ''}${used.has(i) ? ' used' : ''}${i === 0 ? ' transparent' : ''}`}
              style={i ? { background: paletteToHex(pal, i) } : undefined}
              title={i ? `${paletteToHex(pal, i)} (#${i})` : 'Transparent'}
              onMouseDown={(e) => {
                e.preventDefault()
                setState(e.button === 2 ? { secondary: i } : { primary: i })
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
          ))}
        </div>
        <div className="insp-help">Dotted colours appear in this frame. The game can only show these 256 colours.</div>
        <label className="field-row">
          <span>Palette</span>
          <select value={paletteName} onChange={(e) => setState({ paletteName: e.target.value, version: Date.now() })}>
            {Object.keys(palettes).map((n) => (
              <option key={n} value={n}>
                {PALETTE_LABELS[n] ?? n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {doc?.kind === 'item' && (
        <div className="insp-section">
          <label className="check-row">
            <input type="checkbox" checked={tint} onChange={(e) => setState((s) => ({ view: { ...s.view, tint: e.target.checked }, version: s.version + 1 }))} />
            Show the in-game tint
          </label>
          <div className="insp-help">Unique and set items are tinted by the game. This shows how the picture will look.</div>
          {tint && (
            <>
              <label className="field-row">
                <span>Tint style</span>
                <select value={colormap} onChange={(e) => setState({ colormap: e.target.value, version: Date.now() })}>
                  <option value="">None</option>
                  {COLORMAP_FILES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field-row">
                <span>Tint colour</span>
                <select value={tintCode} onChange={(e) => setState({ tintCode: e.target.value, version: Date.now() })}>
                  <option value="">None</option>
                  {catalog?.colors.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
}
