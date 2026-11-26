// A bot holding a place stays there. Bug this catches: a hovering jet bot run in to its hold at
// cruise speed, overshooting about 30 m and swinging 4 to 34 m round it at up to 14 m/s for as
// long as it held (25 November 2026): Mind asked it to stop only once inside 0.6 of the radius.
import { beforeAll, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { FIXED_DT, initPhysics } from '../../../src/core/physics'
import { Jet } from '../../../src/vehicles/Jet'
import { MiraBuggy } from '../../../src/vehicles/MiraBuggy'
import { Hovercraft } from '../../../src/vehicles/Hovercraft'
import { Mind } from '../../../src/bots/mind/Mind'
import { createNavigator } from '../../../src/bots/nav'
import { createPilot } from '../../../src/bots/pilot'
import { createJetPilot, jetPilotTuning } from '../../../src/bots/pilot/jet'
import { testWorld } from './world'

beforeAll(initPhysics)

/**
 * The fastest a holding jet may move once it has arrived: what its own stopping profile allows
 * at the edge of the stop zone (Mind caps the approach to sqrt(2 a d) + 1 with d measured to
 * 0.6 of the radius), at the edge of the hold itself.
 */
const zoneSpeed = (radius: number) => Math.sqrt(2 * jetPilotTuning.stopAccel * radius * 0.4) + 1
/** How long after first entering the radius it may take to slow to that: v / a, twice over. */
const settleTime = (radius: number) => 2 * zoneSpeed(radius) / jetPilotTuning.stopAccel
/** At rest: under this ground speed, m/s, over the hold's last ten seconds. */
const STILL = 1

it('a hovering jet bot comes to its hold and stays inside it', () => {
  const w = testWorld(() => 0, 800, 4)
  const v = new Jet(w.game, w.terrain, new THREE.Vector3(0, 2, 0), 0); v.isLocal = false
  const navigator = createNavigator(w.terrain), pilot = createJetPilot(v, w.terrain)
  const mind = new Mind(v, w.terrain, pilot, { seed: 'hover-hold', navigator })
  const radius = 8, place = { x: 0, z: -160 }
  mind.hold(place, radius, 120)
  let entered = -1, worst = 0, fastest = 0, last = 0
  const steps = 3500
  try {
    for (let i = 0; i < steps; i++) {
      mind.step(FIXED_DT, v.input); v.fixedUpdate(FIXED_DT); w.world.step(); v.postPhysics(FIXED_DT)
      const p = v.body.translation(), u = v.body.linvel(), t = i * FIXED_DT
      const distance = Math.hypot(p.x - place.x, p.z - place.z)
      if (entered < 0 && distance < radius) entered = t
      const speed = Math.hypot(u.x, u.z)
      if (entered >= 0 && t > entered + settleTime(radius)) { worst = Math.max(worst, distance); fastest = Math.max(fastest, speed) }
      if (t > (steps * FIXED_DT) - 10) last = Math.max(last, speed)
    }
    expect(entered).toBeGreaterThan(0)
    // At least twenty seconds of holding were judged.
    expect(steps * FIXED_DT - entered - settleTime(radius)).toBeGreaterThan(20)
    // Arrived, it stays in the hold and never runs faster than its own stop allows there,
    // and it comes to rest rather than circling.
    expect(worst).toBeLessThan(radius)
    expect(fastest).toBeLessThan(zoneSpeed(radius))
    expect(last).toBeLessThan(STILL)
  } finally { navigator.dispose(); w.free() }
}, 30000)

it('leaves ground vehicles to approach a hold as they always have', () => {
  const w = testWorld(() => 0, 400, 4)
  try {
    // No declared stopping deceleration, so Mind does not cap their approach.
    for (const v of [new MiraBuggy(w.game, w.terrain, new THREE.Vector3(0, 1, 0)), new Hovercraft(w.game, w.terrain, new THREE.Vector3(10, 1, 0), 0)]) {
      expect(createPilot(v, w.terrain)!.profile.stopAccel).toBeUndefined()
    }
    // The jet declares its own, read live from its tuning.
    const jet = new Jet(w.game, w.terrain, new THREE.Vector3(20, 2, 0), 0)
    expect(createJetPilot(jet, w.terrain).profile.stopAccel).toBe(jetPilotTuning.stopAccel)
  } finally { w.free() }
})
