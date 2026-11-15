import * as T from 'three/webgpu'
import { Builder, bodyRings, loft } from '../jetgen/shapes'
import { HOVER_EYE, hoverHull, plugNozzle, type Anchor, type HoverBuild } from '../hover/kit'

export { floating, plugNozzle, hoverHull as round3Hull, type Anchor, type HoverBuild as Round3Build } from '../hover/kit'

/**
 * Round three: ten explorations on the original hovercraft's proportions.
 *
 * The owner accepted round two's proportions and rejected its fittings: the headlights and
 * tail lamps were placed at fixed coordinates and hung in the air beside the hull. Nothing
 * here is placed by coordinate. Every fitting asks the hull where its skin is and is built
 * from that answer:
 *
 * - headlights are either lamps set flush in the nose (turned to lie along its outline, on a
 *   low blister whose back is inside the hull) or a light bar that follows the nose's own
 *   outline a few millimetres proud of the skin;
 * - tail lamps are stacked bars set in a socket that is turned to lie along the stern, or a
 *   band that follows the stern's outline;
 * - vents are ducts that follow the hull's skin on a faired base (the shape kit's intake);
 * - spoiler supports root below the deck, inside the hull.
 *
 * Each fitting records an anchor: a point that must be inside the hull. `floating()` lists
 * the anchors that are not, and hover-round3.test.ts requires that list to be empty.
 *
 * Styling inputs. From the approved Box arm buggy: lamps recessed in dark sockets, a centre
 * stripe, flank vents, thick box wing supports with accent ribs. From the approved Hexring
 * Mk2 jet: six-sided thruster ring, faceted accent plates, twin booms, drooped accent tips.
 */
export const R3_EYE = HOVER_EYE
export interface Round3Design {
  id: string; name: string; notes: string; paint: number; accent: number
  /** Hull: width multipliers at the shoulders, waist and rear quarters. */
  shoulder: number; waist: number; rear: number
  /** Half width where the nose meets the shoulders, extra nose length, deck height multiplier, squareness added to every section, stern half width. */
  nose: number; reach: number; deck: number; box: number; tail: number
  /** Straight-edged, faceted wings and plates, as on the jet. */
  hard?: boolean
  canopy: { z0: number; z1: number; width: number; bulge: number }
  head: 'socket' | 'twin' | 'visor'
  lamps: 'bars' | 'band'
  thruster: 'stalk' | 'hex' | 'twin' | 'stern'
  spoiler: 'classic' | 'box' | 'hex' | 'fins' | 'tee' | 'arch' | 'duck'
  /** Spoiler height multiplier. */
  blade: number
  vents: boolean; stripe: boolean
  chine: 'chrome' | 'accent' | 'none'
}

const base = { shoulder: 1, waist: 1, rear: 1, nose: .54, reach: 0, deck: 1, box: 0, tail: .68, blade: 1, canopy: { z0: -1.37, z1: .43, width: .55, bulge: .42 } }
export const R3_DESIGNS: Round3Design[] = [
  { ...base, id: 'h3-gt', name: 'GT', notes: 'The original, finished like the buggy: headlamps recessed in the nose, a centre stripe over the nose and wing, stacked tail bars set into the stern.', paint: 0x2f55c8, accent: 0xf6a623, head: 'socket', lamps: 'bars', thruster: 'stalk', spoiler: 'classic', vents: false, stripe: true, chine: 'chrome' },
  { ...base, id: 'h3-hexring', name: 'Hexring', notes: 'The jet\'s language on the original hull: a six-sided thruster ring, a faceted accent wing braced back to it, a light bar round the nose.', paint: 0x565c66, accent: 0xff3d5a, hard: true, box: .5, head: 'visor', lamps: 'band', thruster: 'hex', spoiler: 'hex', vents: true, stripe: false, chine: 'accent', canopy: { z0: -1.42, z1: .40, width: .52, bulge: .43 } },
  { ...base, id: 'h3-boom', name: 'Twin boom', notes: 'The single thruster becomes two, each lofted out of a rear quarter as on the jet, with a low wing bridging the boom fins.', paint: 0x3d4f66, accent: 0x49e6ff, rear: 1.02, head: 'socket', lamps: 'band', thruster: 'twin', spoiler: 'fins', vents: false, stripe: false, chine: 'chrome' },
  { ...base, id: 'h3-rally', name: 'Rally', notes: 'Closest to the buggy: thick box wing supports with accent ribs, a wide striped wing, flank vents and paired round lamps.', paint: 0x1f4fa8, accent: 0xff8a1e, shoulder: 1.02, rear: 1.03, blade: 1.04, head: 'twin', lamps: 'bars', thruster: 'stalk', spoiler: 'box', vents: true, stripe: true, chine: 'chrome' },
  { ...base, id: 'h3-manta', name: 'Manta', notes: 'A wider, lower reading: fuller shoulders, a tighter waist, a long low canopy and outward fins with drooped accent tips in place of the wing.', paint: 0x16606b, accent: 0xb9f27c, shoulder: 1.04, waist: .93, deck: .92, head: 'visor', lamps: 'band', thruster: 'stalk', spoiler: 'fins', vents: false, stripe: false, chine: 'accent', canopy: { z0: -1.45, z1: .46, width: .6, bulge: .45 } },
  { ...base, id: 'h3-ducktail', name: 'Ducktail', notes: 'No separate wing: a lip rises out of the rear quarters and the thruster exits through the stern itself. The cleanest outline of the ten.', paint: 0xb8321f, accent: 0xf2e6c8, tail: .9, head: 'socket', lamps: 'band', thruster: 'stern', spoiler: 'duck', vents: true, stripe: true, chine: 'none' },
  { ...base, id: 'h3-arrow', name: 'Arrow', notes: 'A longer, sharper nose and a T wing carried on a single pylon that grows out of the thruster spine.', paint: 0xe9edf2, accent: 0x1e6bff, nose: .36, reach: .1, waist: .94, head: 'visor', lamps: 'bars', thruster: 'stalk', spoiler: 'tee', vents: false, stripe: true, chine: 'accent', canopy: { z0: -1.40, z1: .40, width: .52, bulge: .43 } },
  { ...base, id: 'h3-brute', name: 'Brute', notes: 'Squarer sections and a taller deck: the original\'s outline as a heavy hauler, with box supports, twin lamps and a faceted wing.', paint: 0x4a5a2f, accent: 0xffc93c, hard: true, box: 1.1, deck: 1.1, tail: .86, shoulder: 1.01, blade: .96, head: 'twin', lamps: 'bars', thruster: 'hex', spoiler: 'box', vents: true, stripe: false, chine: 'none' },
  { ...base, id: 'h3-halo', name: 'Halo', notes: 'The wing and its supports drawn as one continuous hoop from quarter to quarter over the thruster.', paint: 0x6a2c91, accent: 0xffd6f5, blade: 1.03, head: 'socket', lamps: 'band', thruster: 'stalk', spoiler: 'arch', vents: false, stripe: false, chine: 'chrome' },
  { ...base, id: 'h3-sprint', name: 'Sprint', notes: 'A racing reading: narrow waist, low canopy, twin thrusters in the quarters, a stern lip and a full stripe.', paint: 0x111418, accent: 0x38f5a0, waist: .9, deck: .94, rear: 1.03, tail: .86, head: 'visor', lamps: 'band', thruster: 'twin', spoiler: 'duck', vents: true, stripe: true, chine: 'accent', canopy: { z0: -1.42, z1: .38, width: .52, bulge: .45 } },
]

export function buildRound3(d: Round3Design, detail: number): HoverBuild {
  const b = new Builder(detail, Boolean(d.hard)), hull = hoverHull(d)
  const z0 = hull[0][0], z1 = hull[hull.length - 1][0]
  const head: T.BufferGeometry[] = [], tail: T.BufferGeometry[] = [], beams: [number, number, number][] = [], anchors: Anchor[] = []
  const ring = (n: number) => Math.max(6, 2 * Math.round(n * detail / 2)), seg = (n: number) => Math.max(1, Math.round(n * detail))
  b.fuselage(hull)
  const inside = (x: number, y: number, z: number) => {
    if (z < z0 || z > z1) return false
    const [w, t, bt, yc, e] = b.at(z), h = y >= yc ? t : bt
    return (Math.abs(x) / w) ** e + (Math.abs(y - yc) / h) ** e <= 1
  }
  /** Where a line along Z at (x, y) first meets the skin, coming from the nose (1) or the stern (-1). */
  const meet = (x: number, y: number, from: 1 | -1) => {
    for (let i = 0; i < 400; i++) { const z = from > 0 ? z0 + i * .005 : z1 - i * .005; if (inside(x, y, z)) return z }
    throw new Error(`${d.id}: no hull at x ${x}, y ${y}`)
  }
  const tube = (rows: number[][], x: number, around: number, n = 1) => [false, true].map(m => loft(bodyRings(rows, x, n, ring(around), m)))

  // Flank vents, as on the buggy: a duct that follows the skin behind each shoulder on a low
  // fairing that starts ahead of the mouth and fades into the waist (the shape kit's intake).
  // Beyond 30 m a vent is a few pixels; the reduced model leaves it out.
  if (d.vents && detail >= .3) for (const angle of [40, 140]) { b.intake(-.98, -.3, angle, .15, .1); anchors.push({ what: 'vent', at: [(angle < 90 ? 1 : -1) * b.at(-.7)[0] * .7, b.at(-.7)[3], -.7] }) }
  b.cockpit(d.canopy.z0, d.canopy.z1, d.canopy.width, R3_EYE, { bulge: d.canopy.bulge, rim: .022, floor: .65 })
  for (const z of [-1.02, 1.0]) b.port(.96, z, .18, .24, .12)

  // Headlamps.
  if (d.head === 'visor') {
    // A light bar on the nose's own outline, thinning with the hull toward the tip.
    const n = seg(14) + 2, rows = (out: number, share: number, cap: number) => Array.from({ length: n + 1 }, (_, i) => {
      const z = z0 + .012 + .62 * i / n, [w, t, , yc, e] = b.at(z), h = Math.min(cap, t * share)
      return [z, w + out, h, h, yc + t * .22, e]
    })
    b.add('dark', loft(bodyRings(rows(.007, .5, .05), 0, 1, ring(40))))
    head.push(loft(bodyRings(rows(.016, .2, .02), 0, 1, ring(40))))
    for (const x of [-.5, .5]) beams.push([x, b.at(z0 + .2)[3] + .03, z0 + .1])
    anchors.push({ what: 'light bar', at: [0, b.at(z0 + .3)[3], z0 + .3] })
  } else {
    // Lamps set flush in the nose. Each is turned to lie along the nose's outline where it sits,
    // so its face follows the skin, and a low blister behind it closes the gap where the skin
    // curves away above and below. Only the lens and its ring stand proud, by about 2 cm.
    const lamps = d.head === 'twin' ? [[.50 * d.shoulder, .07], [.80 * d.shoulder, .07]] : [[.70 * d.shoulder, .105]]
    for (const [x0, r] of lamps) for (const side of [-1, 1]) {
      const x = side * x0, y = b.at(z0 + .45)[3] + .035
      const zs = meet(x, y, 1), yaw = Math.max(-.9, Math.min(.9, Math.atan2(meet(x - .08, y, 1) - meet(x + .08, y, 1), .16)))
      const place = (g: T.BufferGeometry) => g.rotateY(yaw).translate(x, y, zs)
      const k = (z: number, f: number, e = 2.5) => [z, r * f, r * f, r * f, 0, e]
      const near = detail >= .3
      // The reduced model keeps the socket and lens and drops the blister and ring.
      if (near) b.add('paint', place(loft(bodyRings([k(-.012, 1.1), k(.05, 1.42), k(.32, 1.3), k(.75, .45)], 0, seg(5), ring(16)))))
      b.add('dark', place(loft(bodyRings([k(-.022, near ? .97 : 1.08), k(.06, near ? .97 : 1.08)], 0, 1, ring(16)))))
      if (near) b.add('chrome', place(new T.TorusGeometry(r * .99, r * .085, 6, Math.max(8, ring(18))).translate(0, 0, -.022)))
      head.push(place(new T.SphereGeometry(r * .84, near ? Math.max(8, ring(14)) : 6, near ? 6 : 3).scale(1, 1, .3).translate(0, 0, -.02)))
      beams.push([x, y, zs - .05])
      anchors.push({ what: 'headlamp', at: [x + .25 * Math.sin(yaw), y, zs + .25 * Math.cos(yaw)] })
    }
  }

  // Tail lamps.
  if (d.lamps === 'band') {
    // Two stacked bars on the stern's own outline, in one dark surround.
    const n = seg(12) + 2, rows = (out: number, lift: number, share: number, cap: number) => Array.from({ length: n + 1 }, (_, i) => {
      const z = z1 - .52 + .508 * i / n, [w, t, , yc, e] = b.at(z), h = Math.min(cap, t * share)
      return [z, w + out, h, h, yc + t * lift, e]
    })
    b.add('dark', loft(bodyRings(rows(.007, .22, .42, .085), 0, 1, ring(40))))
    for (const lift of [.06, .38]) tail.push(loft(bodyRings(rows(.016, lift, .1, .019), 0, 1, ring(40))))
    anchors.push({ what: 'tail band', at: [0, b.at(z1 - .3)[3], z1 - .3] })
  } else {
    // Two stacked bars per side in a socket turned to lie along the stern at that point.
    for (const side of [-1, 1]) {
      const x = side * .56 * d.tail / .68, y = b.at(z1 - .2)[3] + .05
      const za = meet(x - .17, y, -1), zb = meet(x + .17, y, -1), zs = (za + zb) / 2, yaw = Math.atan2(za - zb, .34)
      const place = (g: T.BufferGeometry, dz: number, dy = 0) => g.rotateY(yaw).translate(x, y + dy, zs + dz)
      b.add('dark', place(new T.BoxGeometry(.42, .2, .12), -.035))
      for (const dy of [-.045, .045]) tail.push(place(new T.BoxGeometry(.35, .048, .03), .026, dy))
      anchors.push({ what: 'tail lamp socket', at: [x, y, zs - .08] })
    }
  }

  // Thruster.
  const spine = () => b.body('chrome', [[.43, .06, .055, .045, .60, 2.5], [.85, .16, .13, .08, .75, 2.5], [1.34, .23, .18, .13, .84, 2.6]], { seg: 5, around: 20 })
  if (d.thruster === 'stalk' || d.thruster === 'hex') {
    // The original's chrome spine rising behind the canopy to the central nozzle.
    spine(); b.nozzle(1.36, .84, .22, .18, 0, 2.6); plugNozzle(b, 1.36, .84, .22, .18, 0, 2.6)
    b.add('glow', new T.CircleGeometry(.13, Math.max(8, Math.round(20 * detail))).translate(0, .84, 1.64))
    anchors.push({ what: 'thruster spine', at: [0, .5, .9] })
    // The jet's ring: a six-sided accent collar the nozzle passes through.
    if (d.thruster === 'hex') b.body('accent', [[1.33, .34, .30, .30, .84, 2], [1.56, .34, .30, .30, .84, 2]], { seg: 1, around: 6 })
  } else if (d.thruster === 'twin') {
    // Two booms lofted out of the rear quarters, each ending in its own nozzle.
    const x = .74 * d.rear, y = b.at(1.2)[3] + b.at(1.2)[1] * .62
    b.body('paint', [[-.1, .04, .04, .04, y - .14, 2.4], [.55, .27, .2, .2, y - .02, 2.5], [1.2, .29, .22, .22, y, 2.5], [1.6, .25, .2, .2, y, 2.5]], { x, mirror: true, seg: 7, around: 20 })
    b.nozzle(1.52, y, .2, .17, x, 2.5); plugNozzle(b, 1.52, y, .2, .17, x, 2.5)
    anchors.push({ what: 'boom', at: [x, y - .2, 1.0] }, { what: 'boom', at: [-x, y - .2, 1.0] })
  } else {
    // The thruster leaves through the stern itself: a short cowl grown from the deck, no stalk.
    const y = b.at(1.5)[3] + .1
    b.body('paint', [[.7, .1, .06, .06, y + .08, 2.5], [1.2, .3, .2, .2, y + .02, 2.6], [1.56, .31, .22, .22, y, 2.6]], { seg: 6, around: 20 })
    b.nozzle(1.56, y, .25, .19, 0, 2.6); plugNozzle(b, 1.56, y, .25, .19, 0, 2.6)
    b.add('glow', new T.CircleGeometry(.15, Math.max(8, Math.round(20 * detail))).translate(0, y, 1.84))
    anchors.push({ what: 'stern cowl', at: [0, y - .12, 1.3] })
  }

  // Spoiler. Every support roots below the deck.
  const top = 1.22 * d.blade, root = (x: number, z: number, what: string) => anchors.push({ what, at: [x, .44, z] }, { what, at: [-x, .44, z] })
  if (d.spoiler === 'classic') {
    b.surf([[.79, .50, .83, .64, .16], [.79, .88, 1.20, .49, .14], [.76, top, 1.45, .40, .14]], { tipFrom: .86 })
    b.surf([[0, top, 1.55, .26, .045], [.76, top, 1.49, .34, .045]], { round: false })
    if (d.stripe) b.surf([[0, top, 1.543, .274, .06], [.13, top, 1.541, .277, .06]], { mat: 'accent', round: false })
    root(.79, 1.1, 'spoiler support')
  } else if (d.spoiler === 'box') {
    // The buggy's box arms: thick supports with an accent rib, under a wing wider than they are.
    b.surf([[.84, .46, .92, .64, .25], [.84, .85, 1.16, .54, .23], [.82, top - .02, 1.36, .46, .21]], { mat: 'paint', round: false })
    b.surf([[.905, .56, 1.13, .13, .3], [.90, .86, 1.29, .12, .3], [.875, top - .1, 1.45, .10, .3]], { mat: 'accent', round: false })
    b.surf([[0, top, 1.40, .44, .06], [.82, top, 1.38, .46, .06], [1.14, top - .03, 1.43, .38, .06]], { mat: 'paint' })
    if (d.stripe) b.surf([[0, top, 1.392, .456, .075], [.14, top, 1.392, .456, .075]], { mat: 'accent', round: false })
    root(.84, 1.2, 'box support')
  } else if (d.spoiler === 'hex') {
    // Half of the jet's ring: straight supports, a faceted accent wing, and braces back to the thruster collar.
    b.surf([[.98, .46, .98, .56, .16], [.70, top, 1.40, .40, .12]], { mat: 'paint' })
    b.surf([[.70, top, 1.40, .40, .12], [0, top, 1.40, .40, .12]], { mat: 'accent' })
    b.surf([[.24, .92, 1.38, .22, .14], [.70, top, 1.44, .30, .1]], { mat: 'paint' })
    b.body('chrome', [[1.34, .03, .03, .03, top, 2], [1.5, .075, .075, .075, top, 2.2], [1.72, .075, .075, .075, top, 2.2], [1.85, .03, .03, .03, top, 2]], { x: .70, mirror: true, seg: 3, around: 12 })
    root(.98, 1.2, 'ring support')
  } else if (d.spoiler === 'fins') {
    // Two outward fins with the jet's drooped accent tips; twin booms carry a low wing between them.
    const x = d.thruster === 'twin' ? .74 * d.rear : .86, lean = d.thruster === 'twin' ? .1 : .2, foot = d.thruster === 'twin' ? .62 : .48
    b.surf([[x, foot, .96, .58, .15], [x + lean * .45, .92, 1.26, .46, .13], [x + lean, top, 1.50, .34, .11], [x + lean + .14, top - .1, 1.58, .22, .1]], { mat: 'paint', tip: 'accent', tipFrom: .7 })
    if (d.thruster === 'twin') b.surf([[0, .98, 1.36, .30, .05], [x + lean * .5, .98, 1.33, .34, .05]], { mat: 'paint', round: false })
    // A boom fin stands on its boom, which is anchored above; the others root in the deck.
    anchors.push({ what: 'fin', at: [x, .44, 1.2] }, { what: 'fin', at: [-x, .44, 1.2] })
  } else if (d.spoiler === 'tee') {
    // One pylon out of the thruster spine, carrying a wing with drooped accent tips.
    b.surf([[0, .72, .98, .70, .13], [0, 1.04, 1.2, .56, .11], [0, top + .08, 1.40, .44, .1]], { mat: 'paint', mirror: false, round: false })
    b.surf([[0, top + .08, 1.40, .44, .055], [.62, top + .07, 1.44, .38, .05], [1.02, top - .02, 1.53, .27, .05]], { mat: 'paint', tip: 'accent', tipFrom: .78 })
    if (d.stripe) b.surf([[0, top + .08, 1.392, .456, .07], [.12, top + .08, 1.392, .456, .07]], { mat: 'accent', round: false })
  } else if (d.spoiler === 'arch') {
    // Supports and wing as one hoop.
    b.surf([[.95, .46, .92, .62, .15], [.95, .92, 1.2, .48, .12], [.66, top + .08, 1.40, .38, .09], [0, top + .16, 1.46, .36, .08]], { mat: 'paint', round: false })
    root(.95, 1.2, 'hoop')
  } else {
    // A lip that rises out of the rear quarters and crosses above the stern.
    const y = b.at(1.5)[3] + b.at(1.5)[1]
    b.surf([[1.06 * d.rear, y - .12, 1.26, .50, .13], [.76, y + .1 * d.blade, 1.42, .40, .1], [0, y + .15 * d.blade, 1.48, .36, .09]], { mat: 'paint', round: false })
    if (d.stripe) b.surf([[.14, y + .145 * d.blade, 1.472, .376, .105], [0, y + .15 * d.blade, 1.472, .376, .105]], { mat: 'accent', round: false })
    anchors.push({ what: 'stern lip', at: [1.0 * d.rear, y - .16, 1.4] }, { what: 'stern lip', at: [-1.0 * d.rear, y - .16, 1.4] })
  }

  // The buggy's centre stripe, lying on the nose ahead of the canopy.
  if (d.stripe) {
    const from = z0 + .1, to = d.canopy.z0 - .05, n = seg(8) + 1
    b.add('accent', loft(bodyRings(Array.from({ length: n + 1 }, (_, i) => {
      const z = from + (to - from) * i / n, half = Math.min(.15, b.at(z)[0] * .5)
      return [z, half, .013, .03, b.skin(z, half), 6]
    }), 0, 1, ring(12))))
    anchors.push({ what: 'nose stripe', at: [0, b.skin(-1.6, 0) - .03, -1.6] })
  }

  // Chine lip on the original's ground-level outline, and a dark rim under it.
  if (d.chine !== 'none') b.body(d.chine, hull.map(([z, w, , , y, e]) => [z, w + .04, .018, .018, Math.max(.055, y - .14), e]), { seg: 10, around: 24 })
  b.body('dark', hull.map(([z, w, , , y, e]) => [z * .97, w * .94, .035, .03, Math.max(.045, y - .17), e]), { seg: 8, around: 20 })
  return { builder: b, head, tail, beams, anchors, inside }
}

/** One-draw outline for beyond 120 m: hull, canopy, thruster and the spoiler's main masses. */
export function round3Far(d: Round3Design): T.BufferGeometry[] {
  const hull = hoverHull(d), top = 1.22 * d.blade, box = (w: number, h: number, l: number, x: number, y: number, z: number, tilt = 0) => new T.BoxGeometry(w, h, l).rotateX(tilt).translate(x, y, z)
  const pieces = [loft(bodyRings(hull, 0, 1, 8)), loft(bodyRings([[d.canopy.z0, .03, .03, .02, .47, 2], [(d.canopy.z0 + d.canopy.z1) / 2 - .1, .49, .1 + d.canopy.bulge, .04, .48, 2.6], [d.canopy.z1, .04, .03, .02, .56, 2]], 0, 1, 8))]
  if (d.thruster === 'twin') for (const x of [-.74, .74]) pieces.push(box(.5, .4, 1.5, x * d.rear, .62, 1.1))
  else if (d.thruster === 'stern') pieces.push(box(.56, .4, .9, 0, .5, 1.4))
  else pieces.push(box(.4, .36, 1.1, 0, .8, 1.25, -.2))
  if (d.spoiler === 'tee') pieces.push(box(.1, .7, .5, 0, 1, 1.4, .3), box(2.0, .05, .36, 0, top + .06, 1.62))
  else if (d.spoiler === 'duck') pieces.push(box(2.0 * d.rear, .1, .4, 0, .72, 1.64))
  else {
    const x = d.spoiler === 'fins' ? .9 : .8
    for (const s of [-1, 1]) pieces.push(box(.16, .76, .44, s * x, .86, 1.44, .35))
    if (d.spoiler !== 'fins') pieces.push(box(d.spoiler === 'box' ? 2.2 : 1.6, .05, .34, 0, top, 1.66))
    else if (d.thruster === 'twin') pieces.push(box(1.5, .05, .3, 0, .98, 1.5))
  }
  return pieces
}
