import { useEffect, useMemo, useState } from 'react'
import { IconArrowLeft, IconPencil, IconSearch } from '@tabler/icons-react'
import type { UnitBase, UnitEntry } from '../../../core/catalog'
import { goTo, openAnim, setState, useStore } from '../store'
import { AnimPreview, loadAnimPreview, unitPortrait } from '../thumbs'
import { AnimCanvas, LazyImg } from '../ui'
import { MODE_LABELS, MODE_ORDER, modeName, WEAPON_LABELS, weaponName } from '../names'

const TITLES: Record<UnitBase, { title: string; step1: string }> = {
  chars: { title: 'Character gear', step1: 'Choose a class' },
  monsters: { title: 'Monsters', step1: 'Choose a monster' },
  objects: { title: 'Objects', step1: 'Choose an object' }
}

export function UnitPicker({ base }: { base: UnitBase }) {
  const catalog = useStore((s) => s.catalog)
  const unit = useStore((s) => s.pickUnit)
  const [q, setQ] = useState('')
  const units = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (catalog?.units ?? []).filter((u) => u.base === base && (!n || u.label.toLowerCase().includes(n) || u.token.toLowerCase() === n))
  }, [catalog, base, q])
  const t = TITLES[base]

  if (unit && unit.base === base) return <AnimationChooser unit={unit} />

  return (
    <div className="picker">
      <div className="picker-head">
        <button className="back" onClick={() => goTo('home')}>
          <IconArrowLeft size={18} stroke={1.75} /> Home
        </button>
        <div className="picker-title">
          <h2>{t.title}</h2>
          <span className="muted">{t.step1}</span>
        </div>
        {base !== 'chars' && (
          <div className="search-small">
            <IconSearch size={16} stroke={1.75} />
            <input autoFocus placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>
      <div className={`unit-grid${base === 'chars' ? ' big' : ''}`}>
        {units.map((u) => (
          <button key={u.token} className="unit-card" onClick={() => setState({ pickUnit: u })} title={`Code: ${u.token}`}>
            <LazyImg className="unit-portrait" load={() => unitPortrait(u)} alt={u.label} />
            <span className="uc-name">{u.label}</span>
          </button>
        ))}
        {!units.length && <div className="muted pad">Nothing matches “{q}”.</div>}
      </div>
    </div>
  )
}

function AnimationChooser({ unit }: { unit: UnitEntry }) {
  const modes = useMemo(() => {
    const all = Object.keys(unit.modes)
    return [...MODE_ORDER.filter((m) => all.includes(m)), ...all.filter((m) => !MODE_ORDER.includes(m)).sort()]
  }, [unit])
  const [mode, setMode] = useState(() => (modes.includes('NU') ? 'NU' : modes[0]))
  const wclasses = unit.modes[mode] ?? []
  const [wclass, setWclass] = useState(() => pickWeapon(unit.modes[mode] ?? []))
  useEffect(() => {
    if (!wclasses.includes(wclass)) setWclass(pickWeapon(wclasses))
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const [preview, setPreview] = useState<AnimPreview | null>(null)
  useEffect(() => {
    let live = true
    setPreview(null)
    if (wclasses.includes(wclass)) loadAnimPreview(unit, mode, wclass).then((p) => live && setPreview(p))
    return () => {
      live = false
    }
  }, [unit, mode, wclass]) // eslint-disable-line react-hooks/exhaustive-deps
  const base = unit.base

  return (
    <div className="picker">
      <div className="picker-head">
        <button className="back" onClick={() => setState({ pickUnit: null })}>
          <IconArrowLeft size={18} stroke={1.75} /> {TITLES[base].title}
        </button>
        <div className="picker-title">
          <h2>{unit.label}</h2>
          <span className="muted">Choose the animation to edit</span>
        </div>
      </div>
      <div className="anim-chooser">
        <div className="anim-stage">
          <div className="anim-stage-inner">{preview ? <AnimCanvas preview={preview} scale={3} /> : <span className="lazy-spin" />}</div>
          <div className="anim-caption">
            {modeName(mode)}
            {wclasses.length > 1 || wclass !== 'HTH' ? ` · ${weaponName(wclass).toLowerCase()}` : ''}
          </div>
          <button className="primary-btn big" onClick={() => openAnim(unit, mode, wclass)}>
            <IconPencil size={18} stroke={1.75} /> Edit this animation
          </button>
          <div className="muted small center">Every body part (head, torso, weapon…) can be edited separately.</div>
        </div>
        <div className="anim-options">
          <h3>What are they doing?</h3>
          <div className="choice-grid">
            {modes.map((m) => (
              <button key={m} className={`choice${m === mode ? ' on' : ''}`} onClick={() => setMode(m)} title={`Code: ${m}`}>
                <span>{modeName(m)}</span>
                {MODE_LABELS[m]?.hint && <span className="choice-hint">{MODE_LABELS[m].hint}</span>}
              </button>
            ))}
          </div>
          {wclasses.length > 1 && (
            <>
              <h3>Holding</h3>
              <div className="choice-grid">
                {wclasses.map((w) => (
                  <button key={w} className={`choice${w === wclass ? ' on' : ''}`} onClick={() => setWclass(w)} title={`Code: ${w}`}>
                    <span>{weaponName(w)}</span>
                    {WEAPON_LABELS[w]?.hint && <span className="choice-hint">{WEAPON_LABELS[w].hint}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function pickWeapon(list: string[]): string {
  for (const w of ['1HS', 'HTH']) if (list.includes(w)) return w
  return list[0] ?? 'HTH'
}
