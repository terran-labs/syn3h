import { Builder, type Mat } from '../jetgen/shapes'

/**
 * Next-generation hovercraft design studies, round one. Appearance only: the game's hovercraft
 * is still Hovercraft.ts with hovercraft.glb, and no physics reads these.
 *
 * Every design is generated from the numbers below with the jet lane's shape kit
 * (jetgen/shapes.ts), so a design ships as parameters, not a model file (AGENTS.md).
 *
 * What each design keeps from the current body, so any of them could replace hovercraft.glb
 * without touching Hovercraft.ts:
 * - It fits the assisted collision hull (ENVELOPE): 2.54 m wide, 1.03 m tall, 3.18 m long.
 * - A lift port in each quadrant of the hover footprint (Hovercraft.ts samples the ground at
 *   x +-1, z +-1.3), so the four cushions the physics feels are visible.
 * - One centreline thruster at the stern near the prefab's rear glow (THRUSTER). It swivels,
 *   because the craft steers by yaw alone.
 * - Black glass over the prefab's ride camera (EYE), so the cockpit view sits under the canopy.
 * - No wheels, no landing gear and no weapons: it rides its cushion over land, lava and water.
 *
 * Where the looks come from: the candy hull, inlaid glass and chrome of the current body; the
 * jet's round three (chined hulls, ring tails round the thruster, twin booms, squadron-colour
 * tips); and the tank's round four (white aerospace bodies over a dark lower hull with orange
 * stripes, after ekranoplans and lunar rovers).
 *
 * Body rows:    [z, halfWidth, top, bottom, centreY, exponent]
 * Surface rows: [x, y, zLeadingEdge, chord, thickness], root to tip.
 * Frame: -Z forward, +Y up, metres, origin at the vehicle origin (the hull's underside).
 */
export interface HoverDesign {
  id: string; name: string; blurb: string; paint: number; accent: number
  /** Straight-edged, faceted geometry instead of flowing curves. */
  hard?: boolean
  /**
   * 'candy' is the current body's look: metallic paint under clear coat with mirror chrome.
   * 'military' is the jet's round three: satin paint, gunmetal trim, squadron-colour tips.
   * 'aerospace' is the tank's round four: white paint, satin alloy, foil or orange accents.
   */
  finish?: 'candy' | 'military' | 'aerospace'
  /** Lamp centres on the right side (mirrored to the left) and their radius. */
  lamps: { head: [number, number, number][]; tail: [number, number, number][]; r: number }
  build(b: Builder): void
}

/** The assisted collision hull in Hovercraft.ts configureChassis(), which matches hovercraft.glb. */
export const ENVELOPE = { minX: -1.27, maxX: 1.27, minY: 0, maxY: 1.03, minZ: -1.65, maxZ: 1.53 }
/** Hovercraft.prefab RideCamera, as Hovercraft.ts places it. */
export const EYE: [number, number, number] = [0, .56284, -.497794]
/** The prefab's rear glow, as Hovercraft.ts places it. */
export const THRUSTER: [number, number, number] = [0, .692654, 1.218035]

type Rows = number[][]

/** The plenum under the hull: a dark, inset lower body that reads as the air cushion's skirt. */
function skirt(b: Builder, hull: Rows, inset = .9, floor = .05, mat: Mat = 'dark', exponent?: number): void {
  b.body(mat, hull.map(([z, w, , bottom, y, e]) => {
    const centre = y - bottom * .55
    // Pulled in from both ends, so the plenum never shows ahead of the nose or behind the stern.
    return [z * .93, w * inset, .03, Math.max(.01, centre - floor), centre, exponent ?? e]
  }), { seg: 8, around: 32 })
}

/** A stripe wrapped round the hull between two stations, standing just proud of the skin. */
function band(b: Builder, z0: number, z1: number, mat: Mat = 'accent', grow = .006): void {
  b.body(mat, [z0, z1].map(z => { const [w, t, bottom, y, e] = b.at(z); return [z, w + grow, t + grow, bottom + grow, y, e] }), { seg: 1, around: 40, caps: [false, false] })
}

/** A pod on the deck that houses the main thruster, as the current body's chrome housing does. */
function housing(b: Builder, z0: number, z1: number, y: number, r: number, mat: Mat = 'paint', exponent = 2.4): void {
  const L = z1 - z0, k = (z: number, f: number) => [z, r * f, r * f, r * f, y, exponent]
  b.body(mat, [k(z0, .08), k(z0 + L * .25, .8), k(z0 + L * .6, 1), k(z1, .96)], { seg: 6, around: 24 })
}

/** A shoulder intake: a short nacelle with an alloy lip and a dark mouth, mirrored left and right. */
function intake(b: Builder, x: number, y: number, z0: number, z1: number, r: number): void {
  const L = z1 - z0, k = (z: number, f: number) => [z, r * f, r * f, r * f, y, 2.4]
  b.body('paint', [k(z0, .92), k(z0 + L * .3, 1), k(z0 + L * .7, .8), k(z1, .12)], { x, mirror: true, seg: 6, around: 20 })
  b.body('chrome', [k(z0 - .02, .98), k(z0 + .04, 1)], { x, mirror: true, seg: 1, around: 20 })
  b.body('dark', [k(z0 - .025, .78), k(z0 + .03, .78)], { x, mirror: true, seg: 1, around: 20 })
}

/**
 * Surface rows along an elliptical arc in the X-Y plane, for ring ducts round the thruster.
 * Angles are degrees: 0 is straight out to the right, 90 the top, -90 the bottom.
 */
function arc(cy: number, rx: number, ry: number, a0: number, a1: number, z: number, chord: number, thick = .06, n = 3): Rows {
  return Array.from({ length: n }, (_, i) => {
    const a = (a0 + (a1 - a0) * i / (n - 1)) * Math.PI / 180
    return [Math.max(.02, rx * Math.cos(a)), cy + ry * Math.sin(a), z, chord, thick]
  })
}

const SKIMMER_HULL: Rows = [[-1.62, .12, .03, .03, .24, 2.2], [-1.46, .55, .1, .08, .25, 2.8], [-.9, .95, .2, .13, .27, 2.8], [-.2, 1.12, .3, .15, .28, 2.7], [.5, 1.15, .33, .15, .28, 2.7], [1.0, 1.02, .29, .14, .29, 3], [1.3, .85, .2, .12, .3, 3.2]]
const HALO_HULL: Rows = [[-1.62, .03, .02, .02, .3, 1.3], [-1.1, .46, .14, .1, .3, 1.35], [-.4, .86, .27, .17, .3, 1.4], [.3, 1.0, .32, .19, .3, 1.5], [.8, .86, .3, .19, .31, 1.7], [1.02, .62, .26, .18, .32, 2]]
const LUN_HULL: Rows = [[-1.62, .06, .03, .03, .36, 2], [-1.3, .36, .14, .16, .35, 2.2], [-.6, .58, .26, .22, .34, 2.3], [.2, .64, .3, .23, .34, 2.4], [.9, .52, .26, .19, .37, 2.6], [1.3, .34, .18, .12, .42, 2.8], [1.48, .12, .09, .06, .46, 3]]
const TWIN_POD: Rows = [[-1.12, .03, .02, .02, .44, 1.3], [-.62, .38, .2, .13, .44, 1.4], [.1, .48, .27, .17, .44, 1.5], [.78, .42, .25, .17, .45, 1.7], [1.0, .32, .22, .16, .46, 2]]
const TWIN_BOOM: Rows = [[-1.62, .02, .02, .02, .26, 1.4], [-1.0, .2, .17, .14, .26, 1.5], [0, .27, .2, .15, .26, 1.5], [.9, .27, .2, .15, .27, 1.5], [1.14, .17, .14, .11, .28, 1.6]]
const DISC_HULL: Rows = [[-1.6, .1, .03, .03, .3, 2], [-1.47, .58, .09, .07, .3, 2.2], [-1.05, .98, .17, .13, .3, 2.3], [-.35, 1.2, .23, .17, .3, 2.3], [.35, 1.2, .23, .17, .3, 2.3], [1.0, .96, .19, .14, .3, 2.3], [1.36, .56, .11, .09, .3, 2.2], [1.49, .1, .03, .03, .3, 2]]

export const HOVER_DESIGNS: HoverDesign[] = [
  {
    id: 'skimmer', name: 'Skimmer', paint: 0x1f4f9c, accent: 0xb46bff,
    blurb: 'Closest to the current body: a low candy wedge with inlaid glass, a chrome thruster housing on the deck, twin chrome-tipped fins and skirt strakes.',
    lamps: { head: [[.6, .31, -1.4]], tail: [[.8, .44, 1.3]], r: .055 },
    build(b) {
      b.fuselage(SKIMMER_HULL)
      skirt(b, SKIMMER_HULL, .9, .04)
      b.canopy(-1.15, .15, .4, .1)
      housing(b, .1, 1.0, .64, .21, 'chrome')
      b.nozzle(1.0, .64, .2, .2, 0, 2.4)
      // Twin fins lean out from the housing, as the current body's fins do.
      b.surf([[.42, .5, .45, .8, .09], [.56, .8, .8, .52, .08], [.68, 1.0, 1.08, .3, .07]], { tipFrom: .7 })
      // Skirt strakes: the thin chine blades the prefab calls spoilers.
      b.surf([[1.0, .2, -.85, 1.8, .05], [1.16, .14, -.6, 1.5, .05], [1.25, .07, -.35, 1.2, .05]], { tipFrom: .55 })
      b.port(.66, -.95, .16, .24, .14); b.port(.8, .9, .17, .25, .14)
    },
  },
  {
    id: 'halo', name: 'Halo', paint: 0x565c66, accent: 0xff3d5a, hard: true, finish: 'military',
    blurb: 'The jet\'s round three on a cushion: one chined hull, an octagonal ring on X struts round the swivelling thruster, and forward-swept stub wings with squadron tips.',
    lamps: { head: [[.24, .31, -1.3]], tail: [[.6, .36, 1.03]], r: .045 },
    build(b) {
      b.fuselage(HALO_HULL)
      skirt(b, HALO_HULL, .66, .11, 'dark', 1.6)
      b.canopy(-1.25, -.15, .44, .08)
      b.scoop(-.05, .7, .17, .13)
      b.surf([[.84, .3, .45, .75, .08], [1.06, .34, .2, .55, .07], [1.26, .4, .02, .36, .06]], { tipFrom: .6, tip: 'accent' })
      // Ring duct: four quarter arcs, squadron colour, held on X struts from the hull.
      for (const s of [1, -1]) b.surf(arc(.56, .44, s * .43, 0, 90, .92, .46), { round: false, mat: 'accent' })
      b.surf([[.2, .48, .78, .5, .06], [.31, .87, .94, .42, .06]], { round: false })
      b.surf([[.3, .34, .78, .5, .06], [.36, .26, .94, .42, .06]], { round: false })
      b.nozzle(1.0, .56, .2, .2, 0, 2.2)
      b.port(.36, -.85, .13, .22, .15); b.port(.62, .5, .15, .24, .13)
    },
  },
  {
    id: 'lun', name: 'Lun', paint: 0xdfe3e7, accent: 0xff5a12, finish: 'aerospace',
    blurb: 'An ekranoplan after the tank\'s Lun: a white boat hull over a dark stepped keel, stub wings that droop into tip floats, twin shoulder intakes and a box tail.',
    lamps: { head: [[.2, .42, -1.42]], tail: [[.3, .5, 1.34]], r: .055 },
    build(b) {
      b.fuselage(LUN_HULL)
      // V keel with a hydroplane step aft of midships, dark like an orbiter's belly.
      b.body('dark', [[-1.5, .08, .03, .08, .22, 1.5], [-1.1, .3, .03, .17, .21, 1.5], [-.3, .5, .03, .17, .2, 1.5], [.28, .54, .03, .17, .2, 1.5], [.34, .5, .03, .1, .24, 1.5], [1.0, .36, .03, .07, .3, 1.6], [1.4, .14, .03, .04, .38, 1.8]], { seg: 6, around: 28 })
      b.canopy(-1.3, -.42, .5, .08)
      // Stub wings ride in ground effect and droop into dark floats at the tips.
      b.surf([[.5, .3, -.5, 1.3, .1], [.95, .28, -.36, 1.16, .09], [1.15, .22, -.22, 1.02, .09], [1.19, .07, -.14, .94, .1]], { tipFrom: .78, tip: 'dark' })
      intake(b, .42, .56, -.3, .5, .11)
      // Box tail: twin fins joined across the top, clear of the thruster's swing.
      b.surf([[.28, .46, .62, .62, .07], [.5, .97, .98, .38, .06], [.02, .97, 1.02, .36, .06]], { round: false })
      housing(b, .2, .92, .6, .17)
      b.nozzle(.92, .6, .16, .16, 0, 2.6)
      band(b, .42, .47); band(b, .52, .57)
      b.port(.84, -.2, .15, .2, .2); b.port(.84, .4, .15, .2, .2)
    },
  },
  {
    id: 'twin', name: 'Twin', paint: 0x1d2b44, accent: 0x38d6c6, hard: true, finish: 'military',
    blurb: 'A catamaran after the jet\'s Lancer: two cushion booms run forward as prongs past a recessed cockpit pod, with a tight ring ducting the thruster and canted boom fins.',
    lamps: { head: [[.95, .3, -1.36]], tail: [[.95, .43, 1.12]], r: .055 },
    build(b) {
      b.fuselage(TWIN_POD)
      b.canopy(-.95, -.02, .6, .07)
      b.body('paint', TWIN_BOOM, { x: .97, mirror: true, around: 20 })
      // The booms are the cushions: a dark plenum under each carries two lift ports.
      b.body('dark', [[-1.3, .1, .03, .06, .13, 2.2], [-.9, .2, .03, .07, .13, 2.4], [.9, .22, .03, .07, .14, 2.4], [1.15, .12, .03, .05, .16, 2.2]], { x: .97, mirror: true, around: 16 })
      b.surf([[.3, .42, -.55, 1.5, .08], [.97, .32, -.5, 1.42, .08]], { round: false })
      b.surf([[1.0, .4, .78, .6, .06], [1.22, .98, 1.2, .26, .05]], { tipFrom: .5, tip: 'accent' })
      for (const s of [1, -1]) b.surf(arc(.5, .31, s * .31, 0, 90, .9, .4), { round: false })
      b.surf([[.97, .36, .9, .5, .06], [.31, .5, .92, .4, .06]], { round: false })
      b.nozzle(1.0, .5, .19, .19, 0, 2.2)
      b.nozzle(1.14, .28, .1, .1, .97, 3)
      b.port(.97, -.8, .13, .24, .12); b.port(.97, .7, .13, .24, .12)
    },
  },
  {
    id: 'tub', name: 'Tub', paint: 0xe4e6e8, accent: 0xb8892a, finish: 'aerospace',
    blurb: 'A lunar rover\'s round tub after the tank\'s Lunokhod: a white lens over gold foil with an alloy rim, a glass dome, two camera eyes and a deck thruster under an antenna hoop.',
    lamps: { head: [[.72, .33, -1.24]], tail: [[.5, .35, 1.36]], r: .06 },
    build(b) {
      b.fuselage(DISC_HULL)
      skirt(b, DISC_HULL, .86, .04, 'accent')
      // Alloy rim round the equator, where the lid meets the tub.
      b.body('chrome', DISC_HULL.map(([z, w, , , y]) => [z * 1.006, w + .02, .035, .035, y, 2.3]), { seg: 8, around: 40 })
      b.canopy(-.85, .2, .38, .26)
      housing(b, .3, 1.0, .56, .19, 'chrome')
      b.nozzle(1.0, .56, .18, .18, 0, 2.6)
      // An alloy hoop over the thruster, where Lunokhod carried its antenna.
      for (const s of [1, -1]) b.surf(arc(.5, .5, s === 1 ? .47 : .1, 0, 90, .62, .16, .22, 5), { round: false, mat: 'chrome' })
      // Two camera eyes on the nose.
      for (const [mat, f, dz] of [['chrome', 1, 0], ['glass', .8, -.035]] as const) b.body(mat, [[-1.3 + dz, .1 * f, .1 * f, .1 * f, .42, 2], [-1.2, .13 * f, .13 * f, .13 * f, .42, 2], [-1.05, .02, .02, .02, .4, 2]], { x: .34, mirror: true, seg: 4, around: 16 })
      band(b, -1.22, -1.18)
      b.port(.62, -.72, .19, .19, .14); b.port(.62, .72, .19, .19, .14)
    },
  },
]
