import { useMemo, useState } from 'react'
import { IconArrowLeft, IconSearch } from '@tabler/icons-react'
import type { ItemKind } from '../../../core/catalog'
import { goTo, openItem, useStore } from '../store'
import { itemThumb } from '../thumbs'
import { LazyImg, Segmented } from '../ui'

const KINDS: { value: ItemKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'weapon', label: 'Weapons' },
  { value: 'armor', label: 'Armour' },
  { value: 'misc', label: 'Other items' },
  { value: 'unique', label: 'Uniques' },
  { value: 'set', label: 'Sets' },
  { value: 'other', label: 'Unused graphics' }
]

const PAGE = 240

export function ItemPicker() {
  const catalog = useStore((s) => s.catalog)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<ItemKind | 'all'>('all')
  const [limit, setLimit] = useState(PAGE)
  const items = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (catalog?.items ?? []).filter((i) => (kind === 'all' || i.kind === kind) && (!n || i.name.toLowerCase().includes(n) || i.code === n || i.invfile.includes(n)))
  }, [catalog, q, kind])

  return (
    <div className="picker">
      <div className="picker-head">
        <button className="back" onClick={() => goTo('home')}>
          <IconArrowLeft size={18} stroke={1.75} /> Home
        </button>
        <div className="picker-title">
          <h2>Inventory items</h2>
          <span className="muted">{items.length} pictures</span>
        </div>
        <div className="search-small">
          <IconSearch size={16} stroke={1.75} />
          <input
            autoFocus
            placeholder="Search, e.g. Shako"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setLimit(PAGE)
            }}
          />
        </div>
      </div>
      <div className="picker-filters">
        <Segmented
          options={KINDS}
          value={kind}
          onChange={(k) => {
            setKind(k)
            setLimit(PAGE)
          }}
        />
      </div>
      <div className="item-grid">
        {items.slice(0, limit).map((it, i) => (
          <button key={`${it.kind}:${it.name}:${i}`} className="item-tile" onClick={() => openItem(it, it.path)} title={`${it.path}${it.code ? ` · code ${it.code}` : ''}`}>
            <LazyImg className="item-pic" load={() => itemThumb(it.path)} alt={it.name} />
            <span className={`it-name k-${it.kind}`}>{it.name}</span>
          </button>
        ))}
      </div>
      {items.length > limit && (
        <div className="center pad">
          <button className="btn" onClick={() => setLimit(limit + PAGE)}>
            Show more ({items.length - limit} left)
          </button>
        </div>
      )}
    </div>
  )
}
