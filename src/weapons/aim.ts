/**
 * Where gear points. With the cursor captured on desktop the chase camera orbits with the
 * mouse, and gear goes where the camera looks: a ray from the camera through the middle of
 * the screen finds the point, and the gear leaves its muzzle toward that point, so near and
 * far targets both line up. Otherwise (touch, gamepad, cursor free) it goes straight ahead.
 *
 * Read only use of the camera: the camera itself belongs to the Bots, Performance and QA lane.
 */
import * as THREE from 'three/webgpu'
import type { Game } from '../core/Game'
import { GROUP_ALL, GROUP_LIQUID, GROUP_PROJECTILE, RAPIER, groups } from '../core/physics'
import { laserLifetime, laserSpeed } from './params'

/** Optional input supplied by a bot controller instead of the local keyboard and camera. */
export interface GearControl {
  fire: boolean
  direction: [number, number, number]
}

export interface Aim {
  /** Muzzle: where the gear leaves the vehicle. */
  o: THREE.Vector3
  /** Unit direction of travel. */
  d: THREE.Vector3
  /** What the aim ray found within range, if anything. */
  point: THREE.Vector3 | null
  normal: THREE.Vector3
  /** The body the aim ray found, if any. */
  handle: number | null
}

const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

/** True while the cursor is captured by the game canvas, so mouse movement aims. */
export function cursorAims(game: Game): boolean {
  return typeof document !== 'undefined' && document.pointerLockElement === game.canvas
}

/** Only player input uses camera aim; scripted shots retain their explicit direction. */
export function beamAimDirection(game: Game, body: RAPIER.RigidBody): [number, number, number] | undefined {
  if (!cursorAims(game)) return undefined
  const d = aimFrom(game, body, laserSpeed.value * laserLifetime(laserSpeed.value)).d
  return [d.x, d.y, d.z]
}

/** Cast from `from` along unit `dir`, ignoring `skip`, water and lava surfaces, and sensors. */
export function castAim(game: Game, from: THREE.Vector3, dir: THREE.Vector3, range: number, skip?: RAPIER.RigidBody):
  { point: THREE.Vector3; normal: THREE.Vector3; handle: number | null; toi: number } | null {
  ray.origin = { x: from.x, y: from.y, z: from.z }
  ray.dir = { x: dir.x, y: dir.y, z: dir.z }
  const hit = game.world.castRayAndGetNormal(
    ray, range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(GROUP_PROJECTILE, GROUP_ALL & ~GROUP_LIQUID),
    undefined, skip,
  )
  if (!hit) return null
  const parent = hit.collider.parent()
  return {
    point: from.clone().addScaledVector(dir, hit.timeOfImpact),
    normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    handle: parent && !parent.isFixed() ? parent.handle : null,
    toi: hit.timeOfImpact,
  }
}

/**
 * Aim from a vehicle body. `up` and `ahead` place the muzzle in the vehicle's frame, metres.
 * `lift` tilts the straight-ahead aim upward, radians, for gear that likes to reach high.
 */
export function aimFrom(game: Game, body: RAPIER.RigidBody, range: number, up = 0.4, ahead = 2.4, lift = 0, cameraAim = true): Aim {
  const r = body.rotation()
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w)
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
  const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
  const t = body.translation()
  const o = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(fwd, ahead).addScaledVector(upv, up)
  if (cameraAim && cursorAims(game)) {
    const cam = game.camera
    const from = cam.getWorldPosition(new THREE.Vector3())
    const look = cam.getWorldDirection(new THREE.Vector3())
    const reach = range + from.distanceTo(o)
    const hit = castAim(game, from, look, reach, body)
    // A point behind the muzzle (the camera's ray grazing the vehicle) would aim backwards.
    const target = hit && hit.point.distanceTo(o) > 1.5 ? hit.point : from.clone().addScaledVector(look, reach)
    const d = target.clone().sub(o).normalize()
    const inRange = hit && hit.point.distanceTo(o) <= range
    return { o, d, point: inRange ? hit.point : null, normal: hit?.normal ?? new THREE.Vector3(0, 1, 0), handle: inRange ? hit.handle : null }
  }
  const d = fwd.clone()
  if (lift) d.applyAxisAngle(new THREE.Vector3().crossVectors(fwd, upv).normalize(), lift).normalize()
  const hit = castAim(game, o, d, range, body)
  return { o, d, point: hit?.point ?? null, normal: hit?.normal ?? new THREE.Vector3(0, 1, 0), handle: hit?.handle ?? null }
}
