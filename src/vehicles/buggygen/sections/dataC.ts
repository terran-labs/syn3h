import type { Ellipse } from './loft'

/**
 * Level C features, metres. Read off the reference's slices and material bounds by hand
 * (tools/buggy-fit/sections), so each is a meaningful handle as well as a fit. Order matters:
 * the first feature containing a cell decides its role.
 */
export const FEATURES: Ellipse[] = [
  // Cockpit opening, then its chrome rim: plan ellipses on upward-facing skin above y 0.4.
  { role: null, plane: 'xz', c: [0, .03], r: [.45, .64], band: [.4, 2], facing: .15, snap: .065 },
  { role: 'chrome', plane: 'xz', c: [0, .03], r: [.52, .71], band: [.38, 2], facing: .1, snap: .065 },
  // Headlights: one round lamp each side of the nose, facing forward.
  { role: 'lamp', plane: 'xy', c: [.56, .365], r: [.085, .075], band: [-2.2, -1.45], facing: -.3, snap: .035 },
  // Tail lights: a wide oval each side of the tail, facing back.
  { role: 'lamp', plane: 'xy', c: [.5, .51], r: [.2, .06], band: [1.7, 2.2], facing: .5, snap: .03 },
  // Side scoops: dark ovals on the flanks behind the front wheels.
  { role: 'frame', plane: 'zy', c: [0, .3], r: [.32, .18], band: [.5, 1.2], facing: .5, snap: .065 },
  // The centre stripe along the top, hull and wing.
  { role: 'accent', plane: 'xz', c: [0, 0], r: [.17, 99], band: [.3, 2], facing: .2, snap: .065 },
]

/** Rear wing: Level A rows [z, halfWidth, top, bottom, centreY, exponent]. */
export const WING = [[1.62, .62, .008, .008, .972, 3], [1.67, .72, .03, .02, .978, 6], [1.98, .72, .03, .02, .99, 6], [2.05, .64, .008, .008, .995, 3]]
/** End plates joining the wing to the rear fins, built at x = +-PLATE_X. */
export const PLATE = [[1.42, .02, .05, .05, .84, 4], [1.6, .03, .14, .14, .86, 5], [1.98, .03, .12, .12, .9, 5], [2.04, .02, .06, .06, .93, 4]]
export const PLATE_X = .7
