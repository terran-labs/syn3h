/**
 * Round ten: three variants of round seven's Sherpa, the body the owner came back to after
 * rejecting the lofted and blended rounds. What he likes in it: the cabin glazed with several
 * force field panels, and its fenders. His brief: smooth the body up a bit, keep the same
 * general fender shape, and carry over the approved buggy and jet's styling.
 *
 * So these are the Sherpa's panel hull (expeditionKit.ts) with every corner rounded, round
 * the section and along the length, and the panels between left flat for the windows. The
 * fenders are the Sherpa's own. From the buggy and jet: candy paint with an accent stripe cut
 * into the skin, bright rims round every force field pane, and those two vehicles' colours.
 *
 * Nothing here is approved. `previewTankBody` in ../Tank.ts finds these by id.
 */
import { panelHull, type ExpeditionSpec } from './expeditionKit'
import type { TankBody } from './round8'

const body = (id: string, name: string, tagline: string, color: number, accent: number, spec: ExpeditionSpec): TankBody =>
  ({ id, name, tagline, color, accent, hull: () => panelHull(spec) })

export const round10: TankBody[] = [
  body('r10-sherpa', '01 Sherpa', 'The Sherpa as it was, smoothed: steep panoramic front, narrow waist, rising rear shoulders.', 0xc6d5cc, 0xd94722, {
    cabin: [0, 2], fender: 'swept', stripe: 'centre', radiator: [5], ribs: [4], round: .2,
    sections: [
      [-3.7, 1.15, .94, 1.66, .92, 1.87], [-2.93, 1.41, .76, 1.65, 1.12, 3.35],
      [-1.85, 1.42, .72, 1.63, 1.13, 3.36], [-.95, 1.24, .78, 1.59, .98, 2.95],
      [-.25, 1.15, .88, 1.51, .89, 1.99], [1.25, 1.25, .84, 1.6, 1.01, 2.16],
      [2.7, 1.5, .72, 1.75, 1.22, 2.57], [3.75, 1.34, .85, 1.66, 1.06, 2.23],
    ],
  }),
  body('r10-fastback', '02 Fastback', 'The same front under one long roof that falls away to the tail, with a third pane each side. The buggy\'s colours.', 0x0b2f8f, 0x35d6c8, {
    cabin: [0, 3], fender: 'swept', stripe: 'centre', radiator: [5], round: .24,
    sections: [
      [-3.7, 1.15, .94, 1.66, .92, 1.87], [-2.93, 1.41, .76, 1.65, 1.12, 3.3],
      [-1.75, 1.44, .72, 1.65, 1.14, 3.34], [-.55, 1.4, .74, 1.64, 1.1, 3.1],
      [.75, 1.36, .78, 1.62, 1.06, 2.72], [2.1, 1.42, .78, 1.66, 1.1, 2.38],
      [3.1, 1.42, .8, 1.68, 1.1, 2.2], [3.75, 1.3, .86, 1.64, 1.02, 2.02],
    ],
  }),
  body('r10-longcab', '03 Long cab', 'A long glasshouse of four bays ahead of a low machinery deck. The jet\'s colours.', 0x565c66, 0xff3d5a, {
    cabin: [0, 3], fender: 'swept', stripe: 'shoulders', radiator: [5], ribs: [5], round: .18,
    sections: [
      [-3.7, 1.2, .9, 1.66, .96, 1.9], [-2.9, 1.44, .74, 1.66, 1.14, 3.36],
      [-1.8, 1.45, .72, 1.66, 1.15, 3.38], [-.7, 1.45, .72, 1.66, 1.15, 3.36],
      [.3, 1.4, .76, 1.64, 1.08, 3.05], [.95, 1.3, .84, 1.58, .98, 2.2],
      [2.6, 1.5, .74, 1.74, 1.2, 2.5], [3.75, 1.34, .85, 1.66, 1.06, 2.2],
    ],
  }),
]
