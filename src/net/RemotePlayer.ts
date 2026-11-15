/**
 * One remote vehicle (a player, or a bot the host simulates): the vehicle, its snapshot
 * buffer, and the proxy rule from VehicleNet.js. Near the local player the vehicle stays a
 * dynamic body, nudged toward the snapshot pose and given the snapshot's velocities, so
 * collisions with us are real physics. Farther away it is kinematic and placed exactly.
 */
import * as THREE from 'three/webgpu'
import type { PlayerInfo, WireState } from '../../shared/protocol'
import { RAPIER } from '../core/physics'
import type { Vehicle } from '../vehicles/Vehicle'
import { emptySample, type Sample, SnapshotBuffer } from './SnapshotBuffer'

/** A dynamic proxy farther than this from its target is snapped, not blended. */
const SNAP_DISTANCE = 15

export class RemotePlayer {
  readonly buffer = new SnapshotBuffer(32)
  readonly sample: Sample = emptySample()
  physical = true
  responding = true
  paused = false
  /** Currently in contact with the local vehicle. */
  touching = false
  lastRamSent = -Infinity
  /** Game time the local vehicle last touched this one, for relayed shoves (shove.ts). */
  lastContactAt = -Infinity
  delay = 0.1
  /** Removes this vehicle's effects; call before removing the vehicle. */
  disposeEffects: () => void = () => {}
  private readonly q = new THREE.Quaternion()
  private readonly qt = new THREE.Quaternion()

  /**
   * `owned` is false when the vehicle belongs to someone else (a bot manager's vehicle that
   * this client merely steers); then releasing it must not dispose it.
   */
  constructor(public info: PlayerInfo, public vehicle: Vehicle, readonly owned = true) {
    vehicle.isLocal = false
    vehicle.id = String(info.id)
    vehicle.name = info.name
    this.physical = vehicle.body.bodyType() === RAPIER.RigidBodyType.Dynamic
  }

  push(s: WireState, now: number, sendRate: number, measure = true): void {
    this.buffer.push({ t: s.t, p: s.p, q: s.q, v: s.v, w: s.w, input: s.input, paused: s.paused }, now, sendRate, measure)
  }

  /** Run before the vehicle's own fixed step. */
  steer(renderTime: number, maxExtrapolate: number, localPos: { x: number; y: number; z: number }, radius: number, blend: number): void {
    const s = this.buffer.sample(renderTime, maxExtrapolate, this.sample)
    if (s.mode === 'empty') return
    this.responding = s.mode !== 'stale'
    this.paused = s.paused
    Object.assign(this.vehicle.input, s.input)

    const body = this.vehicle.body
    const cur = body.translation()
    const near = Math.hypot(cur.x - localPos.x, cur.y - localPos.y, cur.z - localPos.z) < radius
    // A parked (hidden tab) vehicle is frozen on its owner's screen, so it is a wall here too.
    this.setPhysical(near && this.responding && !this.paused)

    const [px, py, pz] = s.p
    if (!this.physical) {
      body.setNextKinematicTranslation({ x: px, y: py, z: pz })
      body.setNextKinematicRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] })
      return
    }
    const err = Math.hypot(px - cur.x, py - cur.y, pz - cur.z)
    const k = err > SNAP_DISTANCE ? 1 : blend
    body.setTranslation({ x: cur.x + (px - cur.x) * k, y: cur.y + (py - cur.y) * k, z: cur.z + (pz - cur.z) * k }, true)
    const r = body.rotation()
    this.q.set(r.x, r.y, r.z, r.w).slerp(this.qt.set(s.q[0], s.q[1], s.q[2], s.q[3]), k)
    body.setRotation(this.q, true)
    body.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true)
    body.setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] }, true)
  }

  setPhysical(physical: boolean): void {
    if (physical === this.physical) return
    this.vehicle.body.setBodyType(physical ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased, true)
    this.physical = physical
  }

  /** The terrain changed under us: park on the new ground until fresh states arrive. */
  reseat(heightAt: (x: number, z: number) => number): void {
    this.buffer.clear()
    this.setPhysical(false)
    const t = this.vehicle.body.translation()
    const y = heightAt(t.x, t.z) + 1.5
    this.vehicle.body.setTranslation({ x: t.x, y, z: t.z }, true)
    this.vehicle.body.setNextKinematicTranslation({ x: t.x, y, z: t.z })
  }
}
