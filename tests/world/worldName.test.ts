import { describe, expect, it } from 'vitest'
import { params, worldNameSeed, worldSeed } from '../../shared/params'
import { applyPlanet, currentWorldName, decodeWorld, encodeWorld } from '../../src/world/planets'
import { generatedWorldName, nameSeedKeptAcross, seedName, worldName } from '../../src/world/worldName'
import { lobbyLook } from '../../src/world/lobbyLook'
import { PLANETS } from '../../src/world/planets'

describe('world names', () => {
  it('are the same for every client: a pure function of the name setting', () => {
    for (const n of [1, 42, 999999998]) expect(generatedWorldName(n)).toBe(generatedWorldName(n))
    expect(new Set(Array.from({ length: 2000 }, (_, i) => generatedWorldName(i + 1))).size).toBeGreaterThan(1900)
    for (let i = 1; i < 2000; i++) expect(generatedWorldName(i)).toMatch(/^[A-Z][a-z]{2,13}( [IVX]+| [A-Z][a-z]+)?$/)
  })
  it('do not change when the seed changes, and travel in a link', () => {
    applyPlanet('alpine', 1234, { nameSeed: 77 })
    const name = currentWorldName()
    params.set(worldSeed.def.id, 4321)
    expect(currentWorldName()).toBe(name)
    // A world named by its seed (saved before names had a setting) is pinned to it first.
    applyPlanet('alpine', 1234)
    const old = currentWorldName()
    expect(old).toBe(seedName(1234))
    params.set(worldNameSeed.def.id, nameSeedKeptAcross(worldNameSeed.value, worldSeed.value)); params.set(worldSeed.def.id, 999)
    expect(currentWorldName()).toBe(old)
    // A share link carries the name.
    applyPlanet('desert', 55, { nameSeed: 9001 })
    const link = encodeWorld()
    applyPlanet('moon', 1)
    expect(decodeWorld(link)).toBe(true)
    expect(currentWorldName()).toBe(generatedWorldName(9001))
    // A world rolled afresh gets a name of its own.
    applyPlanet('badlands')
    expect(worldNameSeed.value).toBeGreaterThan(0)
    expect(currentWorldName()).toBe(worldName(worldNameSeed.value, worldSeed.value))
  })
})

describe('worlds from space', () => {
  it('give air only to worlds that have it, and cloud only where the recipe has weather', () => {
    for (const recipe of PLANETS) {
      const look = lobbyLook(recipe.id)
      if (recipe.id === 'moon') { expect(look.airDepth).toBe(0); expect(look.cloud).toBe(0) } else expect(look.airDepth).toBeGreaterThan(0)
      expect(look.night).toBe(recipe.values['world.seaKind'] === 0 ? 1 : recipe.id === 'swamp' ? 2 : 0)
    }
  })
})
