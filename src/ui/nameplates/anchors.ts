import type { Object3D, Quaternion, Vector3 } from 'three/webgpu'
import type { Vehicle } from '../../vehicles/Vehicle'
/** Rendered coordinates already encode the visible wrap tile. The camera must not rewrap them. */
export function renderedPosition(object: Pick<Object3D, 'getWorldPosition'>, out: Vector3): Vector3 {
  return object.getWorldPosition(out)
}
/** A conservative hull envelope, enlarged by the ball using its interpolated world orientation. */
export function renderedEnvelope(vehicle: Pick<Vehicle, 'object' | 'kind' | 'zorb'>, center: Vector3, rotation: Quaternion, offset: Vector3): number {
  renderedPosition(vehicle.object, center)
  let radius = vehicle.kind === 'jet' ? 6 : 3.5
  if (vehicle.zorb.active) {
    vehicle.object.getWorldQuaternion(rotation)
    offset.copy(vehicle.zorb.offset).applyQuaternion(rotation)
    center.add(offset); radius = Math.max(radius, vehicle.zorb.radius)
  }
  return radius
}
