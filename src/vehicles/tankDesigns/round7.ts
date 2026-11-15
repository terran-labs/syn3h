/**
 * Ten independent directions after the owner rejected round six. These are new longitudinal
 * silhouettes on the original six-tread footprint, not edits to the rejected cockpit stack.
 * Every roofline below includes its cabin. The window bays cut that same shell.
 */
import { ExpeditionTank, panelHull, type ExpeditionSpec, type TankHull } from './expeditionKit'
import type { TankDesign } from './designs'

export interface ExpeditionDesign extends TankDesign { spec: ExpeditionSpec; accent: number; hull(): TankHull }
function design(id: string, name: string, tagline: string, color: number, accent: number, spec: ExpeditionSpec): ExpeditionDesign {
  return { id, name, tagline, color, accent, spec, hull: () => panelHull(spec), build: () => new ExpeditionTank(panelHull(spec), color, accent).object }
}

export const round7: ExpeditionDesign[] = [
  design('r7-foundry', '01 Foundry', 'Soviet heavy tractor: a blunt cab, deep cast shoulders and a sunken machinery deck.', 0xb9502b, 0xe7cf91, {
    cabin: [0, 2], fender: 'deep', stripe: 'belt', radiator: [4, 5], ribs: [4, 6],
    sections: [
      [-3.8, 1.4, .69, 1.65, 1.16, 1.82], [-3.02, 1.5, .62, 1.73, 1.24, 3.13],
      [-1.8, 1.52, .62, 1.72, 1.27, 3.13], [-.85, 1.46, .62, 1.65, 1.16, 2.96],
      [-.38, 1.38, .66, 1.55, 1.08, 1.97], [1.1, 1.45, .65, 1.63, 1.2, 1.97],
      [2.6, 1.55, .63, 1.72, 1.25, 2.23], [3.8, 1.42, .7, 1.64, 1.14, 2.12],
    ],
  }),
  design('r7-whiteout', '02 Whiteout', 'Polar mobile station: one long insulated body, a broad forward windscreen and pressure ports.', 0xd6d9cc, 0xe85d25, {
    cabin: [0, 4], fender: 'round', stripe: 'belt', ribs: [2, 4, 6], portholes: true, radiator: [5], trackWidth: 1.02,
    sections: [
      [-3.85, 1.28, .78, 1.63, 1.08, 1.94], [-3.05, 1.47, .7, 1.85, 1.19, 3.22],
      [-1.8, 1.49, .68, 1.88, 1.23, 3.27], [-.5, 1.49, .68, 1.9, 1.23, 3.23],
      [.8, 1.49, .68, 1.87, 1.23, 3.16], [2.05, 1.45, .71, 1.84, 1.18, 3.04],
      [3.2, 1.37, .75, 1.76, 1.08, 2.8], [3.85, 1.2, .83, 1.66, .94, 2.43],
    ],
  }),
  design('r7-selene', '03 Selene', 'Lunar pressure rover: a tall rounded observation nose flowing into a low radiator tail.', 0xe4dfcf, 0x3d8589, {
    cabin: [1, 3], fender: 'short', stripe: 'shoulders', radiator: [6, 7], ribs: [5], pressureShell: true,
    sections: [
      [-3.8, .98, .85, 1.48, .71, 1.73], [-3.45, 1.28, .71, 1.62, .96, 2.03],
      [-2.72, 1.5, .65, 1.7, 1.12, 3.15], [-1.9, 1.57, .65, 1.72, 1.17, 3.48],
      [-.9, 1.51, .68, 1.73, 1.1, 3.22], [-.22, 1.36, .74, 1.69, .98, 2.5],
      [.45, 1.25, .78, 1.55, 1.03, 1.94], [2.15, 1.37, .75, 1.54, 1.12, 1.88],
      [3.8, 1.23, .83, 1.46, .99, 1.76],
    ],
  }),
  design('r7-caspian', '04 Caspian', 'Ekranoplan survey machine: a ship-like keel, heavy chines and a long descending flight deck.', 0x688b95, 0xe8dbc0, {
    cabin: [1, 3], fender: 'swept', stripe: 'shoulders', radiator: [5, 6], ribs: [5],
    sections: [
      [-3.98, .98, .82, 1.46, .75, 1.68], [-3.5, 1.46, .56, 1.69, 1.08, 1.93],
      [-2.45, 1.6, .44, 1.76, 1.05, 3.12], [-1.38, 1.57, .46, 1.74, 1.09, 3.16],
      [-.3, 1.48, .51, 1.7, 1.06, 2.83], [.65, 1.38, .57, 1.64, 1.01, 2.38],
      [2.35, 1.48, .6, 1.68, 1.12, 2.14], [3.92, 1.32, .73, 1.55, .99, 1.91],
    ],
  }),
  design('r7-ballast', '05 Ballast', 'Quarry crawler: a low broad wedge, massive sill girders and a recessed rear work bed.', 0xc5a448, 0x424d55, {
    cabin: [0, 2], fender: 'folded', stripe: 'belt', radiator: [4, 5], ribs: [3, 5], trackWidth: 1.02,
    sections: [
      [-3.85, 1.58, .52, 1.68, 1.39, 1.9], [-2.88, 1.63, .48, 1.8, 1.4, 2.78],
      [-1.64, 1.63, .48, 1.8, 1.42, 2.83], [-.72, 1.6, .5, 1.78, 1.35, 2.62],
      [-.15, 1.5, .56, 1.6, 1.26, 1.83], [1.65, 1.48, .58, 1.5, 1.2, 1.74],
      [2.85, 1.61, .52, 1.77, 1.35, 2.08], [3.8, 1.57, .59, 1.72, 1.3, 1.99],
    ],
  }),
  design('r7-sherpa', '06 Sherpa', 'Alpine rescue crawler: a steep panoramic front, narrow waist and rising rear equipment shoulders.', 0xc6d5cc, 0xd94722, {
    cabin: [0, 2], fender: 'swept', stripe: 'centre', radiator: [5], ribs: [4],
    sections: [
      [-3.7, 1.15, .94, 1.66, .92, 1.87], [-2.93, 1.41, .76, 1.65, 1.12, 3.35],
      [-1.85, 1.42, .72, 1.63, 1.13, 3.36], [-.95, 1.24, .78, 1.59, .98, 2.95],
      [-.25, 1.15, .88, 1.51, .89, 1.99], [1.25, 1.25, .84, 1.6, 1.01, 2.16],
      [2.7, 1.5, .72, 1.75, 1.22, 2.57], [3.75, 1.34, .85, 1.66, 1.06, 2.23],
    ],
  }),
  design('r7-kiln', '07 Kiln', 'Geothermal expedition: a compact forward refuge inside a deep heat-shield hull and ribbed cooling back.', 0x4b5557, 0xdd7841, {
    cabin: [1, 2], fender: 'deep', stripe: 'shoulders', radiator: [4, 5, 6], ribs: [4, 5, 6],
    sections: [
      [-3.9, 1.5, .58, 1.64, 1.27, 1.94], [-3.32, 1.53, .52, 1.78, 1.2, 2.1],
      [-2.57, 1.51, .51, 1.93, .98, 3.17], [-1.28, 1.48, .52, 1.9, 1.02, 3.17],
      [-.48, 1.52, .54, 1.82, 1.21, 2.55], [.75, 1.57, .53, 1.82, 1.28, 2.58],
      [1.95, 1.57, .55, 1.8, 1.28, 2.56], [3.12, 1.49, .61, 1.72, 1.2, 2.31],
      [3.85, 1.33, .72, 1.57, 1.09, 1.98],
    ],
  }),
  design('r7-bathys', '08 Bathys', 'Subglacial pressure vehicle: a barrel-like body, circular viewing ports and a tapered stern.', 0xb9cdb4, 0x2e7d85, {
    cabin: [1, 4], fender: 'round', stripe: 'belt', portholes: true, ribs: [2, 4, 6], radiator: [6], pressureShell: true,
    sections: [
      [-3.85, .94, .93, 1.58, .68, 1.89], [-3.4, 1.26, .69, 1.86, .9, 2.25],
      [-2.65, 1.52, .58, 2.01, 1.08, 3.16], [-1.5, 1.58, .55, 2.03, 1.13, 3.3],
      [-.15, 1.58, .55, 2.03, 1.13, 3.3], [1.2, 1.52, .61, 1.95, 1.09, 3.09],
      [2.45, 1.38, .74, 1.79, .99, 2.65], [3.25, 1.12, .89, 1.58, .78, 2.18],
      [3.85, .86, 1.03, 1.49, .65, 1.8],
    ],
  }),
  design('r7-salt', '09 Salt Runner', 'Desert basin explorer: a broad shallow prow, a low rear deck and a forward observation wedge.', 0xd3bb91, 0x6b5350, {
    cabin: [1, 3], fender: 'short', stripe: 'centre', radiator: [5, 6], ribs: [5], trackWidth: 1.04,
    sections: [
      [-3.98, 1.46, .73, 1.36, 1.21, 1.58], [-3.4, 1.6, .62, 1.43, 1.27, 1.78],
      [-2.45, 1.56, .6, 1.51, 1.11, 2.9], [-1.48, 1.5, .63, 1.5, 1.09, 3.02],
      [-.45, 1.38, .7, 1.43, .98, 2.63], [.4, 1.32, .75, 1.37, 1.03, 1.72],
      [2.1, 1.55, .64, 1.45, 1.31, 1.76], [3.94, 1.48, .75, 1.35, 1.19, 1.59],
    ],
  }),
  design('r7-ark', '10 Ark', 'Remote expedition carrier: a tall forward command room and a stepped, ribbed habitation back.', 0x526b54, 0xe2c46e, {
    cabin: [0, 2], fender: 'folded', stripe: 'shoulders', ribs: [3, 4, 5, 6], radiator: [6],
    sections: [
      [-3.85, 1.32, .7, 1.7, 1.08, 2.02], [-3.08, 1.49, .62, 1.87, 1.19, 3.41],
      [-1.9, 1.49, .62, 1.87, 1.19, 3.41], [-.9, 1.47, .64, 1.83, 1.18, 3.13],
      [.1, 1.46, .65, 1.8, 1.18, 2.82], [1.15, 1.46, .65, 1.8, 1.18, 2.82],
      [2.25, 1.46, .65, 1.8, 1.18, 2.82], [3.1, 1.4, .69, 1.73, 1.13, 2.69],
      [3.85, 1.28, .79, 1.64, 1.02, 2.31],
    ],
  }),
]
