/**
 * Parameter registry: the spine of the game.
 *
 * Every tunable value (physics, vehicle, sky, terrain, network) is declared once with
 * `defineParam`. The declaration drives the slider UI, the network sync, saved presets and
 * the simulation. This file has no browser or Node dependencies so the server can import it
 * to validate and clamp values.
 *
 * Scope:
 *  - 'world'  shared by everyone in a room, synced through the server
 *  - 'client' personal (graphics quality, camera), never sent
 */

export type ParamValue = number | boolean

export interface ParamDef<T extends ParamValue = ParamValue> {
  /** Unique dotted id, e.g. 'buggy.traction'. Also the wire key. */
  id: string
  label: string
  /** UI folder, e.g. 'Buggy'. */
  group: string
  scope: 'world' | 'client'
  default: T
  /** Numbers only. */
  min?: number
  max?: number
  step?: number
  /** Apply when the slider is released, not while dragging (e.g. terrain regeneration). */
  deferred?: boolean
  /**
   * Numbers only: how the settings UI shows and takes the value, without changing what is
   * stored or sent. Shown = (value - offset) * scale; a negative scale reverses the slider.
   */
  display?: { offset: number; scale: number }
}

export interface Param<T extends ParamValue> {
  readonly def: ParamDef<T>
  /** Current value. Cheap enough to read every physics step. */
  value: T
}

export type ParamSource = 'local' | 'remote' | 'preset'
export type ParamListener = (id: string, value: ParamValue, source: ParamSource) => void

const registry = new Map<string, Param<ParamValue>>()
const listeners = new Set<ParamListener>()

/** Clamp and coerce a raw value to what the definition allows. */
export function sanitize(def: ParamDef, raw: unknown): ParamValue {
  if (typeof def.default === 'boolean') return Boolean(raw)
  let n = Number(raw)
  if (!Number.isFinite(n)) n = def.default as number
  if (def.min !== undefined && def.max !== undefined) {
    // Some original Mars Explorer sliders run high to low, so order the bounds first.
    const lo = Math.min(def.min, def.max)
    const hi = Math.max(def.min, def.max)
    n = Math.min(hi, Math.max(lo, n))
  }
  return n
}

/** Declare a parameter. Safe to call again with the same id (hot reload): returns the existing one. */
export function defineParam<T extends ParamValue>(def: ParamDef<T>): Param<T> {
  const existing = registry.get(def.id)
  if (existing) return existing as unknown as Param<T>
  const param = { def, value: def.default } as Param<T>
  registry.set(def.id, param as unknown as Param<ParamValue>)
  return param
}

export const params = {
  all(): Param<ParamValue>[] {
    return [...registry.values()]
  },
  get(id: string): Param<ParamValue> | undefined {
    return registry.get(id)
  },
  /** Set a value. Returns false if the id is unknown or the value did not change. */
  set(id: string, raw: unknown, source: ParamSource = 'local'): boolean {
    const p = registry.get(id)
    if (!p) return false
    const v = sanitize(p.def, raw)
    if (v === p.value) return false
    p.value = v
    for (const l of listeners) l(id, v, source)
    return true
  },
  onChange(listener: ParamListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** All shared values, for late joiners and presets. */
  snapshot(scope: 'world' | 'client' | 'all' = 'world'): Record<string, ParamValue> {
    const out: Record<string, ParamValue> = {}
    for (const p of registry.values()) {
      if (scope === 'all' || p.def.scope === scope) out[p.def.id] = p.value
    }
    return out
  },
  applySnapshot(values: Record<string, unknown>, source: ParamSource = 'remote'): void {
    for (const id in values) this.set(id, values[id], source)
  },
}

// ---------------------------------------------------------------------------------------
// Core world parameters. Feature modules define their own next to the code that reads them.
// ---------------------------------------------------------------------------------------

/** Positive number, metres per second squared, pulling down. Original range 0.81 to 18.81. */
export const worldGravity = defineParam({
  id: 'world.gravity', label: 'Gravity', group: 'World', scope: 'world',
  default: 9.81, min: 0.81, max: 18.81, step: 0.01,
})

/** Altitude of the lava or sea surface in metres. */
export const worldLavaAltitude = defineParam({
  id: 'world.lavaAltitude', label: 'Sea level', group: 'World', scope: 'world',
  default: 0, min: -80, max: 60, step: 0.5,
})

/** Shared terrain seed. A world is a seed plus a parameter set. */
export const worldSeed = defineParam({
  id: 'world.seed', label: 'Seed', group: 'World', scope: 'world',
  default: 1, min: 1, max: 999999, step: 1, deferred: true,
})
