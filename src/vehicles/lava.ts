/**
 * Lava and water handling for the buggies, from Mars Explorer Buggy.js 435-475 ("Floating" and
 * "Diving"). Syn3h commented this out (VhiclBuggy.cs 346-387), but this world has a lava lake,
 * rivers and pools, and pushing each other into them is the game.
 *
 * Kept from the original: the float band (body origin from 3 m under the surface to 0.1 m
 * above), per point skip force that grows 15x with speed and 100x above 15 m/s, the -200 * v
 * per point drag, the lava steering and levelling torques, the 1200 N paddle thrust, the wing
 * lift near the surface, angular drag 2.
 *
 * Changed, and why: the original's buoyancy term is a constant 1.8 * 100 N spread over all
 * points (its depth term always clamps), 180 N against the 294 N weight of a 30 kg buggy, so a
 * slow buggy slowly sank and then drove along the lava bed. Here the static term scales with
 * each point's depth and lifts about 1.6 times the weight when fully under, so a slow buggy
 * floats half submerged; diving pushes up by 1.5 times the weight so a plunge resurfaces.
 */
import * as THREE from 'three/webgpu'
import { defineParam } from '../../shared/params'
import { type UnityBody, signedAngle, unityEulerAngles } from './unityBody'

export const buggyLavaFloat = defineParam({
  id: 'buggy.lavaFloat', label: 'Float on lava', group: 'Buggy', scope: 'world',
  default: true,
})

const tmpP = new THREE.Vector3()
const tmpF = new THREE.Vector3()
const tmpE = new THREE.Vector3()

export interface LavaInput {
  x: number
  y: number
  wingsOpen: boolean
}

/**
 * Apply floating or diving forces. Returns true when the vehicle is in the liquid, in which case
 * the original also set angular drag 2 (done here).
 */
export function applyLava(
  ub: UnityBody,
  points: readonly THREE.Vector3[],
  liquidAt: (x: number, z: number) => number,
  input: LavaInput,
): boolean {
  if (!buggyLavaFloat.value) return false
  const b = ub.body
  const pos = ub.pos
  const h = liquidAt(pos.x, pos.z)
  if (!Number.isFinite(h)) return false
  const mass = b.mass()
  const g = -ub.world.gravity.y
  const weight = mass * g

  // Floating, Buggy.js 436-469.
  if (pos.y < h + 0.1 && pos.y - h > -3) {
    // The original's `hit.distance` here is from a ray cast 3 m above the body down to the surface.
    const hitDistance = pos.y + 3 - h
    if (input.wingsOpen && hitDistance < 2) ub.addForce(tmpF.set(0, 400, 0))
    const e = unityEulerAngles(ub.q, tmpE)
    const roll = signedAngle(e.z)
    const pitch = signedAngle(e.x)
    ub.angularDrag = 2

    const n = points.length
    for (const local of points) {
      tmpP.copy(local).applyQuaternion(ub.q).add(pos)
      const depth = liquidAt(tmpP.x, tmpP.z) - tmpP.y
      if (depth <= 0) continue
      const v = b.velocityAtPoint(tmpP)
      const speed = Math.hypot(v.x, v.y, v.z)
      // Static lift by depth (changed), skip force by speed (original), drag (original).
      const lift = (weight * 1.6 * Math.min(1, depth / 0.5)) / n
      const skip = (1.8 * speed * (speed > 15 ? 100 : 15)) / n
      tmpF.set(-v.x * 200 / n, lift + skip - (v.y * 200) / n, -v.z * 200 / n)
      ub.addForceAtPosition(tmpF, tmpP)
    }
    if (input.y >= 0) {
      ub.addRelativeTorque(
        -input.y * 500 * ((70 - Math.min(70, Math.max(1, -pitch))) / 70),
        input.y * input.x * 300,
        roll * -3 + input.y * input.x * -50,
      )
    }
    if (!input.wingsOpen && hitDistance < 3) ub.addRelativeForce(0, 0, input.y * 1200)
    return true
  }

  // Diving, Buggy.js 472-475: the original's upward push (200, or 400 with wings) was below the
  // buggy's weight; 1.5 times the weight brings it back up to the float band.
  if (pos.y < h) {
    const v = b.linvel()
    ub.addForce(tmpF.set(-v.x * 8, -v.y * 8 + weight * (input.wingsOpen ? 2 : 1.5), -v.z * 8))
    ub.angularDrag = 2
    return true
  }
  return false
}

/**
 * Float points: Mars Explorer's twelve (Buggy.prefab "Floats", scale 0.25), stretched to a
 * body footprint. Our frame: -Z forward.
 */
export function floatPoints(halfWidth: number, halfLength: number, yLow: number, yHigh: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push(new THREE.Vector3(sx * halfWidth * 0.5, yLow, sz * halfLength * 0.875))
    pts.push(new THREE.Vector3(sx * halfWidth * 0.5, yHigh, sz * halfLength * 0.875))
    pts.push(new THREE.Vector3(sx * halfWidth, yLow - 0.2, sz * halfLength))
  }
  return pts
}
