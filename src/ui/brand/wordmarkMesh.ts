/**
 * The Syn3h wordmark path turned into geometry the GPU can draw: closed contours sorted into
 * filled shapes and holes by the even-odd rule, a triangulated front face, a thin chamfer
 * around every edge and shallow side walls, plus points spread along the outline by arc
 * length for the glow particles to be born on. Pure functions with no DOM, so the tests run
 * them directly.
 *
 * Units: one unit is the height of the wordmark box (226 path units), x to the right, y up,
 * the origin at the centre of the 962 by 226 box, z toward the viewer. The front face sits
 * at z = 0, so at zero tilt it covers exactly the box the SVG wordmark covers.
 */
// Earcut alone, from three's sources: importing it from 'three' would pull in most of three.
import { Earcut } from 'three/src/extras/Earcut.js'
import { WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from './wordmarkPath'

export type Point = [number, number]
export interface Contour {
  /** Points in wordmark units, without the closing repeat of the first point. */
  points: Point[]
  /** Signed area, positive when the points run anticlockwise (y up). */
  area: number
  /** How many other contours enclose this one. Even depths are filled, odd depths are holes. */
  depth: number
  /** Index of the innermost enclosing contour, or -1. */
  parent: number
}
export const ASPECT = WORDMARK_WIDTH / WORDMARK_HEIGHT

/** Parses absolute M, L, H, V and Z commands (all the traced path uses) into point loops. */
export function parsePath(d: string): Point[][] {
  const loops: Point[][] = []
  let current: Point[] = [], x = 0, y = 0
  const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  let command = 'M'
  const close = () => { if (current.length > 2) loops.push(current); current = [] }
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]
    if (/[A-Za-z]/.test(token)) { command = token.toUpperCase(); i++; if (command === 'Z') { close(); continue } if (command === 'M') close() }
    if (command === 'M' || command === 'L') { x = Number(tokens[i]); y = Number(tokens[i + 1]); i += 2; current.push([x, y]); if (command === 'M') command = 'L' }
    else if (command === 'H') { x = Number(tokens[i++]); current.push([x, y]) }
    else if (command === 'V') { y = Number(tokens[i++]); current.push([x, y]) }
    else i++
  }
  close()
  return loops
}

export function signedArea(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; sum += p[0] * q[1] - q[0] * p[1] }
  return sum / 2
}

export function insidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j]
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Path loops in wordmark units, sorted into the even-odd nesting tree. */
export function wordmarkContours(d = WORDMARK_PATH): Contour[] {
  const loops = parsePath(d).map(loop => {
    // y down in path units to y up in wordmark units, centred on the box.
    const points = loop.map(([x, y]): Point => [(x - WORDMARK_WIDTH / 2) / WORDMARK_HEIGHT, (WORDMARK_HEIGHT / 2 - y) / WORDMARK_HEIGHT])
    // Drop a repeated last point, which would make a zero-length edge.
    const [a, b] = [points[0], points[points.length - 1]]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) points.pop()
    return points
  })
  const contours: Contour[] = loops.map(points => ({ points, area: signedArea(points), depth: 0, parent: -1 }))
  for (const [i, contour] of contours.entries()) {
    // A vertex of one traced loop never lies on another, so one vertex settles nesting.
    const enclosing = contours.map((other, j) => j !== i && insidePolygon(contour.points[0], other.points) ? j : -1).filter(j => j >= 0)
    contour.depth = enclosing.length
    // The innermost encloser is the one with the smallest area.
    contour.parent = enclosing.sort((a, b) => Math.abs(contours[a].area) - Math.abs(contours[b].area))[0] ?? -1
  }
  return contours
}

/** The area the path fills under the even-odd rule. */
export function evenOddArea(contours: Contour[]): number {
  return contours.reduce((sum, c) => sum + Math.abs(c.area) * (c.depth % 2 === 0 ? 1 : -1), 0)
}

/** Unit vector pointing away from the filled side of each edge i (from point i to i + 1). */
function edgeNormals(contour: Contour): Point[] {
  // Anticlockwise loops have their inside on the left. For holes the filled side is outside.
  const sign = (contour.area > 0 ? 1 : -1) * (contour.depth % 2 === 0 ? 1 : -1)
  return contour.points.map((p, i) => {
    const q = contour.points[(i + 1) % contour.points.length], dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy) || 1
    return [sign * dy / length, -sign * dx / length]
  })
}

export interface FaceTriangles {
  /** x, y pairs, one per contour point, in contour order. */
  positions: Float32Array
  indices: Uint32Array
  /** Index of each contour's first point in `positions`. */
  offsets: number[]
}
/** Triangulates the filled region: each filled contour with the holes directly inside it. */
export function triangulateFace(contours: Contour[]): FaceTriangles {
  const offsets: number[] = [], flat: number[] = []
  for (const contour of contours) { offsets.push(flat.length / 2); for (const p of contour.points) flat.push(p[0], p[1]) }
  const indices: number[] = []
  for (const [i, outer] of contours.entries()) {
    if (outer.depth % 2 !== 0) continue
    const holes = contours.map((c, j) => j).filter(j => contours[j].parent === i && contours[j].depth === outer.depth + 1)
    const order = [i, ...holes]
    // Earcut takes the outline then each hole as one flat list, and orients them itself.
    const data: number[] = [], holeStarts: number[] = [], map: number[] = []
    for (const k of order) {
      if (k !== i) holeStarts.push(data.length / 2)
      for (const [n, p] of contours[k].points.entries()) { data.push(p[0], p[1]); map.push(offsets[k] + n) }
    }
    for (const index of Earcut.triangulate(data, holeStarts, 2)) indices.push(map[index])
  }
  return { positions: new Float32Array(flat), indices: new Uint32Array(indices), offsets }
}

export function triangleArea(positions: ArrayLike<number>, indices: ArrayLike<number>, stride = 2): number {
  let sum = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * stride, b = indices[i + 1] * stride, c = indices[i + 2] * stride
    sum += Math.abs((positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) - (positions[c] - positions[a]) * (positions[b + 1] - positions[a + 1])) / 2
  }
  return sum
}

export interface WordmarkMesh {
  /** Interleaved per vertex: x, y, z, normal x, y, z, part (0 face, 1 chamfer, 2 side wall). */
  vertices: Float32Array
  /** Vertex counts of the three parts, drawn in this order: walls, face, chamfer. */
  wallVertices: number
  bevelVertices: number
  faceVertices: number
  triangles: number
}
export const FLOATS_PER_VERTEX = 7

/**
 * An extruded wordmark with a 45 degree chamfer: the face at z = 0 is the triangulated
 * outline; the chamfer runs from the outline pulled inward along each mitre by `bevel`, at
 * z = 0, out to the true outline at z = -bevel; the walls drop from there to z = -depth.
 * There is no back face: the mark only ever turns a few degrees.
 * Nothing is culled, so triangle winding cannot hide anything. Order matters instead:
 * walls first, then the face, then the chamfer over the face's edge. That is right for any
 * view from the front, and needs no depth buffer (the lobby's context has none).
 */
export function buildWordmarkMesh(options: { depth?: number; bevel?: number; contours?: Contour[] } = {}): WordmarkMesh {
  const depth = options.depth ?? 0.12, bevel = options.bevel ?? 0.013
  const contours = options.contours ?? wordmarkContours()
  const face = triangulateFace(contours)
  const walls: number[] = [], chamfer: number[] = [], inset: Point[] = []
  const push = (into: number[], x: number, y: number, z: number, n: [number, number, number], part: number) => into.push(x, y, z, n[0], n[1], n[2], part)
  for (const contour of contours) {
    const normals = edgeNormals(contour), points = contour.points, count = points.length
    for (let i = 0; i < count; i++) {
      // Mitre at point i: the mean of its two edge normals, lengthened to keep the chamfer
      // even, and capped so very sharp corners do not throw a spike.
      const a = normals[(i - 1 + count) % count], b = normals[i]
      let mx = a[0] + b[0], my = a[1] + b[1]
      const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml
      const scale = Math.min(2, 1 / Math.max(0.2, mx * b[0] + my * b[1]))
      inset.push([points[i][0] - mx * bevel * scale, points[i][1] - my * bevel * scale])
    }
    const base = inset.length - count
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count, p = points[i], q = points[j], ip = inset[base + i], iq = inset[base + j], n = normals[i]
      const wall: [number, number, number] = [n[0], n[1], 0], k = Math.SQRT1_2, slope: [number, number, number] = [n[0] * k, n[1] * k, k]
      for (const [x, y, z] of [[p[0], p[1], -bevel], [q[0], q[1], -bevel], [q[0], q[1], -depth], [p[0], p[1], -bevel], [q[0], q[1], -depth], [p[0], p[1], -depth]]) push(walls, x, y, z, wall, 2)
      for (const [x, y, z] of [[ip[0], ip[1], 0], [iq[0], iq[1], 0], [q[0], q[1], -bevel], [ip[0], ip[1], 0], [q[0], q[1], -bevel], [p[0], p[1], -bevel]]) push(chamfer, x, y, z, slope, 1)
    }
  }
  // The face is the exact triangulation of the outline. The chamfer is drawn after it and
  // covers its outer strip, which looks the same as an inset face without having to
  // triangulate the inset outline (whose traced corners cross themselves in places).
  const front: number[] = []
  for (const index of face.indices) push(front, face.positions[index * 2], face.positions[index * 2 + 1], 0, [0, 0, 1], 0)
  const vertices = new Float32Array([...walls, ...front, ...chamfer])
  const wallVertices = walls.length / FLOATS_PER_VERTEX, bevelVertices = chamfer.length / FLOATS_PER_VERTEX, faceVertices = front.length / FLOATS_PER_VERTEX
  return { vertices, wallVertices, bevelVertices, faceVertices, triangles: (wallVertices + bevelVertices + faceVertices) / 3 }
}

/** A small seeded generator (mulberry32), so a seed always gives the same particles. */
export function random(seed: number): () => number {
  let a = (Math.floor(seed * 9973) ^ 0x9e3779b9) >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export interface OutlineSamples {
  /** Per particle: outline x, y, outward normal x, y. */
  points: Float32Array
  /** Per particle: four uniform random numbers. */
  seeds: Float32Array
  count: number
}
/**
 * Points spread evenly along the whole outline by arc length (stratified, so there are no
 * gaps), each with the unit normal pointing away from the filled side and four random
 * numbers for the shader.
 */
export function sampleOutline(count: number, seed = 1, contours = wordmarkContours()): OutlineSamples {
  const edges: { p: Point; q: Point; n: Point; start: number; length: number }[] = []
  let total = 0
  for (const contour of contours) {
    const normals = edgeNormals(contour)
    for (const [i, p] of contour.points.entries()) {
      const q = contour.points[(i + 1) % contour.points.length], length = Math.hypot(q[0] - p[0], q[1] - p[1])
      edges.push({ p, q, n: normals[i], start: total, length }); total += length
    }
  }
  const rand = random(seed), points = new Float32Array(count * 4), seeds = new Float32Array(count * 4)
  let edge = 0
  // Visit the strata in a shuffled order so that any prefix of the buffer still covers the
  // whole outline: a smaller budget can draw only the first n particles.
  const order = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const along = order.map(k => (k + rand()) / count * total)
  const sorted = along.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0])
  for (const [s, i] of sorted) {
    while (edge < edges.length - 1 && edges[edge].start + edges[edge].length < s) edge++
    const e = edges[edge], t = e.length > 0 ? Math.min(1, Math.max(0, (s - e.start) / e.length)) : 0
    points.set([e.p[0] + (e.q[0] - e.p[0]) * t, e.p[1] + (e.q[1] - e.p[1]) * t, e.n[0], e.n[1]], i * 4)
    seeds.set([rand(), rand(), rand(), rand()], i * 4)
  }
  return { points, seeds, count }
}
