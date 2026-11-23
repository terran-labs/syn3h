/**
 * Unity Rigidbody semantics on top of a Rapier body, for line by line ports of Unity scripts.
 *
 * - AddForce / AddForceAtPosition / AddRelativeForce (ForceMode.Force) and the torque
 *   variants accumulate during the step, as PhysX does, so every query in a FixedUpdate sees
 *   the velocity from the start of the step.
 * - ForceMode.Acceleration and VelocityChange torques change the angular velocity directly,
 *   ignoring inertia, exactly as PhysX does.
 * - `drag` and `angularDrag` use Unity's `v *= 1 - drag * dt` after forces (Rapier's damping
 *   formula differs, so Rapier damping stays 0). `maxAngularVelocity` is honoured, 0 included.
 * - Forces are handed to Rapier as forces, never as pre-step impulses: Rapier substeps its
 *   solver, and an impulse against gravity leaves a measurable drift (0.07 m/s for an impulse
 *   that exactly cancels gravity on a 30 kg body).
 *
 * Frames: our right handed frame with -Z forward. Use `unityLocal` and `unityLocalTorque` to
 * port Unity local vectors. A cross product computed natively in our frame is already the
 * mirrored Unity cross product, so world space torques from cross products need no conversion.
 */
import * as THREE from 'three/webgpu'
import type { RAPIER } from '../core/physics'

const tmpR = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()
export const DEG = 180 / Math.PI

/** Mathf.Lerp: t clamped to 0..1. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

/**
 * Unity `transform.eulerAngles` (degrees, each in 0..360) from our rotation. Mirroring Z turns
 * our quaternion (x, y, z, w) into Unity's (-x, -y, z, w); Unity composes Y then X then Z,
 * which is three.js order 'YXZ' on the same quaternion algebra.
 */
export function unityEulerAngles(q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
  tmpQ.set(-q.x, -q.y, q.z, q.w)
  tmpE.setFromQuaternion(tmpQ, 'YXZ')
  const wrap = (r: number) => ((r * DEG) % 360 + 360) % 360
  return out.set(wrap(tmpE.x), wrap(tmpE.y), wrap(tmpE.z))
}

/** Unity's `eulerAngles.n > 180 ? n - 360 : n`. */
export function signedAngle(deg: number): number {
  return deg > 180 ? deg - 360 : deg
}

export class UnityBody {
  drag: number
  angularDrag: number
  maxAngularVelocity = 7
  /** Current rotation and position, refreshed by `begin`. */
  readonly q = new THREE.Quaternion()
  readonly pos = new THREE.Vector3()

  private readonly accF = new THREE.Vector3()
  private readonly accT = new THREE.Vector3()
  private readonly accDV = new THREE.Vector3()
  private readonly accDW = new THREE.Vector3()

  constructor(readonly body: RAPIER.RigidBody, readonly world: RAPIER.World, drag: number, angularDrag: number) {
    this.drag = drag
    this.angularDrag = angularDrag
  }

  /** Call at the start of FixedUpdate. */
  begin(): void {
    const r = this.body.rotation()
    const t = this.body.translation()
    this.q.set(r.x, r.y, r.z, r.w)
    this.pos.set(t.x, t.y, t.z)
  }

  get velocity(): THREE.Vector3 {
    const v = this.body.linvel()
    return new THREE.Vector3(v.x, v.y, v.z)
  }

  /** Rigidbody.velocity = v (world). */
  setVelocity(v: THREE.Vector3): void {
    this.body.setLinvel(v, true)
  }

  /** transform.InverseTransformDirection, returned in Unity components (z forward). */
  inverseTransformDirectionUnity(world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    tmpQ.copy(this.q).invert()
    out.copy(world).applyQuaternion(tmpQ)
    out.z = -out.z
    return out
  }

  /** transform.TransformDirection of a Unity local vector, to our world. */
  transformDirectionUnity(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x, y, -z).applyQuaternion(this.q)
  }

  private worldCom(out: THREE.Vector3): THREE.Vector3 {
    const c = this.body.worldCom()
    return out.set(c.x, c.y, c.z)
  }

  addForce(f: THREE.Vector3): void {
    this.accF.add(f)
  }

  addForceAtPosition(f: THREE.Vector3, p: THREE.Vector3): void {
    this.accF.add(f)
    tmpR.subVectors(p, this.worldCom(tmpC))
    this.accT.add(tmpR.cross(f))
  }

  /** ForceMode.VelocityChange at a point: dv as is, r x dv straight onto the angular velocity. */
  addVelocityChangeAtPosition(dv: THREE.Vector3, p: THREE.Vector3): void {
    this.accDV.add(dv)
    tmpR.subVectors(p, this.worldCom(tmpC))
    this.accDW.add(tmpR.cross(dv))
  }

  /** AddRelativeForce with Unity local components. */
  addRelativeForce(x: number, y: number, z: number): void {
    this.accF.add(this.transformDirectionUnity(x, y, z, tmpV))
  }

  /** AddTorque, world frame, ForceMode.Force. */
  addTorque(t: THREE.Vector3): void {
    this.accT.add(t)
  }

  /** AddTorque, world frame, ForceMode.Acceleration: angular acceleration, inertia ignored. */
  addTorqueAcceleration(alpha: THREE.Vector3, dt: number): void {
    this.accDW.addScaledVector(alpha, dt)
  }

  /** AddRelativeTorque with Unity local components (mirrored: (-x, -y, z) in our local). */
  addRelativeTorque(x: number, y: number, z: number): void {
    this.accT.add(tmpV.set(-x, -y, z).applyQuaternion(this.q))
  }

  /** AddRelativeTorque(..., ForceMode.Acceleration). */
  addRelativeTorqueAcceleration(x: number, y: number, z: number, dt: number): void {
    this.accDW.add(tmpV.set(-x, -y, z).applyQuaternion(this.q).multiplyScalar(dt))
  }

  /**
   * Hand the step to Rapier: `v' = (v + a dt)(1 - drag dt)` with gravity included, by scaling
   * the velocity now and every force (plus a gravity correction) by the same factor.
   */
  flush(dt: number): void {
    const b = this.body
    const kv = Math.max(0, 1 - this.drag * dt)
    const kw = Math.max(0, 1 - this.angularDrag * dt)
    const v = b.linvel()
    const w = b.angvel()
    const av = { x: (w.x + this.accDW.x) * kw, y: (w.y + this.accDW.y) * kw, z: (w.z + this.accDW.z) * kw }
    const wl = Math.hypot(av.x, av.y, av.z)
    const cap = this.maxAngularVelocity
    if (wl > cap) {
      const s = wl > 0 ? cap / wl : 0
      av.x *= s; av.y *= s; av.z *= s
    }
    b.setLinvel({ x: (v.x + this.accDV.x) * kv, y: (v.y + this.accDV.y) * kv, z: (v.z + this.accDV.z) * kv }, true)
    b.setAngvel(av, true)
    const g = this.world.gravity
    const m = b.mass()
    b.addForce({
      x: this.accF.x * kv + m * g.x * (kv - 1),
      y: this.accF.y * kv + m * g.y * (kv - 1),
      z: this.accF.z * kv + m * g.z * (kv - 1),
    }, true)
    // A zero cap means no rotation at all this step (Mira parks with maxAngularVelocity 0).
    const tk = cap === 0 ? 0 : kw
    b.addTorque({ x: this.accT.x * tk, y: this.accT.y * tk, z: this.accT.z * tk }, true)
    this.accF.set(0, 0, 0)
    this.accT.set(0, 0, 0)
    this.accDV.set(0, 0, 0)
    this.accDW.set(0, 0, 0)
  }
}
