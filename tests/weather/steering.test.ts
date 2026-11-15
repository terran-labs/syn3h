/**
 * At the default storminess the buggy's steering at road level is unchanged within noise:
 * the same throttle and steering run in still air and in the default wind, from several
 * wind directions, end in nearly the same place facing nearly the same way.
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
  const out = { x: p.x, z: p.z, heading: Math.atan2(-fwd.x, -fwd.z) }
  v.dispose(); h.world.free()
  return out
}

describe('buggy steering at road level in the default wind', () => {
  it('is the default storminess', () => expect(storminess.def.default).toBe(RECOMMENDED_STORMINESS))

  it('ends within a metre and two degrees of the still-air run, from any wind direction', () => {
    const still = run(frame(1, 0))
    const results = []
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const windy = run(frame(seed, RECOMMENDED_STORMINESS))
      const dHeading = Math.abs(Math.atan2(Math.sin(windy.heading - still.heading), Math.cos(windy.heading - still.heading))) * 180 / Math.PI
      const dPos = Math.hypot(windy.x - still.x, windy.z - still.z)
      results.push({ seed, dPos: +dPos.toFixed(3), dHeading: +dHeading.toFixed(3) })
    }
    console.log('road steering vs still air', JSON.stringify({ path: Math.hypot(still.x, still.z).toFixed(1), results }))
    for (const r of results) { expect(r.dPos).toBeLessThan(1); expect(r.dHeading).toBeLessThan(2) }
  })
})
