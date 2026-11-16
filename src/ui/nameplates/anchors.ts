import type { Object3D, Quaternion, Vector3 } from 'three/webgpu'
import type { Vehicle } from '../../vehicles/Vehicle'
import type { VehicleKind } from '../../vehicles'

/**
 * Each kind's visible body in its own frame, metres from the vehicle object's origin:
 * [minX, minY, minZ, maxX, maxY, maxZ]. Measured from the rendered meshes on 16 November 2026
 * (jet without its exhaust plume). A generated vehicle should supply its own box here.
 */
const BODY: Record<VehicleKind, readonly number[]> = {
  buggy: [-.94, -.52, -1.96, .94, 1.05, 2.05],
  'buggy-classic': [-.94, -.52, -1.96, .94, 1.05, 2.05],
  'buggy-syn3h': [-.94, -.52, -1.96, .94, 1.05, 2.05],
  hovercraft: [-1.4, 0, -2.04, 1.4, 1.03, 2.04],
  tank: [-1.51, -1.39, -3.81, 1.51, 2.67, 3.84],
  jet: [-3.56, -.91, -3.5, 3.56, 1.06, 3.46],
}
/** Slack around the measured body, for suspension travel and interpolation. */
const MARGIN = .3

/** World-axis box around a vehicle as drawn: half-sizes along x, y and z, and its top. */
export interface Envelope { radius: number; rise: number; reach: number; top: number }

/** Rendered coordinates already encode the visible wrap tile. The camera must not rewrap them. */
export function renderedPosition(object: Pick<Object3D, 'getWorldPosition'>, out: Vector3): Vector3 {
  return object.getWorldPosition(out)
}
/**
 * The vehicle's body box turned to its current orientation, as a world-axis box: `center` gets
 * its middle, `out` its half-sizes (with margin) and the top of the body (without). With the
 * ball out, the ball is the body.
 */
export function renderedEnvelope(vehicle: Pick<Vehicle, 'object' | 'kind' | 'zorb'>, center: Vector3, rotation: Quaternion, offset: Vector3, out: Envelope): Envelope {
  renderedPosition(vehicle.object, center)
  vehicle.object.getWorldQuaternion(rotation)
  if (vehicle.zorb.active) {
    offset.copy(vehicle.zorb.offset).applyQuaternion(rotation)
    center.add(offset)
    out.radius = out.rise = out.reach = vehicle.zorb.radius + MARGIN; out.top = center.y + vehicle.zorb.radius
    return out
  }
  const b = BODY[vehicle.kind] ?? BODY.buggy
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < 8; i++) {
    offset.set(b[i & 1 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 4 ? 5 : 2]).applyQuaternion(rotation)
    x0 = Math.min(x0, offset.x); y0 = Math.min(y0, offset.y); z0 = Math.min(z0, offset.z)
    x1 = Math.max(x1, offset.x); y1 = Math.max(y1, offset.y); z1 = Math.max(z1, offset.z)
  }
  center.x += (x0 + x1) / 2; center.y += (y0 + y1) / 2; center.z += (z0 + z1) / 2
  out.radius = (x1 - x0) / 2 + MARGIN
  out.reach = (z1 - z0) / 2 + MARGIN
  out.rise = (y1 - y0) / 2 + MARGIN
  out.top = center.y + (y1 - y0) / 2
  return out
}
