/**
 * Round nine: five variations on the two round eight bodies the owner picked out, the purple
 * Fork (twin prows) and the white Catamaran (twin hulls).
 *
 * His notes on round eight: integrate the body into sweeping curves and stop plastering blobs
 * onto each other; sweep the body up into the cockpit; make the fender flares look much more
 * powerful; make the headlights part of the body; no fins; these are massive industrial
 * vehicles. So each body here is one continuous surface (blendKit.ts). The prows and hulls run
 * out to the tread pivots and carry them, a valley runs between them, the skin rises to the
 * cockpit rim, the lamps are cut into the skin, and each tread wears a thick haunch.
 *
 * `previewTankBody` in ../Tank.ts finds these by id.
 */
import { bell, blendHull, sm, type BlendSpec } from './blendKit'
import type { TankBody } from './round8'

const body = (id: string, name: string, tagline: string, color: number, accent: number, spec: BlendSpec): TankBody =>
  ({ id, name, tagline, color, accent, hull: () => blendHull(spec) })
/** 1 behind `start`, rounding to 0 at the nose tip. Higher `q` is blunter. */
const nose = (z: number, tip: number, start: number, q: number) => z >= start ? 1 : Math.max(0, 1 - ((start - z) / (start - tip)) ** q) ** (1 / q)
/** 1 ahead of `start`, rounding to 0 at the tail tip. */
const tail = (z: number, tip: number, start: number, q: number) => z <= start ? 1 : Math.max(0, 1 - ((z - start) / (tip - start)) ** q) ** (1 / q)
/** The body draws in a little between the axles, where the treads sit closest. */
const waists = (z: number, front: number, rear: number) => front * bell((z + 1.75) / .6) + rear * bell((z - .7) / .6)

/** A gap opening forward: each prow is `width` across, coming to a point at `tip`, and the gap closes between `shut[0]` and `shut[1]`. */
const prows = (W: (z: number) => number, tip: number, full: number, width: number, shut: [number, number]) => (z: number) =>
  Math.max(0, W(z) - width * nose(z, tip, full, 2.2)) * (1 - sm(z, shut[0], shut[1]))
/** The same opening aft, between two tails. */
const tails = (W: (z: number) => number, tip: number, full: number, width: number, open: [number, number]) => (z: number) =>
  Math.max(0, W(z) - width * tail(z, tip, full, 2.2)) * sm(z, open[0], open[1])

const fork = (z: number) => (1.3 - .1 * (1 - sm(z, -3.4, -2.5))) * tail(z, 3, 2, 2.6) - waists(z, .08, .06)
const ram = (z: number) => 1.3 * tail(z, 2.95, 2.5, 3) - waists(z, .06, .05)
const cat = (z: number) => 1.28 - waists(z, .08, .08) - .08 * (1 - sm(z, -3.35, -2.5)) - .08 * sm(z, 2.4, 3.2)
const barge = (z: number) => 1.3 - waists(z, 0, .06) - .06 * sm(z, 2.4, 3.25)
const swallow = (z: number) => 1.3 * nose(z, -3.3, -2.6, 3) - waists(z, .08, .06) - .06 * sm(z, 2.4, 3.3)
const catFront = prows(cat, -3.35, -2.3, .62, [-2.2, -1.2]), catRear = tails(cat, 3.2, 2.2, .6, [1, 2])
const bargeFront = prows(barge, -3.3, -2.9, .8, [-3, -2.2]), bargeRear = tails(barge, 3.25, 2.2, .6, [.3, 1.6])

export const round9: TankBody[] = [
  body('r9-fork', '01 Fork', 'Twin prows sweep forward to carry the front treads, a valley between them rising into the cockpit.', 0x3b1a8f, 0xff7af2, {
    z0: -3.4, z1: 3, fender: 'swept',
    W: fork, G: prows(fork, -3.4, -2.3, .66, [-2.3, -1]),
    C: z => 1.24 - .1 * (1 - sm(z, -3.4, -2.4)),
    T: (_x, z) => .4 + .08 * bell((z - .3) / 1.6), B: () => .52,
    bubble: { z: -.25, a: .56, b: .92, h: .42, swell: .24 },
    lamps: [{ kind: 'head', x: .92, z: -2.85, long: .36, wide: .13 }, { kind: 'tail', x: .8, z: 2.5, long: .08, wide: .3 }],
    panels: [{ outline: [[.2, .95], [.2, 2.4], [-.2, 2.4], [-.2, .95]] }],
  }),
  body('r9-ram', '02 Ram', 'Short blunt horns and a squared stern: the Fork as a bulldozer.', 0x4b1fa8, 0xffb14a, {
    z0: -3.3, z1: 2.95, fender: 'deep', rim: 3.2,
    W: ram, G: prows(ram, -3.3, -2.95, .72, [-2.9, -2]),
    C: () => 1.25,
    T: (_x, z) => .42 + .08 * sm(z, .5, 2.2), B: () => .55,
    bubble: { z: -.6, a: .6, b: .9, h: .44, swell: .22 },
    lamps: [{ kind: 'head', x: .94, z: -3, long: .11, wide: .27 }, { kind: 'tail', x: .85, z: 2.72, long: .08, wide: .3 }],
    panels: [{ outline: [[1.05, .3], [1.05, 1.5], [.8, 1.5], [.8, .3]], mirror: true }],
  }),
  body('r9-catamaran', '03 Catamaran', 'Two long rails, open between them at both ends, joined by the cockpit.', 0xdfe3e7, 0xff5a12, {
    z0: -3.35, z1: 3.2, fender: 'folded',
    W: cat, G: z => catFront(z) + catRear(z),
    C: z => 1.24 - .08 * (1 - sm(z, -3.35, -2.3)),
    T: (_x, z) => .38 + .1 * bell(z / 1.3), B: () => .5,
    bubble: { z: -.1, a: .54, b: .88, h: .42, swell: .26 },
    lamps: [{ kind: 'head', x: .95, z: -2.85, long: .34, wide: .12 }, { kind: 'tail', x: .95, z: 2.75, long: .3, wide: .1 }],
  }),
  body('r9-barge', '04 Barge', 'Cab forward over a broad cleft bow, the hull splitting into two long tails.', 0xe6e8ea, 0x35d6c8, {
    z0: -3.3, z1: 3.25, fender: 'round', rim: 3,
    W: barge, G: z => bargeFront(z) + bargeRear(z),
    C: () => 1.24,
    T: () => .42, B: () => .54,
    bubble: { z: -1, a: .6, b: .85, h: .44, swell: .24 },
    lamps: [{ kind: 'head', x: .9, z: -3, long: .11, wide: .27 }, { kind: 'tail', x: .96, z: 2.8, long: .3, wide: .09 }],
    panels: [{ outline: [[.2, .1], [.2, .9], [-.2, .9], [-.2, .1]] }],
  }),
  body('r9-swallow', '05 Swallow', 'The original\'s layout made massive: a full shovel nose and a deep swallowtail.', 0x5a2fc0, 0x7dfcff, {
    z0: -3.3, z1: 3.3, fender: 'short',
    W: swallow, G: tails(swallow, 3.3, 2.2, .64, [.8, 2]),
    C: z => 1.24 - .1 * (1 - sm(z, -3.3, -2.3)),
    T: (_x, z) => .4 + .08 * bell((z + .9) / 1.2), B: () => .52,
    bubble: { z: -.9, a: .58, b: .9, h: .44, swell: .24 },
    lamps: [{ kind: 'head', x: .62, z: -2.95, long: .11, wide: .32, turn: 18 }, { kind: 'tail', x: .97, z: 2.85, long: .3, wide: .09 }],
    panels: [{ outline: [[.18, -2.9], [.18, -2], [-.18, -2], [-.18, -2.9]] }],
  }),
]
