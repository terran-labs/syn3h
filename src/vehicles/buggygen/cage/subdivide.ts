// Loop subdivision of a triangle cage with sharp (crease) edges. No dependencies.
//
// One step splits every triangle into four. Smooth edges and vertices follow Loop's rules;
// crease edges (tagged, open boundary, non-manifold, or between two faces of different role)
// follow the curve rules, so lamp borders, openings and folds stay crisp. A vertex with two
// crease edges slides along them; a vertex with three or more is a corner and stays put.
//
// Each step is expressed as a stencil: every new vertex is a weighted sum of old vertices.
// The game applies the stencil to positions; the offline fitter composes stencils into one
// linear map from cage points to the subdivided surface and solves for the cage.

export interface Cage {
  /** xyz per vertex, metres, game frame. */
  positions: ArrayLike<number>
  /** Three vertex indices per triangle, counter clockwise seen from outside. */
  faces: ArrayLike<number>
  /** One small integer per triangle: the role index. */
  tags: ArrayLike<number>
  /** Pairs of vertex indices whose edge is sharp. Role borders and open edges are sharp anyway. */
  creases: ArrayLike<number>
}

/** Sparse rows: new vertex i is sum over k in [start[i], start[i+1]) of weight[k] * old[index[k]]. */
export interface Stencil { start: Uint32Array; index: Uint32Array; weight: Float32Array; rows: number; cols: number }

export interface Step { stencil: Stencil; faces: Uint32Array; tags: Uint8Array; creases: Uint32Array }

const edgeKey = (a: number, b: number, n: number) => (a < b ? a * n + b : b * n + a)

/** The topology of one Loop step and the stencil that places its vertices. */
export function loopStep(vertexCount: number, faces: ArrayLike<number>, tags: ArrayLike<number>, creases: ArrayLike<number>): Step {
  const n = vertexCount, faceCount = faces.length / 3
  // Edges: id per unordered pair, with their (up to two) opposite vertices and crease flag.
  const edgeId = new Map<number, number>()
  const ea: number[] = [], eb: number[] = [], opp: number[] = [], faceOf: number[] = [], sharp: number[] = []
  const faceEdges = new Uint32Array(faceCount * 3)
  for (let f = 0; f < faceCount; f++) for (let c = 0; c < 3; c++) {
    const a = faces[f * 3 + c], b = faces[f * 3 + (c + 1) % 3], o = faces[f * 3 + (c + 2) % 3]
    const k = edgeKey(a, b, n)
    let e = edgeId.get(k)
    if (e === undefined) { e = ea.length; edgeId.set(k, e); ea.push(a); eb.push(b); opp.push(o, -1); faceOf.push(f, -1); sharp.push(0) }
    else if (opp[e * 2 + 1] === -1) {
      opp[e * 2 + 1] = o; faceOf[e * 2 + 1] = f
      if (tags[faceOf[e * 2]] !== tags[f]) sharp[e] = 1
    } else sharp[e] = 1 // a third face: non-manifold, keep it crisp
    faceEdges[f * 3 + c] = e
  }
  const edgeCount = ea.length
  for (let e = 0; e < edgeCount; e++) if (opp[e * 2 + 1] === -1) sharp[e] = 1
  for (let i = 0; i < creases.length; i += 2) {
    const e = edgeId.get(edgeKey(creases[i], creases[i + 1], n))
    if (e !== undefined) sharp[e] = 1
  }
  // Vertex rings: neighbours and the crease neighbours.
  const ringCount = new Uint32Array(n), sharpCount = new Uint32Array(n)
  for (let e = 0; e < edgeCount; e++) { ringCount[ea[e]]++; ringCount[eb[e]]++; if (sharp[e]) { sharpCount[ea[e]]++; sharpCount[eb[e]]++ } }
  const ringStart = new Uint32Array(n + 1)
  for (let v = 0; v < n; v++) ringStart[v + 1] = ringStart[v] + ringCount[v]
  const ring = new Uint32Array(ringStart[n]), ringSharp = new Uint8Array(ringStart[n]), fill = ringStart.slice(0, n)
  for (let e = 0; e < edgeCount; e++) {
    ring[fill[ea[e]]] = eb[e]; ringSharp[fill[ea[e]]++] = sharp[e]
    ring[fill[eb[e]]] = ea[e]; ringSharp[fill[eb[e]]++] = sharp[e]
  }
  // Stencil rows: old vertices first, then one new vertex per edge.
  const start: number[] = [0], index: number[] = [], weight: number[] = []
  const push = (i: number, w: number) => { index.push(i); weight.push(w) }
  for (let v = 0; v < n; v++) {
    const k = ringCount[v], s = sharpCount[v]
    if (k === 0 || s > 2) push(v, 1)
    else if (s === 2) {
      push(v, .75)
      for (let r = ringStart[v]; r < ringStart[v + 1]; r++) if (ringSharp[r]) push(ring[r], .125)
    } else {
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k)
      push(v, 1 - k * beta)
      for (let r = ringStart[v]; r < ringStart[v + 1]; r++) push(ring[r], beta)
    }
    start.push(index.length)
  }
  for (let e = 0; e < edgeCount; e++) {
    if (sharp[e]) { push(ea[e], .5); push(eb[e], .5) }
    else { push(ea[e], .375); push(eb[e], .375); push(opp[e * 2], .125); push(opp[e * 2 + 1], .125) }
    start.push(index.length)
  }
  // Four children per face; children inherit the role.
  const outFaces = new Uint32Array(faceCount * 12), outTags = new Uint8Array(faceCount * 4)
  for (let f = 0; f < faceCount; f++) {
    const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2]
    const ab = n + faceEdges[f * 3], bc = n + faceEdges[f * 3 + 1], ca = n + faceEdges[f * 3 + 2]
    outFaces.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], f * 12)
    outTags.fill(tags[f], f * 4, f * 4 + 4)
  }
  // Each crease edge becomes two crease edges through its new midpoint.
  const outCreases: number[] = []
  for (let e = 0; e < edgeCount; e++) if (sharp[e]) outCreases.push(ea[e], n + e, n + e, eb[e])
  return {
    stencil: {start: Uint32Array.from(start), index: Uint32Array.from(index), weight: Float32Array.from(weight), rows: n + edgeCount, cols: n},
    faces: outFaces, tags: outTags, creases: Uint32Array.from(outCreases),
  }
}

/** Applies a stencil to xyz data. */
export function applyStencil(s: Stencil, data: ArrayLike<number>): Float32Array {
  const out = new Float32Array(s.rows * 3)
  for (let i = 0; i < s.rows; i++) {
    let x = 0, y = 0, z = 0
    for (let k = s.start[i]; k < s.start[i + 1]; k++) { const j = s.index[k] * 3, w = s.weight[k]; x += w * data[j]; y += w * data[j + 1]; z += w * data[j + 2] }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z
  }
  return out
}

/** Subdivides a cage `levels` times. */
export function subdivide(cage: Cage, levels: number): { positions: Float32Array; faces: Uint32Array; tags: Uint8Array } {
  let positions: Float32Array = Float32Array.from(cage.positions), faces: Uint32Array = Uint32Array.from(cage.faces)
  let tags: Uint8Array = Uint8Array.from(cage.tags), creases: Uint32Array = Uint32Array.from(cage.creases)
  for (let l = 0; l < levels; l++) {
    const step = loopStep(positions.length / 3, faces, tags, creases)
    positions = applyStencil(step.stencil, positions); faces = step.faces; tags = step.tags; creases = step.creases
  }
  return {positions, faces, tags}
}
