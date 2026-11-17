/**
 * Handling presets: named sets of values for a vehicle's existing handling settings, one
 * table per vehicle next to its parameters. Nothing new is stored or sent: choosing a preset
 * sets its settings like moving their sliders (so room sync, host and lock rules apply), and
 * the preset in use is worked out by comparing the current values with each preset's.
 */
import { params, type ParamValue } from './params'

export interface HandlingPreset {
  name: string
  /** One line, in plain words, shown under the dropdown. */
  description: string
  values: Readonly<Record<string, ParamValue>>
}

const registry = new Map<string, readonly HandlingPreset[]>()

/** Register a vehicle's presets under its settings group ('Buggy', 'Jet', ...). */
export function definePresets(group: string, presets: readonly HandlingPreset[]): readonly HandlingPreset[] {
  registry.set(group, presets)
  return presets
}

export function presetsFor(group: string): readonly HandlingPreset[] { return registry.get(group) ?? [] }

/** A preset of the given settings at their declared defaults. */
export function defaultPreset(ids: readonly string[], name = 'Default', description = 'The standard handling.'): HandlingPreset {
  return { name, description, values: Object.fromEntries(ids.map(id => [id, params.get(id)!.def.default])) }
}

const same = (a: ParamValue | undefined, b: ParamValue) => typeof b === 'number' ? typeof a === 'number' && Math.abs(a - b) < 1e-9 : a === b

/** The first preset every one of whose values matches, or null for Custom. */
export function matchPreset(presets: readonly HandlingPreset[], value: (id: string) => ParamValue | undefined): HandlingPreset | null {
  return presets.find(preset => Object.entries(preset.values).every(([id, v]) => same(value(id), v))) ?? null
}

/** Set a preset's values, as if each slider had been moved. */
export function applyPreset(preset: HandlingPreset): void {
  for (const [id, value] of Object.entries(preset.values)) if (params.get(id)) params.set(id, value, 'local')
}
