/**
 * What "back to default" means for a setting, in one place.
 *
 * Most settings go back to their registry default (shared/params.ts). A few start somewhere
 * that depends on this device or on another setting, and their reset must return them there,
 * not to the number in their declaration:
 *  - Tint: each glass style has its own measured tint (glassMaterial.ts).
 *  - Show new chat over the game: off on touch-first devices (chat/overlayPreference.ts).
 * A row can also be given its own default by whoever builds it (the Performance card's
 * fine-tune rows return to the quality level's value); see `ResetTarget`.
 *
 * Nothing here changes a value. Resetting goes through the same setter as dragging, so a
 * shared setting obeys the host's lock exactly as an edit would.
 */
import type { ParamValue } from '../../../shared/params'
import { defaultTint } from '../glassMaterial'
import { touchFirst } from '../chat/overlayPreference'
import type { PropertyDef } from './model'

/** Settings whose default is worked out at the moment of asking. */
const DEVICE_DEFAULTS: Record<string, () => ParamValue> = {
  'hud.surfaceCoverage': () => defaultTint(),
  'chat.overlay': () => !touchFirst(),
}

/**
 * Registered values a row shows but a reset must not touch, with the reason; their rows keep
 * the empty slot. The world's name is given to each new world (a generated name seed), so it
 * is never "at its default" and is an identity, like a player's name, not a preference.
 */
export const NOT_RESET: Readonly<Record<string, string>> = {
  'world.nameSeed': 'the world’s name, given to each new world',
  // A picker that applies a sky preset and returns to 0: an action, not a value to go back to.
  'sky.preset': 'an action that applies a sky preset',
}

/** The value a reset of this setting restores, as stored (not as shown). */
export function defaultOf(def: Pick<PropertyDef, 'id' | 'default'>): ParamValue {
  return DEVICE_DEFAULTS[def.id]?.() ?? def.default
}

/**
 * A row's own idea of its default, for a builder that knows better than the registry. `value`
 * is the stored value a reset restores, or undefined while there is none; `apply` performs the
 * reset when restoring is more than setting one value (clearing a quality override).
 */
export interface ResetTarget {
  value(): ParamValue | undefined
  apply?(): void
}

/** Whether a value counts as changed from its default. Numbers within a hair are the same. */
export function differs(value: ParamValue, target: ParamValue | undefined): boolean {
  if (target === undefined) return false
  if (typeof value === 'number' && typeof target === 'number') return Math.abs(value - target) > 1e-9 * Math.max(1, Math.abs(target))
  return value !== target
}
