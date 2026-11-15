import * as THREE from 'three/webgpu'

/** Angles are radians. Wheel order is front left, front right, rear left, rear right. */
export interface BuggySkin {
  readonly object: THREE.Group
  /** Resolves when geometry is attached; rejects on an asset load failure. */
  readonly ready: Promise<void>
  /** True when the model's own faces are the lamps, so the effects lane skips its lamp blobs. */
  readonly ownLamps?: boolean
  setWheel(index: number, localPosition: THREE.Vector3, steerAngle: number, spinAngle: number): void
  /** Caller advances openAmount by dt * 2 for the original half-second transition. */
  setWings(openAmount: number, steer: number, pitch: number): void
  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void
  /**
   * Hub motor load for wheel `index`, 0 idle to 1 flat out (see motorDrive.ts); `regen` while
   * the motor is braking. Drives the rotor/stator glow and sparks. Call once per wheel per
   * frame after setWheel. Optional: skins without hub motors ignore it.
   */
  setDrive?(index: number, effort: number, regen?: boolean): void
  /** Brake lamps on while braking or regenerating. Optional: only mesh lamps need it. */
  setLights?(braking: boolean): void
  /**
   * The vehicle took a blow at `worldPoint` (0.2 a knock to 1 a hard hit). Skins with force
   * fields show it: a flash and a ring across the field (see forceField.ts). Optional.
   */
  fieldHit?(worldPoint: THREE.Vector3, strength: number): void
  dispose(): void
}
