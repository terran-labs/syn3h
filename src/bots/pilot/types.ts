/**
 * Contracts between the three layers of a self-driving vehicle.
 *
 *   mind       decides what to do next (explore, cruise a road, chase, play) and picks a place
 *   navigator  turns "get from here to there" into a route this kind of vehicle can travel
 *   pilot      turns "head for this point at this speed" into the vehicle's own controls
 *
 * Bots and the Daydream autopilot (the player's own vehicle driving itself) share all three.
 * Nothing here knows about a particular vehicle; a pilot only ever writes an `InputState`,
 * exactly what a keyboard, a touch stick or the network would write.
 */
import type { InputState } from '../../core/Input'
import type { Vehicle } from '../../vehicles/Vehicle'
import type { Terrain } from '../../world/Terrain'

/** A place on the map. `y` is a surface height when known (roads carry it). */
export interface NavPoint { x: number; z: number; y?: number }

/** What one kind of vehicle can cross. The navigator plans against this. */
export interface NavProfile {
  /**
   * Steepest grade it can climb, rise over run (0.5 is about 27 degrees). Descents and
   * traverses are allowed up to 1.5 times this. Ignored when `flies`.
   */
  maxGrade: number
  /**
   * 'blocked': liquid is impassable (wheels, tracks). 'surface': it rides on top of water and
   * lava (hovercraft). 'ignored': it is far above it (aircraft).
   */
  liquid: 'blocked' | 'surface' | 'ignored'
  /** True for aircraft: straight lines are fine, the route only has to clear the terrain. */
  flies: boolean
  /** Cost multiplier for travelling on a road, 0..1. 0.35 strongly prefers roads; 1 ignores them. */
  roadCost: number
  /** Metres above the surface an aircraft cruises at. Ignored unless `flies`. */
  cruiseAltitude: number
}

/** A planned route. `points[0]` is near the start; the last point is the goal or as near as it got. */
export interface Route {
  points: NavPoint[]
  /** Sum of step costs, in metres of flat ground equivalent. */
  cost: number
  /** False when the goal was unreachable and the route ends at the closest reachable place. */
  reached: boolean
}

/** Plans a route for one profile. Returns null only when the start itself is unusable. */
export interface Navigator {
  route(from: NavPoint, to: NavPoint, profile: NavProfile): Route | null
  /** True when this profile may stand at (x, z): inside the world, dry enough, not a cliff. */
  passable(x: number, z: number, profile: NavProfile): boolean
  /** Forget everything cached. Call after the terrain regenerates. */
  invalidate(): void
}

/** What the mind asks of the pilot each physics step. */
export interface DriveGoal {
  /** The point to head for now (already a look-ahead point on the route, not the far goal). */
  x: number
  z: number
  /** Ground speed to hold, m/s. The pilot slows further for corners by itself. */
  speed: number
  /** Aircraft only: metres above the surface (ground or liquid) to hold. */
  altitude?: number
  /** When set, come to rest within this many metres of the point instead of driving through. */
  stopWithin?: number
  /** Ask for the vehicle's special mode (buggy wings, jet forward flight) where the pilot supports it. */
  special?: boolean
}

/** What the pilot reports back, so the mind can replan or ask for a rescue. */
export interface PilotStatus {
  /** Seconds it has been trying and failing to make progress. 0 while moving. */
  stuckFor: number
  /** No wheel, track or hover cushion on the ground this step. */
  airborne: boolean
  /** Upside down or on its side. */
  flipped: boolean
}

/**
 * Drives one vehicle. One instance per vehicle; it may keep filter state between steps.
 * `drive` must fully define `input` every call (start from `emptyInput()` values), except
 * `special`, which is a latch: set it to the wanted state, never toggle it.
 */
export interface Pilot {
  readonly profile: NavProfile
  drive(goal: DriveGoal, input: InputState, dt: number): PilotStatus
  /** Clear filters and timers, after a teleport or when control is handed back. */
  reset(): void
}

export type PilotFactory = (vehicle: Vehicle, terrain: Terrain) => Pilot
