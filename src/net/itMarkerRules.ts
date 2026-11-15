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
 */

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
