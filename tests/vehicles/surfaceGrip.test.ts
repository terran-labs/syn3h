/** Per-surface tyre grip: ice must not drive like tarmac, and the buggy must still steer on it. */
import { afterEach, beforeAll, expect, it } from 'vitest'
import { initPhysics } from '../../src/core/physics'
import { surfaceGrip } from '../../src/vehicles/surfaceGrip'
import { courseChange, ground, resetParams, speed, spawn } from './miraScenarios'

beforeAll(initPhysics)
afterEach(() => { ground.surface = undefined; resetParams() })

/** Metres to stop from 25 m/s on the bed's surface. */
async function brake() {
  const { bed, b } = await spawn()
  bed.run(1)
  b.input.y = 1
  for (let t = 0; speed(b) < 25 && t < 30; t += 0.02) bed.run(0.02)
  const z0 = b.body.translation().z
  b.input.y = 0
  b.input.brakes = true
  for (let t = 0; speed(b) > 0.5 && t < 20; t += 0.02) bed.run(0.02)
  return Math.abs(b.body.translation().z - z0)
}

it('ice stops a buggy in a longer distance than dry ground, whenever it grips less', async () => {
  expect(surfaceGrip.ice.value).toBeLessThan(1)
  const dry = await brake()
  ground.surface = 'ice'
  expect(await brake()).toBeGreaterThan(dry * 1.2)
})

it('a buggy still turns on ice', async () => {
  ground.surface = 'ice'
  const { after1, upright } = await courseChange(25)
  expect(after1).toBeGreaterThan(5)
  expect(upright).toBeGreaterThan(0.5)
})
