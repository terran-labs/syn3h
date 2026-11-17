/**
 * The loft body's features, metres, game frame. Every number is a handle: placed by hand from
 * the reference's material regions, not fitted.
 */
export const FEATURES = {
  /** Cockpit opening: an ellipse in plan, and the swept chrome lip round it (half width across, half height). */
  cockpit: { z: .03, halfLength: .64, halfWidth: .45, lipWidth: .05, lipHeight: .03 },
  /** Side scoops: a slot on each flank (centre z and y, radii along z and y, tilt in radians, top leaning back), its lip and its depth. */
  scoop: { z: .02, y: .27, halfLength: .085, halfHeight: .21, tilt: -.35, lip: .028, depth: .12 },
  /**
   * Headlight ducts. Each sits on the axis of the parts' duct lens (parts/sockets.ts DUCT_LAMP),
   * which the parts seat inside it: the duct is that lens's outline times `scale`, `depth` deep
   * behind the lens, under a chrome bezel.
   */
  head: { scale: 1.15, bezel: .016, depth: .03 },
  /** Rear panel: recessed `depth` into the tail, `inset` in from the sides and floor, under a deck lip `lip` deep. */
  rear: { inset: .06, lip: .1, depth: .07 },
  /** Tail lamps: a thin bar each side of the rear panel: centre x, height as a fraction of the panel, half length, half height, proud of the panel by `depth`. */
  tail: { x: .4, y: .55, halfLength: .13, halfHeight: .016, depth: .012 },
  /** Centre stripe half width, on the deck and the wing, and the z where it starts behind the nose. */
  stripe: .17,
  stripeStart: -1.72,
  /** Rear wing and end plates: superellipse rows [z, halfWidth, top, bottom, centreY, exponent]. The plates follow the fin line (the hull's shoulder) less `plateInset`. */
  wing: [[1.62, .62, .008, .008, .972, 3], [1.67, .72, .03, .02, .978, 6], [1.98, .72, .03, .02, .99, 6], [2.05, .64, .008, .008, .995, 3]],
  plate: [[1.48, .015, .02, .02, .84, 4], [1.6, .024, .09, .08, .89, 5], [1.98, .024, .08, .07, .91, 5], [2.03, .015, .03, .03, .93, 4]],
  plateInset: .012,
}
export type Features = typeof FEATURES

/** How many scalars the feature data holds. */
export const FEATURE_NUMBERS = 5 + 7 + 3 + 3 + 5 + 2 + 24 + 24 + 1
