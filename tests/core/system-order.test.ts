import { describe, expect, it, vi } from 'vitest'
import { Game, type System } from '../../src/core/Game'

/** Exercise registration without constructing a renderer or physics world. */
function harness() {
  const systems: System[] = []
  const game = Object.assign(Object.create(Game.prototype) as Game, { systems, buildMark: 0 })
  return { game, systems }
}

describe('system insertion order', () => {
  it('keeps fresh and cached vehicle poses current before camera and terrain updates', () => {
    const { game, systems } = harness()
    let currentPose = 0, cameraPose = -1, expectedPose = 0
    const vehicle = (): System => ({ update: (_dt, alpha) => { currentPose = expectedPose + alpha } })
    const first = vehicle(), next = vehicle()
    const camera: System = { update: () => { cameraPose = currentPose } }
    const terrain: System = { update: (_dt, alpha) => { expect(cameraPose).toBe(expectedPose + alpha) } }
    game.add(first); game.add(camera); game.add(terrain)
    let current = first
    for (const replacement of [next, first, next, first]) {
      game.add(replacement, current)
      game.remove(current, false)
      expect(systems).toEqual([replacement, camera, terrain])
      current = replacement
      for (const alpha of [0, 0.25, 0.9]) {
        expectedPose += 10
        for (const system of systems) system.update?.(0.02, alpha)
      }
    }
  })

  it('preserves append fallback and existing duplicate registration behavior', () => {
    const { game, systems } = harness()
    const first = { update: vi.fn() }, last = { update: vi.fn() }, absent = { update: vi.fn() }
    expect(game.add(first)).toBe(first)
    game.add(last, absent)
    game.add(first)
    expect(systems).toEqual([first, last, first])
    game.remove(first, false)
    expect(systems).toEqual([last, first])
  })
})
