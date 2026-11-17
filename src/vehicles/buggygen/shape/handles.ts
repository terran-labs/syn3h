/**
 * Named shape handles for the cage buggy body: the proof of concept for an in-game vehicle
 * editor. Each handle is a smooth, symmetric, localised displacement of the cage's control
 * points before subdivision, so the subdivided surface stays fair and the cage's creases stay
 * crisp (creases are topology, and a smooth field moves both sides of a crease together).
 *
 * All handles default to 0, which is the fitted buggy unchanged. Ranges are bounded so every
 * vector in range is a valid buggy: the axle mounts, shock tops and wheel positions in
 * LoadedBuggySkin stay where they are, the body keeps covering the sockets, and the driver's
 * eye keeps its clearance (PATTERN.md rule 3). tools/buggy-fit/shape/check.ts tests that.
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
}

/** The handles, in the order a sidebar lists them. Units are metres unless the help says otherwise. */
export const HANDLES = [
  { id: 'noseLength', label: 'Nose length', help: 'Stretches the body ahead of the front axle (m).', min: -.15, max: .25, step: .01 },
  { id: 'noseDroop', label: 'Nose droop', help: 'Lowers the top of the nose, the floor stays (m).', min: -.08, max: .14, step: .01 },
  { id: 'tailLength', label: 'Tail length', help: 'Stretches the body behind the rear axle (m).', min: -.12, max: .2, step: .01 },
  { id: 'tailHeight', label: 'Tail height', help: 'Raises the deck toward the tail (m).', min: -.08, max: .14, step: .01 },
  { id: 'width', label: 'Width', help: 'Widens the whole body about the centre line (fraction).', min: 0, max: .1, step: .005 },
  { id: 'height', label: 'Height', help: 'Raises the deck and everything on it, the sides stay (fraction of height).', min: -.1, max: .12, step: .01 },
  { id: 'cockpitLength', label: 'Cockpit length', help: 'Lengthens the cockpit opening and its rim (fraction).', min: -.12, max: .18, step: .01 },
  { id: 'cockpitWidth', label: 'Cockpit width', help: 'Widens the cockpit opening and its rim (fraction).', min: -.1, max: .12, step: .01 },
  { id: 'frontFlare', label: 'Front fender flare', help: 'Swells the shoulders over the front wheels (m).', min: -.02, max: .12, step: .005 },
  { id: 'rearFlare', label: 'Rear fender flare', help: 'Swells the haunches over the rear wheels (m).', min: -.02, max: .12, step: .005 },
  { id: 'haunchHeight', label: 'Haunch height', help: 'Raises the rear haunches and their fins (m).', min: -.05, max: .14, step: .01 },
  { id: 'spoilerHeight', label: 'Spoiler height', help: 'Raises the rear wing on its plates (m).', min: -.07, max: .25, step: .01 },
  { id: 'spoilerRake', label: 'Spoiler rake', help: 'Tilts the rear wing, trailing edge up (degrees).', min: -8, max: 14, step: 1 },
  { id: 'scoopSize', label: 'Scoop size', help: 'Grows or shrinks the side scoops (fraction).', min: -.2, max: .2, step: .05 },
  { id: 'belly', label: 'Belly clearance', help: 'Lifts the floor between the wheels (m).', min: -.03, max: .05, step: .005 },
] as const satisfies readonly Handle[]

export type HandleId = typeof HANDLES[number]['id']
export type Shape = Record<HandleId, number>

export const defaultShape = (): Shape => Object.fromEntries(HANDLES.map(h => [h.id, 0])) as Shape

/** Clamp every value into its range and onto its step. */
export function clampShape(s: Partial<Shape>): Shape {
  const out = defaultShape()
  for (const h of HANDLES) {
    const v = Number(s[h.id] ?? 0)
    out[h.id] = Number.isFinite(v) ? Math.min(h.max, Math.max(h.min, Math.round(v / h.step) * h.step)) : 0
  }
  return out
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** A smooth bump: 1 at c, 0 beyond c +- r. */
const bump = (c: number, r: number, x: number) => { const t = Math.min(1, Math.abs(x - c) / r); return (1 - t * t) ** 2 }

/** Landmarks of the fitted body (metres, game frame). */
const AXLE_Z = 1.237, FLOOR = -.08, NOSE = -1.96, TAIL = 2.05, COCKPIT_Z = .03, SPOILER_Y = .88

/**
 * Deform half-cage points (x >= 0; x = 0 stays on the mirror plane), metres, in place.
 * `frame` marks points of dark frame faces, which carry the scoops.
 */
export function deform(p: Float64Array, frame: Uint8Array, s: Shape): void {
  const n = p.length / 3
  for (let i = 0; i < n; i++) {
    let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
    const x0 = x, y0 = y, z0 = z
    const up = smooth(FLOOR, .9, y0) // 0 at the floor, 1 on the deck
    // Scoops: scale the frame points of the side scoops about each scoop's centre.
    // The field covers the scoop and the paint around it, fading out, so the rim moves with the hole.
    if (x0 > .5) { const k = s.scoopSize * bump(0, .7, z0) * bump(.3, .4, y0) * (frame[i] ? 1 : .6); z += z0 * k; y += (y0 - .3) * k }
    // Cockpit: scale the rim region about the opening's centre in plan.
    const rim = smooth(.5, .62, y0) * bump(COCKPIT_Z, 1.0, z0) * (1 - smooth(.55, .75, x0))
    x += x0 * s.cockpitWidth * rim
    z += (z0 - COCKPIT_Z) * s.cockpitLength * rim
    // Fender flares: push outward over each axle, fading to nothing at the centre line.
    const side = smooth(.35, .75, x0) * bump(.42, .45, y0)
    x += side * (s.frontFlare * bump(-AXLE_Z, .6, z0) + s.rearFlare * bump(AXLE_Z, .6, z0))
    // Haunches: lift the outer rear deck and its fins.
    y += s.haunchHeight * smooth(.45, .75, x0) * bump(1.25, .55, z0) * up
    // Spoiler: lift the wing and the top of its plates; rake tilts it about the leading edge.
    const wing = smooth(1.45, 1.62, z0) * smooth(.62, SPOILER_Y, y0)
    y += wing * (s.spoilerHeight + Math.tan(s.spoilerRake * Math.PI / 180) * Math.max(0, z0 - 1.62))
    // Tail kick, then nose droop: deck heights that grow toward each end.
    y += s.tailHeight * smooth(.6, TAIL, z0) * up
    y -= s.noseDroop * smooth(-.9, NOSE, z0) * up
    // Belly: lift the floor between the axles, nothing at the ends.
    y += s.belly * (1 - smooth(FLOOR, .2, y0)) * (1 - smooth(.8, 1.3, Math.abs(z0)))
    // Overall height and width, about the floor and the centre line.
    // Only the deck rises, so the sides that carry the sockets and shock tops stay put.
    y += (y0 - FLOOR) * s.height * smooth(.4, .7, y0)
    x *= 1 + s.width
    // Nose and tail length: stretch only beyond the axles, so the wheelbase stays.
    if (z0 < -AXLE_Z) z -= s.noseLength * smooth(-AXLE_Z, NOSE, z0)
    if (z0 > AXLE_Z) z += s.tailLength * smooth(AXLE_Z, TAIL, z0)
    p[i * 3] = x0 === 0 ? 0 : x; p[i * 3 + 1] = y; p[i * 3 + 2] = z
  }
}
