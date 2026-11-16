/**
 * At the default storminess the buggy can still be driven at road level: the same throttle
 * and steering, in the default wind from several directions, keep it upright, carry it at least half
 * the still-air distance and leave it facing within a quarter turn of the still-air run. How far the
 * wind pushes it is tuning (storminess, gusts) and is printed, not pinned.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { initPhysics } from '../../src/core/physics'
import { createVehicle } from '../../src/vehicles'
import { RECOMMENDED_STORMINESS, WeatherSystem, type WindFrame, storminess } from '../../src/world/weather'
import { harness } from '../vehicles2/harness'

beforeAll(initPhysics)

/** Ground 60 m above the sea on a world whose rim is at 230 m: a low road on the volcanic world. */
function frame(seed: number, storm: number): WindFrame {
  return { seed, wrap: 2048, sea: -60, top: 170, storminess: storm, speed: 16, gustiness: 0.5, direction: 0, atmosphere: 1 }
}

function run(f: WindFrame) {
  const h = harness()
  const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 1.2, 0))
  v.isLocal = false
  h.step(v, 50)
  const weather = new WeatherSystem(() => h.terrain, () => [v])
  for (let i = 0; i < 400; i++) {
    v.input.y = 1
    v.input.x = i < 150 ? 0 : 1
    weather.apply(v, f, 1_794_700_000 + i * 0.02, h.terrain)
    h.step(v, 1)
  }
  const p = v.body.translation(), q = v.body.rotation()
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w))
  const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).y
  const out = { x: p.x, z: p.z, heading: Math.atan2(-fwd.x, -fwd.z), upY }
  v.dispose(); h.world.free()
  return out
}

describe('buggy steering at road level in the default wind', () => {
  it('is the default storminess', () => expect(storminess.def.default).toBe(RECOMMENDED_STORMINESS))

  it('stays upright, keeps going and turns as steered, from any wind direction', () => {
    const still = run(frame(1, 0)), path = Math.hypot(still.x, still.z), turn = Math.abs(still.heading)
    const results = [1, 2, 3, 4, 5, 6].map((seed) => ({ seed, ...run(frame(seed, RECOMMENDED_STORMINESS)) }))
    console.log('road steering vs still air', JSON.stringify({ path: path.toFixed(1), heading: still.heading.toFixed(2), results: results.map((r) => ({ seed: r.seed, dPos: +Math.hypot(r.x - still.x, r.z - still.z).toFixed(2), heading: +r.heading.toFixed(2) })) }))
    expect(turn).toBeGreaterThan(0.5)
    for (const r of results) {
      expect(Number.isFinite(r.x + r.z + r.heading)).toBe(true)
      expect(r.upY).toBeGreaterThan(0.8)
      expect(Math.hypot(r.x, r.z)).toBeGreaterThan(path * 0.5)
      // Facing within a quarter turn of the still-air run: the wind has not taken the wheel.
      expect(Math.abs(Math.atan2(Math.sin(r.heading - still.heading), Math.cos(r.heading - still.heading)))).toBeLessThan(Math.PI / 2)
    }
  })
})
