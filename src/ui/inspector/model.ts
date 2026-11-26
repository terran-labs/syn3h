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
import { isVehicleAvailable } from '../../vehicles/available'

/** The part of a parameter definition the inspector reads. Matches shared/params.ts. */
export interface PropertyDef {
  id: string; label: string; group: string; scope: 'world' | 'client'
  /** Set on settings that shape only the lobby (ui/lobby-scene-settings); never shown in play. */
  lobbyGroup?: string
  default: number | boolean; min?: number; max?: number; step?: number; deferred?: boolean
  /** Synced and saved, but no panel shows it (shared/params.ts). */
  hidden?: boolean
  /** The range in words, for a control whose stored numbers are not what it shows. */
  limitsText?: string
  /** Optional, written by the lane that owns the property. */
  description?: string
  /** Shown = (value - offset) * scale, or scale * power^(value - offset); see ParamDef.display. Stored and sent values never change. */
  display?: { offset: number; scale: number; power?: number; step?: number }
}
/** A stored value as the settings UI shows it. */
export function shownValue(def: Pick<PropertyDef, 'display'>, value: number): number {
  const d = def.display
  if (!d) return value
  return d.power ? d.scale * d.power ** (value - d.offset) : (value - d.offset) * d.scale
}
/** The value to store for one typed or slid in display units. */
export function storedValue(def: Pick<PropertyDef, 'display'>, shown: number): number {
  // Rounded off at the tenth place so -0.3 shown is -0.7 stored, not -0.7000000000000001.
  const d = def.display
  if (!d) return shown
  return Number((d.power ? Math.log(shown / d.scale) / Math.log(d.power) + d.offset : shown / d.scale + d.offset).toFixed(10))
}
/**
 * The definition as the settings UI sees it: limits and default in display units, low to
 * high. For properties without a display mapping it is the definition itself.
 */
export function shownDef<T extends PropertyDef>(def: T): T {
  if (!def.display || typeof def.default !== 'number') return def
  const ends = [def.min, def.max].map(v => v === undefined ? undefined : shownValue(def, v))
  const lo = ends.every(v => v !== undefined) ? Math.min(ends[0]!, ends[1]!) : ends[0], hi = ends.every(v => v !== undefined) ? Math.max(ends[0]!, ends[1]!) : ends[1]
  const step = def.display.step ?? (def.step === undefined ? undefined : Math.abs(def.step * def.display.scale))
  return { ...def, default: shownValue(def, def.default), min: lo, max: hi, step, display: undefined }
}
/**
 * One collapsible section inside a card: the groups it holds (definition groups), and any
 * single properties placed here whatever their group. With more than one group, each group is
 * a fold of its own inside the section.
 */
export interface PartSpec {
  title: string
  groups?: readonly string[]
  ids?: readonly string[]
  /** Open for a player who has never touched it. */
  open?: boolean
  /** Old names it went by, so a search for them still finds its rows. */
  aliases?: string
  /** One list of rows, with no fold per group (a short section, or one made of single rows). */
  flat?: boolean
  /** Shown names for groups inside this section; groups given the same name share one fold. */
  titles?: Readonly<Record<string, string>>
}
export interface SectionSpec {
  id: string; title: string; blurb: string; scope: 'world' | 'client'
  parts: readonly PartSpec[]
  /** Every group its parts hold, in order. */
  groups: readonly string[]
  /** Old card names, for search. */
  aliases?: string
}
const card = (spec: Omit<SectionSpec, 'groups'>): SectionSpec => ({ ...spec, groups: spec.parts.flatMap(part => part.groups ?? []) })

/**
 * The in-play sidebar's cards, top to bottom (the owner, 25 November 2026): Game, Players,
 * World, Settings, Chat. Players and Chat are built elsewhere (Shell.ts, chat/ChatCard.ts);
 * Settings' own top half is PerformancePanel.ts, which keeps the stable id 'performance'.
 * Game is what you are doing now; World holds nearly every tweakable setting; Settings is
 * this device: how the game is drawn, heard and controlled. Ids are stable: other code opens cards by them.
 */
/** The in-play card for this device (stable id 'performance'; was Performance, then Rendering). The owner, 25 November 2026. */
export const SETTINGS_TITLE = 'Settings'
export const CARD_ORDER = ['game', 'players', 'world', 'performance', 'chat'] as const
/** Card ids that no longer exist, and the card that took over each (stored open cards, deep links). */
export const RETIRED_CARDS: Readonly<Record<string, string>> = { you: 'game', vehicles: 'world' }

/** Logical sections (cards) built from the registry, in the order shown. */
export const SECTIONS: readonly SectionSpec[] = [
  card({ id: 'game', title: 'Game', blurb: 'You, and the game being played.', scope: 'world', aliases: 'me', parts: [
    // The vehicle, colours and name are drawn at the top of Me by the inspector itself.
    { title: 'Me', groups: ['Me', 'Privacy'], ids: ['bots.playWithMe', 'audio.muted'], open: true, flat: true },
    { title: 'Game', ids: ['game.mode', 'race.auto'], open: true, flat: true },
  ] }),
  card({ id: 'world', title: 'World', blurb: 'The world and everything in it. Most of it is shared with the room.', scope: 'world', aliases: 'vehicles game', parts: [
    { title: 'This world', groups: ['World'], open: true },
    { title: 'Time and weather', groups: ['Sun', 'Sky', 'Weather'] },
    { title: 'Water', groups: ['Water', 'Liquid'], titles: { Water: 'Water and floating', Liquid: 'Wings in water' } },
    { title: 'Terrain', groups: ['Terrain', 'Lava'] },
    { title: 'Vehicles', groups: ['Buggy', 'Jet', 'Hovercraft', 'Tank', 'Zorb', 'Wheels', 'Canopy', 'Surfaces', 'Vehicle looks', 'Vehicle paint'], aliases: 'vehicles handling paint looks', titles: { 'Vehicle looks': 'Paint and looks', 'Vehicle paint': 'Paint and looks' } },
    { title: 'Gear', groups: ['Tag beams', 'Plasma Tag', 'Gear: Yoink', 'Gear: Chaser', 'Gear: Grapple', 'Gear: Plasma Thunder', 'Gear: Impact push', 'Gear effects'], aliases: 'game', titles: { 'Gear: Yoink': 'Yoink', 'Gear: Chaser': 'Chaser', 'Gear: Grapple': 'Grapple', 'Gear: Plasma Thunder': 'Plasma Thunder', 'Gear: Impact push': 'Impact push', 'Gear effects': 'Effects' } },
    { title: 'Bots', groups: ['Bots'], aliases: 'game' },
    { title: 'Modes and rules', groups: ['Game', 'Tag'], aliases: 'game', titles: { Game: 'Hill and room' } },
  ] }),
  // Below PerformancePanel's level, Auto and fine rows, above its Diagnostics.
  card({ id: 'performance', title: SETTINGS_TITLE, blurb: 'This device: how the game is drawn, heard and controlled. Yours only.', scope: 'client', aliases: 'performance rendering me', parts: [
    { title: 'Graphics', groups: ['Graphics'] },
    { title: 'Post effects', groups: ['Post'] },
    { title: 'Light', groups: ['Light'] },
    { title: 'Interface', groups: ['Interface', 'Chat', 'Glass', 'Clear lens'], flat: true },
    // Sound, Camera and Controls live here, in the renamed card (the owner, 25 November 2026).
    { title: 'Sound', groups: ['Audio', 'Adaptive score'] },
    { title: 'Camera', groups: ['Camera'] },
    { title: 'Controls', groups: ['Input', 'Daydream'], flat: true },
    { title: 'Network', groups: ['Network'] },
  ] }),
]
/**
 * Shown by a custom control elsewhere, so never as a generic row too: the Players card's bot
 * count and Connection diagnostics switch (the Players card claims bots.count with its own
 * row; until it does, the count stays in World > Bots).
 */
export const SHOWN_ELSEWHERE: readonly string[] = ['hud.diagnostics']

/**
 * Settings that shape only the lobby (the galaxy, the Mira name, the opening and the lobby's
 * music). They belong in the lobby's Settings and never appear in a card in a world. Tagged
 * with lobbyGroup by their lanes; the id rules catch any not yet tagged.
 */
export function isLobbyOnly(def: Pick<PropertyDef, 'id'> & { lobbyGroup?: string }): boolean {
  return !!def.lobbyGroup || def.id.startsWith('lobby.') || def.id.startsWith('audio.score.lobby') || def.id === 'audio.leadLobby'
}

/**
 * Open cards stored by an earlier version: retired ids become the card that took them over,
 * anything else that is not a string is dropped, and each id appears once (the newest place).
 */
export function migrateOpenCards(saved: unknown): string[] {
  if (!Array.isArray(saved)) return []
  const ids = saved.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 64).map(id => RETIRED_CARDS[id] ?? id)
  return ids.filter((id, i) => ids.lastIndexOf(id) === i)
}

export interface GroupNode { name: string; properties: PropertyDef[] }
export interface PartNode { title: string; open: boolean; aliases: string; flat: boolean; titles: Readonly<Record<string, string>>; groups: GroupNode[]; count: number }
export interface SectionNode extends Omit<SectionSpec, 'parts'> { groups: readonly string[]; tree: GroupNode[]; parts: PartNode[]; count: number }

/**
 * Arrange definitions into cards, sections and groups. Order within a group is definition
 * order. A property listed by id goes there; otherwise its group decides; a group nobody
 * listed becomes a section of its own at the end of World (shared) or Settings (yours only).
 * Lobby-only settings are left out: this tree is the in-play sidebar's.
 */
export function buildTree(defs: readonly PropertyDef[]): SectionNode[] {
  const sections = SECTIONS.map(spec => ({ ...spec, tree: [] as GroupNode[], parts: spec.parts.map(part => ({ title: part.title, open: !!part.open, aliases: part.aliases ?? '', flat: !!part.flat, titles: part.titles ?? {}, groups: [] as GroupNode[], count: 0 })), count: 0 }))
  const byId = new Map<string, [number, number]>(), byGroup = new Map<string, [number, number]>()
  SECTIONS.forEach((spec, s) => spec.parts.forEach((part, p) => {
    for (const id of part.ids ?? []) byId.set(id, [s, p])
    for (const group of part.groups ?? []) if (!byGroup.has(group)) byGroup.set(group, [s, p])
  }))
  for (const def of defs) {
    if (isLobbyOnly(def) || SHOWN_ELSEWHERE.includes(def.id)) continue
    // A hidden vehicle's handling is hidden with it (src/vehicles/available.ts).
    if (def.group === 'Tank' && !isVehicleAvailable('tank')) continue
    let at = byId.get(def.id) ?? byGroup.get(def.group)
    if (!at) {
      const s = sections.findIndex(section => section.id === (def.scope === 'world' ? 'world' : 'performance'))
      let p = sections[s].parts.findIndex(part => part.title === def.group)
      if (p < 0) { p = sections[s].parts.push({ title: def.group, open: false, aliases: '', flat: false, titles: {}, groups: [], count: 0 }) - 1 }
      at = [s, p]
    }
    const section = sections[at[0]], part = section.parts[at[1]]
    let group = part.groups.find(g => g.name === def.group)
    if (!group) { group = { name: def.group, properties: [] }; part.groups.push(group) }
    group.properties.push(def); part.count++; section.count++
  }
  for (const section of sections) {
    // Listed groups first, in their listed order; anything unlisted after them.
    for (const part of section.parts) part.groups.sort((a, b) => rank(section.groups, a.name) - rank(section.groups, b.name))
    // Game's Me section holds the vehicle and name even with no registry rows in it.
    section.parts = section.parts.filter(part => part.count > 0 || section.id === 'game' && part.title === 'Me')
    section.tree = section.parts.flatMap(part => part.groups)
  }
  return sections.filter(section => section.count > 0 || section.id === 'game')
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
  mira: 'world' | 'section'
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
  return { mira: 'world', version: 1, values }
}
/** Write out one section, shared or personal. */
export function exportSection(section: SectionNode, valueOf: (id: string) => number | boolean | undefined): WorldJson {
  const values: Record<string, number | boolean> = {}
  for (const group of section.tree) for (const def of group.properties) { const value = valueOf(def.id); if (value !== undefined) values[def.id] = value }
  return { mira: 'section', version: 1, section: section.id, values }
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
  // Copies made before the rename to Mira carry the old tag; they still paste. rename-keep
  const tag = record.mira ?? record.syn3h // rename-keep
  const kind = tag === 'section' ? 'section' : 'world'
  // Accept the wrapped form and a bare { id: value } object.
  const values = record.values && typeof record.values === 'object' && !Array.isArray(record.values) ? record.values as Record<string, unknown> : tag === undefined ? record : null
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
