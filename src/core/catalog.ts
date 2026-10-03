// Sprite database: indexes every animated unit (COF/DCC) and every static item graphic (DC6)
// available in the loaded archives, labelled using PD2's excel tables.

export type UnitBase = 'chars' | 'monsters' | 'objects'

export interface UnitEntry {
  base: UnitBase
  token: string
  label: string
  /** mode -> weapon classes that have a COF */
  modes: Record<string, string[]>
  /** composit -> armtypes that have at least one DCC */
  armtypes: Record<string, string[]>
  /** every part-graphic stem (without token prefix), e.g. "HDLITNUHTH", upper-case (DCC or DC6) */
  dccs: string[]
  /** the stems stored as DC6 instead of DCC (e.g. Mephisto's parts) */
  dc6: string[]
}

export type ItemKind = 'weapon' | 'armor' | 'misc' | 'unique' | 'set' | 'other'

export interface ItemEntry {
  name: string
  kind: ItemKind
  code: string
  invfile: string
  path: string
  /** colormap index from InvTrans (0 = none) */
  invTrans: number
  /** colour code from colors.txt (unique/set tint), e.g. "lgry" */
  tint: string
}

export interface Catalog {
  units: UnitEntry[]
  items: ItemEntry[]
  colors: { code: string; name: string }[]
  dc6Files: string[]
}

export const CHAR_NAMES: Record<string, string> = {
  AM: 'Amazon',
  SO: 'Sorceress',
  NE: 'Necromancer',
  PA: 'Paladin',
  BA: 'Barbarian',
  DZ: 'Druid',
  AI: 'Assassin'
}

export const MODE_NAMES: Record<string, string> = {
  DT: 'Death',
  NU: 'Neutral',
  WL: 'Walk',
  RN: 'Run',
  GH: 'Get hit',
  TN: 'Town neutral',
  TW: 'Town walk',
  A1: 'Attack 1',
  A2: 'Attack 2',
  BL: 'Block',
  SC: 'Cast',
  TH: 'Throw',
  KK: 'Kick',
  S1: 'Skill 1',
  S2: 'Skill 2',
  S3: 'Skill 3',
  S4: 'Skill 4',
  DD: 'Dead',
  SQ: 'Sequence',
  KB: 'Knockback',
  RN_: 'Run',
  OP: 'Opening',
  ON: 'On',
  OF: 'Off',
  SP: 'Special',
  S5: 'Skill 5'
}

export const WCLASS_NAMES: Record<string, string> = {
  HTH: 'Hand to hand',
  BOW: 'Bow',
  '1HS': 'One-hand swing',
  '1HT': 'One-hand thrust',
  STF: 'Staff',
  '2HS': 'Two-hand swing',
  '2HT': 'Two-hand thrust',
  XBW: 'Crossbow',
  '1JS': 'Left jab, right swing',
  '1JT': 'Left jab, right thrust',
  '1SS': 'Left swing, right swing',
  '1ST': 'Left swing, right thrust',
  HT1: 'One hand-to-hand',
  HT2: 'Two hand-to-hand'
}

export function unitDir(u: { base: string; token: string }): string {
  return `data\\global\\${u.base}\\${u.token}`
}

export function cofPath(u: { base: string; token: string }, mode: string, wclass: string): string {
  return `${unitDir(u)}\\COF\\${u.token}${mode}${wclass}.cof`
}

export function dccPath(u: { base: string; token: string }, comp: string, armtype: string, mode: string, wclass: string): string {
  return `${unitDir(u)}\\${comp}\\${u.token}${comp}${armtype}${mode}${wclass}.dcc`
}

export interface TxtTable {
  header: string[]
  rows: string[][]
  col(name: string): number
}

export function parseTxt(data: Uint8Array | null): TxtTable {
  if (!data) return { header: [], rows: [], col: () => -1 }
  const lines = new TextDecoder('latin1').decode(data).split(/\r?\n/)
  const header = lines[0].split('\t')
  const lower = header.map((h) => h.toLowerCase())
  const rows = lines.slice(1).filter((l) => l.trim()).map((l) => l.split('\t'))
  return { header, rows, col: (name: string) => lower.indexOf(name.toLowerCase()) }
}

export function buildCatalog(files: string[], readTxt: (name: string) => Uint8Array | null): Catalog {
  const unitMap = new Map<string, UnitEntry>()
  const getUnit = (base: UnitBase, token: string): UnitEntry => {
    const key = `${base}/${token}`
    let u = unitMap.get(key)
    if (!u) {
      u = { base, token, label: token, modes: {}, armtypes: {}, dccs: [], dc6: [] }
      unitMap.set(key, u)
    }
    return u
  }
  const dc6Files: string[] = []
  const seen = new Set<string>()
  const cofRe = /^data\\global\\(chars|monsters|objects)\\([^\\]+)\\cof\\([^\\]+)\.cof$/i
  const dccRe = /^data\\global\\(chars|monsters|objects)\\([^\\]+)\\([^\\]+)\\([^\\]+)\.(dcc|dc6)$/i
  for (const raw of files) {
    const f = raw.replace(/\//g, '\\')
    const key = f.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    let m = cofRe.exec(f)
    if (m) {
      const token = m[2].toUpperCase()
      const stem = m[3].toUpperCase()
      if (!stem.startsWith(token) || stem.length < token.length + 3) continue
      const mode = stem.substring(token.length, token.length + 2)
      const wclass = stem.substring(token.length + 2)
      const u = getUnit(m[1].toLowerCase() as UnitBase, token)
      ;(u.modes[mode] ??= []).includes(wclass) || u.modes[mode].push(wclass)
      continue
    }
    m = dccRe.exec(f)
    if (m) {
      const token = m[2].toUpperCase()
      const comp = m[3].toUpperCase()
      const stem = m[4].toUpperCase()
      if (!stem.startsWith(token + comp)) continue
      const rest = stem.substring(token.length + comp.length)
      if (rest.length < 6) continue
      const armtype = rest.substring(0, rest.length - 5)
      const u = getUnit(m[1].toLowerCase() as UnitBase, token)
      if (!u.dccs.includes(comp + rest)) u.dccs.push(comp + rest)
      if (m[5].toLowerCase() === 'dc6' && !u.dc6.includes(comp + rest)) u.dc6.push(comp + rest)
      const list = (u.armtypes[comp] ??= [])
      if (!list.includes(armtype)) list.push(armtype)
      continue
    }
    if (/\.dc6$/i.test(f)) dc6Files.push(f)
  }

  // Labels
  const monstats = parseTxt(readTxt('monstats'))
  const cCode = monstats.col('Code')
  const cName = monstats.col('NameStr')
  const cId = monstats.col('Id')
  const monNames = new Map<string, string[]>()
  for (const r of monstats.rows) {
    const code = (r[cCode] ?? '').toUpperCase()
    if (!code) continue
    const n = r[cName] || r[cId]
    const list = monNames.get(code) ?? []
    if (n && !list.includes(n)) list.push(n)
    monNames.set(code, list)
  }
  for (const u of unitMap.values()) {
    if (u.base === 'chars') u.label = CHAR_NAMES[u.token] ?? u.token
    else if (u.base === 'monsters') {
      const names = monNames.get(u.token) ?? []
      u.label = names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2} more` : '') : `Unnamed (${u.token})`
    } else u.label = `Object ${u.token}`
    for (const k of Object.keys(u.modes)) u.modes[k].sort()
    for (const k of Object.keys(u.armtypes)) u.armtypes[k].sort()
  }
  const units = [...unitMap.values()]
    .filter((u) => Object.keys(u.modes).length > 0)
    .sort((a, b) => (a.base === b.base ? a.label.localeCompare(b.label) : a.base.localeCompare(b.base)))

  // Items
  const items: ItemEntry[] = []
  const byCode = new Map<string, { invfile: string; invTrans: number; name: string }>()
  const addItem = (e: Omit<ItemEntry, 'path'>) => {
    if (e.invfile) items.push({ ...e, path: `data\\global\\items\\${e.invfile}.dc6` })
  }
  for (const [table, kind] of [
    ['weapons', 'weapon'],
    ['armor', 'armor'],
    ['misc', 'misc']
  ] as const) {
    const t = parseTxt(readTxt(table))
    const [n, c, inv, tr] = ['name', 'code', 'invfile', 'InvTrans'].map((h) => t.col(h))
    for (const r of t.rows) {
      if (!r[c] || r[n] === 'Expansion') continue
      const e = { name: r[n], code: r[c], invfile: (r[inv] ?? '').toLowerCase(), invTrans: parseInt(r[tr]) || 0 }
      byCode.set(e.code, e)
      addItem({ ...e, kind, tint: '' })
    }
  }
  for (const [table, kind, codeCol] of [
    ['uniqueitems', 'unique', 'code'],
    ['setitems', 'set', 'item']
  ] as const) {
    const t = parseTxt(readTxt(table))
    const [n, c, inv, tint] = ['index', codeCol, 'invfile', 'invtransform'].map((h) => t.col(h))
    for (const r of t.rows) {
      const base = byCode.get(r[c])
      if (!r[n] || !base || r[n] === 'Expansion') continue
      addItem({
        name: r[n],
        kind,
        code: r[c],
        invfile: (r[inv] || base.invfile).toLowerCase(),
        invTrans: base.invTrans,
        tint: r[tint] ?? ''
      })
    }
  }
  const referenced = new Set(items.map((i) => i.path.toLowerCase()))
  for (const f of dc6Files) {
    if (!/^data\\global\\items\\/i.test(f) || referenced.has(f.toLowerCase())) continue
    const stem = f.substring(f.lastIndexOf('\\') + 1).replace(/\.dc6$/i, '')
    items.push({ name: stem, kind: 'other', code: '', invfile: stem.toLowerCase(), path: f, invTrans: 0, tint: '' })
  }

  const colorsT = parseTxt(readTxt('colors'))
  const colors = colorsT.rows.map((r) => ({ name: r[0], code: r[1] })).filter((c) => c.code)

  return { units, items, colors, dc6Files: dc6Files.sort() }
}
