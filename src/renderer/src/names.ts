// Plain-English names for Diablo II's internal codes. The UI shows these; codes only appear in tooltips.

import type { Catalog, UnitEntry } from '../../core/catalog'

export const MODE_LABELS: Record<string, { name: string; hint: string }> = {
  NU: { name: 'Standing', hint: 'Idle in the field' },
  TN: { name: 'Standing in town', hint: 'Relaxed town idle' },
  WL: { name: 'Walking', hint: '' },
  TW: { name: 'Walking in town', hint: '' },
  RN: { name: 'Running', hint: '' },
  A1: { name: 'Attack', hint: 'Main attack' },
  A2: { name: 'Attack (alternate)', hint: 'Second attack swing' },
  SC: { name: 'Casting', hint: 'Casting a spell' },
  S1: { name: 'Special 1', hint: 'Skill animation' },
  S2: { name: 'Special 2', hint: 'Skill animation' },
  S3: { name: 'Special 3', hint: 'Skill animation' },
  S4: { name: 'Special 4', hint: 'Skill animation' },
  S5: { name: 'Special 5', hint: 'Skill animation' },
  TH: { name: 'Throwing', hint: '' },
  KK: { name: 'Kicking', hint: '' },
  BL: { name: 'Blocking', hint: '' },
  GH: { name: 'Getting hit', hint: '' },
  DT: { name: 'Dying', hint: '' },
  DD: { name: 'Dead', hint: 'Corpse on the ground' },
  SQ: { name: 'Sequence', hint: '' },
  KB: { name: 'Knocked back', hint: '' },
  OP: { name: 'Opening', hint: '' },
  ON: { name: 'On', hint: '' },
  OF: { name: 'Off', hint: '' },
  SP: { name: 'Special', hint: '' },
  RN_: { name: 'Running', hint: '' }
}

export const MODE_ORDER = ['NU', 'TN', 'WL', 'TW', 'RN', 'A1', 'A2', 'SC', 'S1', 'S2', 'S3', 'S4', 'S5', 'TH', 'KK', 'BL', 'GH', 'DT', 'DD']

export function modeName(code: string): string {
  return MODE_LABELS[code]?.name ?? code
}

export const WEAPON_LABELS: Record<string, { name: string; hint: string }> = {
  HTH: { name: 'Unarmed', hint: 'No weapon' },
  '1HS': { name: 'One-handed swing', hint: 'Swords, axes, maces' },
  '1HT': { name: 'One-handed thrust', hint: 'Daggers, javelins' },
  '2HS': { name: 'Two-handed swing', hint: 'Two-handed swords and axes' },
  '2HT': { name: 'Two-handed thrust', hint: 'Spears, polearms' },
  STF: { name: 'Staff', hint: 'Staves' },
  BOW: { name: 'Bow', hint: '' },
  XBW: { name: 'Crossbow', hint: '' },
  '1JS': { name: 'Dual wield: thrust + swing', hint: 'Left thrust, right swing' },
  '1JT': { name: 'Dual wield: thrust + thrust', hint: '' },
  '1SS': { name: 'Dual wield: swing + swing', hint: '' },
  '1ST': { name: 'Dual wield: swing + thrust', hint: '' },
  HT1: { name: 'One claw', hint: 'Assassin claw' },
  HT2: { name: 'Two claws', hint: 'Assassin claws' }
}

export function weaponName(code: string): string {
  return WEAPON_LABELS[code]?.name ?? code
}

export const PART_LABELS: Record<string, string> = {
  HD: 'Head',
  TR: 'Torso',
  LG: 'Legs',
  RA: 'Right arm',
  LA: 'Left arm',
  RH: 'Weapon (right hand)',
  LH: 'Left hand',
  SH: 'Shield',
  S1: 'Shoulder pad 1',
  S2: 'Shoulder pad 2',
  S3: 'Extra part 3',
  S4: 'Extra part 4',
  S5: 'Extra part 5',
  S6: 'Extra part 6',
  S7: 'Extra part 7',
  S8: 'Extra part 8'
}

const ARMOUR = new Set(['HD', 'TR', 'LG', 'RA', 'LA', 'S1', 'S2'])

/** Friendly name for an armtype code on a given part, e.g. LIT -> "Light", "axe" -> "Axe". */
export function armtypeName(catalog: Catalog | null, comp: string, code: string): string {
  if (!code) return 'None'
  const c = code.toUpperCase()
  if (ARMOUR.has(comp) || c === 'LIT' || c === 'MED' || c === 'HVY') {
    if (c === 'LIT') return 'Light'
    if (c === 'MED') return 'Medium'
    if (c === 'HVY') return 'Heavy'
  }
  const item = catalog?.items.find((i) => (i.kind === 'weapon' || i.kind === 'armor') && i.code.toUpperCase() === c)
  return item ? item.name : c
}

// Facing directions (Diablo II direction index -> plain description)
const FACING8 = ['down-left', 'up-left', 'up-right', 'down-right', 'down', 'left', 'up', 'right']
const FACING16 = [
  ...FACING8,
  'down, slightly left',
  'left, slightly down',
  'left, slightly up',
  'up, slightly left',
  'up, slightly right',
  'right, slightly up',
  'right, slightly down',
  'down, slightly right'
]

export function facingName(count: number, d: number): string {
  if (count === 8 || count === 4) return FACING8[d] ?? `#${d}`
  if (count === 16) return FACING16[d] ?? `#${d}`
  return `direction ${d + 1}`
}

/** Screen angle in degrees (0 = right, clockwise) for drawing the facing compass. */
export function facingAngle(count: number, d: number): number | null {
  const a8 = [135, 225, 315, 45, 90, 180, 270, 0]
  const a16 = [...a8, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5]
  if (count === 8 || count === 4) return a8[d]
  if (count === 16) return a16[d]
  return null
}

/** Order directions clockwise from "down" for step-through controls. */
export function facingOrder(count: number): number[] {
  const idx = Array.from({ length: count }, (_, i) => i)
  const ang = (d: number) => ((facingAngle(count, d) ?? d * (360 / count)) - 90 + 360) % 360
  return idx.sort((a, b) => ang(a) - ang(b))
}

export function unitTitle(u: UnitEntry): string {
  return u.label
}
