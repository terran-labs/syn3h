import * as T from 'three/webgpu'
import { Builder, bodyRings, loft } from '../jetgen/shapes'
import { HOVER_EYE, hoverHull, plugNozzle, type Anchor, type HoverBuild, type HullShape } from './kit'
import type { HoverSpec } from './HoverBody'

/**
 * The game's hovercraft body: Lowwing, which the owner approved on 15 November 2026 ("black
 * and green hovercraft is good enough to ship. Go with this one for now").
 *
 * It came out of round four of the design studies (src/vehicles/hovergen/round4.ts, which
 * builds its other four designs with the same generator below). What the owner asked for and
 * this generator does: the deck rises in a coaming round the cockpit opening and the canopy
 * stands inside it; headlamps are bands on the nose's own outline; each lift port sits in a
 * blister of the belly; flank intakes follow the skin on a faired base; the thruster is the
 * open end of a cowl grown from the deck, closed 10 cm inside the lip by a solid disc that
 * carries the glow; and the wing's tips dip down on the outside.
 *
 * The wing options other than 'low' are round four's variations. They ride along here so the
 * studies and the shipped body share one generator; the game builds only LOWWING.
 */
export interface DuctDesign extends HullShape {
  id: string; name: string; notes: string; paint: number; accent: number
  canopy: { z0: number; z1: number; width: number; bulge: number }
  /** How far the coaming lifts the deck at the cockpit's edge, in metres. */
  coaming: number
  head: 'wrap' | 'visor'
  /** Duct section: round, or a wide flat slot. */
  duct: 'round' | 'slot'
  wing: 'tee' | 'gull' | 'vee' | 'low'
  blade: number
  /** Intake size multiplier. */
  vent: number
  stripe: boolean
  chine: 'chrome' | 'accent' | 'none'
}


export const DUCT_BASE = { shoulder: 1, waist: 1, rear: 1, nose: .54, reach: 0, deck: 1, box: 0, tail: .9, blade: 1, vent: 1, coaming: .09, canopy: { z0: -1.37, z1: .43, width: .55, bulge: .43 } }
export const LOWWING: DuctDesign = { ...DUCT_BASE, id: 'h4-low', name: 'Lowwing', notes: 'No pylon: the wing lies on the duct cowl and its tips dip to meet the rear quarters. The lowest and cleanest of the five.', paint: 0x15191e, accent: 0x38f5a0, waist: .92, deck: .96, rear: 1.02, canopy: { z0: -1.37, z1: .43, width: .55, bulge: .47 }, head: 'visor', duct: 'slot', wing: 'low', stripe: true, chine: 'accent' }

export function buildDuctHover(d: DuctDesign, detail: number): HoverBuild {
  const b = new Builder(detail), hull = hoverHull(d)
  const z0 = hull[0][0], z1 = hull[hull.length - 1][0]
  const head: T.BufferGeometry[] = [], tail: T.BufferGeometry[] = [], beams: [number, number, number][] = [], anchors: Anchor[] = []
  const ring = (n: number) => Math.max(6, 2 * Math.round(n * detail / 2)), seg = (n: number) => Math.max(1, Math.round(n * detail))
  const near = detail >= .3
  b.fuselage(hull)
  const inside = (x: number, y: number, z: number) => {
    if (z < z0 || z > z1) return false
    const [w, t, bt, yc, e] = b.at(z), h = y >= yc ? t : bt
    return (Math.abs(x) / w) ** e + (Math.abs(y - yc) / h) ** e <= 1
  }
  const smooth = (v: number) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t) }

  // The red one's intakes: a duct that follows the skin behind each shoulder on a faired base.
  if (near) for (const angle of [40, 140]) { b.intake(-.98, -.3, angle, .15 * d.vent, .1 * d.vent); anchors.push({ what: 'vent', at: [(angle < 90 ? 1 : -1) * b.at(-.7)[0] * .7, b.at(-.7)[3], -.7] }) }

  // Cockpit, and the coaming that lifts the deck to meet it.
  const c = d.canopy
  b.cockpit(c.z0, c.z1, c.width, HOVER_EYE, { bulge: c.bulge, rim: .022, floor: .65 })
  if (near) {
    // The opening's outline, as the shape kit draws it: half width and skin height at its edge.
    const outline = (z: number) => {
      const s = Math.min(1, Math.max(0, (z - c.z0) / (c.z1 - c.z0))), [w, t, , y, e] = b.at(z), env = Math.max(.004, Math.sin(Math.PI * s)) ** .45
      const ff = Math.min(.97, c.width * env)
      return { env, w, cw: w * ff, yEdge: y + t - t * (1 - (1 - ff ** e) ** (1 / e)) }
    }
    const n = seg(22) + 4, across = 5
    for (const side of [1, -1]) {
      // A strip from the deck, a hand's width outside the opening, up to a lip just inside the
      // canopy's foot. Its outer edge is under the skin and its inner edge inside the canopy,
      // so neither edge shows and the deck reads as rising into the cockpit.
      const strip = loft(Array.from({ length: n + 1 }, (_, j) => {
        const z = c.z0 - .06 + (c.z1 - c.z0 + .12) * j / n, o = outline(z), fade = Math.min(1, o.env * 1.5)
        const xIn = o.cw * .95, xOut = Math.min(o.w * .97, o.cw + (.2 + o.cw * .35) * fade + .02)
        const yOut = b.skin(z, xOut) - .012, yIn = Math.max(yOut, o.yEdge + d.coaming * fade)
        return Array.from({ length: across + 1 }, (_, k) => { const u = k / across; return new T.Vector3(side * (xOut + (xIn - xOut) * u), yOut + (yIn - yOut) * smooth(u) ** .85, z) })
      }), false, false, false, { open: true })
      // An open strip has no inside to measure: make it face up.
      const index = strip.getIndex()!, mid = Math.floor(n / 2) * (across + 1) + 2
      if (strip.getAttribute('normal').getY(mid) < 0) { for (let i = 0; i < index.count; i += 3) { const t = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, t) } strip.computeVertexNormals() }
      b.add('paint', strip)
    }
  }

  // Headlamps: bands on the nose's own outline.
  {
    // 'visor' runs from the tip round both corners in one bar; 'wrap' starts where the nose is
    // already half a metre wide, which leaves one lamp wrapped round each corner.
    let from = z0 + .012
    if (d.head === 'wrap') while (b.at(from)[0] < .5) from += .01
    const length = d.head === 'wrap' ? .5 : .62, n = seg(14) + 2
    const rows = (out: number, share: number, cap: number) => Array.from({ length: n + 1 }, (_, i) => {
      const z = from + length * i / n, [w, t, , yc, e] = b.at(z), h = Math.min(cap, t * share)
      return [z, w + out, h, h, yc + t * .2, e]
    })
    b.add('dark', loft(bodyRings(rows(.006, .5, d.head === 'wrap' ? .07 : .05), 0, 1, ring(40))))
    head.push(loft(bodyRings(rows(.015, .3, d.head === 'wrap' ? .042 : .022), 0, 1, ring(40))))
    // Beam origins on the lamp itself: where the nose is as wide as the origin is far out. A
    // fixed z put them in the air ahead of the nose, which tapers to a point.
    let at = z0
    while (b.at(at)[0] < .6) at += .01
    for (const x of [-.6, .6]) beams.push([x, b.at(at)[3] + b.at(at)[1] * .2, at])
    anchors.push({ what: 'headlamp band', at: [0, b.at(from + .25)[3], from + .25] })
  }

  // Tail lamps: two stacked bars on the stern's own outline, in one dark surround.
  {
    const n = seg(12) + 2, rows = (out: number, lift: number, share: number, cap: number) => Array.from({ length: n + 1 }, (_, i) => {
      const z = z1 - .52 + .508 * i / n, [w, t, , yc, e] = b.at(z), h = Math.min(cap, t * share)
      return [z, w + out, h, h, yc + t * lift, e]
    })
    b.add('dark', loft(bodyRings(rows(.007, .22, .42, .085), 0, 1, ring(40))))
    for (const lift of [.06, .38]) tail.push(loft(bodyRings(rows(.016, lift, .1, .019), 0, 1, ring(40))))
    anchors.push({ what: 'tail band', at: [0, b.at(z1 - .3)[3], z1 - .3] })
  }

  // The red one's thrust duct: a cowl grown from the deck whose own skin ends as the nozzle lip.
  const y = b.at(1.5)[3] + .1, slot = d.duct === 'slot'
  const [dw, dt, e] = slot ? [.46, .15, 4.2] : [.3, .21, 2.6]
  // The lip stands a hand's width aft of the hull's own tail, so the tail ends inside the cowl
  // ahead of the plug and never shows in the mouth.
  const lip = 2.0, lw = dw * .9, lh = dt * .9
  b.body('paint', [[.62, .1, .05, .05, y + .08, 2.5], [1.15, dw, dt, dt * .95, y + .02, e], [1.65, dw, dt, dt * .95, y, e], [lip, lw, lh, dt * .86, y, e]], { seg: 6, around: 24, exhaust: 'main' })
  // The kit lines the lip with a dark wall and ends it in a see-through glow deep inside. Close
  // the throat 10 cm in with a solid disc, and put the glow on it, so the view from astern
  // stops at the engine and not inside the hull.
  plugNozzle(b, lip, y, lw, lh, 0, e, 'duct')
  b.add('glow', new T.CircleGeometry(lh * .62, Math.max(8, Math.round(24 * detail))).scale(lw / lh, 1, 1).translate(0, y, lip - .094))
  anchors.push({ what: 'duct cowl', at: [0, y - .12, 1.3] })

  // The silver one's wing: its tips dip down on the outside.
  const top = 1.3 * d.blade, cowl = y + dt
  const wing = (rows: number[][]) => b.surf(rows, { mat: 'paint', tip: 'accent', tipFrom: .7 })
  if (d.wing === 'tee' || d.wing === 'gull') {
    // One pylon rooted in the cowl.
    b.surf([[0, y + .02, .98, .74, .13], [0, (y + top) / 2 + .1, 1.22, .56, .11], [0, top, 1.42, .44, .1]], { mat: 'paint', mirror: false, round: false })
    if (d.wing === 'tee') wing([[0, top, 1.42, .44, .055], [.6, top - .01, 1.46, .38, .05], [1.0, top - .1, 1.54, .28, .05], [1.12, top - .34, 1.63, .2, .05]])
    else wing([[0, top - .08, 1.42, .44, .055], [.5, top + .05, 1.45, .4, .05], [.95, top - .03, 1.53, .29, .05], [1.1, top - .32, 1.62, .2, .05]])
    if (d.stripe) b.surf([[0, top - (d.wing === 'gull' ? .08 : 0), 1.412, .456, .07], [.12, top - (d.wing === 'gull' ? .05 : 0), 1.413, .455, .07]], { mat: 'accent', round: false })
    anchors.push({ what: 'pylon', at: [0, y - .1, 1.3] })
  } else if (d.wing === 'vee') {
    // Two struts splayed from the cowl's shoulders.
    b.surf([[dw * .7, y + .02, 1.0, .62, .12], [dw * .7 + .16, (y + top) / 2 + .08, 1.22, .5, .1], [dw * .7 + .3, top, 1.42, .42, .09]], { mat: 'paint', round: false })
    wing([[0, top, 1.42, .42, .055], [.66, top - .01, 1.46, .38, .05], [1.02, top - .1, 1.54, .28, .05], [1.14, top - .34, 1.63, .2, .05]])
    anchors.push({ what: 'strut', at: [dw * .7, y - .1, 1.3] }, { what: 'strut', at: [-dw * .7, y - .1, 1.3] })
  } else {
    // The wing lies on the cowl and its tips come down to the rear quarters.
    const reach = b.at(1.5)[0] * .98, land = b.at(1.55)[3] + b.at(1.55)[1] * .5
    // A short pedestal lifts the wing clear of the cowl so it reads as a wing, not a lid.
    b.surf([[0, cowl - .06, 1.18, .66, .2], [0, cowl + .2, 1.34, .5, .14]], { mat: 'paint', mirror: false, round: false })
    wing([[0, cowl + .2, 1.34, .5, .07], [.6, cowl + .22, 1.38, .42, .06], [reach * .9, cowl + .1, 1.47, .32, .06], [reach, land, 1.55, .24, .06]])
    if (d.stripe) b.surf([[0, cowl + .2, 1.332, .516, .09], [.12, cowl + .204, 1.333, .515, .09]], { mat: 'accent', round: false })
    anchors.push({ what: 'wing tip', at: [reach * .9, b.at(1.55)[3], 1.6] }, { what: 'wing tip', at: [-reach * .9, b.at(1.55)[3], 1.6] })
  }

  // Lift ports, each in a blister of the belly with its ring 8 mm proud of the blister.
  for (const z of [-1.02, 1.0]) {
    const x = .96, yb = b.skin(z, x, -1) + .05, drop = .1
    b.body('paint', [[z - .55, .04, .02, .02, yb, 2.4], [z - .22, .27, .02, drop, yb, 2.8], [z + .22, .27, .02, drop, yb, 2.8], [z + .55, .04, .02, .02, yb, 2.4]], { x, mirror: true, seg: 4, around: 16 })
    for (const sx of [1, -1]) {
      const slab = (mat: 'chrome' | 'dark' | 'glow', f: number, depth: number) => {
        const g = loft(bodyRings([[0, .17 * f, .22 * f, .22 * f, 0, 3], [depth, .17 * f, .22 * f, .22 * f, 0, 3]], 0, 1, ring(24)))
        g.rotateX(Math.PI / 2); g.translate(x * sx, yb - .05, z); b.add(mat, g)
      }
      slab('chrome', 1, drop - .05 + .008); slab('dark', .86, drop - .05 + .014); slab('glow', .66, drop - .05 + .02)
      b.hover.push([x * sx, yb - drop - .02, z])
      anchors.push({ what: 'lift port', at: [x * sx, yb + .03, z] })
    }
  }

  // Centre stripe on the nose, stopping short of the coaming.
  if (d.stripe) {
    const from = z0 + .1, to = c.z0 - .14, n = seg(8) + 1
    b.add('accent', loft(bodyRings(Array.from({ length: n + 1 }, (_, i) => {
      const z = from + (to - from) * i / n, half = Math.min(.15, b.at(z)[0] * .5)
      return [z, half, .013, .03, b.skin(z, half), 6]
    }), 0, 1, ring(12))))
  }

  if (d.chine !== 'none') b.body(d.chine, hull.map(([z, w, , , yc, x]) => [z, w + .04, .018, .018, Math.max(.055, yc - .14), x]), { seg: 10, around: 24 })
  b.body('dark', hull.map(([z, w, , , yc, x]) => [z * .97, w * .94, .035, .03, Math.max(.045, yc - .17), x]), { seg: 8, around: 20 })
  return { builder: b, head, tail, beams, anchors, inside }
}

/** One-draw outline for beyond 120 m. */
export function ductHoverFar(d: DuctDesign): T.BufferGeometry[] {
  const hull = hoverHull(d), top = 1.3 * d.blade, c = d.canopy
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, tilt = 0, roll = 0) => new T.BoxGeometry(w, h, l).rotateX(tilt).rotateZ(roll).translate(x, y, z)
  const pieces = [loft(bodyRings(hull, 0, 1, 8)), loft(bodyRings([[c.z0, .03, .03, .02, .47, 2], [(c.z0 + c.z1) / 2 - .1, .52, .1 + c.bulge, .04, .5, 2.6], [c.z1, .04, .03, .02, .56, 2]], 0, 1, 8))]
  pieces.push(box(d.duct === 'slot' ? .9 : .6, d.duct === 'slot' ? .3 : .42, 1.2, 0, .5, 1.3))
  if (d.wing === 'low') pieces.push(box(2.2, .06, .4, 0, .78, 1.6))
  else {
    if (d.wing === 'vee') for (const s of [-1, 1]) pieces.push(box(.08, .8, .46, s * .45, .95, 1.42, .3, -s * .3))
    else pieces.push(box(.1, .8, .5, 0, .95, 1.42, .3))
    pieces.push(box(2.0, .05, .36, 0, top, 1.64))
    for (const s of [-1, 1]) pieces.push(box(.05, .3, .22, s * 1.1, top - .2, 1.72))
  }
  return pieces
}

/** What the game builds: Lowwing, at whatever detail a level asks for. */
export const LOWWING_SPEC: HoverSpec = { id: LOWWING.id, paint: LOWWING.paint, accent: LOWWING.accent, build: detail => buildDuctHover(LOWWING, detail), far: () => ductHoverFar(LOWWING) }
