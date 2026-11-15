/**
 * Wrapping world helpers.
 *
 * The world is a square tile, `size` metres on a side and centred on the origin, that
 * repeats exactly: leaving by one edge arrives at the opposite one. Positions are kept in
 * the canonical range [-size / 2, size / 2). Anything that compares two positions (a chase
 * camera, a bot seeking a target, a minimap, a remote vehicle) must compare the nearest
 * images, or things on the far side of the seam appear a whole world away.
 *
 * No imports, so the client, the server and tests all share one definition.
 */

/** A coordinate brought into [-size / 2, size / 2). */
export function wrapCoord(v: number, size: number): number {
  return v - size * Math.floor(v / size + 0.5)
}

/** The image of coordinate `v` nearest to `ref`: within half a world of it. */
export function nearestImage(v: number, ref: number, size: number): number {
  return v - size * Math.floor((v - ref) / size + 0.5)
}

/** Shortest signed distance from `from` to `to` along one axis of the wrapping world. */
export function wrapDelta(from: number, to: number, size: number): number {
  return wrapCoord(to - from, size)
}

/** Shortest distance between two points on the wrapping world. */
export function wrapDistance(ax: number, az: number, bx: number, bz: number, size: number): number {
  const dx = wrapDelta(ax, bx, size)
  const dz = wrapDelta(az, bz, size)
  return Math.sqrt(dx * dx + dz * dz)
}
