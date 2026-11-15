/**
 * The camera's path into a world: from high over the player's vehicle down to the chase
 * camera's own place behind it. Pure, so the end of the path can be tested against the chase
 * camera's rest pose and the lobby's descent (src/ui/Shell.ts) cannot drift from it.
 *
 * The path is always built from where the vehicle is now. A world can be rebuilt while the
 * lobby still covers the game (the tapped planet, or the room's own world arriving), which
 * moves the spawn point by up to a kilometre; a path kept from before that would show the new
 * world from over the old spawn point and then jump.
 */
import { Vector3 } from 'three/webgpu'

/** Height above the ground at the top of the path, metres. */
export const ARRIVAL_START_HEIGHT = 520
/** How far behind the vehicle the top of the path stands, metres. */
export const ARRIVAL_START_BACK = 40
/** Field of view at the top, close to the galaxy's own. */
export const ARRIVAL_START_FOV = 64

export interface ArrivalInput {
  /** The vehicle's position on the ground plane and its heading in radians (0 faces -Z). */
  x: number; z: number; heading: number
  /** Ground height under the vehicle, and the vehicle's height above it. */
  floor: number; altitude: number
  /** The chase camera's arm (vehicle clearance plus orbit distance), its height ratio and field of view. */
  arm: number; heightRatio: number; fov: number
}
export interface ArrivalPath {
  /** Where the camera stands at t = 0 and t = 1. */
  readonly top: Vector3
  readonly end: Vector3
  /** Write the camera position and look target for t in 0..1 and return the field of view. */
  pose(t: number, position: Vector3, look: Vector3): number
}

export function arrivalPath(input: ArrivalInput): ArrivalPath {
  const { floor, arm } = input
  const at = new Vector3(input.x, floor, input.z)
  const ahead = new Vector3(-Math.sin(input.heading), 0, -Math.cos(input.heading))
  const body = floor + Math.max(0.5, input.altitude)
  const end = new Vector3(at.x - ahead.x * arm, body + arm * input.heightRatio, at.z - ahead.z * arm)
  const endLook = end.clone().addScaledVector(ahead, 60)
  const endHeight = Math.max(1.5, end.y - floor)
  const top = new Vector3(at.x - ahead.x * ARRIVAL_START_BACK, floor + ARRIVAL_START_HEIGHT, at.z - ahead.z * ARRIVAL_START_BACK)
  return {
    top, end,
    pose(t, position, look) {
      const u = Math.max(0, Math.min(1, t))
      // It falls fast at first, carrying on the dive's speed, and slows into place; the view
      // turns from straight down to level along the vehicle's heading late in the fall.
      const fall = 1 - (1 - u) ** 2.4, turnTo = u * u * u * (u * (u * 6 - 15) + 10)
      const height = Math.exp(Math.log(ARRIVAL_START_HEIGHT) + (Math.log(endHeight) - Math.log(ARRIVAL_START_HEIGHT)) * fall)
      const back = ARRIVAL_START_BACK + (arm - ARRIVAL_START_BACK) * fall
      position.set(at.x - ahead.x * back, floor + height, at.z - ahead.z * back)
      look.copy(at).lerp(endLook, turnTo)
      return ARRIVAL_START_FOV + (input.fov - ARRIVAL_START_FOV) * fall
    },
  }
}
