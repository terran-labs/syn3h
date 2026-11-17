/**
 * Named shape handles for the cage buggy body: the rig behind the vehicle editor. Each handle
 * is a smooth, symmetric, localised displacement field over the cage's control points before
 * subdivision, so the subdivided surface stays fair and the cage's creases stay crisp. The
 * sculpted features (headlight ducts, side scoops, hood scoop, tail lamps, cockpit rim) do not
 * take the field directly: rig.ts moves each one as a rigid body that follows the field, so
 * they never stretch (see features.ts).
 *
 * All handles default to 0, which is the fitted buggy unchanged. The wheels, axle mounts and
 * shock tops never move; tools/buggy-fit/shape/check.ts measures what each range does.
 *
 * The ideas follow the owner's Blender variations (tools/buggy-bodies/variants.py and
 * build.py deform()): nose and tail length, nose drop, height, cabin, hips, shoulders, tail
 * kick, tuck, spoiler height and reach.
 */

export interface Handle {
  id: string
  label: string
  /** What the number means, for a tooltip. */
  help: string
  min: number
  max: number
  step: number
  /**
   * The part of the range random buggies are drawn from, where the checks in
   * tools/buggy-fit/shape/check.ts pass; the rest of the range is reachable by hand and is
   * there to show where the rig stops. Absent means the whole range.
   */
  safe?: readonly [number, number]
}

/**
 * The handles, in the order a sidebar lists them. Units are metres unless the help says
 * otherwise. Every range spans at most 63 steps (one share code character each).
 */
export const HANDLES = [
  { id: 'noseLength', label: 'Nose length', help: 'Stretches the body ahead of the front axle (m).', min: -.2, max: .5, step: .02 },
  { id: 'noseDroop', label: 'Nose droop', help: 'Lowers the top of the nose, the floor stays (m).', min: -.12, max: .24, step: .01 },
  { id: 'noseWidth', label: 'Nose width', help: 'Widens or tapers the body toward the nose (fraction at the tip).', min: -.3, max: .2, step: .01, safe: [-.15, .2] },
  { id: 'tailLength', label: 'Tail length', help: 'Stretches the body behind the rear axle (m).', min: -.2, max: .5, step: .02 },
  { id: 'tailHeight', label: 'Tail height', help: 'Raises the deck toward the tail (m).', min: -.12, max: .24, step: .01 },
  { id: 'tailWidth', label: 'Tail width', help: 'Widens or tapers the body toward the tail (fraction at the tip).', min: -.3, max: .2, step: .01, safe: [-.15, .2] },
  { id: 'width', label: 'Width', help: 'Widens the whole body about the centre line (fraction).', min: -.06, max: .2, step: .005, safe: [0, .12] },
  { id: 'height', label: 'Height', help: 'Raises the deck and everything on it, the sides stay (fraction of height).', min: -.3, max: .3, step: .01, safe: [-.12, .3] },
  { id: 'rideHeight', label: 'Ride height', help: 'Moves the whole body up or down over the axles, which stay (m).', min: -.06, max: .08, step: .005, safe: [-.06, .03] },
  { id: 'deckCrown', label: 'Deck crown', help: 'Raises the centre line of hood and deck against the sides (m).', min: -.1, max: .16, step: .01, safe: [-.1, .1] },
  { id: 'shoulder', label: 'Shoulder line', help: 'Raises or lowers the crease along the upper side (m).', min: -.1, max: .12, step: .01, safe: [-.1, .06] },
  { id: 'cabinPosition', label: 'Cabin position', help: 'Moves the cockpit and its rim along the body (m, + toward the tail).', min: -.2, max: .2, step: .01 },
  { id: 'cockpitSize', label: 'Cockpit size', help: 'Scales the cockpit rim, canopy and tub uniformly (fraction).', min: -.15, max: .15, step: .01 },
  { id: 'frontFlare', label: 'Front fender flare', help: 'Swells the shoulders over the front wheels (m).', min: -.04, max: .2, step: .005, safe: [0, .2] },
  { id: 'rearFlare', label: 'Rear fender flare', help: 'Swells the haunches over the rear wheels (m).', min: -.04, max: .2, step: .005, safe: [0, .2] },
  { id: 'haunchHeight', label: 'Haunch height', help: 'Raises the rear haunches and their fins (m).', min: -.08, max: .24, step: .01, safe: [-.08, .14] },
  { id: 'spoilerHeight', label: 'Spoiler height', help: 'Raises the rear wing on its plates (m).', min: -.1, max: .4, step: .01, safe: [-.1, .25] },
  { id: 'spoilerRake', label: 'Spoiler rake', help: 'Tilts the rear wing, trailing edge up (degrees).', min: -12, max: 20, step: 1 },
  { id: 'scoopSize', label: 'Scoop size', help: 'Scales the side scoops uniformly (fraction).', min: -.3, max: .3, step: .02 },
  { id: 'lampSize', label: 'Headlight size', help: 'Scales the headlight ducts and lenses uniformly (fraction).', min: -.25, max: .25, step: .01 },
  { id: 'belly', label: 'Belly clearance', help: 'Lifts the floor between the wheels (m).', min: -.03, max: .08, step: .005 },
] as const satisfies readonly Handle[]

export type HandleId = typeof HANDLES[number]['id']
export type Shape = Record<HandleId, number>

export const defaultShape = (): Shape => Object.fromEntries(HANDLES.map(h => [h.id, 0])) as Shape
export const isDefaultShape = (s: Shape): boolean => HANDLES.every(h => s[h.id] === 0)

/** Clamp every value into its range and onto its step. */
export function clampShape(s: Partial<Shape>): Shape {
  const out = defaultShape()
  for (const h of HANDLES) {
    const v = Number(s[h.id] ?? 0)
    // Rounded to the step, then to 1e-9, so a value read back from a share code is the same number.
    out[h.id] = Number.isFinite(v) ? +Math.min(h.max, Math.max(h.min, Math.round(v / h.step) * h.step)).toFixed(9) : 0
  }
  return out
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** A smooth bump: 1 at c, 0 beyond c +- r. */
const bump = (c: number, r: number, x: number) => { const t = Math.min(1, Math.abs(x - c) / r); return (1 - t * t) ** 2 }

/** Landmarks of the fitted body (metres, game frame), checked against cage250 (see check.ts). */
export const LANDMARKS = { AXLE_Z: 1.237, FLOOR: -.08, NOSE: -1.96, TAIL: 2.05, SPOILER_Y: .88, HALF_WIDTH: .97 }
const { AXLE_Z, FLOOR, NOSE, TAIL, SPOILER_Y, HALF_WIDTH } = LANDMARKS

/**
 * A feature the field scales locally about its centre (the feature itself is then scaled
 * exactly by the rig): centre, radius of the region that flows with it, and its handle.
 */
export interface ScaledRegion { centre: [number, number, number]; radius: number; handle: HandleId }

/**
 * The displacement field at one point of the half body (x >= 0), metres, into `out`.
 * `regions` are the features with a size handle, so the paint around them makes room.
 */
export function field(x0: number, y0: number, z0: number, s: Shape, regions: readonly ScaledRegion[], out: number[]): void {
  let x = x0, y = y0, z = z0
  const up = smooth(FLOOR, .9, y0) // 0 at the floor, 1 on the deck
  // Sized features: a local scale about each centre, fading out over its region.
  for (const r of regions) {
    const k = s[r.handle]
    if (!k) continue
    const d = Math.hypot(x0 - r.centre[0], y0 - r.centre[1], z0 - r.centre[2]), f = k * bump(0, r.radius, d)
    x += (x0 - r.centre[0]) * f; y += (y0 - r.centre[1]) * f; z += (z0 - r.centre[2]) * f
  }
  // Cabin: slide the cockpit region along the body, fading out ahead of it and behind it.
  z += s.cabinPosition * bump(.08, 1.45, z0) * smooth(.3, .6, y0) * (1 - smooth(.65, .85, x0))
  // Fender flares: push outward over each axle, fading to nothing at the centre line.
  const side = smooth(.35, .75, x0) * bump(.42, .45, y0)
  x += side * (s.frontFlare * bump(-AXLE_Z, .6, z0) + s.rearFlare * bump(AXLE_Z, .6, z0))
  // Shoulder: the upper side band, where the side turns into the deck, up or down.
  y += s.shoulder * smooth(.5, .8, x0) * bump(.55, .3, y0)
  // Haunches: lift the outer rear deck and its fins.
  y += s.haunchHeight * smooth(.45, .75, x0) * bump(1.25, .55, z0) * up
  // Spoiler: lift the wing and the top of its plates; rake tilts it about the leading edge.
  const wing = smooth(1.45, 1.62, z0) * smooth(.62, SPOILER_Y, y0)
  y += wing * (s.spoilerHeight + Math.tan(s.spoilerRake * Math.PI / 180) * Math.max(0, z0 - 1.62))
  // Tail kick, then nose droop: deck heights that grow toward each end.
  y += s.tailHeight * smooth(.6, TAIL, z0) * up
  y -= s.noseDroop * smooth(-.9, NOSE, z0) * up
  // Crown: the deck's centre line up against its edges, over hood and tail deck.
  y += s.deckCrown * (1 - (Math.min(x0, HALF_WIDTH) / HALF_WIDTH) ** 2) * smooth(.35, .75, y0)
  // Belly: lift the floor between the axles, nothing at the ends.
  y += s.belly * (1 - smooth(FLOOR, .2, y0)) * (1 - smooth(.8, 1.3, Math.abs(z0)))
  // Overall height about the floor. Only the deck rises, so the sides that carry the sockets
  // and shock tops stay put.
  y += (y0 - FLOOR) * s.height * smooth(.4, .7, y0)
  // Width, then taper toward each end (the taper grows from the axle to the tip).
  x *= 1 + s.width + s.noseWidth * smooth(-.9, NOSE, z0) + s.tailWidth * smooth(.9, TAIL, z0)
  // Nose and tail length: stretch only beyond the axles, so the wheelbase stays.
  if (z0 < -AXLE_Z) z -= s.noseLength * smooth(-AXLE_Z, NOSE, z0)
  if (z0 > AXLE_Z) z += s.tailLength * smooth(AXLE_Z, TAIL, z0)
  // Ride height: everything.
  y += s.rideHeight
  out[0] = x0 === 0 ? 0 : x; out[1] = y; out[2] = z
}
