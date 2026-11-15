import { Builder } from './shapes'

/**
 * Five next-generation jet designs after the owner's red reference renders: a long nose with
 * black glass set in a chrome surround, chrome-capped tip pods and fins, a dorsal intake, a
 * wide chrome-rimmed exhaust and chrome-rimmed hover ports on the belly.
 *
 * Every design fits the current jet's envelope (about 7.7 m span, 7 m long), keeps a hover
 * port near each of the current three hover thrusters, a main nozzle near the tail, and three
 * landing gear legs whose feet reach the current landing-gear collider's underside. So any of
 * them can replace jet.glb without touching the physics.
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

/**
 * Surface rows along an elliptical arc in the X-Y plane, for hoop and arch tails.
 * Angles are degrees: 0 is straight out to the right, 90 is the top, -90 the bottom.
 * The leading edge runs from z0 to z1 and the chord from chord0 to chord1.
 */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, z0: number, z1: number, chord0: number, chord1: number, thick = .08, n = 7): number[][] {
  const rows = Array.from({ length: n }, (_, i) => {
    const k = i / (n - 1), a = (a0 + (a1 - a0) * k) * Math.PI / 180
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a), z0 + (z1 - z0) * k, chord0 + (chord1 - chord0) * k, thick]
  })
  return cx === 0 && Math.abs(Math.abs(a1) - 90) < 1e-6 ? meetAtCentre(rows) : rows
}

/** Rows that end on the centre line: Builder.surf mitres them against their mirror image. */
const meetAtCentre = (rows: number[][]): number[][] => rows

/** The forward-swept wing of the Stiletto, shared by the second-round hybrids. */
const FORWARD_SWEPT = [[.55, 0, .7, 2.0, .1], [1.5, .08, .3, 1.6, .085], [2.6, .2, -.2, 1.2, .075], [3.3, .38, -.5, .9, .07], [3.55, .62, -.55, .75, .07]]
const STILETTO_HULL = [[-3.6, .05, .03, .03, 0, 2], [-3.2, .2, .12, .1, 0, 2.2], [-2.2, .36, .26, .2, 0, 2.3], [-.8, .5, .4, .3, .02, 2.3], [.6, .62, .5, .36, .04, 2.4], [1.9, .62, .48, .36, .06, 2.6], [2.7, .52, .4, .34, .06, 3], [3.1, .46, .32, .3, .06, 3.2]]

/** Chined, diamond-section hulls for the third round. */
const POD_HULL = [[-3.5, .04, .02, .02, -.02, 1.3], [-2.6, .34, .16, .12, 0, 1.35], [-1.6, .52, .34, .2, .02, 1.4], [-.4, .68, .44, .28, .03, 1.5], [.9, .7, .44, .3, .04, 1.6], [2.0, .52, .36, .3, .05, 1.8], [2.7, .42, .32, .3, .05, 2]]
const BOOM_HULL = [[-1.9, .03, .03, .03, -.05, 1.4], [-1.0, .2, .2, .16, -.05, 1.5], [.4, .28, .26, .22, -.05, 1.5], [2.2, .26, .24, .2, -.03, 1.5], [3.1, .18, .18, .16, 0, 1.6]]

/** How a Vanguard is put together. Every field has the Vanguard Quad's value as its default. */
interface VanguardOptions {
  /** Intakes as rows of [angle, z0, z1, halfWidth, height]. */
  intakes?: number[][]
  /** Tail ring outline: eight sides, six sides, or a square box. */
  ring?: 'oct' | 'hex' | 'box'
  /** A wide ring that runs straight into the booms, with no struts. */
  ringOnBooms?: boolean
  /** Outer wings: a plain forward sweep, or the same with tip plates turned down. */
  wing?: 'swept' | 'droop'
  /** Booms end ahead of the wing, or run forward past the cockpit as prongs. */
  booms?: 'short' | 'prong'
  /** Canards on the booms, on the cockpit pod, or none. */
  canards?: 'boom' | 'pod' | 'none'
  /** Main thruster exit: round, or wide and flat. */
  nozzle?: 'round' | 'flat'
  /** Ring radius in metres (default .95). */
  ringSize?: number
  /** Struts from the hull's spine and keel to the ring's top and bottom joints. */
  spine?: boolean
}

/** The pilot's eye in the Vanguard family: low in the pod, a third of the way along the canopy. */
export const VANGUARD_EYE: [number, number, number] = [0, .28, -1.6]
const QUAD_INTAKES = [45, 135, 225, 315].map(a => [a, -.35, 1.25, .2, .13])

/**
 * The tail ring. Its outline is a list of corners; the struts run from each boom to the
 * corners nearest it and take their end position, leading edge and chord from those same
 * corners, so ring and strut always meet exactly. A slim longeron runs through each joint.
 */
function tailRing(b: Builder, o: VanguardOptions, boomX: number, boomY: number): void {
  const cy = .05, z0 = 2.25, z1 = 2.45, chord = .75, t = .06, shape = o.ring ?? 'oct'
  // A ring on the booms is sized so its flanks land on them: a hexagon's flanks are at cos 30.
  const r = o.ringOnBooms ? (shape === 'hex' ? boomX / Math.cos(Math.PI / 6) : boomX) : o.ringSize ?? .95
  const rLow = o.ringOnBooms ? r * .6 : r * .95, zm = (z0 + z1) / 2
  // A pointed chrome longeron through a joint, along the chord.
  const joint = (x: number, y: number, z: number, c: number) => b.body('chrome', [[z - .26, .003, .003, .003, y, 1.5], [z - .06, .045, .045, .045, y, 1.5], [z + .1, .065, .065, .065, y, 1.5], [z + c - .1, .065, .065, .065, y, 1.5], [z + c + .06, .045, .045, .045, y, 1.5], [z + c + .26, .003, .003, .003, y, 1.5]], { x, mirror: x !== 0, seg: 3, around: 8 })
  const row = (x: number, y: number, z: number) => [x, y, z, chord, t]
  const side = (deg: number, ry: number) => { const a = deg * Math.PI / 180; return [r * Math.cos(a), cy + ry * Math.sin(a)] }
  const paint = { round: false, mat: 'accent' as const }
  let corners: number[][]
  if (shape === 'oct') {
    const top = [row(r, cy, z0), row(...side(45, r) as [number, number], zm), row(0, cy + r, z1)], bottom = [row(r, cy, z0), row(...side(-45, rLow) as [number, number], zm), row(0, cy - rLow, z1)]
    b.surf(meetAtCentre(top), paint); b.surf(meetAtCentre(bottom), paint); corners = [top[1], bottom[1]]
    joint(0, cy + r, z1, chord); joint(0, cy - rLow, z1, chord)
  } else if (shape === 'hex') {
    const up = side(30, r), down = side(-30, rLow)
    b.surf(meetAtCentre([row(up[0], up[1], z0), row(0, cy + r, z1)]), paint); b.surf(meetAtCentre([row(down[0], down[1], z0), row(0, cy - rLow, z1)]), paint)
    b.surf([row(down[0], down[1], z0), row(up[0], up[1], z0)], paint)
    corners = [row(up[0], up[1], z0), row(down[0], down[1], z0)]
    // The two halves join at the top and bottom points: those get a joint as well.
    joint(0, cy + r, z1, chord); joint(0, cy - rLow, z1, chord)
  } else {
    const x = r * .78, up = cy + r * .78, down = cy - rLow * .78
    b.surf(meetAtCentre([row(x, up, z0), row(0, up, z1)]), paint); b.surf(meetAtCentre([row(x, down, z0), row(0, down, z1)]), paint); b.surf([row(x, down, z0), row(x, up, z0)], paint)
    corners = [row(x, up, z0), row(x, down, z0)]
  }
  if (o.spine) {
    b.surf([[0, .36, z0 - .1, chord + .1, t], [0, cy + r, z1, chord, t]], { mirror: false, round: false })
    b.surf([[0, -.27, z0 - .1, chord + .1, t], [0, cy - rLow, z1, chord, t]], { mirror: false, round: false })
  }
  if (o.ringOnBooms) return
  for (const [x, y, z, c] of corners) {
    // Carry the strut a little past the corner, along its own line, so it ends inside the ring.
    const dx = x - boomX, dy = y - boomY, k = .03 / Math.hypot(dx, dy)
    b.surf([[boomX, boomY, z - .15, c + .15, t], [x + dx * k, y + dy * k, z, c, t]], { round: false })
    joint(x, y, z, c)
  }
}

/**
 * The Vanguard family: a chined cockpit pod between twin booms with a ring tail. The pod and
 * the booms are each one lofted skin from nose to nozzle lip: the four intakes are bulges of
 * the pod's skin and the three thrusters are the open rear ends of their bodies.
 */
function vanguard(b: Builder, o: VanguardOptions = {}): void {
  const bx = 1.5, flat = o.nozzle === 'flat'
  const tail = flat
    ? [[2.0, .56, .36, .3, .05, 2.2], [2.6, .54, .28, .26, .05, 3], [2.95, .52, .24, .24, .05, 3.6], [3.08, .48, .21, .21, .05, 3.6]]
    : [[2.0, .52, .38, .32, .05, 1.9], [2.6, .42, .37, .35, .05, 2.1], [2.95, .39, .37, .37, .05, 2.2], [3.08, .35, .34, .34, .05, 2.2]]
  b.fuselage([...POD_HULL.slice(0, 5), ...tail], { intakes: o.intakes ?? QUAD_INTAKES, exhaust: true })
  // A real cockpit: an opening in the hull, an interior tub and a bubble canopy over the pilot.
  b.cockpit(-2.9, -.7, .6, VANGUARD_EYE, { bulge: .2 })
  const boomTail = [[2.2, .26, .24, .2, -.03, 1.6], [2.9, .2, .2, .19, 0, 2], [3.2, .17, .17, .17, 0, 2.2]]
  const boomNose = o.booms === 'prong' ? [[-3.5, .02, .02, .02, -.07, 1.4], [-2.3, .16, .15, .12, -.07, 1.5], [-.6, .26, .25, .2, -.05, 1.5], [.4, .28, .26, .22, -.05, 1.5]] : BOOM_HULL.slice(0, 3)
  b.body('paint', [...boomNose, ...boomTail], { x: bx, mirror: true, around: 20, exhaust: true })
  b.surf([[.5, 0, -.4, 2.2, .08], [bx, -.02, -.2, 2.0, .08]], { round: false })
  // One clean forward sweep: the leading edge runs straight from the boom to the tip.
  // The drooped tip plate turns down a quarter of a metre, half its first depth.
  if (o.wing === 'droop') b.surf([[bx, -.02, .9, 1.5, .07], [2.4, .1, .36, 1.16, .062], [3.3, .2, -.18, .82, .055], [3.55, -.05, -.14, .74, .055]], { tipFrom: .66, tip: 'accent' })
  else b.surf([[bx, -.02, .9, 1.5, .07], [2.4, .1, .36, 1.16, .062], [3.2, .22, -.12, .8, .055], [3.65, .32, -.39, .5, .05]], { tipFrom: .75, tip: 'accent' })
  const canards = o.canards ?? 'boom'
  if (canards === 'boom') b.surf([[1.6, -.05, -1.1, .7, .06], [2.5, .05, -.7, .3, .05]], { tipFrom: .5, tip: 'accent' })
  if (canards === 'pod') b.surf([[.35, -.05, -2.3, .75, .07], [1.2, -.2, -1.75, .3, .05]], { tipFrom: .5, tip: 'accent' })
  tailRing(b, o, bx, -.03)
  b.port(0, -1.74, .24, .4); b.port(bx, 1.16, .16, .38, -.27)
  b.leg([0, -.12, -1.15], 'aft'); b.leg([bx, -.12, 1.75], 'aft')
}

export const JET_DESIGNS: JetDesign[] = [
  {
    id: 'vermilion', name: 'Vermilion', paint: 0x9c0a14, accent: 0x49e6ff,
    blurb: 'Closest to the reference: gull wings dropping into chrome-capped tip pods, canards, twin upper fins.',
    build(b) {
      b.fuselage([[-3.5, .1, .03, .03, -.05, 2.2], [-3.35, .3, .09, .08, -.05, 2.6], [-2.6, .44, .2, .17, -.03, 2.6], [-1.3, .56, .33, .26, 0, 2.5], [0, .7, .46, .34, .03, 2.4], [1.3, .74, .5, .38, .05, 2.6], [2.4, .66, .4, .36, .04, 3], [3.0, .56, .3, .32, .02, 3.4]])
      b.canopy(-3.3, -.55, .64, .05)
      b.scoop(-.35, 1.4, .27, .2)
      b.surf([[.38, -.05, -2.75, .8, .1], [.85, -.1, -2.55, .62, .09], [1.25, -.18, -2.25, .4, .08]], { tipFrom: .72 })
      b.surf([[.6, 0, -.2, 2.5, .11], [1.6, .16, .2, 2.2, .09], [2.7, .12, .75, 1.8, .08], [3.3, -.15, 1.1, 1.6, .09], [3.5, -.75, 1.3, 1.5, .11]], { tipFrom: .8 })
      b.surf([[.4, .4, 1.3, 1.3, .1], [1.0, .72, 1.9, 1.0, .08], [1.75, .95, 2.5, .7, .07]], { tipFrom: .75 })
      b.engine(1.25, -.34, .3, 2.6, .27)
      b.nozzle(3.0, .0, .5, .26, 0, 3.6)
      b.port(0, -1.74, .26, .42); b.port(.42, 1.16, .2, .4)
      b.leg([0, -.16, -1.15], 'aft'); b.leg([1.25, -.44, 1.1], 'aft')
    },
  },
  {
    id: 'manta', name: 'Manta', paint: 0x0d5a78, accent: 0x7dfcff,
    blurb: 'A wide blended body with crescent wings sweeping up into chrome winglets and twin canted fins.',
    build(b) {
      b.fuselage([[-3.3, .12, .03, .03, 0, 2.2], [-3.0, .45, .1, .08, 0, 2.8], [-2.0, .8, .24, .16, 0, 2.8], [-.5, 1.15, .4, .24, .02, 2.6], [1.0, 1.25, .44, .26, .04, 2.6], [2.4, 1.05, .34, .24, .06, 2.8], [3.1, .85, .22, .2, .07, 3.2]])
      b.canopy(-2.95, -.4, .5, .06)
      b.scoop(-.2, 1.5, .2, .16, .62)
      b.surf([[1.0, 0, -.6, 2.9, .1], [2.0, .05, .2, 2.2, .08], [2.9, .1, 1.2, 1.5, .07], [3.5, .3, 2.1, 1.0, .07], [3.7, .78, 2.6, .7, .08]], { tipFrom: .8 })
      b.surf([[.7, .3, 1.6, 1.3, .09], [.95, .75, 2.1, .9, .08], [1.25, 1.15, 2.6, .55, .07]], { tipFrom: .7 })
      b.nozzle(3.1, .07, .62, .18, 0, 3.6)
      b.port(0, -1.74, .3, .44); b.port(.7, 1.16, .24, .42)
      b.leg([0, -.1, -1.15], 'aft'); b.leg([.9, -.1, .3], 'in')
    },
  },
  {
    id: 'stiletto', name: 'Stiletto', paint: 0x3b1a8f, accent: 0xff7af2,
    blurb: 'A needle nose and forward-swept wings, shoulder engines and a tall chrome-tipped V tail.',
    build(b) {
      b.fuselage([[-3.6, .05, .03, .03, 0, 2], [-3.2, .2, .12, .1, 0, 2.2], [-2.2, .36, .26, .2, 0, 2.3], [-.8, .5, .4, .3, .02, 2.3], [.6, .62, .5, .36, .04, 2.4], [1.9, .62, .48, .36, .06, 2.6], [2.7, .52, .4, .34, .06, 3], [3.1, .46, .32, .3, .06, 3.2]])
      b.canopy(-3.05, -.9, .64, .07)
      b.scoop(-.5, 1.1, .22, .17)
      b.surf([[.55, 0, .7, 2.0, .1], [1.5, .08, .3, 1.6, .085], [2.6, .2, -.2, 1.2, .075], [3.3, .38, -.5, .9, .07], [3.55, .62, -.55, .75, .07]], { tipFrom: .82 })
      b.surf([[.3, -.1, -2.5, .7, .09], [.8, -.2, -2.2, .5, .08], [1.2, -.32, -1.9, .35, .07]], { tipFrom: .72 })
      b.surf([[.3, .4, 1.7, 1.4, .09], [.8, .95, 2.3, 1.0, .08], [1.35, 1.5, 2.9, .6, .07]], { tipFrom: .75 })
      b.surf([[.3, -.3, 2.0, .9, .08], [.6, -.6, 2.4, .6, .07], [.8, -.85, 2.7, .4, .06]], { tipFrom: .7 })
      b.engine(.74, -.06, -.4, 2.6, .27)
      b.nozzle(3.1, .06, .4, .24, 0, 3.4)
      b.port(0, -1.74, .22, .4); b.port(1.5, 1.16, .2, .36, .02)
      b.leg([0, -.16, -1.15], 'aft'); b.leg([.74, -.2, 1.2], 'aft')
    },
  },
  {
    id: 'talon', name: 'Talon', paint: 0xd4620a, accent: 0xffe27a,
    blurb: 'A cockpit pod between twin engine booms, joined by an arched tail, with drooping chrome-capped tips.',
    build(b) {
      b.fuselage([[-3.4, .06, .03, .03, 0, 2], [-3.0, .3, .14, .1, 0, 2.4], [-2.0, .5, .3, .2, 0, 2.4], [-.6, .66, .44, .3, .02, 2.4], [.6, .64, .42, .3, .04, 2.4], [1.5, .46, .3, .26, .05, 2.6], [2.1, .32, .2, .2, .05, 3]])
      b.canopy(-2.95, -.5, .64, .07)
      b.body('paint', [[-1.2, .05, .05, .05, -.05, 2], [-.8, .22, .22, .2, -.05, 2.2], [.5, .29, .29, .27, -.05, 2.2], [2.2, .25, .25, .23, -.03, 2.2], [3.1, .19, .19, .18, 0, 2.2]], { x: 1.55, mirror: true, around: 24 })
      b.body('chrome', [[-1.55, .01, .01, .01, -.05, 2], [-1.3, .05, .05, .05, -.05, 2], [-1.05, .13, .13, .12, -.05, 2], [-.85, .2, .2, .19, -.05, 2]], { x: 1.55, mirror: true, seg: 5, around: 20 })
      b.surf([[.5, 0, -.5, 2.2, .1], [1.0, -.01, -.4, 2.1, .1], [1.55, -.02, -.3, 2.0, .1]])
      b.surf([[1.55, -.02, -.1, 1.9, .09], [2.5, .1, .5, 1.5, .08], [3.3, .05, 1.1, 1.1, .08], [3.6, -.45, 1.5, .95, .1]], { tipFrom: .8 })
      b.surf([[1.55, .15, 2.1, 1.0, .08], [1.3, .55, 2.4, .85, .07], [.7, .82, 2.65, .75, .07], [0, .88, 2.75, .7, .07]])
      b.surf([[1.6, .15, 2.2, .9, .08], [1.85, .6, 2.6, .65, .07], [2.1, .95, 2.95, .42, .06]], { tipFrom: .7 })
      b.nozzle(3.1, 0, .19, .19, 1.55)
      b.nozzle(2.1, .05, .3, .18, 0, 3.2)
      b.port(0, -1.74, .26, .42); b.port(1.55, 1.16, .17, .4, -.3)
      b.leg([0, -.14, -1.15], 'aft'); b.leg([1.55, -.14, 1.75], 'aft')
    },
  },
  {
    id: 'dragonfly', name: 'Dragonfly', paint: 0x0f7a3c, accent: 0xb6ff5c,
    blurb: 'Tandem wings: high chrome-tipped foreplanes, low rear wings dropping into tip pods, one tall dorsal fin.',
    build(b) {
      b.fuselage([[-3.5, .08, .03, .03, 0, 2.2], [-3.25, .28, .1, .08, 0, 2.6], [-2.3, .46, .24, .18, 0, 2.6], [-1.0, .58, .36, .26, .02, 2.5], [.4, .66, .44, .32, .04, 2.4], [1.8, .64, .42, .34, .05, 2.6], [2.8, .54, .32, .3, .05, 3], [3.2, .46, .24, .26, .04, 3.4]])
      b.canopy(-3.2, -1.0, .64, .06)
      b.scoop(-.6, .9, .24, .18)
      b.surf([[.5, .12, -1.6, 1.3, .09], [1.4, .25, -1.2, 1.0, .08], [2.3, .4, -.7, .75, .07], [2.75, .72, -.4, .6, .07]], { tipFrom: .78 })
      b.surf([[.6, -.08, .7, 2.2, .1], [1.7, -.02, 1.1, 1.8, .09], [2.8, -.1, 1.6, 1.4, .08], [3.4, -.4, 1.9, 1.2, .09], [3.55, -.9, 2.05, 1.1, .11]], { tipFrom: .8 })
      b.surf([[0, .4, 1.5, 1.5, .08], [0, .95, 2.2, 1.0, .07], [0, 1.45, 2.9, .55, .06]], { tipFrom: .78, mirror: false })
      b.engine(1.3, -.38, .9, 2.8, .25)
      b.nozzle(3.2, .0, .4, .2, 0, 3.6)
      b.port(0, -1.74, .26, .42); b.port(.4, 1.16, .19, .38)
      b.leg([0, -.14, -1.15], 'aft'); b.leg([1.3, -.47, 1.5], 'aft')
    },
  },
  // Second round: the Stiletto's forward-swept wings with the Talon's in-swept arch tail.
  {
    id: 'sabre', name: 'Sabre', paint: 0x6a1bb0, accent: 0xffb14a,
    blurb: 'The Stiletto with its V tail replaced by a hoop: fins rise from the shoulder engines and meet over the exhaust.',
    build(b) {
      b.fuselage(STILETTO_HULL)
      b.canopy(-3.05, -.9, .64, .07)
      b.scoop(-.5, 1.1, .22, .17)
      b.surf(FORWARD_SWEPT, { tipFrom: .82 })
      b.surf([[.3, -.1, -2.5, .7, .09], [.8, -.2, -2.2, .5, .08], [1.2, -.32, -1.9, .35, .07]], { tipFrom: .72 })
      b.surf(arc(0, .12, 1.0, 1.05, 0, 90, 1.9, 2.75, 1.0, .7), { round: false })
      b.engine(.74, -.06, -.4, 2.6, .27)
      b.nozzle(3.1, .06, .4, .24, 0, 3.4)
      b.port(0, -1.74, .22, .4); b.port(1.5, 1.16, .2, .36, .02)
      b.leg([0, -.16, -1.15], 'aft'); b.leg([.74, -.2, 1.2], 'aft')
    },
  },
  {
    id: 'halo', name: 'Halo', paint: 0xd4620a, accent: 0x7dfcff,
    blurb: 'Forward-swept wings ahead of a full ring tail that circles one large round exhaust.',
    build(b) {
      b.fuselage([[-3.6, .05, .03, .03, 0, 2], [-3.2, .2, .12, .1, 0, 2.2], [-2.2, .36, .26, .2, 0, 2.3], [-.8, .52, .4, .3, .02, 2.3], [.6, .66, .5, .38, .04, 2.3], [1.9, .6, .5, .42, .06, 2.2], [2.7, .46, .44, .4, .06, 2.1], [3.0, .4, .4, .38, .06, 2]])
      b.canopy(-3.05, -.9, .64, .07)
      b.scoop(-.4, 1.2, .24, .18)
      b.surf(FORWARD_SWEPT, { tipFrom: .82 })
      b.surf([[.3, -.1, -2.5, .7, .09], [.8, -.2, -2.2, .5, .08], [1.2, -.32, -1.9, .35, .07]], { tipFrom: .72 })
      b.surf(arc(0, .06, 1.05, 1.05, 0, 90, 2.3, 2.5, .85, .8), { round: false })
      b.surf(arc(0, .06, 1.05, .98, 0, -90, 2.3, 2.5, .85, .8), { round: false })
      b.surf([[.3, .06, 2.1, 1.0, .1], [.7, .06, 2.2, .9, .09], [1.08, .06, 2.3, .85, .08]], { round: false })
      b.nozzle(3.0, .06, .38, .38)
      b.port(0, -1.74, .22, .4); b.port(1.5, 1.16, .2, .36, .02)
      b.leg([0, -.16, -1.15], 'aft'); b.leg([1.0, -.02, 1.1], 'in')
    },
  },
  {
    id: 'scimitar', name: 'Scimitar', paint: 0x9c0a14, accent: 0xffe27a,
    blurb: 'The Talon with forward-swept outer wings and canards: twin booms carry a round arch tail with chrome outer fins.',
    build(b) {
      b.fuselage([[-3.4, .06, .03, .03, 0, 2], [-3.0, .3, .14, .1, 0, 2.4], [-2.0, .5, .3, .2, 0, 2.4], [-.6, .66, .44, .3, .02, 2.4], [.6, .64, .42, .3, .04, 2.4], [1.5, .46, .3, .26, .05, 2.6], [2.1, .32, .2, .2, .05, 3]])
      b.canopy(-2.95, -.5, .64, .07)
      b.body('paint', [[-1.2, .05, .05, .05, -.05, 2], [-.8, .22, .22, .2, -.05, 2.2], [.5, .29, .29, .27, -.05, 2.2], [2.2, .25, .25, .23, -.03, 2.2], [3.1, .19, .19, .18, 0, 2.2]], { x: 1.55, mirror: true, around: 24 })
      b.body('chrome', [[-1.55, .01, .01, .01, -.05, 2], [-1.3, .05, .05, .05, -.05, 2], [-1.05, .13, .13, .12, -.05, 2], [-.85, .2, .2, .19, -.05, 2]], { x: 1.55, mirror: true, seg: 5, around: 20 })
      b.surf([[.5, 0, -.5, 2.2, .1], [1.0, -.01, -.4, 2.1, .1], [1.55, -.02, -.3, 2.0, .1]], { round: false })
      b.surf([[1.55, -.02, .6, 1.7, .09], [2.4, .08, .2, 1.3, .08], [3.2, .25, -.25, .95, .07], [3.6, .5, -.4, .75, .07]], { tipFrom: .8 })
      b.surf([[.3, -.08, -2.4, .7, .09], [.8, -.15, -2.1, .5, .08], [1.15, -.25, -1.85, .35, .07]], { tipFrom: .72 })
      b.surf(arc(0, .1, 1.55, 1.0, 0, 90, 2.1, 2.8, 1.0, .7), { round: false })
      b.surf([[1.6, .15, 2.2, .9, .08], [1.85, .6, 2.6, .65, .07], [2.1, .95, 2.95, .42, .06]], { tipFrom: .7 })
      b.nozzle(3.1, 0, .19, .19, 1.55)
      b.nozzle(2.1, .05, .3, .18, 0, 3.2)
      b.port(0, -1.74, .26, .42); b.port(1.55, 1.16, .17, .4, -.3)
      b.leg([0, -.14, -1.15], 'aft'); b.leg([1.55, -.14, 1.75], 'aft')
    },
  },
  {
    id: 'crescent', name: 'Crescent', paint: 0x152a7a, accent: 0xff7af2,
    blurb: 'A wide arch springs from underwing engines set far out, spanning the whole tail behind forward-swept wings.',
    build(b) {
      b.fuselage([[-3.5, .1, .03, .03, -.05, 2.2], [-3.35, .3, .09, .08, -.05, 2.6], [-2.6, .44, .2, .17, -.03, 2.6], [-1.3, .56, .33, .26, 0, 2.5], [0, .7, .46, .34, .03, 2.4], [1.3, .74, .5, .38, .05, 2.6], [2.4, .66, .4, .36, .04, 3], [3.0, .56, .3, .32, .02, 3.4]])
      b.canopy(-3.3, -.55, .64, .05)
      b.scoop(-.35, 1.4, .27, .2)
      b.surf([[.6, 0, .6, 2.1, .1], [1.6, .06, .2, 1.7, .09], [2.6, .18, -.25, 1.25, .08], [3.3, .36, -.55, .95, .07], [3.55, .6, -.6, .78, .07]], { tipFrom: .82 })
      b.surf([[.38, -.05, -2.75, .8, .1], [.85, -.1, -2.55, .62, .09], [1.25, -.18, -2.25, .4, .08]], { tipFrom: .72 })
      b.surf(arc(0, -.1, 1.65, 1.3, 0, 90, 1.6, 2.8, 1.1, .72), { round: false })
      b.engine(1.6, -.2, .5, 2.7, .27)
      b.nozzle(3.0, 0, .5, .26, 0, 3.6)
      b.port(0, -1.74, .26, .42); b.port(.42, 1.16, .2, .4)
      b.leg([0, -.16, -1.15], 'aft'); b.leg([1.6, -.3, 1.3], 'aft')
    },
  },
  {
    id: 'trident', name: 'Trident', paint: 0x8a1466, accent: 0xb6ff5c,
    blurb: 'Forward-swept gull wings dropping into chrome tip pods, a hoop tail braced by a dorsal spine, and high canards.',
    build(b) {
      b.fuselage(STILETTO_HULL)
      b.canopy(-3.05, -.9, .64, .07)
      b.scoop(-.5, 1.1, .22, .17)
      b.surf([[.55, 0, .7, 2.0, .1], [1.5, .12, .3, 1.6, .085], [2.6, .15, -.2, 1.25, .08], [3.3, -.1, -.45, 1.05, .09], [3.5, -.65, -.5, .95, .11]], { tipFrom: .8 })
      b.surf([[.4, .3, -1.0, .8, .08], [1.0, .5, -.6, .55, .07], [1.5, .62, -.3, .38, .06]], { tipFrom: .72 })
      b.surf(arc(0, .12, 1.0, 1.05, 0, 90, 1.9, 2.75, 1.0, .7), { round: false })
      b.surf([[0, .45, 1.5, 1.4, .07], [0, .8, 2.1, 1.05, .06], [0, 1.15, 2.7, .75, .06]], { mirror: false, round: false, mat: 'chrome' })
      b.engine(.74, -.06, -.4, 2.6, .27)
      b.nozzle(3.1, .06, .4, .24, 0, 3.4)
      b.port(0, -1.74, .22, .4); b.port(1.5, 1.16, .2, .36, .02)
      b.leg([0, -.16, -1.15], 'aft'); b.leg([.74, -.2, 1.2], 'aft')
    },
  },
  // Third round: Scimitar's twin booms and Halo's ring tail, with hard military lines.
  // Chined diamond hulls, straight cranked wings, polygonal rings, satin paint. No weapons.
  {
    id: 'warden', name: 'Warden', paint: 0x3d4650, accent: 0xe8641a, hard: true, finish: 'military',
    blurb: 'Scimitar squared off: a chined pod between twin booms, with an octagonal ring tail strung between the booms around the main thruster.',
    build(b) {
      b.fuselage(POD_HULL)
      b.canopy(-2.9, -.7, .6, .06)
      b.scoop(-.3, 1.2, .26, .18)
      b.body('paint', BOOM_HULL, { x: 1.55, mirror: true, around: 20 })
      b.surf([[.5, 0, -.4, 2.2, .08], [1.55, -.02, -.2, 2.0, .08]], { round: false })
      b.surf([[1.55, -.02, .7, 1.6, .07], [3.0, .2, -.1, .95, .06], [3.65, .3, -.4, .6, .05]], { tipFrom: .75, tip: 'accent' })
      b.surf([[.35, -.05, -2.3, .75, .07], [1.2, -.2, -1.75, .3, .05]], { tipFrom: .5, tip: 'accent' })
      b.surf(arc(0, .05, 1.55, 1.05, 0, 90, 2.2, 2.5, .9, .75, .06, 3), { round: false })
      b.surf(arc(0, .05, 1.55, .7, 0, -90, 2.2, 2.5, .9, .75, .06, 3), { round: false })
      b.surf([[1.6, .12, 2.2, .9, .06], [2.1, .9, 2.9, .4, .05]], { tipFrom: .5, tip: 'accent' })
      b.nozzle(2.7, .05, .36, .26, 0, 4)
      b.nozzle(3.1, 0, .17, .17, 1.55, 3)
      b.port(0, -1.74, .24, .4); b.port(1.55, 1.16, .16, .38, -.27)
      b.leg([0, -.12, -1.15], 'aft'); b.leg([1.55, -.12, 1.75], 'aft')
    },
  },
  {
    id: 'bastion', name: 'Bastion', paint: 0x4a5236, accent: 0xf2c230, hard: true, finish: 'military',
    blurb: 'Halo hardened: one chined hull, cranked forward-swept wings, engine nacelles and an octagonal ring tail braced top and bottom.',
    build(b) {
      b.fuselage([[-3.6, .04, .02, .02, 0, 1.3], [-2.6, .3, .18, .12, 0, 1.35], [-1.2, .5, .36, .24, .02, 1.4], [.4, .66, .48, .32, .04, 1.5], [1.8, .62, .48, .36, .05, 1.7], [2.6, .5, .42, .38, .06, 2], [3.0, .42, .4, .38, .06, 2.2]])
      b.canopy(-3.0, -.9, .6, .06)
      b.scoop(-.4, 1.1, .24, .18)
      b.surf([[.55, 0, .9, 1.9, .08], [1.6, .05, .3, 1.5, .07], [3.0, .22, -.3, .9, .06], [3.6, .34, -.5, .6, .05]], { tipFrom: .8, tip: 'accent' })
      b.surf([[.3, -.1, -2.4, .7, .07], [1.15, -.3, -1.85, .3, .05]], { tipFrom: .5, tip: 'accent' })
      b.engine(1.05, -.08, .2, 2.5, .24)
      b.surf(arc(0, .06, 1.05, 1.05, 0, 90, 2.2, 2.45, .85, .8, .06, 3), { round: false })
      b.surf(arc(0, .06, 1.05, .95, 0, -90, 2.2, 2.45, .85, .8, .06, 3), { round: false })
      b.surf([[0, .44, 1.9, .9, .05], [0, 1.1, 2.35, .75, .05]], { mirror: false, round: false, mat: 'accent' })
      b.surf([[0, -.34, 1.9, .9, .05], [0, -.88, 2.35, .75, .05]], { mirror: false, round: false })
      b.nozzle(3.0, .06, .36, .36, 0, 2.2)
      b.port(0, -1.74, .22, .4); b.port(1.5, 1.16, .2, .36, .02)
      b.leg([0, -.16, -1.15], 'aft'); b.leg([1.05, -.2, 1.2], 'aft')
    },
  },
  {
    id: 'lancer', name: 'Lancer', paint: 0x1d2b44, accent: 0x38d6c6, hard: true, finish: 'military',
    blurb: 'The booms run forward as twin prongs past a recessed cockpit pod, with a tight ring ducting the main thruster and drooped wingtip plates.',
    build(b) {
      b.fuselage([[-2.6, .05, .03, .03, 0, 1.3], [-1.9, .36, .22, .14, 0, 1.4], [-.8, .6, .42, .26, .02, 1.5], [.6, .7, .46, .3, .04, 1.6], [1.9, .56, .4, .32, .05, 1.8], [2.7, .44, .36, .34, .06, 2.2]])
      b.canopy(-2.2, -.3, .6, .07)
      b.body('paint', [[-3.6, .02, .02, .02, -.08, 1.4], [-2.4, .16, .14, .12, -.08, 1.5], [-.6, .26, .24, .2, -.06, 1.5], [1.6, .28, .26, .22, -.04, 1.5], [3.0, .2, .2, .18, -.02, 1.6]], { x: 1.35, mirror: true, around: 20 })
      b.surf([[.5, 0, -1.0, 2.6, .08], [1.35, -.04, -.9, 2.5, .08]], { round: false })
      b.surf([[1.35, -.04, .5, 1.7, .07], [2.9, .12, -.1, 1.0, .06], [3.45, .1, -.3, .8, .06], [3.6, -.45, -.2, .7, .06]], { tipFrom: .66, tip: 'accent' })
      b.surf(arc(0, .06, .85, .85, 0, 90, 2.3, 2.5, .7, .7, .06, 3), { round: false })
      b.surf(arc(0, .06, .85, .8, 0, -90, 2.3, 2.5, .7, .7, .06, 3), { round: false })
      b.surf([[1.35, -.02, 2.2, .8, .06], [.85, .06, 2.3, .7, .06]], { round: false })
      b.surf([[1.4, .15, 2.0, 1.0, .06], [1.9, 1.0, 2.9, .4, .05]], { tipFrom: .5, tip: 'accent' })
      b.nozzle(2.7, .06, .34, .34, 0, 2.2)
      b.nozzle(3.0, -.02, .18, .18, 1.35, 3)
      b.port(0, -1.74, .2, .36); b.port(1.35, 1.16, .16, .38, -.27)
      b.leg([0, -.1, -1.0], 'aft'); b.leg([1.35, -.12, 1.75], 'aft')
    },
  },
  {
    id: 'aegis', name: 'Aegis', paint: 0x8a7a5c, accent: 0xc0392b, hard: true, finish: 'military',
    blurb: 'A wide chined lifting body with forward-swept wings, a squared-off box tail in place of the ring, and one broad flat vectoring nozzle.',
    build(b) {
      b.fuselage([[-3.4, .06, .02, .02, 0, 1.25], [-2.4, .6, .16, .1, 0, 1.3], [-1.0, 1.0, .32, .18, .02, 1.35], [.6, 1.25, .4, .22, .04, 1.4], [2.0, 1.15, .36, .22, .05, 1.5], [3.0, .9, .24, .2, .06, 1.8]])
      b.canopy(-2.8, -.6, .42, .06)
      b.scoop(-.1, 1.3, .2, .15, .6)
      b.surf([[1.1, .02, 1.0, 1.7, .07], [2.2, .1, .4, 1.2, .06], [3.3, .26, -.2, .7, .05], [3.65, .34, -.4, .5, .05]], { tipFrom: .8, tip: 'accent' })
      b.surf([[.7, .12, -1.9, .7, .06], [1.5, .4, -1.4, .3, .05]], { tipFrom: .5, tip: 'accent' })
      b.surf([[1.05, .2, 2.0, 1.0, .06], [1.2, 1.0, 2.5, .8, .06], [0, 1.0, 2.6, .8, .06]], { round: false })
      b.nozzle(3.0, .06, .55, .2, 0, 4)
      b.port(0, -1.74, .28, .42); b.port(.7, 1.16, .24, .42)
      b.leg([0, -.1, -1.15], 'aft'); b.leg([.9, -.08, .3], 'in')
    },
  },
  {
    id: 'vanguard', name: 'Vanguard', paint: 0x565c66, accent: 0xff3d5a, hard: true, finish: 'military',
    blurb: 'Twin booms carry a free octagonal ring on four X struts around the main thruster, with dogtooth forward-swept wings and boom canards.',
    build(b) { vanguard(b, { intakes: [[90, -.3, 1.2, .26, .18]] }) },
  },
  // Fourth round: the Vanguard with several intakes spaced evenly around the fuselage.
  ...([
    ['tri', 'Tri', 'Three intakes at 120 degrees: one on the spine and one low on each flank.', [90, 210, 330].map(a => [a, -.3, 1.2, .22, .17])],
    ['quad', 'Quad', 'Four intakes in an X at 90 degrees, echoing the X struts of the tail ring.', QUAD_INTAKES],
    ['hex', 'Hex', 'Six intakes at 60 degrees right round the hull, belly included.', [30, 90, 150, 210, 270, 330].map(a => [a, -.2, 1.0, .15, .13])],
    ['collar', 'Collar', 'Eight short intakes in a tight collar behind the cockpit.', [0, 1, 2, 3, 4, 5, 6, 7].map(k => [22.5 + 45 * k, .1, .9, .11, .1])],
    ['stagger', 'Stagger', 'Two rows of three, the rear row turned 60 degrees so the six never line up.', [...[90, 210, 330].map(a => [a, -.6, .3, .17, .14]), ...[30, 150, 270].map(a => [a, .5, 1.4, .17, .14])]],
  ] as [string, string, string, number[][]][]).map(([id, name, blurb, intakes]): JetDesign => ({
    id: `vanguard-${id}`, name: `Vanguard ${name}`, paint: 0x565c66, accent: 0xff3d5a, hard: true, finish: 'military', blurb,
    build(b) { vanguard(b, { intakes }) },
  })),
  // Fifth round: variations on the Vanguard Quad.
  ...([
    ['prong', 'Prong', 'The booms run forward past the cockpit as twin prongs, with the canards moved to the pod.', { booms: 'prong', canards: 'pod' }],
    ['hex', 'Hexring', 'A six-sided tail ring with upright flanks, and wingtip plates turned down.', { ring: 'hex', wing: 'droop' }],
    ['box', 'Boxtail', 'A square box tail around a wide flat thruster, for a heavier, more armoured look.', { ring: 'box', nozzle: 'flat' }],
    ['span', 'Spanring', 'A wide ring that runs straight into the booms with no struts, and no canards: the cleanest outline.', { ringOnBooms: true, canards: 'none' }],
  ] as [string, string, string, VanguardOptions][]).map(([id, name, blurb, options]): JetDesign => ({
    id: `quad-${id}`, name: `Quad ${name}`, paint: 0x565c66, accent: 0xff3d5a, hard: true, finish: 'military', blurb,
    build(b) { vanguard(b, options) },
  })),
  // Sixth round: the Quad Hexring as one lofted body, with pointed joints all round the ring.
  ...([
    ['mk2', 'Mk2', 'The Hexring cleaned up: intakes and thrusters lofted into their bodies, six ring joints, shallower wingtips.', { ring: 'hex', wing: 'droop' }],
    ['prong', 'Prong', 'The same with the booms run forward as prongs and the canards on the cockpit pod.', { ring: 'hex', wing: 'droop', booms: 'prong', canards: 'pod' }],
    ['span', 'Span', 'The ring widened until its flanks are the booms themselves: a diamond roof and keel, no struts, no canards.', { ring: 'hex', wing: 'droop', ringOnBooms: true, canards: 'none' }],
    ['spine', 'Spine', 'A larger ring braced to the hull by a dorsal and a ventral strut that meet its top and bottom joints.', { ring: 'hex', wing: 'droop', spine: true, ringSize: 1.08 }],
    ['heavy', 'Heavy', 'A wide flat main thruster, prong booms and plain swept tips: the heaviest looking of the five.', { ring: 'hex', wing: 'swept', booms: 'prong', nozzle: 'flat', canards: 'none' }],
  ] as [string, string, string, VanguardOptions][]).map(([id, name, blurb, options]): JetDesign => ({
    smooth: true, id: `hex-${id}`, name: `Hexring ${name}`, paint: 0x565c66, accent: 0xff3d5a, hard: true, finish: 'military', blurb,
    build(b) { vanguard(b, options) },
  })),
]
