import type * as THREE from 'three/webgpu'
import { Mesh } from './kit'
import type { Surface } from './surface'

/**
 * The cockpit canopy: a teardrop blister standing on the deck, widest a little ahead of the
 * driver, its base following the deck as it rises toward the tail. One mesh with outward
 * normals, tagged `canopy`, so the shared force field draws it. Like the shipped canopy it is
 * open along its foot, where it stands on the deck: a floor would lie across the cockpit tub's
 * opening, right under the driver's view.
 *
 * The shape is a loft of dome sections through stations along the body, Catmull-Rom between
 * them; the reference was the owner's sculpted cockpit, so the stations are measured from it.
 * Frame: the game's (+X right, +Y up, -Z forward).
 */
/**
 * Stations [z, half width, base height, crown height, p, q]; the first and last are the tips.
 * Each section is y = base + (crown - base) (1 - |x / half width|^p)^q: p near 3 gives the
 * flat crown and straight sloping sides of the middle, lower p and q the rounder ends.
 * Fitted per station by tools/buggy-fit/parts/fit-canopy.ts.
 */
export const CANOPY_STATIONS: number[][] = [
  [-.832, 0, .666, .672, 1.7, .83],
  [-.8, .201, .666, .696, 1.2, .88],
  [-.76, .289, .666, .731, 1.2, .58],
  [-.72, .349, .667, .763, 1.7, .83],
  [-.64, .415, .668, .82, 2.15, .93],
  [-.52, .463, .675, .889, 2.4, .98],
  [-.32, .515, .69, .97, 2.8, 1.08],
  [-.02, .487, .749, 1.043, 3.1, .95],
  [.08, .473, .771, 1.052, 2.75, .85],
  [.28, .441, .805, 1.035, 2.25, .75],
  [.58, .39, .805, .983, 1.65, .78],
  [.7, .344, .813, .956, 1.6, .9],
  [.78, .271, .833, .93, 1.25, .75],
  [.82, .214, .849, .913, 1.2, .73],
  [.86, .143, .864, .896, 1.25, .75],
  [.88, .071, .872, .887, 1.25, .75],
  [.9, 0, .872, .878, 1.25, .75],
]

function cr(keys: number[][], u: number): number[] {
  const K = keys.length - 1, x = Math.min(Math.max(u, 0), 1) * K, i = Math.min(Math.floor(x), K - 1), f = x - i
  const a = keys[Math.max(i - 1, 0)], b = keys[i], c = keys[i + 1], d = keys[Math.min(i + 2, K)]
  return b.map((_, k) => .5 * (2 * b[k] + (-a[k] + c[k]) * f + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f * f + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * f * f * f))
}

/**
 * How far back the canopy's tail reaches, and where the stretch begins. The stations end at
 * z 0.9, as the shipped canopy does; the cage body's cockpit rim runs on to about z 1.0 behind
 * the cockpit, in a V that showed through the force field, so the tail is stretched back over it.
 */
export const CANOPY_TAIL = { from: .7, reach: .98 }

/** With a body, the canopy's foot is sunk this far under its deck wherever it would stand proud. */
export const CANOPY_SINK = .008

/**
 * `body`, if given, is the body's surface: wherever the stored foot would stand above the deck
 * (and show a dark gap under the force field) the foot is lowered to just under it. The crown
 * stays where it is; the foot is never raised.
 */
const tailZ = (z: number) => {
  const t = CANOPY_TAIL, end = CANOPY_STATIONS[CANOPY_STATIONS.length - 1][0]
  return z <= t.from ? z : t.from + (z - t.from) * (t.reach - t.from) / (end - t.from)
}

export function buildCanopy(detail: 0 | 1 | 2, body?: Surface): { part: 'canopy'; role: string; geometry: THREE.BufferGeometry }[] {
  const dome = detail === 0 ? 14 : detail === 1 ? 8 : 6, rings = detail === 0 ? 15 : detail === 1 ? 9 : 5
  const m = new Mesh()
  const seat = (x: number, z: number, base: number) => {
    const deck = body?.ray([x, base + .4, z], [0, -1, 0], .6)?.point[1]
    return deck === undefined ? base : Math.min(base, deck - CANOPY_SINK)
  }
  const ringAt = (u: number) => {
    const [z0, w, stored, top, p, q] = cr(CANOPY_STATIONS, u), z = tailZ(z0)
    // The deck under both feet (the body is symmetric, but an edited one need not be).
    const base = Math.min(seat(w * .97, z, stored), seat(-w * .97, z, stored))
    const pts: number[] = []
    // Dome from the right foot over the crown to the left foot.
    for (let k = 0; k <= dome; k++) {
      const c = Math.cos(Math.PI * k / dome)
      pts.push(m.vert(w * c, base + (top - base) * Math.max(0, 1 - Math.abs(c) ** p) ** q, z))
    }
    return pts
  }
  const first = cr(CANOPY_STATIONS, 0), last = cr(CANOPY_STATIONS, 1)
  // Rings between the tips, spaced more closely toward the ends where the plan turns fastest.
  const list = Array.from({ length: rings }, (_, k) => ringAt((1 - Math.cos(Math.PI * (k + 1) / (rings + 1))) / 2))
  m.begin()
  const nose = m.vert(0, seat(0, first[0], first[2]), first[0]), tail = m.vert(0, seat(0, tailZ(last[0]), last[2]), tailZ(last[0]))
  const n = list[0].length
  for (let k = 0; k + 1 < n; k++) m.tri(nose, list[0][k + 1], list[0][k])
  for (let j = 0; j + 1 < list.length; j++) m.skin(list[j], list[j + 1], false)
  for (let k = 0; k + 1 < n; k++) m.tri(tail, list[list.length - 1][k], list[list.length - 1][k + 1])
  m.orientAway([0, .7, 0])
  return [{ part: 'canopy', role: 'canopy', geometry: m.geometry() }]
}

export const CANOPY_NUMBERS = CANOPY_STATIONS.length * 6 + 3
