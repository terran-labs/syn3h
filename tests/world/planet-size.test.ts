import { expect, it } from 'vitest'
import { TILE_MAX, TILE_MIN, TILE_STEP, tileSize, WRAP_SIZES } from '../../shared/protocol'
import { shownDef, shownValue, storedValue } from '../../src/ui/inspector/model'
import { terrainPlanetSize } from '../../src/world/terrain/settings'

// Bugs caught: saved rooms and links changing size; a slider value giving a tile the chunk
// grid cannot build (not a whole 256 m); a stored value giving no tile at all.
it('keeps the three old sizes exactly', () => {
  expect([0, 1, 2].map(tileSize)).toEqual([...WRAP_SIZES])
})

it('makes every slider position a whole tile, and shows it as the size it builds', () => {
  const def = terrainPlanetSize.def
  const view = shownDef(def)
  expect([view.min, view.max, view.default]).toEqual([TILE_MIN, TILE_MAX, 2048])
  for (let metres = TILE_MIN; metres <= TILE_MAX; metres += view.step!) {
    const stored = storedValue(def, metres)
    expect(tileSize(stored)).toBe(metres)
    expect(Math.round(shownValue(def, stored))).toBe(metres)
  }
})

it('never gives a tile that is not whole, in range and finite, whatever is stored', () => {
  for (const junk of [NaN, Infinity, -Infinity, -3, 7, 1e300, 'x', '1', null, undefined, {}, 0.123456]) {
    const size = tileSize(junk)
    expect(Number.isFinite(size)).toBe(true)
    expect(size).toBeGreaterThanOrEqual(TILE_MIN)
    expect(size).toBeLessThanOrEqual(TILE_MAX)
    expect(size % TILE_STEP).toBe(0)
  }
})
