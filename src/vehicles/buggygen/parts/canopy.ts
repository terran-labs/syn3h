import type * as THREE from 'three/webgpu'
import { Mesh } from './kit'

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
  [-.72, .349, .667, .763, 1.7, .83],
  [-.52, .463, .675, .889, 2.4, .98],
  [-.32, .515, .69, .97, 2.8, 1.08],
  [-.02, .487, .749, 1.043, 3.1, .95],
  [.28, .441, .805, 1.035, 2.25, .75],
  [.58, .39, .805, .983, 1.65, .78],
  [.78, .271, .833, .93, 1.25, .75],
  [.9, 0, .872, .878, 1.25, .75],
]

function cr(keys: number[][], u: number): number[] {
  const K = keys.length - 1, x = Math.min(Math.max(u, 0), 1) * K, i = Math.min(Math.floor(x), K - 1), f = x - i
  const a = keys[Math.max(i - 1, 0)], b = keys[i], c = keys[i + 1], d = keys[Math.min(i + 2, K)]
  return b.map((_, k) => .5 * (2 * b[k] + (-a[k] + c[k]) * f + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f * f + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * f * f * f))
}

export function buildCanopy(detail: 0 | 1 | 2): { part: 'canopy'; role: string; geometry: THREE.BufferGeometry }[] {
  const dome = detail === 0 ? 14 : detail === 1 ? 8 : 6, rings = detail === 0 ? 12 : detail === 1 ? 8 : 5
  const m = new Mesh()
  const ringAt = (u: number) => {
    const [z, w, base, top, p, q] = cr(CANOPY_STATIONS, u)
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
  const nose = m.vert(0, (first[2] + first[3]) / 2, first[0]), tail = m.vert(0, (last[2] + last[3]) / 2, last[0])
  const n = list[0].length
  for (let k = 0; k + 1 < n; k++) m.tri(nose, list[0][k + 1], list[0][k])
  for (let j = 0; j + 1 < list.length; j++) m.skin(list[j], list[j + 1], false)
  for (let k = 0; k + 1 < n; k++) m.tri(tail, list[list.length - 1][k], list[list.length - 1][k + 1])
  m.orientAway([0, .7, 0])
  return [{ part: 'canopy', role: 'canopy', geometry: m.geometry() }]
}

export const CANOPY_NUMBERS = CANOPY_STATIONS.length * 6
