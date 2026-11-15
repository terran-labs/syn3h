/**
 * One remote vehicle (a player, or a bot the host simulates): the vehicle, its snapshot
 * buffer, and the proxy rule from VehicleNet.js. Near the local player the vehicle stays a
 * dynamic body, nudged toward the snapshot pose and given the snapshot's velocities, so
 * collisions with us are real physics. Farther away it is kinematic and placed exactly.
 */
import { nearestImage } from '../../shared/wrap'
import * as THREE from 'three/webgpu'
import type { PlayerInfo, WireState } from '../../shared/protocol'
import { RAPIER } from '../core/physics'
import type { Vehicle } from '../vehicles/Vehicle'
import { emptySample, type Sample, SnapshotBuffer } from './SnapshotBuffer'

/** Bounds on the learned ride height, metres; see RemotePlayer.clearance. */
const MIN_CLEARANCE = 0.1
const MAX_CLEARANCE = 1.5

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
  /**
   * Side of the wrapping world in metres, 0 when it does not wrap. On a wrapping world a
   * position is one of many images a whole tile apart, and three rules keep a remote vehicle
   * whole across the seam:
   *  1. Its snapshots are stored as one continuous track: each new state is taken at the image
   *     nearest the one before, so interpolation and extrapolation never blend across a tile.
   *     A sender's own whole-tile shift arrives as a jump of exactly one tile and vanishes here.
   *  2. It is placed at the image nearest the local player.
   *  3. When that image changes (we or they crossed the seam), the body is moved by the whole
   *     tile at once, not blended or snapped: its motion relative to us is unbroken.
   */
  wrapSize = 0
  /**
   * Ground height at a world position, when the client has a terrain. A remote vehicle is
   * placed where its snapshots say, and between or beyond snapshots that can be inside a
   * hill: the straight line between two states cuts through a crest the real vehicle drove
   * over, and carrying on along the last velocity runs into a rising slope. At speed that
   * was metres deep. So the placed height is never below the ground plus `clearance`.
   */
  groundAt: ((x: number, z: number) => number) | null = null
  /**
   * The least height above the ground this vehicle's own snapshots have shown, metres: its
   * ride height at its most compressed, learned from the sender, which is never underground.
   * It differs by vehicle (a buggy on its wheels, a hovercraft on its cushion, a zorb ball)
   * and only ever lowers, so a true position is never lifted. Bounded to stay sensible.
   */
  clearance = MAX_CLEARANCE
  /** The body was moved by a whole tile on the last step (for tests and diagnostics). */
  jumped = false
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
    let p = s.p
    const head = this.buffer.newest
    if (this.wrapSize > 0 && head) p = [nearestImage(p[0], head.p[0], this.wrapSize), p[1], nearestImage(p[2], head.p[2], this.wrapSize)]
    if (this.groundAt) {
      const above = p[1] - this.groundAt(p[0], p[2])
      // A state at or under the ground teaches nothing (and is lifted like any other sample).
      if (above > 0) this.clearance = Math.max(MIN_CLEARANCE, Math.min(this.clearance, above))
    }
    this.buffer.push({ t: s.t, p, q: s.q, v: s.v, w: s.w, input: s.input, paused: s.paused }, now, sendRate, measure)
  }

  /** Run before the vehicle's own fixed step. */
  steer(renderTime: number, maxExtrapolate: number, localPos: { x: number; y: number; z: number }, radius: number, blend: number): void {
    const s = this.buffer.sample(renderTime, maxExtrapolate, this.sample)
    if (s.mode === 'empty') return
    this.responding = s.mode !== 'stale'
    this.paused = s.paused
    Object.assign(this.vehicle.input, s.input)

    const body = this.vehicle.body
    const at = body.translation()
    let [px, py, pz] = s.p
    let cur = { x: at.x, y: at.y, z: at.z }
    this.jumped = false
    if (this.wrapSize > 0) {
      // The target at the image nearest us, and the body at the image nearest that target.
      px = nearestImage(px, localPos.x, this.wrapSize)
      pz = nearestImage(pz, localPos.z, this.wrapSize)
      cur = { x: nearestImage(at.x, px, this.wrapSize), y: at.y, z: nearestImage(at.z, pz, this.wrapSize) }
      if (cur.x !== at.x || cur.z !== at.z) {
        // A whole tile, in one move, with no velocity implied and nothing blended. shiftBy
        // moves the drawn position with the body, so nothing streaks across the world.
        this.vehicle.shiftBy(cur.x - at.x, cur.z - at.z)
        this.jumped = true
      }
    }
    // Never inside a hill: see groundAt. Aircraft and anything airborne are untouched.
    if (this.groundAt) py = Math.max(py, this.groundAt(px, pz) + this.clearance)
    const near = Math.hypot(cur.x - localPos.x, cur.y - localPos.y, cur.z - localPos.z) < radius
    // A parked (hidden tab) vehicle is frozen on its owner's screen, so it is a wall here too.
    this.setPhysical(near && this.responding && !this.paused)

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

  /**
   * Keep the vehicle at the image nearest the local player between physics steps. The local
   * player's own whole-tile shift happens after a step; without this a neighbour would be
   * drawn a world away for the frame before the next one.
   */
  reimage(localPos: { x: number; z: number }): void {
    if (!(this.wrapSize > 0)) return
    const at = this.vehicle.body.translation()
    const dx = nearestImage(at.x, localPos.x, this.wrapSize) - at.x
    const dz = nearestImage(at.z, localPos.z, this.wrapSize) - at.z
    if (dx !== 0 || dz !== 0) this.vehicle.shiftBy(dx, dz)
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
