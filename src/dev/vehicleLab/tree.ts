/**
 * The vehicle lab's sidebar model, kept pure so it runs in vitest: which exhibits exist
 * (collected from a module map), the vehicle, group and design tree, the default selection,
 * selections to and from the URL, and which game parameters belong to a vehicle.
 */
import type { ParamDef } from '../../../shared/params'
import { filterDesigns, groupsOf } from './logic'
import type { LabDesignInfo, LabExhibit } from './types'

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

export function isExhibit(value: unknown): value is LabExhibit {
  const v = value as Partial<LabExhibit> | null
  return !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.designs === 'function' && typeof v.build === 'function'
}

/**
 * Every exhibit exported by a map of modules (what `import.meta.glob(..., { eager: true })`
 * returns). A module may export any number of exhibits, named or default, singly or in arrays.
 * The first exhibit with an id wins; the order is `order` (default 100), then title.
 */
export function collectExhibits(modules: Record<string, unknown>): LabExhibit[] {
  const found = new Map<string, LabExhibit>()
  const take = (value: unknown, path: string) => {
    if (Array.isArray(value)) { for (const v of value) take(v, path); return }
    if (!isExhibit(value)) return
    if (found.has(value.id)) { if (found.get(value.id) !== value) console.warn(`Vehicle lab: exhibit id "${value.id}" in ${path} is already taken`); return }
    found.set(value.id, value)
  }
  for (const path of Object.keys(modules).sort()) {
    const module = modules[path]
    if (module && typeof module === 'object') for (const value of Object.values(module)) take(value, path)
  }
  return [...found.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title))
}

// ---------------------------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------------------------

export interface TreeGroup {
  name: string
  /** Shown text, for example 'Round 3'. */
  label: string
  /** The last group: shown expanded, the others marked older. */
  latest: boolean
  designs: LabDesignInfo[]
}

export interface TreeVehicle {
  id: string
  title: string
  /** Groups, oldest first; empty when the designs have none. */
  groups: TreeGroup[]
  /** Every design, for vehicles without groups. */
  designs: LabDesignInfo[]
  /** Set when the exhibit failed to list its designs. */
  error?: string
}

export interface TreeSection { name: string; vehicles: TreeVehicle[] }

export interface ListedExhibit { exhibit: LabExhibit; designs: LabDesignInfo[]; error?: string }

/** Sections in the order their first exhibit appears; exhibits keep their registration order. */
export function buildTree(listed: ListedExhibit[]): TreeSection[] {
  const sections: TreeSection[] = []
  for (const { exhibit, designs, error } of listed) {
    const name = exhibit.section ?? 'Vehicles'
    let section = sections.find(s => s.name === name)
    if (!section) { section = { name, vehicles: [] }; sections.push(section) }
    const names = groupsOf(designs)
    section.vehicles.push({
      id: exhibit.id, title: exhibit.title, designs, error,
      groups: names.map((g, i) => ({
        name: g, label: `${exhibit.groupLabel ?? 'Group'} ${g}`, latest: i === names.length - 1,
        designs: filterDesigns(designs, g).designs,
      })),
    })
  }
  return sections
}

// ---------------------------------------------------------------------------------------------
// Selection and the URL
// ---------------------------------------------------------------------------------------------

/** What the sidebar has selected: a vehicle, its group if it has groups, and a design id or 'all'. */
export interface Selection { vehicle: string; group?: string; design: string }

export interface Wanted { vehicle?: string; group?: string; design?: string }

/** Reads the selection parameters, mapping retired ids (the game-skins exhibit) to today's. */
export function selectionFromSearch(search: string): Wanted {
  const q = new URLSearchParams(search)
  const wanted: Wanted = { vehicle: q.get('vehicle') ?? undefined, group: q.get('group') ?? q.get('round') ?? undefined, design: q.get('design') ?? undefined }
  // game-skins showed the Syn3h and classic skins. The classic buggy is retired, so both old
  // links, and a link to its own exhibit, open the Syn3h buggy.
  if (wanted.vehicle === 'game-skins' || wanted.vehicle === 'game-buggy-classic') return { vehicle: 'game-buggy' }
  return wanted
}

/** Writes the selection into a query string, keeping every other parameter as it was. */
export function selectionToSearch(selection: Selection, search = ''): string {
  const q = new URLSearchParams(search)
  q.delete('round')
  q.set('vehicle', selection.vehicle)
  if (selection.group === undefined) q.delete('group'); else q.set('group', selection.group)
  q.set('design', selection.design)
  return `?${q.toString()}`
}

/**
 * Settles what to show. An unknown vehicle falls back to the first listed (an alias counts as
 * its exhibit); an unknown group to the latest; a missing design to the exhibit's default, then
 * the first. A design may be an id, a 1 based position or 'all' (side by side).
 */
export function resolveSelection(tree: TreeSection[], exhibits: LabExhibit[], wanted: Wanted): Selection | null {
  const vehicles = tree.flatMap(s => s.vehicles)
  if (!vehicles.length) return null
  const byAlias = exhibits.find(e => e.aliases?.includes(wanted.vehicle ?? ''))?.id
  const vehicle = vehicles.find(v => v.id === wanted.vehicle) ?? vehicles.find(v => v.id === byAlias) ?? vehicles[0]
  const exhibit = exhibits.find(e => e.id === vehicle.id)
  const group = vehicle.groups.length ? (vehicle.groups.find(g => g.name === wanted.group) ?? vehicle.groups[vehicle.groups.length - 1]) : undefined
  const designs = group?.designs ?? vehicle.designs
  let design = wanted.design
  if (design !== 'all') {
    const byPosition = design !== undefined && /^\d+$/.test(design) ? designs[Number(design) - 1]?.id : undefined
    design = designs.find(d => d.id === design)?.id ?? byPosition
    if (!design) {
      const preferred = exhibit?.defaultDesign?.(group?.name)
      // An exhibit that exists to compare (the line-up) may open on the whole set.
      design = preferred === 'all' ? 'all' : designs.find(d => d.id === preferred)?.id ?? designs[0]?.id ?? ''
    }
  }
  return { vehicle: vehicle.id, group: group?.name, design }
}

// ---------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------

/**
 * Parameters that change how any vehicle model looks, listed for every game vehicle: the
 * showroom shading tier (vehicles/skins/showroom.ts).
 */
export const VEHICLE_WIDE_PARAMS = ['gfx.vehicleShading']

/**
 * Words kept off the page. A parameter whose label contains one is not listed in the lab (it
 * stays in the game's own settings panel).
 */
export const HIDDEN_LABEL = /\b(laser|lasers|weapons?|fire|firing|shoot\w*|guns?|missiles?|bullets?|bombs?|ammo|kill\w*|attack\w*|blast\w*|tag beams?)\b/i

/** True when a parameter may be shown in the lab: see HIDDEN_LABEL. */
export const presentable = (def: ParamDef) => !HIDDEN_LABEL.test(def.label) && !HIDDEN_LABEL.test(def.group)

/**
 * The parameters that belong to a vehicle, grouped by their `group` in registration order.
 *
 * Default rule, from the family (the exhibit's `family`, else its id; for game vehicles the
 * kind): the family's first word ('buggy-classic' gives 'buggy') must equal the parameter id's
 * prefix ('buggy.power'), or start with it ('hovercraft' and 'hover.thrust'), or equal its group
 * name in lower case ('Tank'). VEHICLE_WIDE_PARAMS are added. Shared world groups (Lava, Liquid,
 * Zorb) are left out: they act on every vehicle and live in the game's settings.
 *
 * `override` (the exhibit's `paramGroups`) replaces the rule: each entry names a group or an id
 * prefix or a full id. An empty override lists nothing.
 */
export function vehicleParams(defs: readonly ParamDef[], family: string, override?: readonly string[]): { group: string; defs: ParamDef[] }[] {
  const f = family.toLowerCase().split('-')[0]
  const belongs = (def: ParamDef) => {
    const prefix = def.id.split('.')[0].toLowerCase(), group = def.group.toLowerCase()
    if (override) return override.some(o => { const x = o.toLowerCase(); return x === group || x === prefix || x === def.id.toLowerCase() })
    if (VEHICLE_WIDE_PARAMS.includes(def.id)) return true
    return prefix === f || (prefix.length >= 3 && f.startsWith(prefix)) || group === f || group === family.toLowerCase()
  }
  const groups: { group: string; defs: ParamDef[] }[] = []
  for (const def of defs) {
    if (!belongs(def) || !presentable(def)) continue
    let g = groups.find(x => x.group === def.group)
    if (!g) { g = { group: def.group, defs: [] }; groups.push(g) }
    g.defs.push(def)
  }
  return groups
}
