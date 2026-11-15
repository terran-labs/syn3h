/**
 * Camera director: while the vehicle drives itself (Daydream), cut between a few shots so
 * the trip reads as a film rather than a dashcam. It only proposes poses; ChaseCamera eases
 * to them, keeps them out of the ground and liquid, and returns to the normal chase view
 * the moment the player takes the controls back.
 *
 * The shot list is fixed and every pose is a pure function of time and the vehicle's motion,
 * so a capture of a daydream is repeatable.
 */
import * as THREE from 'three/webgpu'

export type Shot = 'chase' | 'orbit' | 'flyby' | 'crane' | 'low'

/** Order and length in seconds. 'chase' is the ordinary follow camera, as a breather. */
const SEQUENCE: readonly [Shot, number][] = [['chase', 8], ['orbit', 12], ['chase', 6], ['flyby', 9], ['crane', 9], ['low', 7]]

export interface DirectorTerrain {
  heightAt(x: number, z: number): number
  liquidHeightAt?(x: number, z: number): number | null | undefined
}

export class CameraDirector {
  active = false
  shot: Shot = 'chase'
  private index = 0
  private shotTime = 0
  private blockedTime = 0
  private angle = 0
  private side = 1
  private placed = false
  private readonly anchor = new THREE.Vector3()
  private readonly heading = new THREE.Vector3(0, 0, -1)

  start(): void { this.active = true; this.index = 0; this.begin() }
  stop(): void { this.active = false; this.shot = 'chase' }

  private begin(): void {
    this.shot = SEQUENCE[this.index][0]; this.shotTime = 0; this.blockedTime = 0; this.placed = false
    this.side = -this.side
  }
  private next(): void { this.index = (this.index + 1) % SEQUENCE.length; this.begin() }

  /**
   * Advance and, for a cinematic shot, write the wanted camera position and look target.
   * Returns false when the ordinary chase camera should be used this frame.
   */
  update(dt: number, vehicle: THREE.Vector3, velocity: { x: number; y: number; z: number }, terrain: DirectorTerrain, position: THREE.Vector3, target: THREE.Vector3): boolean {
    if (!this.active) return false
    this.shotTime += dt
    const speed = Math.hypot(velocity.x, velocity.z)
    // Keep the last real heading while stopped, so shots do not swing about at rest.
    if (speed > 1) this.heading.set(velocity.x / speed, 0, velocity.z / speed)
    const h = this.heading, px = -h.z * this.side, pz = h.x * this.side
    if (this.shotTime >= SEQUENCE[this.index][1]) this.next()
    // A fly-by needs something flying by.
    if (this.shot === 'flyby' && !this.placed && speed < 5) this.next()
    if (this.shot === 'chase') return false
    const surface = (x: number, z: number) => {
      const liquid = terrain.liquidHeightAt?.(x, z)
      return Math.max(terrain.heightAt(x, z), liquid != null && Number.isFinite(liquid) ? liquid : -Infinity)
    }
    // Lead the subject a little: the camera eases toward its pose, so it trails a moving car.
    target.set(vehicle.x + velocity.x * 0.45, vehicle.y + 1, vehicle.z + velocity.z * 0.45)
    if (this.shot === 'orbit') {
      if (!this.placed) { this.angle = Math.atan2(-h.z, -h.x); this.placed = true }
      this.angle += dt * 0.28 * this.side
      position.set(vehicle.x + Math.cos(this.angle) * 13, vehicle.y + 4.5, vehicle.z + Math.sin(this.angle) * 13)
    } else if (this.shot === 'flyby') {
      if (!this.placed) {
        // Stand beside the path ahead and let the vehicle come through the frame.
        const lead = Math.max(25, Math.min(55, speed * 3.5))
        this.anchor.set(vehicle.x + h.x * lead + px * 7, 0, vehicle.z + h.z * lead + pz * 7)
        this.anchor.y = surface(this.anchor.x, this.anchor.z) + 2.2
        this.placed = true
      }
      position.copy(this.anchor)
      target.set(vehicle.x, vehicle.y + 1, vehicle.z)
      // It has gone by and is leaving: cut.
      if ((vehicle.x - this.anchor.x) * h.x + (vehicle.z - this.anchor.z) * h.z > 30) this.next()
    } else if (this.shot === 'crane') {
      position.set(vehicle.x - h.x * 16, vehicle.y + 13, vehicle.z - h.z * 16)
    } else {
      position.set(vehicle.x + px * 7 + h.x * 3, 0, vehicle.z + pz * 7 + h.z * 3)
      position.y = Math.max(surface(position.x, position.z) + 1.1, vehicle.y - 0.5)
    }
    // A hill between camera and car is a shot of a hill. Give it a moment, then cut.
    let blocked = false
    for (let i = 1; i < 8 && !blocked; i++) {
      const t = i / 8, x = position.x + (target.x - position.x) * t, z = position.z + (target.z - position.z) * t
      blocked = position.y + (target.y - position.y) * t < surface(x, z)
    }
    this.blockedTime = blocked ? this.blockedTime + dt : 0
    if (this.blockedTime > 0.7) { this.next(); return false }
    return true
  }
}
