/**
 * The world inspector's data, with no DOM in it: every registered property arranged into
 * logical sections and groups, a plain-language description and the limits of each, and a
 * world written out as JSON and read back in safely.
 *
 * Nothing here knows any particular property. A property defined anywhere in the game
 * appears in the tree; one whose group is not listed below lands in the section for its
 * scope. Descriptions come from the definition when a lane has written one, then from the
 * table in descriptions.ts, and always end with the limits, which are worked out here.
 */
import { DESCRIPTIONS } from './descriptions'

/** The part of a parameter definition the inspector reads. Matches shared/params.ts. */
export interface PropertyDef {
  id: string; label: string; group: string; scope: 'world' | 'client'
  default: number | boolean; min?: number; max?: number; step?: number; deferred?: boolean
  /** Synced and saved, but no panel shows it (shared/params.ts). */
  hidden?: boolean
  /** The range in words, for a control whose stored numbers are not what it shows. */
  limitsText?: string
  /** Optional, written by the lane that owns the property. */
  description?: string
  /** Shown = (value - offset) * scale; see ParamDef.display. Stored and sent values never change. */
  display?: { offset: number; scale: number }
}
/** A stored value as the settings UI shows it. */
export function shownValue(def: Pick<PropertyDef, 'display'>, value: number): number {
  return def.display ? (value - def.display.offset) * def.display.scale : value
}
/** The value to store for one typed or slid in display units. */
export function storedValue(def: Pick<PropertyDef, 'display'>, shown: number): number {
  // Rounded off at the tenth place so -0.3 shown is -0.7 stored, not -0.7000000000000001.
  return def.display ? Number((shown / def.display.scale + def.display.offset).toFixed(10)) : shown
}
/**
 * The definition as the settings UI sees it: limits and default in display units, low to
 * high. For properties without a display mapping it is the definition itself.
 */
export function shownDef<T extends PropertyDef>(def: T): T {
  if (!def.display || typeof def.default !== 'number') return def
  const ends = [def.min, def.max].map(v => v === undefined ? undefined : shownValue(def, v))
  const lo = ends.every(v => v !== undefined) ? Math.min(ends[0]!, ends[1]!) : ends[0], hi = ends.every(v => v !== undefined) ? Math.max(ends[0]!, ends[1]!) : ends[1]
  const step = def.step === undefined ? undefined : Math.abs(def.step * def.display.scale)
  return { ...def, default: shownValue(def, def.default), min: lo, max: hi, step, display: undefined }
}
export interface SectionSpec { id: string; title: string; blurb: string; groups: readonly string[]; scope: 'world' | 'client' }
/** Logical sections, in the order they are shown. Personal settings first; stable ids preserve saved section copies. */
export const SECTIONS: readonly SectionSpec[] = [
  { id: 'you', title: 'Me', blurb: 'Yours only: camera, sound, graphics and this display.', groups: ['Interface', 'Camera', 'Input', 'Daydream', 'Audio', 'Adaptive score', 'Graphics', 'Network'], scope: 'client' },
  { id: 'game', title: 'Game', blurb: 'What is being played, and who else is driving.', groups: ['Game', 'Tag', 'Tag beams', 'Zorb', 'Plasma Tag', 'Bots'], scope: 'world' },
  { id: 'vehicles', title: 'Vehicles', blurb: 'How each vehicle drives, flies and looks.', groups: ['Buggy', 'Jet', 'Hovercraft', 'Tank', 'Wheels', 'Canopy', 'Vehicle paint'], scope: 'world' },
  { id: 'world', title: 'World', blurb: 'The planet itself: its seed, land and seas.', groups: ['World', 'Terrain', 'Lava', 'Sun', 'Sky', 'Weather'], scope: 'world' },
]
export interface GroupNode { name: string; properties: PropertyDef[] }
export interface SectionNode extends SectionSpec { groups: readonly string[]; tree: GroupNode[]; count: number }

/** Arrange definitions into sections and groups. Order within a group is definition order. */
export function buildTree(defs: readonly PropertyDef[]): SectionNode[] {
  const sections = SECTIONS.map(spec => ({ ...spec, tree: [] as GroupNode[], count: 0 }))
  const home = (def: PropertyDef) => sections.find(s => s.groups.includes(def.group)) ?? sections.find(s => s.scope === def.scope && (s.id === 'world' || s.id === 'you'))!
  for (const def of defs) {
    const section = home(def)
    let group = section.tree.find(g => g.name === def.group)
    if (!group) { group = { name: def.group, properties: [] }; section.tree.push(group) }
    group.properties.push(def); section.count++
  }
  // Listed groups first, in their listed order; anything unlisted after them.
  for (const section of sections) section.tree.sort((a, b) => rank(section.groups, a.name) - rank(section.groups, b.name))
  return sections.filter(section => section.count > 0)
}
const rank = (order: readonly string[], name: string) => { const i = order.indexOf(name); return i < 0 ? order.length : i }

/** A number as a person would read it: no trailing noise, small values kept precise. */
export function show(value: number | boolean, def?: Pick<PropertyDef, 'step'>): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (!Number.isFinite(value)) return String(value)
  const step = def?.step ?? 0
  const places = step >= 1 || Number.isInteger(value) && step === 0 ? 0 : Math.min(6, Math.max(1, Math.ceil(-Math.log10(step || Math.max(1e-6, Math.abs(value) / 1000)))))
  return String(Number(value.toFixed(places)))
}
/** What the property is for, in a sentence, or an empty string if nobody has written one. */
export function describe(def: PropertyDef): string { return def.description ?? DESCRIPTIONS[def.id] ?? '' }
/** The guardrails in plain words: range, default, and who it affects. */
export function limits(def: PropertyDef): string {
  if (def.display) def = shownDef(def)
  const parts: string[] = []
  if (def.limitsText) parts.push(def.limitsText)
  else if (typeof def.default === 'number' && def.min !== undefined && def.max !== undefined) parts.push(`${show(Math.min(def.min, def.max), def)} to ${show(Math.max(def.min, def.max), def)}`)
  else if (typeof def.default === 'boolean') parts.push('on or off')
  if (!def.limitsText) parts.push(`default ${show(def.default, def)}`)
  parts.push(def.scope === 'world' ? 'shared with everyone in the room' : 'yours only')
  if (def.deferred) parts.push('applies when you let go')
  return parts.join(' · ')
}
/** Where a value sits between its limits, 0 to 1, for the guard bar. Null without limits. */
export function fraction(def: PropertyDef, value: number | boolean): number | null {
  if (def.display && typeof value === 'number') return fraction(shownDef(def), shownValue(def, value))
  if (typeof value !== 'number' || def.min === undefined || def.max === undefined || def.max === def.min) return null
  const lo = Math.min(def.min, def.max), hi = Math.max(def.min, def.max)
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)))
}

// ---------------------------------------------------------------------------------------
// A world as JSON
// ---------------------------------------------------------------------------------------

export interface WorldJson {
  /** Says what this is, so a paste of something else is refused politely. */
  syn3h: 'world' | 'section'
  version: 1
  /** For a section copy: which one. */
  section?: string
  /** Property id to value. A world holds every shared property; a section holds its own. */
  values: Record<string, number | boolean>
}
/** Write out a world: every shared property, so the JSON stands alone. */
export function exportWorld(defs: readonly PropertyDef[], valueOf: (id: string) => number | boolean | undefined): WorldJson {
  const values: Record<string, number | boolean> = {}
  for (const def of defs) { const value = valueOf(def.id); if (def.scope === 'world' && value !== undefined) values[def.id] = value }
  return { syn3h: 'world', version: 1, values }
}
/** Write out one section, shared or personal. */
export function exportSection(section: SectionNode, valueOf: (id: string) => number | boolean | undefined): WorldJson {
  const values: Record<string, number | boolean> = {}
  for (const group of section.tree) for (const def of group.properties) { const value = valueOf(def.id); if (value !== undefined) values[def.id] = value }
  return { syn3h: 'section', version: 1, section: section.id, values }
}
export interface PasteEntry { id: string; value: number | boolean; adjusted: boolean }
export type PasteResult =
  | { ok: true; kind: 'world' | 'section'; entries: PasteEntry[]; skipped: { id: string; why: string }[] }
  | { ok: false; why: string }

/**
 * Read pasted text. Never trusts it: only known properties are accepted, each value must be
 * the right kind, numbers are pulled inside their limits (and reported as adjusted), and a
 * pasted world may only carry shared properties, so it can never change someone's own
 * camera, sound or graphics. `personal` allows personal properties, for a section the
 * player copied from their own "Me" card.
 */
export function parseWorld(text: string, defs: readonly PropertyDef[], options: { personal?: boolean } = {}): PasteResult {
  let data: unknown
  try { data = JSON.parse(text) } catch { return { ok: false, why: 'That is not JSON.' } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, why: 'That JSON is not a world.' }
  const record = data as Record<string, unknown>
  const kind = record.syn3h === 'section' ? 'section' : 'world'
  // Accept the wrapped form and a bare { id: value } object.
  const values = record.values && typeof record.values === 'object' && !Array.isArray(record.values) ? record.values as Record<string, unknown> : record.syn3h === undefined ? record : null
  if (!values) return { ok: false, why: 'That JSON has no values in it.' }
  const byId = new Map(defs.map(def => [def.id, def]))
  const entries: PasteEntry[] = [], skipped: { id: string; why: string }[] = []
  const ids = Object.keys(values)
  if (ids.length > 2000) return { ok: false, why: 'That JSON is too large to be a world.' }
  for (const id of ids) {
    const def = byId.get(id), raw = values[id]
    if (!def) { skipped.push({ id, why: 'not a property of this game' }); continue }
    if (def.scope === 'client' && !(options.personal && kind === 'section')) { skipped.push({ id, why: 'personal settings are not pasted' }); continue }
    if (typeof def.default === 'boolean') {
      if (typeof raw !== 'boolean') { skipped.push({ id, why: 'needs on or off' }); continue }
      entries.push({ id, value: raw, adjusted: false }); continue
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) { skipped.push({ id, why: 'needs a number' }); continue }
    let value = raw
    if (def.min !== undefined && def.max !== undefined) value = Math.min(Math.max(def.min, def.max), Math.max(Math.min(def.min, def.max), value))
    entries.push({ id, value, adjusted: value !== raw })
  }
  if (!entries.length) return { ok: false, why: skipped.length ? 'Nothing in that JSON can be pasted here.' : 'That JSON is empty.' }
  return { ok: true, kind, entries, skipped }
}
/** One line saying what a paste did. */
export function pasteSummary(result: Extract<PasteResult, { ok: true }>): string {
  const adjusted = result.entries.filter(entry => entry.adjusted).length
  return [`${result.entries.length} ${result.entries.length === 1 ? 'property' : 'properties'} pasted`, adjusted ? `${adjusted} pulled inside limits` : '', result.skipped.length ? `${result.skipped.length} left out` : ''].filter(Boolean).join(', ') + '.'
}
