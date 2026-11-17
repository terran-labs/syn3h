/**
 * At the default storminess the buggy can still be driven at road level: the same throttle
 * and steering, in the default wind from several directions, keep it upright, carry it at least
 * half the still-air distance and turn it the same way, within a quarter turn of the still-air total. How far the
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

/** Heading of a vehicle's nose on the ground plane, radians. */
const headingOf = (q: { x: number; y: number; z: number; w: number }) => {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w))
  return Math.atan2(-fwd.x, -fwd.z)
}

/**
 * Drive straight, then hold full lock. Measured as driven, not as where it ends: a buggy that
 * turns sharply can come all the way round, so the turn is summed step by step (unwrapped) and
 * the path is the distance travelled, not the distance from the start.
 */
function run(f: WindFrame) {
  const h = harness()
  const v = createVehicle(h.game, h.terrain, 'buggy', new THREE.Vector3(0, 1.2, 0))
  v.isLocal = false
  h.step(v, 50)
  const weather = new WeatherSystem(() => h.terrain, () => [v])
  let last = v.body.translation(), lastHeading = headingOf(v.body.rotation()), turned = 0, path = 0
  for (let i = 0; i < 400; i++) {
    v.input.y = 1
    v.input.x = i < 150 ? 0 : 1
    weather.apply(v, f, 1_794_700_000 + i * 0.02, h.terrain)
    h.step(v, 1)
    const p = v.body.translation(), heading = headingOf(v.body.rotation())
    path += Math.hypot(p.x - last.x, p.z - last.z)
    turned += Math.atan2(Math.sin(heading - lastHeading), Math.cos(heading - lastHeading))
    last = p; lastHeading = heading
  }
  const q = v.body.rotation()
  const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).y
  const out = { path, turned, upY }
  v.dispose(); h.world.free()
  return out
}

describe('buggy steering at road level in the default wind', () => {
  it('is the default storminess', () => expect(storminess.def.default).toBe(RECOMMENDED_STORMINESS))

  it('stays upright, keeps going and turns as steered, from any wind direction', () => {
    const still = run(frame(1, 0))
    const results = [1, 2, 3, 4, 5, 6].map((seed) => ({ seed, ...run(frame(seed, RECOMMENDED_STORMINESS)) }))
    console.log('road steering vs still air', JSON.stringify({ path: still.path.toFixed(1), turned: still.turned.toFixed(2), results: results.map((r) => ({ seed: r.seed, path: +r.path.toFixed(1), turned: +r.turned.toFixed(2) })) }))
    // Full lock for five seconds turns the buggy, in still air, whatever the handling preset.
    expect(Math.abs(still.turned)).toBeGreaterThan(0.5)
    for (const r of results) {
      expect(Number.isFinite(r.path + r.turned)).toBe(true)
      expect(r.upY).toBeGreaterThan(0.8)
      expect(r.path).toBeGreaterThan(still.path * 0.5)
      // The same way round, and within a quarter turn of the still-air total: the wind has not taken the wheel.
      expect(Math.sign(r.turned)).toBe(Math.sign(still.turned))
      expect(Math.abs(r.turned - still.turned)).toBeLessThan(Math.PI / 2)
    }
  })
})
