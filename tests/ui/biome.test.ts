import { expect, it } from 'vitest'
import { choicesOf } from '../../src/ui/inspector/Inspector'
import { terrainLook } from '../../src/world/terrain/settings'
import { PLANETS } from '../../src/world/planets'
import { BIOME_NAMES, RECIPE_IDS } from '../../shared/recipes'

// Bug caught: renaming "look" to "biome" must not change what is stored, or saved worlds,
// links and older clients would load the wrong planet.
it('shows the biome as named choices while keeping its id and stored numbers', () => {
  expect(terrainLook.def.id).toBe('terrain.look')
  const choices = choicesOf(terrainLook.def)
  expect(choices?.name).toBe('Biome')
  expect(choices?.options.map(o => o.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  // One name per biome, taken from the shared list.
  expect(choices?.options.map(o => o.label)).toEqual([...BIOME_NAMES])
  expect(BIOME_NAMES.length).toBe(RECIPE_IDS.length)
  // Each recipe still names its biome by the same number, in recipe order.
  expect(PLANETS.map(p => p.values['terrain.look'])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  expect(terrainLook.def.label).not.toMatch(/look/i)
})
