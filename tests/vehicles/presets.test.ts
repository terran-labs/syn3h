/** Handling presets (shared/presets.ts): what the dropdown promises must stay true. */
import { afterEach, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { applyPreset, matchPreset, presetsFor } from '../../shared/presets'
import '../../src/vehicles/buggyParams'
import '../../src/vehicles/Jet'
import '../../src/vehicles/Hovercraft'
import '../../src/vehicles/Tank'
import { resetParams } from './miraScenarios'

const GROUPS = ['Buggy', 'Jet', 'Hovercraft', 'Tank']
const current = (id: string) => params.get(id)?.value

afterEach(resetParams)

describe.each(GROUPS)('%s presets', (group) => {
  const presets = presetsFor(group)

  it('exist, are named once each, and set the same settings', () => {
    expect(presets.length).toBeGreaterThan(0)
    expect(new Set(presets.map(p => p.name)).size).toBe(presets.length)
    const ids = Object.keys(presets[0].values).sort()
    for (const preset of presets) expect(Object.keys(preset.values).sort()).toEqual(ids)
  })

  it('only hold values each setting accepts', () => {
    for (const preset of presets) for (const [id, value] of Object.entries(preset.values)) {
      const def = params.get(id)?.def
      expect(def, `${preset.name}: ${id} is a setting`).toBeDefined()
      expect(def!.group, `${preset.name}: ${id} belongs to ${group}`).toBe(group)
      expect(typeof value).toBe(typeof def!.default)
      if (typeof value === 'number') {
        expect(value).toBeGreaterThanOrEqual(Math.min(def!.min!, def!.max!))
        expect(value).toBeLessThanOrEqual(Math.max(def!.min!, def!.max!))
      }
    }
  })

  it('the defaults are the first preset', () => {
    expect(matchPreset(presets, current)).toBe(presets[0])
  })

  it('choosing a preset sets exactly its values, and a changed slider shows Custom', () => {
    for (const preset of presets) {
      resetParams()
      const untouched = Object.fromEntries(params.all().filter(p => !(p.def.id in preset.values)).map(p => [p.def.id, p.value]))
      applyPreset(preset)
      for (const [id, value] of Object.entries(preset.values)) expect(current(id), `${preset.name}: ${id}`).toBe(value)
      for (const [id, value] of Object.entries(untouched)) expect(current(id), `${preset.name} leaves ${id}`).toBe(value)
      expect(matchPreset(presets, current)?.name).toBe(preset.name)
      const [id] = Object.keys(preset.values), def = params.get(id)!.def
      params.set(id, typeof def.default === 'boolean' ? !current(id) : (current(id) as number) === def.min ? def.max! : def.min!)
      // Unless the change happens to land on another preset, which is then shown.
      const shown = matchPreset(presets, current)
      if (shown) expect(Object.entries(shown.values).every(([k, v]) => current(k) === v)).toBe(true)
      else expect(shown).toBeNull()
    }
  })
})
