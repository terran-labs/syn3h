import type { Builder } from './shapes'

/**
 * The one jet the game ships: the Hexring Mk2 the owner approved on 15 November 2026.
 *
 * It lives apart from designs.ts on purpose. That file holds every study design from the six
 * design rounds and is for the vehicle lab only; the game must not bundle it. GameJet imports
 * this file and nothing else from the design side, and tests/vehicles2/game-graph.test.ts keeps
 * designs.ts out of the game's import graph. The lab shows this same object as round six's Mk2.
 *
 * Body rows:    [z, halfWidth, top, bottom, centreY, exponent]
 * Surface rows: [x, y, zLeadingEdge, chord, thickness], root to tip.
 */
export interface JetDesign {
  id: string; name: string; blurb: string; paint: number; accent: number
  /** Straight-edged, faceted geometry instead of flowing curves. */
  hard?: boolean
  /** Smooth normals without changing the angular planform. */
  smooth?: boolean
  /** Kept for reference only: every design now renders through the shared vehicle shading. */
  finish?: 'candy' | 'military'
  build(b: Builder): void
}

/** The pilot's eye in the Vanguard family: low in the pod, a third of the way along the canopy. */
export const VANGUARD_EYE: [number, number, number] = [0, .28, -1.6]

/** Chined, diamond-section cockpit pod that ends in the round main thruster. */
const POD = [[-3.5, .04, .02, .02, -.02, 1.3], [-2.6, .34, .16, .12, 0, 1.35], [-1.6, .52, .34, .2, .02, 1.4], [-.4, .68, .44, .28, .03, 1.5], [.9, .7, .44, .3, .04, 1.6], [2.0, .52, .38, .32, .05, 1.9], [2.6, .42, .37, .35, .05, 2.1], [2.95, .39, .37, .37, .05, 2.2], [3.08, .35, .34, .34, .05, 2.2]]
/** One of the twin booms, each ending in its own thruster. */
const BOOM = [[-1.9, .03, .03, .03, -.05, 1.4], [-1.0, .2, .2, .16, -.05, 1.5], [.4, .28, .26, .22, -.05, 1.5], [2.2, .26, .24, .2, -.03, 1.6], [2.9, .2, .2, .19, 0, 2], [3.2, .17, .17, .17, 0, 2.2]]
/** Four intakes round the pod, as rows of [angle, z0, z1, halfWidth, height]. */
const INTAKES = [45, 135, 225, 315].map(a => [a, -.35, 1.25, .2, .13])

const BOOM_X = 1.5
/**
 * Where thrust leaves the shipped jet, in its own frame, for code that must not build the model
 * to find out (the thrust plume). Every entry is taken from the rows above or checked against
 * the built model by
 * tests/vehicles2/game-jet.test.ts, so a change of design cannot leave a plume hanging in space.
 */
export const MK2_FITTINGS = {
  /** Rear nozzle exits: the pod's and the two booms'. */
  nozzles: [
    { x: 0, y: POD[POD.length - 1][4], z: POD[POD.length - 1][0], r: POD[POD.length - 1][1] },
    { x: BOOM_X, y: BOOM[BOOM.length - 1][4], z: BOOM[BOOM.length - 1][0], r: BOOM[BOOM.length - 1][1] },
    { x: -BOOM_X, y: BOOM[BOOM.length - 1][4], z: BOOM[BOOM.length - 1][0], r: BOOM[BOOM.length - 1][1] },
  ],
  /** Belly hover ports: under the nose and under each boom. */
  ports: [{ x: 0, y: -.262, z: -1.74, r: .24 }, { x: BOOM_X, y: -.39, z: 1.16, r: .16 }, { x: -BOOM_X, y: -.39, z: 1.16, r: .16 }],
} as const

/**
 * A chined cockpit pod between twin booms with a six-sided ring tail. The pod and the booms are
 * each one lofted skin from nose to nozzle lip: the four intakes are bulges of the pod's skin
 * and the three thrusters are the open rear ends of their bodies.
 */
function build(b: Builder): void {
  const bx = BOOM_X, by = -.03
  b.fuselage(POD, { intakes: INTAKES, exhaust: true })
  // A real cockpit: an opening in the hull, an interior tub and a bubble canopy over the pilot.
  b.cockpit(-2.9, -.7, .6, VANGUARD_EYE, { bulge: .2 })
  b.body('paint', BOOM, { x: bx, mirror: true, around: 20, exhaust: true })
  b.surf([[.5, 0, -.4, 2.2, .08], [bx, -.02, -.2, 2.0, .08]], { round: false })
  // One clean forward sweep: the leading edge runs straight from the boom to the tip. The
  // drooped tip plate turns down a quarter of a metre.
  b.surf([[bx, -.02, .9, 1.5, .07], [2.4, .1, .36, 1.16, .062], [3.3, .2, -.18, .82, .055], [3.55, -.05, -.14, .74, .055]], { tipFrom: .66, tip: 'accent' })
  b.surf([[1.6, -.05, -1.1, .7, .06], [2.5, .05, -.7, .3, .05]], { tipFrom: .5, tip: 'accent' })

  // The tail ring: a hexagon with upright flanks. Struts run from each boom to the corners
  // nearest it and take their end position, leading edge and chord from those same corners, so
  // ring and strut always meet exactly. A pointed chrome longeron runs through each joint.
  const cy = .05, z0 = 2.25, z1 = 2.45, chord = .75, t = .06, r = .95, rLow = r * .95
  const joint = (x: number, y: number, z: number, c: number) => b.body('chrome', [[z - .26, .003, .003, .003, y, 1.5], [z - .06, .045, .045, .045, y, 1.5], [z + .1, .065, .065, .065, y, 1.5], [z + c - .1, .065, .065, .065, y, 1.5], [z + c + .06, .045, .045, .045, y, 1.5], [z + c + .26, .003, .003, .003, y, 1.5]], { x, mirror: x !== 0, seg: 3, around: 8 })
  const row = (x: number, y: number, z: number) => [x, y, z, chord, t]
  const side = (deg: number, ry: number) => { const a = deg * Math.PI / 180; return [r * Math.cos(a), cy + ry * Math.sin(a)] }
  const up = side(30, r), down = side(-30, rLow)
  // Each of the six panels carries a control surface on its trailing edge. The upper and lower
  // pairs work as elevators and ailerons, the flanks as rudders (see NextJet.setControls).
  const panel = { round: false, mat: 'accent' as const, flap: .38 }
  b.surf([row(up[0], up[1], z0), row(0, cy + r, z1)], panel); b.surf([row(down[0], down[1], z0), row(0, cy - rLow, z1)], panel)
  b.surf([row(down[0], down[1], z0), row(up[0], up[1], z0)], panel)
  // The two halves join at the top and bottom points: those get a joint as well.
  joint(0, cy + r, z1, chord); joint(0, cy - rLow, z1, chord)
  for (const [x, y, z, c] of [row(up[0], up[1], z0), row(down[0], down[1], z0)]) {
    // Carry the strut a little past the corner, along its own line, so it ends inside the ring.
    const dx = x - bx, dy = y - by, k = .03 / Math.hypot(dx, dy)
    b.surf([[bx, by, z - .15, c + .15, t], [x + dx * k, y + dy * k, z, c, t]], { round: false })
    joint(x, y, z, c)
  }

  b.port(0, -1.74, .24, .4); b.port(bx, 1.16, .16, .38, -.27)
  b.leg([0, -.12, -1.15], 'aft'); b.leg([bx, -.12, 1.75], 'aft')
}

export const SHIPPED_JET: JetDesign = {
  smooth: true, id: 'hex-mk2', name: 'Hexring Mk2', paint: 0x565c66, accent: 0xff3d5a, hard: true, finish: 'military',
  blurb: 'The Hexring cleaned up: intakes and thrusters lofted into their bodies, six ring joints, shallower wingtips.',
  build,
}
