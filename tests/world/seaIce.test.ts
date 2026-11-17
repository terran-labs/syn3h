import { beforeAll, describe, expect, it } from 'vitest'
import { RAPIER, createWorld, initPhysics } from '../../src/core/physics'
import { createTerrainCollider } from '../../src/world/terrain/collider'
import { generateTerrain } from '../../src/world/terrain/generate'
import { createSeaIceCollider, SEA_ICE_FRICTION } from '../../src/world/terrain/seaIce'
import { settingsForRecipe, paintPlanetMap } from '../../src/world/planetMap'
import { PLANETS } from '../../src/world/planets'

beforeAll(initPhysics)

describe('the Ice Moon', () => {
  const recipe = PLANETS.find(p => p.id === 'ice')!
  it('a vehicle on its frozen sea rests on the ice, at the sea level, and does not sink', () => {
    const data = generateTerrain(7, settingsForRecipe(recipe), { resolution: 129 })
    // A point well out to sea: the deepest sample.
    let deepest = 0
    for (let i = 1; i < data.heights.length; i++) if (data.heights[i] < data.heights[deepest]) deepest = i
    expect(data.heights[deepest]).toBeLessThan(-3)
    const n = data.resolution, x = -data.size / 2 + (deepest % n) * data.cell, z = -data.size / 2 + Math.floor(deepest / n) * data.cell
    const world = createWorld(9.81)
    createTerrainCollider(world, data)
    const ice = createSeaIceCollider(world, data, 0, 0, 0)
    expect(ice.friction()).toBeCloseTo(SEA_ICE_FRICTION, 5)
    // A buggy-sized box dropped from 3 m: it lands on the ice and stays there.
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 3, z))
    world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 2).setMass(900), body)
    for (let step = 0; step < 600; step++) world.step()
    const y = body.translation().y
    expect(Number.isFinite(y)).toBe(true)
    expect(y).toBeGreaterThan(0.4)
    expect(y).toBeLessThan(0.6)
    expect(Math.abs(body.linvel().y)).toBeLessThan(0.05)
  })
  it('looks frozen from space: white and pale, not a blue world', () => {
    const map = paintPlanetMap('ice', 90210, 256, 128, { 'world.seaFrozen': true })
    let blue = 0, total = 0
    for (let o = 0; o < map.data.length; o += 4 * 7) {
      const r = map.data[o], g = map.data[o + 1], b = map.data[o + 2]
      total++
      if (b > r + 40 && b > g + 15) blue++
    }
    expect(blue / total).toBeLessThan(0.2)
  })
})
