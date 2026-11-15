import * as T from 'three/webgpu'
import { Builder } from '../jetgen/shapes'

/**
 * Generator parts shared by the game's hovercraft body (lowwing.ts) and by the design studies
 * in src/vehicles/hovergen. This folder is what the game loads; the studies are not
 * (tests/vehicles2/game-graph.test.ts), so nothing here may import from hovergen.
 */

/** The driver's eye in the craft's frame. */
export const HOVER_EYE: [number, number, number] = [0, .69, -.63]

/** Hull: width multipliers at the shoulders, waist and rear quarters; nose half width, extra nose length, deck height multiplier, added squareness, stern half width. */
export interface HullShape { shoulder: number; waist: number; rear: number; nose: number; reach: number; deck: number; box: number; tail: number }

/** Hull stations [z, halfWidth, top, bottom, centreY, exponent], the original's at buggy scale. */
export function hoverHull(d: HullShape): number[][] {
  const e = d.box, k = d.deck
  return [
    [-1.63 - d.reach, .035, .035, .025, .08, 2.4],
    [-1.48 - d.reach * .5, d.nose, .105 * k, .08, .15, 2.8 + e],
    [-1.06, 1.18 * d.shoulder, .20 * k, .14, .21, 3.1 + e],
    [-.68, 1.17 * d.shoulder, .22 * k, .15, .22, 3.0 + e],
    [-.16, .88 * d.waist, .22 * k, .13, .24, 2.8 + e],
    [.22, .95 * d.waist, .23 * k, .15, .23, 3.0 + e],
    [.60, 1.18 * d.rear, .24 * k, .16, .23, 3.1 + e],
    [1.04, 1.17 * d.rear, .23 * k, .16, .23, 3.0 + e],
    [1.40, d.tail, .23 * k, .13, .24, 2.7 + e],
    [1.50, d.tail * .24, .13, .08, .24, 2.3],
  ].map(([z, w, t, b, y, x]) => [z * 1.25, w * 1.10, t * 1.25, b * 1.25, y * 1.25, x])
}

/** A point that must lie inside the hull for the fitting named to count as attached. */
export interface Anchor { what: string; at: [number, number, number] }
export interface HoverBuild {
  builder: Builder
  head: T.BufferGeometry[]; tail: T.BufferGeometry[]
  /** Lamp centres, for the lab's headlight beams. */
  beams: [number, number, number][]
  anchors: Anchor[]
  /** True when the point is inside the hull's skin. */
  inside(x: number, y: number, z: number): boolean
}

/**
 * Close a thruster's throat. The shape kit lines a nozzle with a dark inner wall and ends it
 * in a glow, and the glow is see-through, so from astern the eye went past it to the inside
 * of the hull (the owner, 15 Nov 2026: "I shouldn't be able to see inside the thruster").
 * This adds a solid dark disc just ahead of the glow's rear face, never in its plane.
 * `kind` says which kit part made the nozzle: nozzle(), or a duct (a body ending in an
 * exhaust), where the disc sits 10 cm inside the lip and the caller adds a glow on it.
 */
export function plugNozzle(b: Builder, z: number, y: number, halfWidth: number, halfHeight: number, x = 0, exponent = 2.2, kind: 'nozzle' | 'duct' = 'nozzle'): void {
  const k = (dz: number, f: number) => [z + dz, halfWidth * f, halfHeight * f, halfHeight * f, y, exponent]
  b.body('dark', kind === 'nozzle' ? [k(-.11, .64), k(.05, .64)] : [k(-.16, .8), k(-.1, .8)], { x, mirror: x !== 0, seg: 1, around: 28 })
}

/** Anchors that are not inside the hull: fittings that would hang in the air. Empty when all is attached. */
export function floating(build: HoverBuild): Anchor[] {
  return build.anchors.filter(a => !build.inside(...a.at))
}

