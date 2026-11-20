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
 * How far a point on screen is clear of the circle of `radius` round the centre, upward: its
 * height above the circle's upper edge where it is within the circle's width, and to the sides
 * how far beyond its width. Positive outside, negative inside or under it, and continuous, so a
 * marker kept above it never jumps. `x`, `y`: from the screen's centre, as shares of its height.
 */
export function clearance(x: number, y: number, radius: number): number {
  return Math.max(y - Math.sqrt(Math.max(0, radius * radius - x * x)), Math.abs(x) - radius)
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

/** Seconds an eased jump takes to close most of the way (about two thirds). */
export const LIFT_EASE = 0.1

/**
 * One frame of your own marker: where it is drawn and how much of it shows. While it shows in
 * full, the clear lift is followed at once, however fast the camera moves, unless the way there
 * passes through the circle: with the car off to one side and the camera steeply up, the nearest
 * lift that clears it can switch from beside it to above it. That jump is eased instead, and so
 * is any move while it is faded, so it fades back in where it lands rather than appearing there.
 * How much shows is measured where it is drawn, so on its way through the circle it is not seen:
 * it never shows over the centre, and never pops. `last` is last frame's result, or null.
 */
export function stepOwnMarker(last: { lift: number; opacity: number } | null, base: number, radius: number, screenOf: (lift: number) => readonly [number, number] | null, dt: number): { lift: number; opacity: number } {
  const target = clearOfCentre(base, radius, screenOf).lift
  const shown = last?.lift ?? null
  const delta = shown === null ? 0 : target - shown
  let ease = last !== null && last.opacity < 0.999
  if (shown !== null && radius > 0) for (let k = 1; k < 8 && !ease; k++) {
    const p = screenOf(shown + delta * k / 8)
    ease = p !== null && clearance(p[0], p[1], radius) < 0
  }
  const lift = shown === null || !ease ? target : shown + delta * (1 - Math.exp(-Math.max(0, dt) / LIFT_EASE))
  if (!(radius > 0)) return { lift, opacity: 1 }
  const p = screenOf(lift)
  const x = p ? Math.min(1, Math.max(0, clearance(p[0], p[1], radius) / (radius * CLEAR_MARGIN))) : 1
  return { lift, opacity: x * x * (3 - 2 * x) }
}
