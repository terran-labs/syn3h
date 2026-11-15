/** Public terrain roads only. Heights distinguish the summit from the coastal ring. */
export interface RoadPoint { x: number; z: number; y?: number }
type Road = readonly RoadPoint[] | { points: readonly RoadPoint[]; closed?: boolean; kind?: string; width?: number }
export interface RoadTerrain { roadPaths?(): readonly Road[]; data?: { roads?: readonly Road[] } }
export function roadPaths(terrain: RoadTerrain): readonly Road[] { return terrain.roadPaths?.() ?? terrain.data?.roads ?? [] }
interface Graph { source: readonly Road[]; points: RoadPoint[]; edges: number[][]; routes: Map<string, number[]> }
const graphs = new WeakMap<RoadTerrain, Graph>()
const distance = (a: RoadPoint, b: RoadPoint) => Math.hypot(a.x - b.x, a.z - b.z, (a.y ?? 0) - (b.y ?? 0))
function graphFor(terrain: RoadTerrain): Graph {
  const source = roadPaths(terrain), cached = graphs.get(terrain)
  if (cached?.source === source) return cached
  const graph: Graph = { source, points: [], edges: [], routes: new Map() }, owners: number[] = []
  const connect = (a: number, b: number) => { graph.edges[a].push(b); graph.edges[b].push(a) }
  source.forEach((road, owner) => {
    const points = 'points' in road ? road.points : road, start = graph.points.length
    for (const p of points) { graph.points.push(p); graph.edges.push([]); owners.push(owner) }
    for (let i = start + 1; i < graph.points.length; i++) connect(i - 1, i)
    if ('closed' in road && road.closed && points.length > 2) connect(start, graph.points.length - 1)
  })
  // Join approach roads, foot ring, spiral and summit ring without joining stacked turns.
  const buckets = new Map<string, number[]>()
  graph.points.forEach((point, i) => {
    const x = Math.floor(point.x / 8), z = Math.floor(point.z / 8)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of buckets.get(`${x + dx}:${z + dz}`) ?? []) {
        if (owners[j] !== owners[i] && Math.abs((point.y ?? 0) - (graph.points[j].y ?? 0)) < 4 && distance(point, graph.points[j]) <= 8) connect(i, j)
      }
    }
    const key = `${x}:${z}`, list = buckets.get(key) ?? []; list.push(i); buckets.set(key, list)
  })
  // Regeneration replaces the public array; the next lookup builds a fresh graph.
  graphs.set(terrain, graph); return graph
}
function route(graph: Graph, start: number, goal: number): number[] {
  const key = `${start}:${goal}`, old = graph.routes.get(key)
  if (old) return old
  const costs = new Float64Array(graph.points.length).fill(Infinity), previous = new Int32Array(graph.points.length).fill(-1)
  const heap: { node: number; cost: number }[] = []
  const push = (node: number, cost: number) => {
    let i = heap.length; heap.push({ node, cost })
    while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].cost <= cost) break; heap[i] = heap[parent]; i = parent }
    heap[i] = { node, cost }
  }
  const pop = () => {
    const top = heap[0], last = heap.pop()!
    if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++; if (heap[child].cost >= last.cost) break; heap[i] = heap[child]; i = child } heap[i] = last }
    return top
  }
  costs[start] = 0; push(start, 0)
  while (heap.length) {
    const { node, cost } = pop(); if (cost > costs[node]) continue
    if (node === goal) break
    for (const next of graph.edges[node]) {
      const value = cost + distance(graph.points[node], graph.points[next])
      if (value < costs[next]) { costs[next] = value; previous[next] = node; push(next, value) }
    }
  }
  const path: number[] = []
  if (Number.isFinite(costs[goal])) for (let i = goal; i !== -1; i = previous[i]) path.push(i)
  path.reverse(); if (graph.routes.size >= 64) graph.routes.clear(); graph.routes.set(key, path); return path
}
/** Route across connected roads; a spiral must never choose a nearby turn at another height. */
export function roadWaypoint(terrain: RoadTerrain, from: RoadPoint, target: RoadPoint, lookAhead: number): RoadPoint | null {
  const graph = graphFor(terrain)
  let start = -1, goal = -1, da = Infinity, db = Infinity
  graph.points.forEach((p, i) => { const a = distance(p, from), b = distance(p, target); if (a < da) { da = a; start = i } if (b < db) { db = b; goal = i } })
  if (start < 0 || da > 70 || db > 70) return null
  const path = route(graph, start, goal)
  if (!path.length) return null
  let travelled = da, index = 0
  while (index + 1 < path.length && travelled < lookAhead) {
    travelled += distance(graph.points[path[index]], graph.points[path[index + 1]]); index++
  }
  return graph.points[path[index]]
}
