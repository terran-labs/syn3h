import type * as THREE from 'three'
import { Mesh } from './kit'

/**
 * Body fittings. So far only the skid plate: one smooth chrome belly under the floor, turned up
 * at the nose and tail like a sled, its edges tucked up into the body. Same design as
 * tools/buggy-bodies/build.py `skid_plate`; there the stations were found by casting rays at
 * the body's underside, here they are the result of that cast, smoothed, as a table.
 *
 * Not yet generated (still in the loaded `Sockets` mesh): the headlight lenses with their
 * chrome bezels and halo rings, and the eight swellings of the body that carry the arm roots
 * and shock tops. Those follow the body's surface, so they belong with a body generator that
 * can answer "where is the surface here, and which way does it face".
 *
 * Frame: the game's (+X right, +Y up, -Z forward).
 */
export const SKID = {
  /** First station (game z), spacing, and per station [half width, keel height]. */
  from: -1.8, step: .24,
  stations: [[.48, .0825], [.628, .0158], [.638, -.025], [.643, -.0465], [.662, -.0584], [.694, -.0614], [.737, -.0586], [.78, -.0568], [.804, -.0572], [.803, -.057], [.769, -.0611], [.707, -.0677], [.649, -.0577], [.624, -.0067], [.504, .0924]],
  /** Belly sag below the keel line, the turn up at the edges, and how far the ends lift. */
  sag: .03, edgeTurn: .05, endLift: .05, under: .012,
}

export function buildSockets(detail: 0 | 1 | 2): { part: 'sockets'; role: string; geometry: THREE.BufferGeometry }[] {
  const s = SKID, m = detail === 0 ? 8 : detail === 1 ? 4 : 2
  const plate = new Mesh()
  plate.begin()
  const last = s.stations.length - 1
  const rows = s.stations.map(([w, keel], i) => Array.from({ length: m + 1 }, (_, k) => {
    const t = -1 + 2 * k / m, end = i === 0 || i === last
    return plate.vert(w * t, keel - s.under - s.sag * (1 - t * t) + (end ? s.endLift : s.edgeTurn * t ** 4), s.from + s.step * i)
  }))
  for (let i = 0; i < last; i++) for (let k = 0; k < m; k++) plate.quad(rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1])
  // The plate is an open sheet: it faces down, away from the body.
  plate.orientAway([0, 1, 0])
  return [{ part: 'sockets', role: 'chrome', geometry: plate.geometry() }]
}

export const SOCKETS_NUMBERS = 2 + SKID.stations.length * 2 + 4
