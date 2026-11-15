import { describe, expect, it } from 'vitest'
import type { TerrainRoadPath } from '../../../src/world/Terrain'
import { createNavigator } from '../../../src/bots/nav'
import { isRoadFord } from '../../../src/bots/nav/fords'
import { isSafeGround } from '../../../src/bots/BotBrain'
import { GROUND, synthetic } from './fixtures'

function crossing(depth = 0.35, marked = true) {
  const road: TerrainRoadPath = {
    kind: 'plain', closed: false, width: 14,
    points: [-24, -16, -8, 0, 8, 16, 24].map(x => ({ x, y: 0, z: 4 })),
    fords: marked ? [{ start: 2, end: 4, depth }] : [],
  }
  const t = synthetic(128, () => 0, { liquid: x => Math.abs(x) <= 8 ? depth : -Infinity, roads: [road], wrapSize: 128 })
  t.liquidKindAt = x => Math.abs(x) <= 8 ? 'water' : null
  return t
}

describe('marked road fords', () => {
  it('plans through shallow marked water, including its banks', () => {
    const t = crossing(), nav = createNavigator(t)
    expect(nav.passable(0, 4, GROUND)).toBe(true)
    expect(isSafeGround(t, 0, 4)).toBe(true)
    const route = nav.route({ x: -40, z: 4 }, { x: 40, z: 4 }, GROUND)
    expect(route?.reached).toBe(true)
    for (const p of route!.points) expect(nav.passable(p.x, p.z, GROUND)).toBe(true)
    nav.dispose()
  })
  it('rejects disabled fords, deep crossings, lava and water outside the road', () => {
    expect(isRoadFord(crossing(0.35, false), 0, 4)).toBe(false)
    expect(isRoadFord(crossing(0.8), 0, 4)).toBe(false)
    const t = crossing()
    expect(isRoadFord(t, 0, 15)).toBe(false)
    t.liquidKindAt = () => 'lava'
    expect(isRoadFord(t, 0, 4)).toBe(false)
    expect(createNavigator(t).passable(0, 4, GROUND)).toBe(false)
  })
  it('checks actual depth and refreshes after regenerated roads', () => {
    const t = crossing(), nav = createNavigator(t)
    expect(nav.passable(0, 4, GROUND)).toBe(true)
    t.liquidHeightAt = () => 2
    expect(nav.passable(0, 4, GROUND)).toBe(false)
    t.liquidHeightAt = x => Math.abs(x) <= 8 ? 0.35 : -Infinity
    t.roadPaths = () => []
    t.regenerate()
    expect(nav.passable(0, 4, GROUND)).toBe(false)
    expect(nav.route({ x: -40, z: 4 }, { x: 40, z: 4 }, GROUND)?.reached).toBe(false)
    nav.dispose()
  })
  it('recognizes the same crossing across the world seam', () => {
    expect(isRoadFord(crossing(), 128, 4)).toBe(false) // fixture liquid does not wrap
    const t = crossing()
    t.liquidHeightAt = () => 0.35
    t.liquidKindAt = () => 'water'
    expect(isRoadFord(t, 128, 4)).toBe(true)
  })
})
