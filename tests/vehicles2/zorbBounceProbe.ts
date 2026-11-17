/**
 * Zorb bounce and hop measurements (src/vehicles/zorb.ts), headless with real Rapier. Shared by
 * zorb-bounce.test.ts (invariants) and tools/zorb-bounce-report.ts (the numbers for the
 * handling report). Heights are of the ball's base above the ground under it.
 */
import * as THREE from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { FIXED_DT, GROUP_ALL, GROUP_TERRAIN, RAPIER, createWorld, groups } from '../../src/core/physics'
import { createVehicle, type VehicleKind } from '../../src/vehicles'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import type { Terrain } from '../../src/world/Terrain'

export type Ground = 'flat' | 'slope' | 'ledge' | 'water' | 'lava'
const SLOPE = 20 * Math.PI / 180

/** A world with flat ground, a 20 degree slope rising toward -x, or a 10 m ledge (high for x < 0). */
export function world(ground: Ground = 'flat', gravity = 9.81) {
  const physics = createWorld(gravity)
  const add = (desc: RAPIER.ColliderDesc) => physics.createCollider(desc.setCollisionGroups(groups(GROUP_TERRAIN, GROUP_ALL)))
  let heightAt = (_x: number, _z: number) => 0
  // A sea 20 m deep with its surface at 0.
  if (ground === 'water' || ground === 'lava') add(RAPIER.ColliderDesc.cuboid(2000, .5, 2000).setTranslation(0, -20.5, 0))
  if (ground === 'flat') add(RAPIER.ColliderDesc.cuboid(2000, .5, 2000).setTranslation(0, -.5, 0))
  if (ground === 'ledge') {
    add(RAPIER.ColliderDesc.cuboid(500, 5, 500).setTranslation(-500, 5, 0))
    add(RAPIER.ColliderDesc.cuboid(2000, .5, 2000).setTranslation(0, -.5, 0))
    heightAt = (x) => (x < 0 ? 10 : 0)
  }
  if (ground === 'slope') {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -SLOPE)
    add(RAPIER.ColliderDesc.cuboid(2000, .5, 2000).setRotation(q).setTranslation(.5 * Math.sin(SLOPE), -.5 * Math.cos(SLOPE), 0))
    heightAt = (x) => -x * Math.tan(SLOPE)
  }
  const normal = ground === 'slope' ? new THREE.Vector3(Math.sin(SLOPE), Math.cos(SLOPE), 0) : new THREE.Vector3(0, 1, 0)
  const game = { world: physics, scene: new THREE.Scene(), input: { state: emptyInput() } } as unknown as Game
  const liquid = ground === 'water' || ground === 'lava'
  if (liquid) heightAt = () => -20
  const terrain = { size: 4000, heightAt, ...(liquid ? { liquidHeightAt: () => 0, liquidKindAt: () => ground } : {}), normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.copy(normal), spawnPoint: () => ({ position: new THREE.Vector3(0, 2, 0), heading: 0 }), dispose() {} } as unknown as Terrain
  physics.step()
  return { physics, game, terrain, heightAt }
}

export interface Ride {
  v: Vehicle
  step(n?: number): void
  /** Ball base above the ground under it. */
  height(): number
  done(): void
}

/** A zorbed vehicle, grown to full size and settled. */
export function ride(ground: Ground = 'flat', kind: VehicleKind = 'buggy', at = new THREE.Vector3(0, 2, 0), gravity = 9.81): Ride {
  const w = world(ground, gravity)
  if (ground !== 'flat') at.y = w.heightAt(at.x, at.z) + 2
  const v = createVehicle(w.game, w.terrain, kind, at)
  v.isLocal = false
  const step = (n = 1) => { for (let i = 0; i < n; i++) { v.fixedUpdate(FIXED_DT); w.physics.step(); v.postPhysics(FIXED_DT) } }
  v.input.zorb = true
  step(400)
  const c = new THREE.Vector3()
  const height = () => { v.zorb.centre(c); return c.y - v.zorb.radius - w.heightAt(c.x, c.z) }
  return { v, step, height, done() { v.dispose(); w.physics.free() } }
}

/** Put the ball's base `h` metres above the ground at x, z, at rest (or with velocity `vel`). */
export function place(r: Ride, h: number, vel = { x: 0, y: 0, z: 0 }, x = 0, z = 0, ground = 0): void {
  const c = r.v.zorb.centre(new THREE.Vector3()), t = r.v.body.translation()
  r.v.body.setTranslation({ x: x + (t.x - c.x), y: ground + h + r.v.zorb.radius + (t.y - c.y), z: z + (t.z - c.z) }, true)
  r.v.body.setLinvel(vel, true)
  r.v.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
}

/** Successive peak heights after the first touchdown, for up to `seconds`. */
export function bounces(r: Ride, seconds = 20, minimum = .1): { peaks: number[]; maxHeight: number; settled: number; finite: boolean } {
  const peaks: number[] = []
  let rising = false, top = 0, touched = false, maxHeight = r.height(), finite = true, settled = -1
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    r.step()
    const h = r.height(), vy = r.v.body.linvel().y
    if (!Number.isFinite(h) || !Number.isFinite(vy)) { finite = false; break }
    maxHeight = Math.max(maxHeight, h)
    if (!touched && h < .05) touched = true
    if (!touched) continue
    if (vy > .05) { rising = true; top = Math.max(top, h) }
    else if (rising && vy <= 0) { rising = false; if (top > minimum) peaks.push(top); top = 0 }
    if (settled < 0 && h < .05 && Math.abs(vy) < .1 && i * FIXED_DT > 1 && peaks.length && !rising) settled = i * FIXED_DT
  }
  return { peaks, maxHeight, settled, finite }
}

/** Press Space once (a hop) and return the apex of the ball's base above where it started. */
export function hop(r: Ride, seconds = 4): { apex: number; peaks: number[] } {
  const start = r.height()
  r.v.input.special = !r.v.input.special
  const b = bounces(r, seconds, .05)
  return { apex: b.maxHeight - start, peaks: b.peaks }
}
