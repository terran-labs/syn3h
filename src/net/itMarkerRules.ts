/**
 * Rules for the "it" marker, kept free of the renderer so they can be tested on their own:
 * who gets a marker, and how high it floats.
 *
 * Remote vehicles: a fixed height over the roof, as before.
 *
 * The local vehicle: from the chase camera a point a fixed height above your own car sits low
 * in the view and lands on whoever is ahead of you, which reads as them being "it". So the
 * local marker is lifted until it sits a set angle above the camera's horizontal, which puts it
 * in the upper part of the screen, clear of the car, at any camera distance.
 *
 * It must also never cover the middle of your own view, where the reticle and the aim point
 * are (the owner, 19 November 2026: "it completely blocks whatever I'm aiming at at certain
 * angles"). clearOfCentre works in screen space: it raises your marker just far enough that it
 * sits above a clear circle round the screen's centre, and where no lift is enough it fades it,
 * reaching nothing at the circle's edge. Other players' markers, and how others see yours, are
 * unchanged.
 */
import { defineParam } from '../../shared/params'

/**
 * Radius of the clear circle round the middle of your view, as a share of the screen's height:
 * your own "it" marker stays out of it. The reticle and the aim cone, with room round them.
 */
export const ownMarkerClear = defineParam({ id: 'hud.ownMarkerClear', label: 'My "it" marker stays this far from the centre (share of screen height)', group: 'Interface', scope: 'client', default: 0.12, min: 0, max: 0.3, step: 0.01 })

/** Height over a remote vehicle's origin, as the original marker. */
export const REMOTE_LIFT = 3.2
/** The local marker never floats lower than a remote one, nor absurdly high. */
export const LOCAL_LIFT_MIN = REMOTE_LIFT
export const LOCAL_LIFT_MAX = 8
/** Fraction of the half vertical field of view above the camera's horizontal for the local marker. */
export const LOCAL_SCREEN_FRACTION = 0.42
/** Closer than this (first person, or a camera inside the car) the local marker is hidden. */
export const LOCAL_MIN_CAMERA_DISTANCE = 2

/** Whether the marker is drawn this frame. */
export function itMarkerVisible<V>(target: V | null, local: V | null, cameraDistance: number): boolean {
  if (!target) return false
  if (target !== local) return true
  return cameraDistance >= LOCAL_MIN_CAMERA_DISTANCE
}

/**
 * Lift over the local vehicle's origin, in metres.
 * @param horizontal horizontal distance from the camera to the vehicle
 * @param rise camera height above the vehicle's origin (negative if below)
 * @param fovDeg the camera's vertical field of view
 */
export function localMarkerLift(horizontal: number, rise: number, fovDeg: number): number {
  const angle = (fovDeg * Math.PI / 360) * LOCAL_SCREEN_FRACTION
  const lift = rise + horizontal * Math.tan(angle)
  if (!Number.isFinite(lift)) return LOCAL_LIFT_MIN
  return Math.min(LOCAL_LIFT_MAX, Math.max(LOCAL_LIFT_MIN, lift))
}

/** Which vehicle carries the marker: nobody outside tag, or when nobody is "it". */
export function itMarkerTarget<V>(tagMode: boolean, it: number, vehicleOf: (id: number) => V | undefined): V | null {
  if (!tagMode || !it) return null
  return vehicleOf(it) ?? null
}

/** Highest your own marker may be raised to clear the middle of the view, metres: the length of its beam. */
export const CLEAR_LIFT_MAX = 40
/** Clearance kept above the circle, as a share of its radius; the fade runs across it. */
export const CLEAR_MARGIN = 0.5
/** How far below the marker's centre its lowest point is, metres (the gem's point, the bob, the halo). */
export const MARKER_BOTTOM = 1.7

/**
 * How far a point on screen is clear of the circle of `radius` round the centre: its distance
 * from the circle's edge, positive outside and negative inside. `x`, `y`: from the screen's
 * centre, as shares of its height.
 */
export function clearance(x: number, y: number, radius: number): number {
  return Math.hypot(x, y) - radius
}

/**
 * Your own marker's lift over your vehicle, raised from `base` just far enough that its lowest
 * point sits CLEAR_MARGIN above the clear circle, and how much of it shows. `screenOf(lift)` is
 * where the marker's lowest point lands on screen at that lift ([x, y] from the centre, as shares
 * of the screen's height), or null when it is behind the camera. Raising it moves it up the
 * screen. Where even CLEAR_LIFT_MAX is not enough, it stays there and fades by its clearance,
 * to nothing at the circle's edge: it may sit dimly at the circle's rim, never over the centre.
 */
export function clearOfCentre(base: number, radius: number, screenOf: (lift: number) => readonly [number, number] | null): { lift: number; opacity: number } {
  if (!(radius > 0)) return { lift: base, opacity: 1 }
  const want = radius * CLEAR_MARGIN
  const gap = (lift: number) => { const p = screenOf(lift); return p ? clearance(p[0], p[1], radius) : Infinity }
  if (gap(base) >= want) return { lift: base, opacity: 1 }
  const top = Math.max(base, CLEAR_LIFT_MAX), highest = gap(top)
  if (highest < want) {
    const x = Math.min(1, Math.max(0, highest / want))
    return { lift: top, opacity: x * x * (3 - 2 * x) }
  }
  // The lowest lift that clears it: the gap grows as the marker rises.
  let lo = base, hi = top
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (gap(mid) >= want) hi = mid; else lo = mid }
  return { lift: hi, opacity: 1 }
}

/** Seconds your own marker takes to fade out before a jump, and back in after it. */
export const JUMP_FADE = 0.15
/** A change of lift that would move the marker more than this share of the screen's height in one frame is a jump. */
export const JUMP_SCREEN = 0.05

/** Your own marker this frame: its lift, how much shows, and the jump fade (1 shown, 0 hidden). */
export interface OwnMarker { lift: number; opacity: number; fade: number }

/**
 * One frame of your own marker. It follows the lowest lift that keeps it clear of the circle
 * (clearOfCentre) as the camera moves. Where that lift jumps (with the car to one side, or the
 * camera steep, it can switch from one side of the circle to the other), the marker does not
 * fly across: it fades out where it is, as long as that is still outside the circle, moves
 * unseen, and fades back in at its new place. How much shows is also measured where it is
 * drawn, so it is never seen inside the circle. `last` is last frame's result, or null.
 */
export function stepOwnMarker(last: OwnMarker | null, base: number, radius: number, screenOf: (lift: number) => readonly [number, number] | null, dt: number): OwnMarker {
  const target = clearOfCentre(base, radius, screenOf).lift
  const gap = (lift: number) => { const p = screenOf(lift); return p ? clearance(p[0], p[1], radius) : Infinity }
  const shows = (lift: number) => {
    if (!(radius > 0)) return 1
    const x = Math.min(1, Math.max(0, gap(lift) / (radius * CLEAR_MARGIN)))
    return x * x * (3 - 2 * x)
  }
  if (!last) return { lift: target, fade: 1, opacity: shows(target) }
  const step = Math.max(0, dt) / JUMP_FADE
  let jump = false
  if (radius > 0 && target !== last.lift) {
    const a = screenOf(last.lift), b = screenOf(target)
    jump = !a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > JUMP_SCREEN
    for (let k = 1; k < 8 && !jump; k++) jump = gap(last.lift + (target - last.lift) * k / 8) < 0
  }
  let lift = target, fade = Math.min(1, last.fade + step)
  if (jump) {
    // Fade out in place while that place is still clear of the circle; then move, unseen.
    fade = gap(last.lift) > 0 ? Math.max(0, last.fade - step) : 0
    lift = fade > 0 ? last.lift : target
  }
  return { lift, fade, opacity: fade * shows(lift) }
}
