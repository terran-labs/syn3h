/**
 * The Syn3h wordmark path turned into geometry the GPU can draw: closed contours sorted into
 * filled shapes and holes by the even-odd rule, a triangulated flat face with a thin edge
 * band, a wide band outward from the outline for the plasma's glow, plus points spread
 * along the outline by arc length for the plasma's particles. Pure functions with no DOM, so the tests run
 * them directly.
 *
 * Units: one unit is the height of the wordmark box (226 path units), x to the right, y up,
 * the origin at the centre of the 962 by 226 box. The face covers exactly the box the SVG
 * wordmark covers.
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
  /**
   * Interleaved per vertex: x, y, then an inward offset x, y and the part (0 face, 1 edge).
   * The edge's inner ring sits at the outline plus offset times the edge width, which the
   * shader picks so the line stays at least a pixel wide on small screens.
   */
  vertices: Float32Array
  /** Vertex counts of the two parts, drawn in this order: face, edge. */
  faceVertices: number
  edgeVertices: number
  triangles: number
}
export const FLOATS_PER_VERTEX = 5

/**
 * The flat wordmark: the triangulated outline as one face, and a thin band just
 * inside the outline for its edge line, drawn over the face. No depth, no lighting.
 */
export function buildWordmarkMesh(options: { contours?: Contour[] } = {}): WordmarkMesh {
  const contours = options.contours ?? wordmarkContours()
  const face = triangulateFace(contours)
  const front: number[] = [], edge: number[] = []
  for (const index of face.indices) front.push(face.positions[index * 2], face.positions[index * 2 + 1], 0, 0, 0)
  for (const contour of contours) {
    const normals = edgeNormals(contour), points = contour.points, count = points.length
    // Mitre at each point: the mean of its two edge normals, lengthened to keep the line
    // even, and capped so very sharp corners do not throw a spike. Pointing inward.
    const mitres = points.map((_, i): Point => {
      const a = normals[(i - 1 + count) % count], b = normals[i]
      let mx = a[0] + b[0], my = a[1] + b[1]
      const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml
      const scale = Math.min(2, 1 / Math.max(0.2, mx * b[0] + my * b[1]))
      return [-mx * scale, -my * scale]
    })
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count, p = points[i], q = points[j], mp = mitres[i], mq = mitres[j]
      for (const [v, m] of [[p, mp], [q, mq], [q, null], [p, mp], [q, null], [p, null]] as const) edge.push(v[0], v[1], m?.[0] ?? 0, m?.[1] ?? 0, 1)
    }
  }
  const vertices = new Float32Array([...front, ...edge])
  const faceVertices = front.length / FLOATS_PER_VERTEX, edgeVertices = edge.length / FLOATS_PER_VERTEX
  return { vertices, faceVertices, edgeVertices, triangles: (faceVertices + edgeVertices) / 3 }
}

export interface GlowBand {
  /**
   * Interleaved per vertex: x, y on the outline; an outward offset x, y (unit length on
   * the band's outer rim, zero on the outline); the fraction of the way round its contour
   * (0 to 1); and that contour's length, in wordmark units.
   */
  vertices: Float32Array
  triangles: number
}
export const GLOW_FLOATS_PER_VERTEX = 6

/**
 * The plasma's body: a band running outward from the whole outline, one quad per edge and
 * a small fan at each corner, so its outer rim is the outline grown by the band width with
 * rounded corners (the width is the shader's). Where bands overlap, at concave corners and
 * between close letters, the renderer takes the brighter, so nothing doubles up.
 */
export function buildGlowBand(contours = wordmarkContours()): GlowBand {
  const out: number[] = []
  const push = (p: Point, o: Point, u: number, length: number) => out.push(p[0], p[1], o[0], o[1], u, length)
  for (const contour of contours) {
    const normals = edgeNormals(contour), points = contour.points, count = points.length
    const along: number[] = []; let length = 0
    for (let i = 0; i < count; i++) { along.push(length); const q = points[(i + 1) % count]; length += Math.hypot(q[0] - points[i][0], q[1] - points[i][1]) }
    const zero: Point = [0, 0]
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count, p = points[i], q = points[j], n = normals[i], u0 = along[i] / length, u1 = j === 0 ? 1 : along[j] / length
      push(p, zero, u0, length); push(q, zero, u1, length); push(q, n, u1, length)
      push(p, zero, u0, length); push(q, n, u1, length); push(p, n, u0, length)
      // The corner at q: a fan from this edge's normal round to the next one's, the short way.
      const m = normals[j], from = Math.atan2(n[1], n[0])
      let turn = Math.atan2(m[1], m[0]) - from
      while (turn > Math.PI) turn -= 2 * Math.PI
      while (turn < -Math.PI) turn += 2 * Math.PI
      const steps = Math.ceil(Math.abs(turn) / (Math.PI / 6))
      for (let k = 0; k < steps; k++) {
        const a = from + turn * k / steps, b = from + turn * (k + 1) / steps
        push(q, zero, u1 % 1, length); push(q, [Math.cos(a), Math.sin(a)], u1 % 1, length); push(q, [Math.cos(b), Math.sin(b)], u1 % 1, length)
      }
    }
  }
  const vertices = new Float32Array(out)
  return { vertices, triangles: vertices.length / GLOW_FLOATS_PER_VERTEX / 3 }
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
