/**
 * How much of a bright effect to draw when it goes off close to the camera: 1 from NEAR_FULL
 * metres out, falling with distance to NEAR_MIN at the lens. A Plasma Thunder burst on your own
 * car is about 6 m from the chase camera, and a burst is tens of metres across: its flash and
 * stars filled the view (half the frame near white at night for a third of a second; three of
 * them, three quarters for most of a second). Bursts beyond NEAR_FULL, the flare seen across the
 * map that the owner asked for, are drawn exactly as before.
 */
export const NEAR_FULL = 25
export const NEAR_MIN = 0.2
/**
 * A hit's own flash is metres, not tens of metres, across: it is drawn down only inside this
 * range, so the vehicle hits made to read at 15 to 40 m (ImpactFx) are untouched.
 */
export const NEAR_HIT = 12

export function nearLens(distance: number, full = NEAR_FULL): number {
  return Math.min(1, Math.max(NEAR_MIN, distance / full))
}
