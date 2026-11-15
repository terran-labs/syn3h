/**
 * Round eight: ten reinterpretations of the original tank at its own scale and proportions.
 *
 * The owner rejected round seven as tall boxes on treads. The original is a low dart, 5 m long
 * and 2.5 m wide, slung between six tread pods that stand as tall as it does, with one small
 * bubble for the driver. These keep that: the same footprint and pod positions, a body no
 * taller than its treads, one force field bubble. The styling follows the approved Box arm
 * buggy and Hexring Mk2 jet: lofted candy-painted bodies, an accent stripe, bright rims,
 * fins and intakes. Carried forward from every earlier round: no weapons, six independent
 * treads each with its own fender (the rear ones sweeping back), stout single-pivot arms,
 * big headlamps, mechanical running gear.
 *
 * Each entry varies the body's plan and profile, not its paint. `tank.design` in ../Tank.ts
 * picks one by position, so append new designs rather than reordering.
 */
import { sleekHull, type SleekSpec } from './sleekKit'
import type { TankBody } from '../tank/shipped'
export type { TankBody } from '../tank/shipped'

const body = (id: string, name: string, tagline: string, color: number, accent: number, spec: SleekSpec): TankBody =>
  ({ id, name, tagline, color, accent, hull: () => sleekHull(spec) })
const tip = (z: number, y: number, x = 0) => [z, .03, .025, .025, y, 2, x]

export const round8: TankBody[] = [
  body('r8-dart', '01 Dart', 'The original, redrawn: an arrowhead with a swallowtail, its bubble amidships.', 0x1c5d8f, 0xb46bff, {
    fender: 'swept', bubble: { z: -.35, a: .5, b: .85, h: .52 },
    lofts: [
      { stripe: 14, stations: [tip(-3, 1), [-2.4, .34, .16, .14, 1.02, 2.2], [-1.2, .82, .34, .3, 1.06, 2.4], [-.2, 1.12, .5, .36, 1.08, 2.6], [.8, 1.05, .46, .36, 1.08, 2.6], [1.7, .7, .3, .28, 1.06, 2.4], [2.3, .3, .14, .14, 1.04, 2.2], tip(2.6, 1.03)] },
      { twin: true, stations: [tip(.3, 1.05, .7), [1.3, .34, .22, .2, 1.08, 2.2, .86], [2.3, .3, .2, .16, 1.13, 2.2, 1], tip(3.2, 1.22, 1.14)] },
    ],
    noseLamps: [[.36, 1.03, -1.95, .15]],
  }),
  body('r8-manta', '02 Manta', 'A broad, flat ray: drooped nose, wide shoulders and two canted tail fins.', 0x0d5a78, 0x7dfcff, {
    fender: 'round', bubble: { z: -.6, a: .55, b: .95, h: .52 },
    lofts: [{ stripe: 14, stations: [tip(-2.9, .93), [-2.3, .6, .14, .12, .98, 2.2], [-1.3, 1.05, .3, .22, 1.04, 2.2], [0, 1.2, .42, .3, 1.08, 2.3], [1.3, 1.1, .36, .28, 1.08, 2.3], [2.3, .8, .2, .18, 1.06, 2.2], tip(2.85, 1.05)] }],
    fins: [{ x: .72, y: 1.3, z: 2, height: .8, chord: .8, sweep: .5, lean: .3, twin: true }],
    noseLamps: [[.5, .98, -2.05, .15]],
  }),
  body('r8-hexring', '03 Hexring', 'The jet on tracks: a slim fuselage, an intake nacelle over each side and a tail ring.', 0x565c66, 0xff3d5a, {
    fender: 'short', bubble: { z: -.7, a: .46, b: .9, h: .5 },
    lofts: [
      { stripe: 16, stations: [tip(-3.1, 1), [-2.2, .42, .26, .2, 1.05, 2.2], [-1, .62, .46, .3, 1.1, 2.4], [.4, .62, .44, .32, 1.1, 2.4], [1.8, .45, .3, .26, 1.08, 2.3], tip(2.7, 1.06)] },
      { twin: true, mouth: 'front', stations: [[-1.5, .26, .24, .22, 1.2, 2.2, .98], [-.4, .3, .27, .25, 1.2, 2.2, 1], [1.2, .28, .25, .24, 1.2, 2.2, 1], [2.4, .2, .18, .18, 1.22, 2.2, .98], tip(2.95, 1.22, .98)] },
    ],
    fins: [{ x: .98, y: 1.38, z: 2.2, height: .62, chord: .6, sweep: .3, lean: -.16, twin: true }],
    wing: { y: 2, z: 2.5, span: .9, chord: .42, surface: 'accent' },
  }),
  body('r8-catamaran', '04 Catamaran', 'Two long hulls with the cockpit pod bridged between them.', 0xdfe3e7, 0xff5a12, {
    fender: 'folded', bubble: { z: -.25, a: .48, b: .82, h: .5 },
    lofts: [
      { stripe: 16, stations: [tip(-1.7, 1.12), [-1.1, .5, .26, .2, 1.16, 2.3], [-.2, .66, .36, .28, 1.2, 2.4], [.8, .6, .32, .28, 1.2, 2.4], [1.6, .3, .16, .14, 1.18, 2.2], tip(2, 1.17)] },
      { twin: true, stations: [tip(-3, .98, .62), [-2.2, .34, .22, .2, 1, 2.3, .7], [-.8, .46, .34, .3, 1.04, 2.5, .74], [1, .46, .34, .3, 1.04, 2.5, .74], [2.3, .34, .24, .22, 1.04, 2.3, .7], tip(2.9, 1.04, .64)] },
    ],
    noseLamps: [[.7, 1.02, -2.05, .15]],
  }),
  body('r8-scarab', '05 Scarab', 'A rounded beetle shell with the bubble well forward.', 0x8a1466, 0xb6ff5c, {
    fender: 'deep', bubble: { z: -1, a: .62, b: .9, h: .55 },
    lofts: [{ stripe: 18, stations: [[-2.55, .1, .08, .08, 1, 2], [-2.1, .7, .34, .26, 1.04, 2.1], [-1.1, 1.1, .56, .34, 1.1, 2.2], [.2, 1.2, .6, .36, 1.12, 2.2], [1.4, 1.05, .5, .34, 1.1, 2.2], [2.2, .6, .28, .24, 1.06, 2.1], [2.55, .1, .06, .06, 1.05, 2]] }],
    noseLamps: [[.48, 1.02, -2, .16]],
    hoop: { z: .2, y: 1.2, width: 1.16, height: .66, radius: .05, surface: 'accent' },
  }),
  body('r8-stiletto', '06 Stiletto', 'A needle nose, the driver far aft, and the buggy\'s spoiler across two fins.', 0x0b2f8f, 0x35d6c8, {
    fender: 'swept', bubble: { z: .55, a: .5, b: .8, h: .5 },
    lofts: [{ stripe: 14, stations: [tip(-3.5, .95), [-2.6, .24, .14, .12, .98, 2.2], [-1.2, .56, .3, .24, 1.04, 2.4], [.3, .95, .48, .34, 1.1, 2.5], [1.4, 1.05, .5, .36, 1.12, 2.5], [2.3, .8, .36, .3, 1.1, 2.4], [2.75, .3, .14, .14, 1.08, 2.2]] }],
    fins: [{ x: .78, y: 1.3, z: 2.2, height: .72, chord: .7, sweep: .4, twin: true, surface: 'paint' }],
    wing: { y: 2.02, z: 2.6, span: .95, chord: .5 },
    noseLamps: [[.3, 1.02, -1.75, .14]],
  }),
  body('r8-wedge', '07 Wedge', 'Cab forward: the bubble over the nose and a deck rising to twin exhausts.', 0xd4620a, 0xffe27a, {
    fender: 'folded', bubble: { z: -1.35, a: .6, b: .8, h: .55 },
    lofts: [
      { stripe: 16, stations: [[-2.9, .1, .06, .06, .9, 2.4], [-2.5, .8, .2, .16, .95, 2.6], [-1.5, 1, .42, .26, 1.02, 2.6], [-.2, 1.1, .5, .32, 1.08, 2.6], [1.2, 1.12, .58, .34, 1.12, 2.8], [2.3, 1, .6, .34, 1.14, 3], [2.7, .7, .4, .3, 1.14, 3]] },
      { twin: true, mouth: 'rear', stations: [tip(.9, 1.6, .6), [1.6, .26, .2, .1, 1.62, 2.2, .6], [2.6, .3, .22, .12, 1.66, 2.2, .6], [2.95, .28, .2, .12, 1.66, 2.2, .6]] },
    ],
    noseLamps: [[.55, .98, -2.3, .16]],
  }),
  body('r8-wasp', '08 Wasp', 'A waisted body that swells between the treads, under one tall dorsal fin.', 0x0f7a3c, 0xffe27a, {
    fender: 'round', bubble: { z: -.95, a: .5, b: .85, h: .52 },
    lofts: [{ stripe: 14, stations: [tip(-3, 1), [-2.5, .4, .2, .16, 1.02, 2.2], [-1.25, 1.15, .42, .3, 1.06, 2.4], [0, .78, .46, .32, 1.1, 2.4], [1.25, 1.2, .44, .32, 1.1, 2.4], [2.4, .7, .26, .24, 1.08, 2.3], tip(2.9, 1.07)] }],
    fins: [{ x: 0, y: 1.42, z: 1.7, height: .95, chord: 1.1, sweep: .6 }],
    noseLamps: [[.4, 1.03, -2.25, .15]],
  }),
  body('r8-fork', '09 Fork', 'The original turned round: twin prows reach forward of a blunt cockpit body.', 0x3b1a8f, 0xff7af2, {
    fender: 'short', bubble: { z: -.3, a: .55, b: .9, h: .54 },
    pylons: [{ rootX: .7 }],
    lofts: [
      { stripe: 16, stations: [[-1.7, .3, .2, .16, 1.02, 2.2], [-.9, .9, .4, .3, 1.06, 2.4], [.2, 1.15, .5, .34, 1.1, 2.5], [1.4, 1, .44, .32, 1.1, 2.5], [2.3, .6, .26, .24, 1.08, 2.3], tip(2.9, 1.06)] },
      { twin: true, stations: [tip(-3.3, .95, .85), [-2.5, .26, .18, .14, .98, 2.2, .82], [-1.4, .38, .26, .22, 1.04, 2.3, .72], [-.4, .3, .2, .2, 1.06, 2.2, .6], tip(.3, 1.06, .5)] },
    ],
    fins: [{ x: .6, y: 1.36, z: 2, height: .55, chord: .6, sweep: .35, lean: .2, twin: true }],
  }),
  body('r8-halo', '10 Halo', 'A lifting body under a bright roll hoop, with short twin fins.', 0x9c0a14, 0x49e6ff, {
    fender: 'deep', bubble: { z: -.5, a: .55, b: .9, h: .55 },
    lofts: [{ stripe: 14, stations: [[-2.85, .08, .05, .05, .96, 2.2], [-2.2, .55, .2, .16, 1, 2.4], [-1, .95, .4, .28, 1.06, 2.6], [.3, 1.1, .48, .34, 1.1, 2.6], [1.6, .95, .4, .3, 1.1, 2.6], [2.5, .55, .22, .2, 1.08, 2.4], [2.9, .08, .05, .05, 1.07, 2.2]] }],
    hoop: { z: .5, y: 1.25, width: 1.02, height: .98, radius: .06 },
    fins: [{ x: .62, y: 1.32, z: 2.1, height: .5, chord: .6, sweep: .3, lean: .12, twin: true }],
    noseLamps: [[.45, 1, -2, .15]],
  }),
]
