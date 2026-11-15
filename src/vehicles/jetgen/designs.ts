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
export interface JetDesign { id: string; name: string; blurb: string; paint: number; accent: number; build(b: Builder): void }

/**
 * Surface rows along an elliptical arc in the X-Y plane, for hoop and arch tails.
 * Angles are degrees: 0 is straight out to the right, 90 is the top, -90 the bottom.
 * The leading edge runs from z0 to z1 and the chord from chord0 to chord1.
 */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, z0: number, z1: number, chord0: number, chord1: number, thick = .08, n = 7): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const k = i / (n - 1), a = (a0 + (a1 - a0) * k) * Math.PI / 180
    return [Math.max(.02, cx + rx * Math.cos(a)), cy + ry * Math.sin(a), z0 + (z1 - z0) * k, chord0 + (chord1 - chord0) * k, thick]
  })
}

/** The forward-swept wing of the Stiletto, shared by the second-round hybrids. */
const FORWARD_SWEPT = [[.55, 0, .7, 2.0, .1], [1.5, .08, .3, 1.6, .085], [2.6, .2, -.2, 1.2, .075], [3.3, .38, -.5, .9, .07], [3.55, .62, -.55, .75, .07]]
const STILETTO_HULL = [[-3.6, .05, .03, .03, 0, 2], [-3.2, .2, .12, .1, 0, 2.2], [-2.2, .36, .26, .2, 0, 2.3], [-.8, .5, .4, .3, .02, 2.3], [.6, .62, .5, .36, .04, 2.4], [1.9, .62, .48, .36, .06, 2.6], [2.7, .52, .4, .34, .06, 3], [3.1, .46, .32, .3, .06, 3.2]]

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
      b.nozzle(3.1, .07, .34, .17, .42, 3.4)
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
      b.surf([[1.55, .15, 2.1, 1.0, .08], [1.3, .55, 2.4, .85, .07], [.7, .82, 2.65, .75, .07], [.02, .88, 2.75, .7, .07]])
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
]
