/**
 * The loft body's features, metres, game frame. Every number is a handle: placed by hand from
 * the reference's material regions, not fitted.
 */
export const FEATURES = {
  /** Cockpit opening: an ellipse in plan, and the swept chrome lip round it (half width across, half height). */
  cockpit: { z: .03, halfLength: .64, halfWidth: .45, lipWidth: .05, lipHeight: .03 },
  /** Side scoops: an ellipse on each flank (centre z and y, radii along z and y), its lip and its depth. */
  scoop: { z: .0, y: .3, halfLength: .15, halfHeight: .2, lip: .022, depth: .13 },
  /** Headlights: a round duct each side of the nose, its bezel and depth. */
  head: { x: .56, y: .365, r: .085, bezel: .018, depth: .07 },
  /** Tail lamps: a thin bar each side of the rear panel, centre x and y, half length, half height, proud of the panel by `depth`. */
  tail: { x: .48, y: .515, halfLength: .17, halfHeight: .016, depth: .012 },
  /** Centre stripe half width, on the deck and the wing. */
  stripe: .17,
  /** Rear wing and end plates: superellipse rows [z, halfWidth, top, bottom, centreY, exponent]; plates at x = +-plateX. */
  wing: [[1.62, .62, .008, .008, .972, 3], [1.67, .72, .03, .02, .978, 6], [1.98, .72, .03, .02, .99, 6], [2.05, .64, .008, .008, .995, 3]],
  plate: [[1.42, .02, .05, .05, .84, 4], [1.6, .03, .14, .14, .86, 5], [1.98, .03, .12, .12, .9, 5], [2.04, .02, .06, .06, .93, 4]],
  plateX: .7,
}

/** How many scalars the feature data holds. */
export const FEATURE_NUMBERS = 5 + 6 + 5 + 5 + 1 + 24 + 24 + 1
