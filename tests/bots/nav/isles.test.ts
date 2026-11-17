/**
 * Bug caught: a ground bot planning a route across open water to an isle it cannot reach,
 * then driving into the channel. Hovercraft and jets may cross.
 */
import { describe, expect, it } from 'vitest'
import { createNavigator } from '../../../src/bots/nav/grid'
import { AIR, GROUND, HOVER, island } from './fixtures'

describe('isles', () => {
  it('are out of reach of ground vehicles from the home island, and reachable over the water', () => {
    const t = island('archipelago', 7)
    const start = t.spawnPoint(0).position
    const isles = [...t.data.layout.isles].sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z))
    expect(isles.length).toBeGreaterThan(0)
    const goal = { x: isles[0].x, z: isles[0].z }
    const nav = createNavigator(t)
    const ground = nav.route(start, goal, GROUND)!
    expect(ground.reached).toBe(false)
    // Where it gives up is dry land on the home island, short of the channel.
    for (const p of ground.points) expect(t.heightAt(p.x, p.z), `${p.x} ${p.z}`).toBeGreaterThan(t.liquidHeightAt!(p.x, p.z))
    // A hovercraft crosses the channel to the isle's near shore; a jet flies to its middle.
    const len = Math.hypot(goal.x - start.x, goal.z - start.z)
    const shore = { x: goal.x - (goal.x - start.x) / len * isles[0].radius * 0.75, z: goal.z - (goal.z - start.z) / len * isles[0].radius * 0.75 }
    expect(t.heightAt(shore.x, shore.z)).toBeGreaterThan(t.liquidHeightAt!(shore.x, shore.z))
    // Reached as the bots' mind counts it (Mind.ts): the route ends within 25 m of the place.
    const hover = nav.route(start, shore, HOVER)!, end = hover.points[hover.points.length - 1]
    expect(hover.reached || Math.hypot(end.x - shore.x, end.z - shore.z) <= 25).toBe(true)
    expect(nav.route(start, goal, AIR)!.reached).toBe(true)
  })
})
