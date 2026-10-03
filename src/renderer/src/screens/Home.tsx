import { useMemo, useState } from 'react'
import { IconArrowRight, IconBox, IconLayoutGrid, IconRotate360, IconGhost2, IconHistory, IconPencil, IconSearch, IconShirt, IconSword } from '@tabler/icons-react'
import { goTo, openAnim, openItem, setState, useStore } from '../store'
import { itemThumb, unitPortrait } from '../thumbs'
import { LazyImg } from '../ui'
import { modeName, weaponName } from '../names'

export function Home() {
  const catalog = useStore((s) => s.catalog)
  const doc = useStore((s) => s.doc)
  const recent = useStore((s) => s.recent)
  const loadingMsg = useStore((s) => s.loadingMsg)
  const error = useStore((s) => s.error)
  const [q, setQ] = useState('')

  const results = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!catalog || n.length < 2) return null
    const units = catalog.units.filter((u) => u.label.toLowerCase().includes(n) || u.token.toLowerCase() === n).slice(0, 8)
    const items = catalog.items.filter((i) => i.name.toLowerCase().includes(n)).slice(0, 12)
    return { units, items }
  }, [catalog, q])

  const counts = catalog
    ? {
        chars: catalog.units.filter((u) => u.base === 'chars').length,
        monsters: catalog.units.filter((u) => u.base === 'monsters').length,
        objects: catalog.units.filter((u) => u.base === 'objects').length,
        items: catalog.items.length
      }
    : null

  return (
    <div className="home">
      <div className="home-inner">
        <h1>What do you want to change?</h1>
        {error ? (
          <div className="notice danger">{error}</div>
        ) : !catalog ? (
          <div className="notice">{loadingMsg ?? 'Loading…'}</div>
        ) : (
          <>
            <div className="search-big">
              <IconSearch size={18} stroke={1.75} />
              <input autoFocus placeholder="Search characters, monsters and items, e.g. Zombie or Shako" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            {results ? (
              <div className="search-results">
                {results.units.map((u) => (
                  <button key={u.base + u.token} className="result-row" onClick={() => setState({ screen: u.base === 'chars' ? 'chars' : u.base === 'monsters' ? 'monsters' : 'objects', pickUnit: u })}>
                    <LazyImg className="result-thumb" load={() => unitPortrait(u)} />
                    <span className="rr-text">
                      <span>{u.label}</span>
                      <span className="muted">{u.base === 'chars' ? 'Character' : u.base === 'monsters' ? 'Monster' : 'Object'}</span>
                    </span>
                    <IconArrowRight size={16} className="muted" />
                  </button>
                ))}
                {results.items.map((i, k) => (
                  <button key={k} className="result-row" onClick={() => openItem(i, i.path)}>
                    <LazyImg className="result-thumb" load={() => itemThumb(i.path)} />
                    <span className="rr-text">
                      <span className={`k-${i.kind}`}>{i.name}</span>
                      <span className="muted">Item · {i.kind === 'other' ? 'graphic' : i.kind}</span>
                    </span>
                    <IconArrowRight size={16} className="muted" />
                  </button>
                ))}
                {!results.units.length && !results.items.length && <div className="muted pad">No matches. Try part of a name.</div>}
              </div>
            ) : (
              <>
                <div className="big-cards">
                  <button className="big-card" onClick={() => goTo('chars')}>
                    <IconShirt size={30} stroke={1.5} />
                    <span className="bc-title">Character gear</span>
                    <span className="bc-sub">Armour, helmets and weapons on any class, in every animation</span>
                    <span className="bc-count">{counts?.chars} classes</span>
                  </button>
                  <button className="big-card" onClick={() => goTo('monsters')}>
                    <IconGhost2 size={30} stroke={1.5} />
                    <span className="bc-title">Monster</span>
                    <span className="bc-sub">Recolour or reshape any monster</span>
                    <span className="bc-count">{counts?.monsters} monsters</span>
                  </button>
                  <button className="big-card" onClick={() => goTo('items')}>
                    <IconSword size={30} stroke={1.5} />
                    <span className="bc-title">Inventory item</span>
                    <span className="bc-sub">Item pictures, including uniques and sets</span>
                    <span className="bc-count">{counts?.items} graphics</span>
                  </button>
                </div>
                <button className="studio-card" onClick={() => goTo('3d')}>
                  <IconRotate360 size={26} stroke={1.5} />
                  <span>
                    <span className="bc-title">3D Studio</span>
                    <span className="bc-sub">Load a 3D model (3ds Max, Blender, Mixamo) or build one from shapes, and render it into game sprites</span>
                  </span>
                  <IconArrowRight size={18} />
                </button>
                <button className="studio-card" onClick={() => goTo('tiles')}>
                  <IconLayoutGrid size={26} stroke={1.5} />
                  <span>
                    <span className="bc-title">Tile Maker</span>
                    <span className="bc-sub">Import a scene from Blender or 3ds Max and split it into map tiles: .dt1 floors, walls, lower walls and roofs, plus a ready-placed .ds1 map piece</span>
                  </span>
                  <IconArrowRight size={18} />
                </button>
                <button className="link-row" onClick={() => goTo('objects')}>
                  <IconBox size={16} stroke={1.75} /> Objects: chests, shrines, doors and more ({counts?.objects})
                </button>

                {doc && (
                  <button className="continue-card" onClick={() => setState({ screen: 'editor' })}>
                    <IconPencil size={18} stroke={1.75} />
                    <span>
                      Continue editing <b>{doc.kind === 'anim' ? `${doc.unit.label}: ${modeName(doc.mode).toLowerCase()}` : doc.title}</b>
                    </span>
                    <IconArrowRight size={16} />
                  </button>
                )}

                {recent.length > 0 && (
                  <div className="recent">
                    <h3>
                      <IconHistory size={16} stroke={1.75} /> Recent
                    </h3>
                    {recent.map((r, i) => (
                      <button
                        key={i}
                        className="result-row"
                        onClick={() => {
                          if (r.kind === 'item') {
                            const it = catalog.items.find((x) => x.path === r.path && x.name === r.name) ?? null
                            openItem(it, r.path)
                          } else {
                            const u = catalog.units.find((x) => x.base === r.base && x.token === r.token)
                            if (u) openAnim(u, r.mode, r.wclass)
                          }
                        }}
                      >
                        {r.kind === 'item' ? (
                          <LazyImg className="result-thumb" load={() => itemThumb(r.path)} />
                        ) : (
                          <LazyImg
                            className="result-thumb"
                            load={() => {
                              const u = catalog.units.find((x) => x.base === r.base && x.token === r.token)
                              return u ? unitPortrait(u) : Promise.resolve(null)
                            }}
                          />
                        )}
                        <span className="rr-text">
                          {r.kind === 'item' ? (
                            <span>{r.name || r.title}</span>
                          ) : (
                            <span>
                              {catalog.units.find((x) => x.base === r.base && x.token === r.token)?.label ?? r.token}: {modeName(r.mode).toLowerCase()}
                            </span>
                          )}
                          <span className="muted">{r.kind === 'item' ? 'Item' : weaponName(r.wclass)}</span>
                        </span>
                        <IconArrowRight size={16} className="muted" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
