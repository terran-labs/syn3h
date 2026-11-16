import type { Color, Vector3 } from 'three/webgpu'

/**
 * A model publishes this on vehicle.object.userData.headlights. Positions and outward
 * directions are vehicle-local, colours are linear, and the caller owns every output.
 * Models derive anchors from their lamp geometry, never from an effects-only offset.
 */
export interface HeadlightSource {
  readonly count: number
  sample(index: number, position: Vector3, direction: Vector3, color: Color): boolean
  /** Simplified models without lamp faces request the existing shared instanced glow. */
  needsGlow?(): boolean
}
