/**
 * Headless scenarios for the jet, shared by its invariant tests (tests/vehicles2/jet.test.ts) and
 * the handling report (tools/handling-report.ts). Forward is local -Z. Call initPhysics first.
 */
import * as THREE from 'three/webgpu'
import { FIXED_DT } from '../../src/core/physics'
import { Jet, jetVectorResponse } from '../../src/vehicles/Jet'
import { harness } from './harness'
import { worldGravity } from '../../shared/params'

type Jetbed = ReturnType<typeof harness>

/** A remote-free jet in a bed with no floor, under the world's gravity, at `altitude`, ready for `fn`. Freed afterwards. */
export function withJet<T>(altitude: number, fn: (v: Jet, h: Jetbed) => T, floor = false): T {
  const h = harness(worldGravity.value, floor)
  const v = new Jet(h.game, h.terrain, new THREE.Vector3(0, altitude, 0))
  v.isLocal = false
  try { return fn(v, h) } finally { v.dispose(); h.world.free() }
}

export const jetSpeed = (v: Jet) => {
  const l = v.body.linvel()
  return Math.hypot(l.x, l.y, l.z)
}

/**
 * Pitch or yaw rate (degrees per second) at 12 m/s in flight mode, under the 20 m/s stall speed
 * where the wings have little authority, with the thrust vectoring slider at `vector`.
 */
export const vectorRate = (axis: 'y' | 'w', vector: number) => {
  const old = jetVectorResponse.value
  jetVectorResponse.value = vector
  try {
    return withJet(500, (v, h) => {
      v.input.special = true; v.input.z = 1
      h.step(v, 2)
      v.body.setLinvel({ x: 0, y: 0, z: -12 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      v.input[axis] = -1
      h.step(v, 50)
      const w = v.body.angvel()
      return Math.hypot(w.x, w.y, w.z) * 180 / Math.PI
    })
  } finally { jetVectorResponse.value = old }
}

/** Forward speed (m/s) after `steps` fixed steps at full flight thrust from a standstill high up. */
export const flightSpeedAfter = (steps: number) =>
  withJet(500, (v, h) => {
    v.input.special = true; v.input.z = 1
    h.step(v, steps)
    return -v.body.linvel().z
  })

/** Full flight thrust from a standstill for `seconds`, level flight held by zeroing vertical speed: speed every step. */
export const flightSpeedTrace = (seconds = 120) =>
  withJet(3000, (v, h) => {
    v.input.special = true; v.input.z = 1
    const trace: number[] = []
    for (let t = 0; t < seconds; t += FIXED_DT) {
      h.step(v)
      const l = v.body.linvel()
      v.body.setLinvel({ x: l.x, y: 0, z: l.z }, true)
      trace.push(jetSpeed(v))
    }
    return trace
  })

/** Hover mode: vertical speed (m/s) after one second of full lift and of full descend. */
export const hoverClimb = () => {
  const run = (z: number) => withJet(100, (v, h) => { v.input.z = z; h.step(v, Math.round(1 / FIXED_DT)); return v.body.linvel().y })
  return { up: run(1), down: run(-1) }
}

/** In flight at `speed` m/s, nose pitched up at full input for `seconds`: turn radius v / pitch rate (m). */
export const loopRadius = (speed = 60, seconds = 1) =>
  withJet(1500, (v, h) => {
    v.input.special = true; v.input.z = 1
    h.step(v)
    v.body.setLinvel({ x: 0, y: 0, z: -speed }, true)
    v.input.y = -1
    h.step(v, Math.round(seconds / FIXED_DT))
    const w = v.body.angvel(), rate = Math.hypot(w.x, w.y, w.z)
    return rate > 1e-6 ? jetSpeed(v) / rate : Infinity
  })

/** Flight at `speed` m/s with brakes held and no thrust: metres travelled until under 1 m/s (or after 60 s). */
export const flightBrakeDistance = (speed = 60) =>
  withJet(3000, (v, h) => {
    v.input.special = true
    h.step(v)
    v.body.setLinvel({ x: 0, y: 0, z: -speed }, true)
    v.input.brakes = true
    let d = 0
    for (let t = 0; t < 60 && jetSpeed(v) > 1; t += FIXED_DT) {
      h.step(v)
      const l = v.body.linvel()
      v.body.setLinvel({ x: l.x, y: 0, z: l.z }, true)
      d += Math.hypot(l.x, l.z) * FIXED_DT
    }
    return d
  })
