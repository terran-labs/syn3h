import * as THREE from 'three/webgpu'

/** Angles are radians. Wheel order is front left, front right, rear left, rear right. */
export interface BuggySkin {
  readonly object: THREE.Group
  /** Resolves when geometry is attached; rejects on an asset load failure. */
  readonly ready: Promise<void>
  setWheel(index: number, localPosition: THREE.Vector3, steerAngle: number, spinAngle: number): void
  /** Caller advances openAmount by dt * 2 for the original half-second transition. */
  setWings(openAmount: number, steer: number, pitch: number): void
  setColors(body: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): void
  dispose(): void
}
