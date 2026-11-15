import { beforeAll, expect, it } from 'vitest'
import * as T from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { harness } from './harness'
import { generateTerrain } from '../../src/world/terrain/generate'
import { defaultTerrainSettings } from '../../src/world/terrain/settings'
import { HeightSampler } from '../../src/world/terrain/sampler'
import { createTerrainCollider } from '../../src/world/terrain/collider'
import { lavaSurfaceAt } from '../../src/world/terrain/lava'
import { spawnPointAt } from '../../src/world/terrain/spawn'

/**
 * Cost and path record for the assisted hovercraft on real generated terrain.
 *
 * The drive is the island route from hover-island.test.ts. It reports the craft's own
 * simulation time per fixed step (forces, clearance guard and render update, excluding the
 * physics solver) and how many terrain height lookups that needed. Timing is printed, never
 * asserted; the lookup count is deterministic and is the budget. Before the coarse clearance
 * pass this drive took 473 lookups and about 229 microseconds per step; after, 86 and 33,
 * with the path below unchanged to six decimals (15 Nov 2026, seed 1).
 * Run with HOVER_COST=1 to print the cost and HOVER_PATH=1 to print the path, and compare
 * the path before and after any change to the glide or its guard.
 */
beforeAll(initPhysics)

function drive(seed: number) {
  const h = harness(9.81, false), data = generateTerrain(seed, defaultTerrainSettings()), sampler = new HeightSampler(data)
  let lookups = 0
  h.terrain.heightAt = (x, z) => { lookups++; return sampler.heightAt(x, z) }
  h.terrain.normalAt = (x, z, out) => sampler.normalAt(x, z, out)
  h.terrain.liquidHeightAt = (x, z) => lavaSurfaceAt(data.lava, x, z, 0)
  createTerrainCollider(h.world, data); h.world.step()
  const spawn = spawnPointAt(sampler, 0), v = new Hovercraft(h.game, h.terrain, new T.Vector3(spawn.x, spawn.y, spawn.z), spawn.heading)
  v.isLocal = false; v.input.y = 1
  const path: number[] = []
  let own = 0
  for (let i = 0; i < 1000; i++) {
    v.input.x = i >= 350 && i < 425 ? -1 : i >= 600 && i < 675 ? 1 : 0
    let t = performance.now()
    v.fixedUpdate(1 / 50); own += performance.now() - t
    h.world.step()
    t = performance.now()
    v.postPhysics(1 / 50); v.update(.02, .5); own += performance.now() - t
    if (i % 100 === 99) { const p = v.body.translation(), o = v.object.position; path.push(p.x, p.y, p.z, o.y) }
  }
  const corrections = v.clearanceCorrections
  v.dispose(); h.world.free()
  return { path, own, lookups, corrections }
}

it('follows the recorded island path and reports its simulation cost', () => {
  const first = drive(1)
  // Warm run for timing; the first includes JIT warm-up.
  const second = drive(1)
  expect(second.path).toEqual(first.path)
  if (process.env.HOVER_COST) console.log(`hover cost: ${(second.own / 1000 * 1000).toFixed(1)} us/step, ${second.lookups / 1000} height lookups/step, ${second.corrections} corrections`)
  if (process.env.HOVER_PATH) console.log('hover path: ' + JSON.stringify(first.path.map(n => +n.toFixed(6))))
  expect(first.path.every(Number.isFinite)).toBe(true)
  // Four glide samples plus two coarse guard passes is 74; steep ground adds full passes.
  expect(second.lookups / 1000).toBeLessThan(130)
}, 60000)
