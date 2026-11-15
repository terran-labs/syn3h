import { sanitize, type ParamDef, type ParamValue } from '../../../shared/params'
import { RECIPE_IDS, recipeIdForLook, type RecipeId } from '../../../shared/recipes'
import { exportWorld, parseWorld, type WorldJson } from '../inspector/model'

export const SAVED_WORLDS_KEY = 'syn3h.savedWorlds.v1'
export const SAVED_WORLDS_MAX = 12
const MAX_BYTES = 512 * 1024
export interface SavedWorld { id: string; savedAt: number; recipeId: RecipeId; seed: number; world: WorldJson }
export interface SavedLibrary { entries: SavedWorld[]; notice?: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const bytes = (value: string) => new TextEncoder().encode(value).length
export const worldIdentity = (values: Record<string, ParamValue>): string => JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))

/** Clipboard parsing is permissive. Saved records must pass strict validation first. */
export function readSavedWorlds(raw: string | null, defs: readonly ParamDef[]): SavedLibrary {
  if (raw === null) return { entries: [] }
  if (bytes(raw) > MAX_BYTES) throw new Error('The saved world library is too large.')
  const data: unknown = JSON.parse(raw)
  if (!object(data) || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > SAVED_WORLDS_MAX) throw new Error('The saved world library has an unsupported format.')
  const byId = new Map(defs.map(def => [def.id, def])), seen = new Set<string>()
  let adjusted = false
  const entries = data.entries.map((item: unknown): SavedWorld => {
    if (!object(item) || typeof item.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.id) || seen.has(item.id)) throw new Error('A saved world has an invalid identity.')
    seen.add(item.id)
    if (typeof item.savedAt !== 'number' || !Number.isSafeInteger(item.savedAt) || item.savedAt < 0 || !RECIPE_IDS.includes(item.recipeId as RecipeId) || typeof item.seed !== 'number' || !Number.isInteger(item.seed) || item.seed < 1 || item.seed > 999999) throw new Error('A saved world has invalid recipe or seed metadata.')
    const world = item.world
    if (!object(world) || world.syn3h !== 'world' || world.version !== 1 || !object(world.values) || Object.keys(world.values).length > 2000) throw new Error('A saved world has an unsupported snapshot format.')
    for (const [id, value] of Object.entries(world.values)) {
      const def = byId.get(id)
      if (!def || def.scope !== 'world') continue
      if (typeof value !== typeof def.default || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`A saved world has an invalid value for ${id}.`)
    }
    if (world.values['world.seed'] !== item.seed || recipeIdForLook(world.values['terrain.look']) !== item.recipeId) throw new Error('Saved recipe and seed do not match the world snapshot.')
    const parsed = parseWorld(JSON.stringify(world), defs)
    if (!parsed.ok || parsed.kind !== 'world') throw new Error('The saved world cannot be read.')
    adjusted ||= parsed.skipped.length > 0 || parsed.entries.some(entry => entry.adjusted)
    const values = Object.fromEntries(parsed.entries.map(entry => [entry.id, entry.value]))
    return { id: item.id, savedAt: item.savedAt, recipeId: item.recipeId as RecipeId, seed: item.seed, world: { syn3h: 'world', version: 1, values } }
  })
  return { entries, notice: adjusted ? 'Saved worlds were adjusted to the available settings.' : undefined }
}

/** Restore all world values; newly introduced settings use defaults, never the prior world. */
export function savedWorldPlan(entry: SavedWorld, defs: readonly ParamDef[]): Record<string, ParamValue> {
  const checked = readSavedWorlds(JSON.stringify({ version: 1, entries: [entry] }), defs).entries[0]
  return Object.fromEntries(defs.filter(def => def.scope === 'world').map(def => [def.id, sanitize(def, checked.world.values[def.id] ?? def.default)]))
}

export class SavedWorldStore {
  constructor(private readonly defs: () => readonly ParamDef[], private readonly storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage) {}
  read(): SavedLibrary { return readSavedWorlds(this.storage().getItem(SAVED_WORLDS_KEY), this.defs()) }
  save(values: Record<string, ParamValue>): { entry: SavedWorld; duplicate: boolean } {
    const library = this.read(), defs = this.defs()
    const world = exportWorld(defs, id => values[id])
    const recipeId = recipeIdForLook(world.values['terrain.look']), seed = world.values['world.seed']
    if (!recipeId || typeof seed !== 'number') throw new Error('This world cannot be saved yet.')
    const draft: SavedWorld = { id: crypto.randomUUID(), savedAt: Date.now(), recipeId, seed, world }
    const entry = readSavedWorlds(JSON.stringify({ version: 1, entries: [draft] }), defs).entries[0]
    const existing = library.entries.find(saved => worldIdentity(savedWorldPlan(saved, defs)) === worldIdentity(savedWorldPlan(entry, defs)))
    if (existing) return { entry: existing, duplicate: true }
    if (library.entries.length >= SAVED_WORLDS_MAX) throw new Error('Twelve worlds are saved. Delete one before saving another.')
    this.write([...library.entries, entry])
    return { entry, duplicate: false }
  }
  remove(id: string): void { this.write(this.read().entries.filter(entry => entry.id !== id)) }
  private write(entries: SavedWorld[]): void {
    const text = JSON.stringify({ version: 1, entries })
    if (bytes(text) > MAX_BYTES) throw new Error('The saved world library is full.')
    this.storage().setItem(SAVED_WORLDS_KEY, text)
  }
}
