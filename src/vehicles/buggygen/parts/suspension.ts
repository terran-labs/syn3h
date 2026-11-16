import type * as THREE from 'three'
import { Mesh, lensLoft, tube, helix, toOwn, type Station, type V3 } from './kit'

/**
 * The Box arm suspension: a heavy tapered box section arm with an accent rib and a chrome hub
 * boss, plus a separate coilover shock. Same design as tools/buggy-bodies/build.py `co-box`,
 * which built the shipped model, now generated at run time.
 *
 * Working frame (as build.py): Z is the span, hub at 0, toward the body mount; Y is up (the
 * arm's thickness); X is the chord, fore and aft. `toOwn` turns it into the glb frame that
 * LoadedBuggySkin.strutMatrix expects: span along +Y, thickness along -Z.
 */
export const STRUT = {
  /** Span of the arm from hub to body mount (the original Axle mesh's length). */
  span: .83,
  /** Arm sections: [span, chord, thickness] from the hub out; the root at `span`. */
  arm: [[.02, .24, .13], [.3, .3, .12], [.6, .46, .12]] as [number, number, number][],
  rootChord: .6, rootThick: .14,
  /** The arm hangs this far below the span line. */
  drop: .02,
  /** Raised rib along the top: start and end of span, chord at each, height. */
  rib: { from: .12, to: .7, chord0: .05, chord1: .07, thick: .15, drop: .01 },
  /** Chrome boss round the hub: span from and to, chord, thickness. */
  boss: { from: -.04, to: .06, chord: .3, thick: .17 },
  /** Shock foot: the cross pin the shock hangs from, in the working frame. */
  foot: [0, .07, .2] as V3, pinHalf: .11, pinRadius: .04,
}

/** Shock: a damper rod, a collar near the foot and a coil spring, foot at 0, one unit long. */
export const SHOCK = { rod: .026, collar: { r: .088, from: .05, to: .11 }, spring: { turns: 4.5, R: .066, wire: .019, from: .12, to: .97 } }

/** The shock's top anchor in each wheel's corner (game frame), as shipped. */
export interface Piece { part: 'strut' | 'shock'; role: string; geometry: THREE.BufferGeometry }

export function buildStrut(detail: 0 | 1 | 2): Piece[] {
  const s = STRUT, n = detail === 0 ? 8 : detail === 1 ? 6 : 4
  const metal = new Mesh(), chrome = new Mesh(), accent = new Mesh()
  const stations: Station[] = [...s.arm, [s.span, s.rootChord, s.rootThick]].map(([z, c, t]) => [z, c, t, 0, -s.drop])
  lensLoft(metal, detail === 2 ? [stations[0], stations[stations.length - 1]] : stations, n)
  if (detail < 2) lensLoft(accent, [[s.rib.from, s.rib.chord0, s.rib.thick, 0, -s.rib.drop], [s.rib.to, s.rib.chord1, s.rib.thick, 0, -s.rib.drop]], 6)
  lensLoft(chrome, [[s.boss.from, s.boss.chord, s.boss.thick, 0, 0], [s.boss.to, s.boss.chord, s.boss.thick, 0, 0]], n)
  if (detail < 2) tube(chrome, [-s.pinHalf, s.foot[1], s.foot[2]], [s.pinHalf, s.foot[1], s.foot[2]], s.pinRadius, s.pinRadius, n)
  const out: Piece[] = [{ part: 'strut', role: 'frame', geometry: metal.geometry(toOwn) }, { part: 'strut', role: 'chrome', geometry: chrome.geometry(toOwn) }]
  if (accent.triangles) out.push({ part: 'strut', role: 'accent', geometry: accent.geometry(toOwn) })
  return out
}

export function buildShock(detail: 0 | 1 | 2): Piece[] {
  const k = SHOCK, sp = k.spring
  const chrome = new Mesh(), spring = new Mesh()
  tube(chrome, [0, 0, 0], [0, 0, 1], k.rod, k.rod, detail === 0 ? 8 : 6)
  tube(chrome, [0, 0, k.collar.from], [0, 0, k.collar.to], k.collar.r, k.collar.r, detail === 0 ? 10 : 6)
  // Far away the coil reads as a sleeve: one tube at the spring's mean radius.
  if (detail === 2) tube(spring, [0, 0, sp.from], [0, 0, sp.to], sp.R, sp.R, 6)
  else helix(spring, sp.turns, detail === 0 ? 8 : 6, sp.R, sp.wire, sp.from, sp.to)
  return [{ part: 'shock', role: 'chrome', geometry: chrome.geometry(toOwn) }, { part: 'shock', role: 'accent', geometry: spring.geometry(toOwn) }]
}

/** Scalar parameters held above. */
export const SUSPENSION_NUMBERS = 1 + 9 + 2 + 1 + 6 + 4 + 3 + 2 + 1 + 3 + 6
