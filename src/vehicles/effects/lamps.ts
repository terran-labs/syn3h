/**
 * One headlight pose per vehicle kind: the single source every view of the beam reads (the
 * owner, 26 November 2026: "None of the vehicle's visible light cones align with where their
 * headlight beams actually throw").
 *
 * Before this the beam was authored three times over: the visible cone in mist (cones.ts) at
 * 12 degrees and 2 degrees down, a fixed 18 m long; the player's own spot lights
 * (effects/index.ts) at 30 degrees from a different point, whose lower edge lit the ground at the
 * bumper; and other vehicles' ground pool (pools.ts), a hand-drawn patch brightest 3 m ahead. Now:
 *
 *   - the player's spot lights take the pose's origin, axis, spread and reach;
 *   - the visible cone is the same lamp's bright core: the same axis, CORE_SHARE of the spread,
 *     running to where the axis meets the ground, or fading out at the reach when it misses;
 *   - other vehicles' ground pool evaluates the same spot equation per pixel from the same pose
 *     (pools.ts), so it lights the ground as the player's own lamps would.
 *
 * A round spot this wide lights the ground nearest the bumper brightest whatever its aim: that
 * ground is closer and lit more steeply. So the axis is aimed where the eye expects the beam to
 * end, inside the lit ground (LAMP_POSES landing).
 */
import * as T from 'three/webgpu'
import { defineParam } from '../../../shared/params'

export interface LampPose {
  /** The right-hand lamp in the vehicle's frame at design size, metres (the left mirrors x). */
  readonly x: number; readonly y: number; readonly z: number
  /** The lamp's height above flat ground with the vehicle at rest, metres: aims the axis. */
  readonly restHeight: number
  /** Where the axis meets flat ground with the vehicle at rest, metres ahead of the lamp. */
  readonly landing: number
  /** Half angle of the usable light, radians: the spot's, and the pool's skirt. */
  readonly spread: number
  /** How far the light reaches, metres. */
  readonly reach: number
}

/** The visible cone's half angle, as a share of the lamp's spread: its bright core. */
export const CORE_SHARE = .4

/**
 * Where the buggy's beam lands ahead, metres: tunable, as the owner judges the look. Nearer
 * reads as the cone ending inside the lit road; farther lights the road further out.
 */
export const buggyBeamLanding = defineParam({ id: 'light.buggyBeamLanding', label: 'Buggy beam lands (m ahead)', group: 'Vehicle looks', scope: 'world', default: 6, min: 3, max: 25, step: .5 })

const SPREAD = Math.PI / 6
export const LAMP_POSES: Readonly<Record<'buggy' | 'hovercraft' | 'jet' | 'tank', LampPose>> = {
  // Lamp points as drawn (effects/index.ts lamp glows); rest heights measured at rest in play.
  buggy: { x: .584, y: .036, z: -1.775, restHeight: .54, landing: 6, spread: SPREAD, reach: 50 },
  hovercraft: { x: .6, y: .215, z: -2.03, restHeight: 2.72, landing: 14, spread: SPREAD, reach: 50 },
  jet: { x: 1, y: -.423, z: -3.2756, restHeight: .75, landing: 9, spread: SPREAD, reach: 60 },
  tank: { x: .584, y: .036, z: -1.775, restHeight: .54, landing: 8, spread: SPREAD, reach: 50 },
}

/** The pose for a vehicle kind (the buggy's landing from the registry). */
export function lampPoseFor(kind: string): LampPose {
  if (kind.startsWith('buggy')) return { ...LAMP_POSES.buggy, landing: Number(buggyBeamLanding.value) }
  return kind === 'hovercraft' || kind === 'jet' || kind === 'tank' ? LAMP_POSES[kind] : LAMP_POSES.buggy
}

/** The axis's angle below the vehicle's forward direction, radians. */
export function lampPitch(pose: LampPose): number { return Math.atan2(pose.restHeight, Math.max(.5, pose.landing)) }

/** The axis in the vehicle's frame (forward is -z). */
export function lampAxis(pose: LampPose, out: T.Vector3): T.Vector3 {
  const p = lampPitch(pose)
  return out.set(0, -Math.sin(p), -Math.cos(p))
}

/**
 * Metres along the ray from `origin` in unit direction `dir` to the ground (`heightAt`), within
 * `reach`, or null if it stays above it. Marches then bisects to about 2 mm: 34 height samples at most.
 */
export function groundHit(origin: T.Vector3, dir: T.Vector3, reach: number, heightAt: (x: number, z: number) => number): number | null {
  const steps = 24, step = reach / steps
  let prev = 0
  if (origin.y - heightAt(origin.x, origin.z) <= 0) return 0
  for (let i = 1; i <= steps; i++) {
    const t = i * step, y = origin.y + dir.y * t
    if (y - heightAt(origin.x + dir.x * t, origin.z + dir.z * t) <= 0) {
      let lo = prev, hi = t
      for (let k = 0; k < 10; k++) {
        const m = (lo + hi) / 2
        if (origin.y + dir.y * m - heightAt(origin.x + dir.x * m, origin.z + dir.z * m) <= 0) hi = m; else lo = m
      }
      return hi
    }
    prev = t
  }
  return null
}

/**
 * The player's spot lights' settings from the pose: same angle, an even fall from the axis
 * (penumbra 1), a linear fall with distance (decay 1) that three.js eases to nothing at the
 * reach: a hot zone near the car that eases away, not a slab to the reach. SPOT_MATCH scales
 * the old candela figures for decay 1, and a little under, so the lit soil keeps its colour.
 */
export const SPOT_PENUMBRA = 1, SPOT_DECAY = 1
/** Old intensities were for decay 2: at 4 m they gave I / 16; decay 1 gives I / 4 there, so a quarter, then half again. */
export const SPOT_MATCH = 1 / 8
const spotAxis = new T.Vector3()
/** Pose a spot light at lamp `x` (vehicle frame, already scaled) on a vehicle drawn at `size`. */
export function poseSpot(spot: T.SpotLight, pose: LampPose, x: number, size = 1): void {
  spot.angle = pose.spread; spot.penumbra = SPOT_PENUMBRA; spot.decay = SPOT_DECAY; spot.distance = pose.reach
  spot.position.set(x, pose.y * size, pose.z * size)
  const a = lampAxis(pose, spotAxis)
  spot.target.position.set(x + a.x * 20, pose.y * size + a.y * 20, pose.z * size + a.z * 20)
}
