/** The smoothed Sherpa approved on 15 November 2026. */
import { panelHull, type TankHull } from './kit'

export interface TankBody { id: string; name: string; tagline: string; color: number; accent: number; hull(): TankHull }

export const sherpa: TankBody = {
  id: 'r10-sherpa', name: '01 Sherpa',
  tagline: 'The Sherpa as it was, smoothed: steep panoramic front, narrow waist, rising rear shoulders.',
  color: 0xc6d5cc, accent: 0xd94722,
  hull: () => panelHull({
    cabin: [0, 2], fender: 'swept', stripe: 'centre', radiator: [5], ribs: [4], round: .2,
    sections: [
      [-3.7, 1.15, .94, 1.66, .92, 1.87], [-2.93, 1.41, .76, 1.65, 1.12, 3.35],
      [-1.85, 1.42, .72, 1.63, 1.13, 3.36], [-.95, 1.24, .78, 1.59, .98, 2.95],
      [-.25, 1.15, .88, 1.51, .89, 1.99], [1.25, 1.25, .84, 1.6, 1.01, 2.16],
      [2.7, 1.5, .72, 1.75, 1.22, 2.57], [3.75, 1.34, .85, 1.66, 1.06, 2.23],
    ],
  }),
}
