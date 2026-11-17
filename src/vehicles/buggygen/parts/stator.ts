import type * as THREE from 'three/webgpu'
import { Mesh } from './kit'

/**
 * The hub motor's stator, after the owner's RimSimple: an angular bow tie across the hub. Its
 * span runs along Z, the wheel axle along X. At the hub the section is a flat topped lens,
 * thick in the middle and pinched to a thin edge at the two open faces of the wheel. Out along
 * the span the middle thins and the edges thicken, until at each tip the section is a bow tie:
 * thin in the middle, flaring at the faces into two horns that reach out to the rotor ring.
 * The tip is hollowed between the horns. The last stretch of each tip is chrome; that is where
 * the motor glow and sparks sit (the skin's STATOR_TIP, 0.33).
 *
 * Built from flat panels between straight edges, drawn with face normals, as the original is.
 * Frame: as the skin uses the loaded `RimSimple`, recentred on its bounding box.
 */
/**
 * Stations from the hub out (the other half mirrors). Each gives one quarter of the section as
 * four points, from the hub's middle line out to the open face: centre (x 0), shoulder, horn,
 * edge (x the half width). Columns: span at the centre, at the shoulder, at the horn and at the
 * edge; half thickness at each of the four; then the shoulder's, horn's and edge's x.
 */
export const STATOR_STATIONS: number[][] = [
  // z centre, shoulder, horn, edge | y centre, shoulder, horn, edge | x shoulder, horn, edge
  [0, 0, 0, 0, .096, .096, .05, .011, .1, .17, .2],
  [.078, .078, .078, .078, .091, .091, .045, .011, .1, .17, .2],
  [.17, .175, .19, .19, .062, .062, .09, .03, .1, .178, .208],
  [.236, .245, .27, .275, .039, .039, .113, .04, .1, .186, .222],
  [.246, .256, .333, .347, .036, .036, .13, 0, .1, .194, .236],
]
/** Station from which the stator is chrome. */
export const STATOR_CHROME_FROM = 3

/** One section ring: 14 points round, starting at the open face on +X. */
function section(row: number[]): [number, number, number][] {
  const [zc, zs, zh, ze, yc, ys, yh, ye, xs, xh, xe] = row
  const q: [number, number, number][] = [[xe, ye, ze], [xh, yh, zh], [xs, ys, zs], [0, yc, zc]]
  const top = [...q, ...q.slice(0, 3).reverse().map(([x, y, z]) => [-x, y, z] as [number, number, number])]
  return [...top, ...top.map(([x, y, z]) => [x, -y, z] as [number, number, number]).reverse()]
}

export function buildStator(detail: 0 | 1 | 2): { part: 'stator'; role: string; geometry: THREE.BufferGeometry }[] {
  // Further away the in-between stations go: hub, wing end and tip still make the bow tie.
  const rows = detail === 2 ? [0, 3, 4] : detail === 1 ? [0, 1, 3, 4] : [0, 1, 2, 3, 4]
  // Stations from one tip through the hub to the other, as [row, side].
  const order = [...rows.slice(1).reverse().map(i => [i, -1]), ...rows.map(i => [i, 1])]
  const metal = new Mesh(), chrome = new Mesh()
  const ring = (m: Mesh, [i, side]: number[]) => section(STATOR_STATIONS[i]).map(([x, y, z]) => m.vert(x, y, z * side))
  for (let k = 0; k + 1 < order.length; k++) {
    // Each ring is CCW seen from +Z, so skinning toward +Z faces outward.
    const m = Math.min(order[k][0], order[k + 1][0]) >= STATOR_CHROME_FROM ? chrome : metal
    m.skin(ring(m, order[k]), ring(m, order[k + 1]))
  }
  // Tip faces: the section is a concave bow tie, so fan it from its middle.
  for (const end of [order[0], order[order.length - 1]]) {
    const r = ring(chrome, end), c = chrome.vert(0, 0, STATOR_STATIONS[end[0]][0] * end[1])
    for (let j = 0; j < r.length; j++) if (end[1] > 0) chrome.tri(r[j], r[(j + 1) % r.length], c); else chrome.tri(r[(j + 1) % r.length], r[j], c)
  }
  // Flat panels: unshared corners, so each face keeps its own normal.
  const flat = (m: Mesh) => { const g = m.geometry().toNonIndexed(); g.computeVertexNormals(); return g }
  return [{ part: 'stator', role: 'frame', geometry: flat(metal) }, { part: 'stator', role: 'chrome', geometry: flat(chrome) }]
}

export const STATOR_NUMBERS = STATOR_STATIONS.length * 11 + 1
