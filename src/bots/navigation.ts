/** Optional public terrain seam. Older terrain builds expose the same data under data.roads. */
export interface RoadPoint { x: number; z: number; y?: number }
type Road = readonly RoadPoint[] | { points: readonly RoadPoint[]; closed?: boolean }
export interface RoadTerrain { roadPaths?(): readonly Road[]; data?: { roads?: readonly Road[] } }
export function roadPaths(terrain: RoadTerrain): readonly Road[] {
  return terrain.roadPaths?.() ?? terrain.data?.roads ?? []
}
/** Follow a shared centreline when climbing rather than cutting across a steep flank. */
export function roadWaypoint(terrain: RoadTerrain, from: RoadPoint, target: RoadPoint, lookAhead: number): RoadPoint | null {
  let best: { points: readonly RoadPoint[]; a: number; b: number; closed: boolean } | null = null
  let score = Infinity
  for (const road of roadPaths(terrain)) {
    const points: readonly RoadPoint[] = 'points' in road ? road.points : road
    if (points.length < 2) continue
    let a = 0, b = 0, da = Infinity, db = Infinity
    points.forEach((p, i) => {
      const d1 = Math.hypot(p.x - from.x, p.z - from.z), d2 = Math.hypot(p.x - target.x, p.z - target.z)
      if (d1 < da) { da = d1; a = i }
      if (d2 < db) { db = d2; b = i }
    })
    if (da < 70 && db < 45 && da + db < score) { score = da + db; best = { points, a, b, closed: 'closed' in road && !!road.closed } }
  }
  if (!best) return null
  const { points, a, b, closed } = best
  let step = b >= a ? 1 : -1
  if (closed && Math.abs(b - a) > points.length / 2) step *= -1
  let i = a, travelled = Math.hypot(points[a].x - from.x, points[a].z - from.z)
  while (i !== b && travelled < lookAhead) {
    const next = (i + step + points.length) % points.length
    travelled += Math.hypot(points[next].x - points[i].x, points[next].z - points[i].z); i = next
  }
  return points[i]
}
