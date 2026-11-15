/**
 * What grows on each kind of world: the plants' shapes and the rules for where they grow.
 * The machinery that draws them round the camera is in `groundcover.ts`.
 *
 *  - alpine:   clumped meadow grass, seed-head grasses, daisies, low cushion flowers,
 *              lupins and half-buried stones, in whites, butter yellows, violets and blues
 *  - desert:   clumps of dry golden grass, foxtail seed heads, dusty succulent rosettes,
 *              a few sunset-coloured blooms and pebbles
 *  - volcanic: dark blades with ember tips, alien anemones and tube clumps in one ember,
 *              red and magenta family with a rare cold cyan, thickest near the lava
 *  - obsidian: the volcanic plants in magenta, violet and ember red on black glass
 *  - badlands: the desert's plants on red clay
 *  - archipelago: short lush turf, sea oats along the shore, tropical blooms in drifts
 *  - swamp:    olive sedge, reed beds along the water, glowcaps lit from beneath
 *  - ice and moon: bare
 *
 * Every plant fades from the ground's own colour at its root to its own colour at the tip,
 * so it grows out of the ground instead of sitting on it. Nothing here is large: no trees,
 * bushes or cacti.
 *
 * To add a planet, add a `Flora` to FLORA under its look (terrain.look). Layers are plain
 * data: a shape, a grid and a `grow` rule that reads the ground at a cell.
 */
import * as THREE from 'three/webgpu'

// ---------------------------------------------------------------------------------------
// The ground at a cell, and what grows there
// ---------------------------------------------------------------------------------------

/** The ground at one cell, gathered once and handed to `grow`. */
export interface Ground {
  x: number
  z: number
  y: number
  /** 0..1 patch noise, for drifts. */
  patch: number
  /** 0..1 broader noise, for regions: tall or short grass, lush or dry. */
  region: number
  /** 0..1 how volcanic (rocky) the ground is. */
  rock: number
  /** 0..1 how close the nearest river, pool or shore is: 1 at its edge, 0 beyond ~35 m. */
  flow: number
  /** Distance to the centre of the nearest grass clump, metres. */
  clumpD: number
  /** 0..1 hash shared by every blade in the clump. */
  clump: number
  /** Unit direction from the clump's centre to this cell. */
  outX: number
  outZ: number
  /** Height of the tree line on this world: alpine meadows thin out toward it. */
  treeLine: number
}

export interface Plant {
  /** Height multiplier; 0 means nothing grows in this cell. */
  scale: number
  r: number
  g: number
  b: number
  /** Lean of the whole plant, metres sideways per metre up. */
  lx: number
  lz: number
}

export interface LayerSpec {
  /** Slots per side. */
  n: number
  /** Metres between cells. Must divide every tile size. */
  spacing: number
  geometry: THREE.BufferGeometry
  /** What grows in a cell, given the ground there and a hash of the cell. */
  grow(c: Ground, h: number, out: Plant): void
  /** This layer's plants darken the ground beneath them (see SHADE_N in groundcover.ts). */
  shade?: boolean
}

export interface Flora {
  layers(treeLine: number): LayerSpec[]
  /** The ground under dense growth is multiplied by this colour. */
  shade: number
}

// ---------------------------------------------------------------------------------------
// Geometry: small procedural meshes. Per vertex: colour, and in `aShape`: sway (0 at the root, 1 at the
// tip), tint (how much of the plant's own colour the vertex takes), glow, and `own`: how
// much of the vertex shows the plant at all, against the ground's colour at its foot.
// ---------------------------------------------------------------------------------------

export class Builder {
  pos: number[] = []
  col: number[] = []
  sway: number[] = []
  tint: number[] = []
  glow: number[] = []
  own: number[] = []
  /**
   * `root` is the height in metres over which a plant fades in from the ground's colour.
   * `earth` on a vertex keeps that much of the ground's colour above the root too, for
   * stalks that should look like they are made of the soil.
   */
  constructor(private readonly root = 0.18) {}
  v(x: number, y: number, z: number, c: THREE.Color, sway: number, tint = 0, glow = 0, earth = 0): void {
    this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.sway.push(sway); this.tint.push(tint); this.glow.push(glow)
    const t = Math.max(0, Math.min(1, y / this.root))
    this.own.push(t * t * (3 - 2 * t) * (1 - earth))
  }
  /** One triangle. */
  tri(a: number[], b: number[], c: number[], col: THREE.Color[], sway: number[], tint = 0, glow: number[] = [0, 0, 0], earth = 0): void {
    this.v(a[0], a[1], a[2], col[0], sway[0], tint, glow[0], earth)
    this.v(b[0], b[1], b[2], col[1], sway[1], tint, glow[1], earth)
    this.v(c[0], c[1], c[2], col[2], sway[2], tint, glow[2], earth)
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    // Packed into one vec4 (sway, tint, glow, own): WebGPU allows only eight vertex buffers
    // and the instances take four.
    const shape = new Float32Array(this.sway.length * 4)
    for (let i = 0; i < this.sway.length; i++) {
      shape[i * 4] = this.sway[i]; shape[i * 4 + 1] = this.tint[i]; shape[i * 4 + 2] = this.glow[i]; shape[i * 4 + 3] = this.own[i]
    }
    g.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 4))
    return g
  }
}

const C = (hex: number) => new THREE.Color(hex)
/** A repeatable 0..1 sequence for shaping, so geometry is the same on every client. */
const r01 = (i: number, k: number) => (((i * k) % 97) / 97)

/**
 * A tuft of tapered blades leaning outward, each bent once partway up so it arcs instead
 * of standing as a flat spike. Three triangles per blade. The tuft takes the plant's tint.
 */
export function tuft(blades: number, height: number, root: number, tip: number, opts: { glow?: number; curl?: number; width?: number } = {}): THREE.BufferGeometry {
  const { glow = 0, curl = 0, width = 0.028 } = opts
  const b = new Builder(height * 0.45)
  const cr = C(root), ct = C(tip), cm = cr.clone().lerp(ct, 0.55)
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7
    const out = 0.04 + 0.14 * r01(i, 37)
    const h = height * (0.6 + 0.4 * r01(i, 53))
    const ox = Math.cos(a), oz = Math.sin(a)
    const cx = ox * out, cz = oz * out
    // Blade faces sideways to its lean, so the tuft has volume from every direction.
    const wx = -oz * width, wz = ox * width
    const lean = 0.18 + curl + 0.12 * r01(i, 71)
    // The bend: the upper part leans out further than the lower.
    const mh = h * 0.55, mo = h * lean * 0.35
    const m = [cx + ox * mo, mh, cz + oz * mo]
    const t = [cx + ox * h * lean * 1.4, h, cz + oz * h * lean * 1.4]
    const w1 = 0.62
    const a0 = [cx - wx, 0, cz - wz], a1 = [cx + wx, 0, cz + wz]
    const m0 = [m[0] - wx * w1, m[1], m[2] - wz * w1], m1 = [m[0] + wx * w1, m[1], m[2] + wz * w1]
    b.tri(a0, a1, m1, [cr, cr, cm], [0, 0, 0.45], 1)
    b.tri(a0, m1, m0, [cr, cm, cm], [0, 0.45, 0.45], 1)
    b.tri(m0, m1, t, [cm, cm, ct], [0.45, 0.45, 1], 1, [0, 0, glow])
  }
  return b.build()
}

/** A thin ribbon from p0 to p1, two triangles, its width across its own lean. */
function ribbon(b: Builder, p0: number[], p1: number[], w0: number, w1: number, c0: THREE.Color, c1: THREE.Color, s0: number, s1: number,
  o: { tint?: number; g0?: number; g1?: number; earth?: number } = {}): void {
  const { tint = 0, g0 = 0, g1 = 0, earth = 0 } = o
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2]
  const l = Math.hypot(dx, dz)
  const wx = l > 1e-4 ? -dz / l : 1, wz = l > 1e-4 ? dx / l : 0
  const a = [p0[0] - wx * w0, p0[1], p0[2] - wz * w0], c = [p0[0] + wx * w0, p0[1], p0[2] + wz * w0]
  const d = [p1[0] - wx * w1, p1[1], p1[2] - wz * w1], e = [p1[0] + wx * w1, p1[1], p1[2] + wz * w1]
  b.tri(a, c, d, [c0, c0, c1], [s0, s0, s1], tint, [g0, g0, g1], earth)
  b.tri(c, e, d, [c0, c1, c1], [s0, s1, s1], tint, [g0, g1, g1], earth)
}

/** Two ribbons crossed at right angles along a path: a stem with volume from every side. */
function stem(b: Builder, pts: number[][], w0: number, w1: number, c0: THREE.Color, c1: THREE.Color,
  o: { tint?: number; g0?: number; g1?: number; earth?: number; s0?: number; s1?: number } = {}): void {
  const { tint = 0, g0 = 0, g1 = 0, earth = 0, s0 = 0, s1 = 1 } = o
  const n = pts.length - 1
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n
    const wa = w0 + (w1 - w0) * t0, wb = w0 + (w1 - w0) * t1
    const ca = c0.clone().lerp(c1, t0), cb = c0.clone().lerp(c1, t1)
    const ga = g0 + (g1 - g0) * t0, gb = g0 + (g1 - g0) * t1
    const sa = s0 + (s1 - s0) * t0, sb = s0 + (s1 - s0) * t1
    const p = pts[i], q = pts[i + 1]
    for (const [wx, wz] of [[1, 0], [0, 1]]) {
      const a = [p[0] - wx * wa, p[1], p[2] - wz * wa], c = [p[0] + wx * wa, p[1], p[2] + wz * wa]
      const d = [q[0] - wx * wb, q[1], q[2] - wz * wb], e = [q[0] + wx * wb, q[1], q[2] + wz * wb]
      b.tri(a, c, d, [ca, ca, cb], [sa, sa, sb], tint, [ga, ga, gb], earth)
      b.tri(c, e, d, [ca, cb, cb], [sa, sb, sb], tint, [ga, gb, gb], earth)
    }
  }
}

/**
 * A flower head: a ring of petals cupped upward around a centre. Petals take the plant's
 * colour, paler at the tips; the centre keeps its own.
 */
function flowerHead(b: Builder, hx: number, hy: number, hz: number, petals: number, radius: number, centre: THREE.Color, sway = 1): void {
  const deep = C(0xb8b8b8), pale = C(0xffffff)
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * Math.PI * 2, a1 = ((i + 0.78) / petals) * Math.PI * 2, am = (a0 + a1) / 2
    const r = radius * (0.85 + 0.3 * r01(i, 41))
    const lift = 0.04 + 0.03 * r01(i, 59)
    const p0 = [hx, hy, hz]
    const p1 = [hx + Math.cos(a0) * r * 0.45, hy + lift * 0.4, hz + Math.sin(a0) * r * 0.45]
    const pm = [hx + Math.cos(am) * r, hy + lift, hz + Math.sin(am) * r]
    const p2 = [hx + Math.cos(a1) * r * 0.45, hy + lift * 0.4, hz + Math.sin(a1) * r * 0.45]
    b.tri(p0, p1, pm, [deep, pale, pale], [sway, sway, sway], 1)
    b.tri(p0, pm, p2, [deep, pale, pale], [sway, sway, sway], 1)
  }
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2, rr = radius * 0.28
    b.tri([hx, hy + 0.03, hz], [hx + Math.cos(a0) * rr, hy + 0.018, hz + Math.sin(a0) * rr], [hx + Math.cos(a1) * rr, hy + 0.018, hz + Math.sin(a1) * rr],
      [centre, centre, centre], [sway, sway, sway])
  }
}

/** A daisy: a thin stem with two leaves at its foot and a cupped flower head. */
export function daisy(height: number, petals: number, radius: number, stemCol: number, centre: number): THREE.BufferGeometry {
  const b = new Builder(0.12)
  const cs = C(stemCol)
  stem(b, [[0, 0, 0], [0.025, height * 0.55, 0.012], [0.03, height, 0.02]], 0.011, 0.007, cs, cs)
  ribbon(b, [0, 0, 0], [0.11, 0.07, 0.03], 0.022, 0.004, cs, cs, 0, 0.3)
  ribbon(b, [0, 0, 0], [-0.08, 0.06, -0.07], 0.02, 0.004, cs, cs, 0, 0.3)
  flowerHead(b, 0.03, height, 0.02, petals, radius, C(centre))
  return b.build()
}

/**
 * A cushion plant: a low dome of tiny blossoms packed together, like moss campion on a
 * mountain. The blossoms take the plant's colour; green shows between them.
 */
export function cushion(): THREE.BufferGeometry {
  const b = new Builder(0.05)
  const leaf = C(0x2e4c1e), leafTop = C(0x4a6e2c)
  const pale = C(0xffffff), deep = C(0xc0c0c0)
  // The dome's green body: a low fan, lighter on top.
  const R = 0.24, H = 0.11
  for (let k = 0; k < 7; k++) {
    const a0 = (k / 7) * Math.PI * 2, a1 = ((k + 1) / 7) * Math.PI * 2
    b.tri([0, H, 0], [Math.cos(a0) * R, 0.0, Math.sin(a0) * R], [Math.cos(a1) * R, 0.0, Math.sin(a1) * R], [leafTop, leaf, leaf], [0.2, 0, 0])
  }
  // Blossoms packed over the dome, each two petals crossed into a small four-pointed star
  // facing up and out. Together they cover most of the green.
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4, rr = R * 0.9 * Math.sqrt((i + 0.5) / 11)
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr
    const y = H * (1 - (rr / R) ** 2) + 0.015
    const s = 0.05
    for (let p = 0; p < 2; p++) {
      const q = p * Math.PI / 2 + i
      const ux = Math.cos(q) * s, uz = Math.sin(q) * s, vx = -uz * 0.35, vz = ux * 0.35
      b.tri([x - ux, y, z - uz], [x + vx, y + 0.006, z + vz], [x + ux, y, z + uz], [pale, deep, pale], [0.3, 0.3, 0.3], 1)
      b.tri([x - ux, y, z - uz], [x + ux, y, z + uz], [x - vx, y + 0.006, z - vz], [pale, pale, deep], [0.3, 0.3, 0.3], 1)
    }
  }
  return b.build()
}

/**
 * A seed-head grass: a few slender stalks, each carrying a narrow plume of seeds that
 * bows in the wind. The plume takes the plant's colour.
 */
export function seedGrass(stalks: number, height: number, stalkCol: number, plumeCol: number, plumeLen = 0.16): THREE.BufferGeometry {
  const b = new Builder(0.12)
  const cs = C(stalkCol), cp = C(plumeCol)
  for (let i = 0; i < stalks; i++) {
    const a = i * 2.3 + 0.4
    const h = height * (0.75 + 0.25 * r01(i, 31))
    const ox = Math.cos(a), oz = Math.sin(a)
    const lean = 0.12 + 0.1 * r01(i, 13)
    const top = [ox * (0.04 + h * lean), h, oz * (0.04 + h * lean)]
    stem(b, [[ox * 0.03, 0, oz * 0.03], top], 0.009, 0.006, cs, cs, { s1: 0.9 })
    // The head: the stalk runs on through it, set with small spikelets in two
    // alternating rows that angle up and out, like an ear of wild grain. No closed outline,
    // so it never reads as a diamond.
    const len = plumeLen * (0.8 + 0.4 * r01(i, 7))
    const dir = [ox * 0.35, 1, oz * 0.35]
    const end = [top[0] + dir[0] * len, h + len, top[2] + dir[2] * len]
    stem(b, [top, end], 0.006, 0.003, cs, cp, { s0: 0.9, s1: 1.05 })
    const K = 7
    for (let k = 0; k < K; k++) {
      const t = (k + 0.5) / K
      const side = k % 2 ? 1 : -1
      const q = [top[0] + dir[0] * len * t, h + len * t, top[2] + dir[2] * len * t]
      // Spikelets alternate across the head, crossing the stalk's lean.
      const sx = -oz * side, sz = ox * side
      const sl = 0.045 * (1 - 0.45 * t)
      const tip = [q[0] + sx * sl * 0.55, q[1] + sl, q[2] + sz * sl * 0.55]
      const w = 0.012 * (1 - 0.4 * t)
      b.tri([q[0] - dir[0] * 0.01, q[1] - 0.01, q[2] - dir[2] * 0.01], [q[0] + sx * w, q[1] + w * 0.5, q[2] + sz * w], tip,
        [cp, cp, cp], [0.9 + 0.15 * t, 0.9 + 0.15 * t, 1.05], 1)
    }
  }
  return b.build()
}

/**
 * A lupin: a tall spike with blossoms spiralling up it, largest at the bottom, palest at
 * the top, above a few fingered leaves. The blossoms take the plant's colour.
 */
export function lupin(): THREE.BufferGeometry {
  const b = new Builder(0.1)
  const green = C(0x35662a)
  const white = C(0xffffff), mid = C(0xc8c8c8)
  const H = 0.8
  stem(b, [[0, 0, 0], [0.02, H * 0.5, 0.01], [0.03, H, 0.02]], 0.012, 0.005, green, green)
  // Fingered leaves at the foot.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3
    ribbon(b, [0, 0.05, 0], [Math.cos(a) * 0.17, 0.11, Math.sin(a) * 0.17], 0.016, 0.004, green, green, 0, 0.25)
  }
  for (let k = 0; k < 14; k++) {
    const t = k / 13
    const y = H * (0.38 + 0.6 * t)
    const a = k * 2.4
    const size = 0.07 * (1 - 0.55 * t)
    const cx = 0.03 * (y / H), cz = 0.02 * (y / H)
    const ox = Math.cos(a), oz = Math.sin(a)
    const col = t > 0.75 ? white : mid
    // A small hooded blossom standing out from the spike and tipping down.
    b.tri([cx, y + size * 0.55, cz], [cx + ox * size - oz * size * 0.55, y - size * 0.15, cz + oz * size + ox * size * 0.55],
      [cx + ox * size + oz * size * 0.55, y - size * 0.15, cz + oz * size - ox * size * 0.55], [mid, col, col], [0.5 + 0.5 * t, 0.5 + 0.5 * t, 0.5 + 0.5 * t], 1)
  }
  return b.build()
}

/**
 * A stone half sunk in the ground: an uneven lump whose lower half takes the ground's
 * colour, so it reads as bedded in the soil rather than set down on it.
 */
export function stone(): THREE.BufferGeometry {
  const b = new Builder(0.14)
  const top = C(0x8e8c86), side = C(0x6e6c67), low = C(0x46443f)
  // Two irregular rings and a low cap: a rounded, weathered lump rather than a pyramid.
  const N = 7
  const lowRing: number[][] = [], highRing: number[][] = []
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2
    const r = 0.26 + 0.1 * r01(k, 7)
    lowRing.push([Math.cos(a) * r, 0.05 + 0.04 * r01(k, 3), Math.sin(a) * r * 0.8])
    const r2 = r * (0.62 + 0.12 * r01(k, 5))
    highRing.push([Math.cos(a + 0.2) * r2, 0.16 + 0.05 * r01(k, 11), Math.sin(a + 0.2) * r2 * 0.8])
  }
  const cap = [0.02, 0.22, -0.01]
  for (let k = 0; k < N; k++) {
    const p = lowRing[k], q = lowRing[(k + 1) % N], P = highRing[k], Q = highRing[(k + 1) % N]
    b.tri(cap, P, Q, [top, top, top], [0, 0, 0])
    b.tri(p, Q, P, [side, top, top], [0, 0, 0])
    b.tri(p, q, Q, [side, side, top], [0, 0, 0])
    // The skirt, down into the ground.
    const ps = [p[0] * 1.15, -0.06, p[2] * 1.15], qs = [q[0] * 1.15, -0.06, q[2] * 1.15]
    b.tri(p, ps, q, [side, low, side], [0, 0, 0])
    b.tri(q, ps, qs, [side, low, low], [0, 0, 0])
  }
  return b.build()
}

/**
 * A desert succulent: a low rosette of thick pointed leaves in two rings, each leaf folded
 * along its keel so it has a lit face and a shaded face. Dusty sage, flushing toward the
 * plant's colour at the tips.
 */
export function rosette(): THREE.BufferGeometry {
  const b = new Builder(0.04)
  const base = C(0x5e6a32), keel = C(0x8a9450), tip = C(0xffffff)
  const rings = [{ n: 8, len: 0.26, rise: 0.17, w: 0.065, a0: 0 }, { n: 6, len: 0.18, rise: 0.26, w: 0.055, a0: 0.4 }, { n: 4, len: 0.09, rise: 0.3, w: 0.04, a0: 0.9 }]
  for (const r of rings) {
    for (let k = 0; k < r.n; k++) {
      const a = r.a0 + (k / r.n) * Math.PI * 2
      const ox = Math.cos(a), oz = Math.sin(a), sx = -oz, sz = ox
      const len = r.len * (0.85 + 0.3 * r01(k, 11))
      const p = [ox * len, r.rise + 0.02, oz * len]
      const mid = [ox * len * 0.45, r.rise * 0.8, oz * len * 0.45]
      const ridge = [mid[0], mid[1] + 0.03, mid[2]]
      const l = [mid[0] + sx * r.w, mid[1], mid[2] + sz * r.w], rr = [mid[0] - sx * r.w, mid[1], mid[2] - sz * r.w]
      // Tint only toward the tip: green leaves with red-flushed points.
      b.v(0, 0.02, 0, base, 0); b.v(l[0], l[1], l[2], base, 0.1); b.v(ridge[0], ridge[1], ridge[2], keel, 0.1)
      b.v(0, 0.02, 0, base, 0); b.v(ridge[0], ridge[1], ridge[2], keel, 0.1); b.v(rr[0], rr[1], rr[2], base, 0.1)
      b.v(l[0], l[1], l[2], base, 0.1); b.v(p[0], p[1], p[2], tip, 0.2, 0.8); b.v(ridge[0], ridge[1], ridge[2], keel, 0.1)
      b.v(ridge[0], ridge[1], ridge[2], keel, 0.1); b.v(p[0], p[1], p[2], tip, 0.2, 0.8); b.v(rr[0], rr[1], rr[2], base, 0.1)
    }
  }
  return b.build()
}

/**
 * The alien bloom of the volcanic worlds: a dark stalk the colour of the soil, a small
 * glowing heart, and a crown of long arms that arch out and droop like a sea anemone's.
 * Each arm is folded along its spine so it has a lit and a shaded side, deep at the base,
 * the plant's colour along its length and lit from within only at the tip.
 */
export function anemone(): THREE.BufferGeometry {
  const b = new Builder(0.2)
  const soil = C(0x2a1a18)
  const deep = C(0x303030), body = C(0x8a8a8a), tip = C(0xe0e0e0)
  // A short, thick stalk: the crown sits low, so the plant reads as a bloom on the ground,
  // never as a little palm.
  const H = 0.22
  stem(b, [[0, 0, 0], [0.03, H * 0.5, 0.01], [-0.02, H, 0.03]], 0.055, 0.04, soil, soil, { earth: 0.75, s1: 0.6 })
  const hx = -0.02, hz = 0.03
  // The heart: a small glowing bud where the arms meet.
  for (const [wx, wz] of [[1, 0], [0, 1]]) {
    const w = 0.05
    b.tri([hx - wx * w, H - 0.02, hz - wz * w], [hx + wx * w, H - 0.02, hz + wz * w], [hx, H + 0.09, hz], [body, body, tip], [0.6, 0.6, 0.6], 1, [0.6, 0.6, 1])
  }
  const ARMS = 8
  const SEG = 4
  for (let k = 0; k < ARMS; k++) {
    const a = (k / ARMS) * Math.PI * 2 + 0.3 + 0.25 * r01(k, 17)
    const ox = Math.cos(a), oz = Math.sin(a), sx = -oz, sz = ox
    const len = 0.42 + 0.14 * r01(k, 23)
    const pts: number[][] = []
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG
      const r = len * (t * 0.9 + 0.1 * t * t)
      // Up a little, then curling down to rest near the ground.
      const y = Math.max(0.03, H + 0.14 * Math.sin(t * 2.6) - 0.3 * t * t)
      pts.push([hx + ox * r, y, hz + oz * r])
    }
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG, t1 = (i + 1) / SEG
      const w0 = 0.09 * (1 - t0 * 0.8), w1 = 0.09 * (1 - t1 * 0.8)
      const p = pts[i], q = pts[i + 1]
      const c0 = t0 < 0.3 ? deep : body, c1 = t1 > 0.9 ? tip : body
      // Glow only in the last stretch of the arm.
      const g0 = t0 > 0.6 ? 0.6 : 0, g1 = t1 > 0.6 ? 1 : 0
      const s0 = 0.6 + 0.4 * t0, s1 = 0.6 + 0.4 * t1
      // Folded along the spine: the spine is raised, the edges hang below it.
      const k0 = 0.022 * (1 - t0), k1 = 0.022 * (1 - t1)
      const pl = [p[0] - sx * w0, p[1] - k0, p[2] - sz * w0], pr = [p[0] + sx * w0, p[1] - k0, p[2] + sz * w0]
      const ql = [q[0] - sx * w1, q[1] - k1, q[2] - sz * w1], qr = [q[0] + sx * w1, q[1] - k1, q[2] + sz * w1]
      b.tri(pl, p, ql, [c0, c0, c1], [s0, s0, s1], 1, [g0, g0, g1])
      b.tri(p, q, ql, [c0, c1, c1], [s0, s1, s1], 1, [g0, g1, g1])
      b.tri(p, pr, q, [c0, c0, c1], [s0, s0, s1], 1, [g0, g0, g1])
      b.tri(pr, qr, q, [c0, c1, c1], [s0, s1, s1], 1, [g0, g1, g1])
    }
  }
  return b.build()
}

/**
 * A clump of tapering tubes of different heights, like tube worms on a sea vent: soil
 * coloured along their length, the plant's colour toward the top, and a glowing rim.
 */
export function tubes(): THREE.BufferGeometry {
  const b = new Builder(0.25)
  const soil = C(0x2a1a18), lip = C(0xffffff)
  for (let k = 0; k < 6; k++) {
    const a = k * 2.4 + 0.5
    const r = 0.05 + 0.12 * r01(k, 29)
    const h = 0.26 + 0.6 * r01(k, 43)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const lean = 0.2
    const tip = [x + Math.cos(a) * h * lean, h, z + Math.sin(a) * h * lean]
    const mid = [x + Math.cos(a) * h * lean * 0.45, h * 0.6, z + Math.sin(a) * h * lean * 0.45]
    stem(b, [[x, 0, z], mid, tip], 0.045, 0.03, soil, C(0x8a8a8a), { tint: 1, earth: 0.5 })
    // The mouth: a flared rim, lit from inside.
    const R = 0.05
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + 0.4, a1 = ((i + 1) / 4) * Math.PI * 2 + 0.4
      b.tri([tip[0], tip[1] - 0.02, tip[2]], [tip[0] + Math.cos(a0) * R, tip[1] + 0.02, tip[2] + Math.sin(a0) * R],
        [tip[0] + Math.cos(a1) * R, tip[1] + 0.02, tip[2] + Math.sin(a1) * R], [lip, lip, lip], [1, 1, 1], 1, [1, 0.8, 0.8])
    }
  }
  return b.build()
}

/**
 * Reeds: a stand of tall, narrow, bending leaves with a few seed spikes among them, like
 * bulrushes at the edge of a marsh. Leaves take the plant's tint.
 */
export function reeds(): THREE.BufferGeometry {
  const b = new Builder(0.25)
  const root = C(0x2a3014), tip = C(0x8a9a4a), spike = C(0x4a2e18)
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4 + 0.2
    const ox = Math.cos(a), oz = Math.sin(a)
    const h = 0.9 + 0.5 * r01(i, 37)
    const out = 0.03 + 0.08 * r01(i, 13)
    const lean = 0.1 + 0.18 * r01(i, 59)
    const p0 = [ox * out, 0, oz * out]
    const p1 = [ox * (out + h * lean * 0.3), h * 0.55, oz * (out + h * lean * 0.3)]
    const p2 = [ox * (out + h * lean), h, oz * (out + h * lean)]
    ribbon(b, p0, p1, 0.022, 0.016, root, root.clone().lerp(tip, 0.6), 0, 0.5, { tint: 1 })
    ribbon(b, p1, p2, 0.016, 0.002, root.clone().lerp(tip, 0.6), tip, 0.5, 1, { tint: 1 })
  }
  // Three seed spikes standing straight among the leaves.
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 1
    const x = Math.cos(a) * 0.06, z = Math.sin(a) * 0.06
    const h = 1.1 + 0.25 * r01(i, 17)
    stem(b, [[x, 0, z], [x + 0.02, h - 0.2, z]], 0.006, 0.005, root, root, { s1: 0.8 })
    stem(b, [[x + 0.02, h - 0.2, z], [x + 0.025, h, z]], 0.022, 0.018, spike, spike, { s0: 0.8, s1: 0.9 })
  }
  return b.build()
}

/**
 * Glowcaps: a cluster of short soil-coloured stalks, each topped with a flat cap that is lit
 * from beneath in the plant's colour. Faint by day, the swamp's lanterns at night.
 */
export function glowcaps(): THREE.BufferGeometry {
  const b = new Builder(0.06)
  const soil = C(0x2a2418), cap = C(0xffffff), rim = C(0xb0b0b0)
  for (let i = 0; i < 6; i++) {
    const a = i * 2.4 + 0.3, r = 0.04 + 0.12 * r01(i, 29)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const h = 0.07 + 0.16 * r01(i, 41)
    stem(b, [[x, 0, z], [x + 0.01, h, z]], 0.008, 0.006, soil, soil, { earth: 0.6, s1: 0.3 })
    const R = 0.03 + 0.03 * r01(i, 7)
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI * 2, a1 = ((k + 1) / 5) * Math.PI * 2
      b.tri([x + 0.01, h + 0.012, z], [x + 0.01 + Math.cos(a0) * R, h - 0.006, z + Math.sin(a0) * R],
        [x + 0.01 + Math.cos(a1) * R, h - 0.006, z + Math.sin(a1) * R], [cap, rim, rim], [0.3, 0.3, 0.3], 1, [1, 0.7, 0.7])
    }
  }
  return b.build()
}

// ---------------------------------------------------------------------------------------
// What grows where
// ---------------------------------------------------------------------------------------

export const unit = (h: number, shift: number) => ((h >>> shift) & 1023) / 1023

export function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const tintColour = new THREE.Color()

/**
 * Sets the plant's tint to `hex`, its brightness varied by up to `vary` either way. The
 * tint is converted to linear light like every other colour the renderer sees: raw sRGB
 * numbers here would come out bleached, oranges as peach and violets as lilac.
 */
export function setTint(out: Plant, hex: number, vary: number, h: number): void {
  const k = 1 - vary / 2 + vary * unit(h, 12)
  tintColour.setHex(hex)
  out.r = tintColour.r * k
  out.g = tintColour.g * k
  out.b = tintColour.b * k
}

/**
 * Grass grows in clumps: dense at a clump's centre, thinning to bare gaps between clumps.
 * Blades in a clump share a height and a shade and lean out from its centre. Returns the
 * clump's height factor, or 0 where this cell falls in a gap.
 */
function clumped(c: Ground, h: number, out: Plant, gap: number): number {
  if (unit(h, 22) > smooth(gap, gap * 0.35, c.clumpD)) return 0
  const lean = 0.22 * smooth(0.1, gap * 0.8, c.clumpD)
  out.lx = c.outX * lean
  out.lz = c.outZ * lean
  // Taller at the clump's heart, shorter at its rim.
  return (0.7 + 0.6 * c.clump) * (1 - 0.35 * smooth(0, gap, c.clumpD))
}

// One hue family per world, drawn from its ground.
// Alpine: whites, butter yellow and violet from the meadow's own painted drifts, and blue.
const ALPINE_DAISIES = [0xffffff, 0xfff4dc, 0xffd23a, 0xb06ad0, 0xffffff]
const ALPINE_CUSHIONS = [0xd86ab8, 0xb06ad0, 0xffffff, 0xe890c8]
const LUPINS = [0x4a5cf0, 0x7a52e0, 0x5a7cf8, 0x9a5ae0]
// Desert: sunset colours from the sand and sandstone.
const DESERT_BLOOMS = [0xff8a2a, 0xff5a4a, 0xffd04a, 0xf06a8a]
// Volcanic: ember orange, deep red and magenta. CYAN is the one cold accent, about one
// plant in twenty.
const EMBERS = [0xf05a14, 0xc41c12, 0xb8185c, 0xe03a16, 0x9c1048]
const CYAN = 0x26e8ff

function alpineLayers(treeLine: number): LayerSpec[] {
  return [
    {
      // Meadow grass in clumps: tall and lush in some regions, short turf in others, with
      // sun-dried gold patches and bare earth showing between clumps.
      n: 176, spacing: 0.8, shade: true, geometry: tuft(7, 0.42, 0x2a5418, 0xa6d060, { width: 0.03 }),
      grow(c, h, out) {
        if (c.y > treeLine) return
        const thin = 0.5 * smooth(treeLine * 0.6, treeLine, c.y)
        if (unit(h, 2) < thin) return
        const k = clumped(c, h, out, 2.1 - 0.5 * thin)
        if (!k) return
        const tall = Math.max(smooth(0.35, 0.7, c.region), 0.7 * c.flow)
        out.scale = (0.5 + 1.3 * tall) * k
        const dry = smooth(0.62, 0.85, c.patch) * (1 - tall * 0.5) * (1 - c.flow)
        const deep = smooth(0.45, 0.2, c.patch) + 0.4 * c.flow
        const v = 0.85 + 0.3 * c.clump
        out.r = (1 + 0.6 * dry - 0.25 * deep) * v
        out.g = (1 + 0.1 * dry - 0.1 * deep) * v
        out.b = (1 - 0.4 * dry + 0.1 * deep) * v
      },
    },
    {
      // Seed-head grasses standing above the turf where the grass is tall.
      n: 80, spacing: 1.6, geometry: seedGrass(4, 0.62, 0x8a8a4a, 0xd8d0a0),
      grow(c, h, out) {
        if (c.y > treeLine * 0.85) return
        if (unit(h, 22) > 0.55 * smooth(0.45, 0.7, c.region) * smooth(0.3, 0.6, c.patch)) return
        out.scale = 0.8 + 0.5 * unit(h, 2)
        setTint(out, unit(h, 4) < 0.5 ? 0xe8dcb0 : 0xc8a078, 0.15, h)
      },
    },
    {
      // Daisies in drifts, each drift mostly one colour.
      n: 80, spacing: 1.6, geometry: daisy(0.42, 9, 0.11, 0x3a6a26, 0xf0b828),
      grow(c, h, out) {
        if (c.y > treeLine) return
        const band = Math.floor(c.patch * 9)
        const drift = band % 2 === 1 ? 0.85 : 0.08
        if (unit(h, 22) > drift) return
        out.scale = 0.75 + 0.7 * unit(h, 2)
        const pick = unit(h, 4) < 0.12 ? (h >>> 6) % ALPINE_DAISIES.length : band % ALPINE_DAISIES.length
        setTint(out, ALPINE_DAISIES[pick], 0.08, h)
      },
    },
    {
      // Cushion flowers, low and tight, where the grass thins: up toward the tree line.
      n: 56, spacing: 1.6, geometry: cushion(),
      grow(c, h, out) {
        if (c.y > treeLine * 1.15) return
        const high = smooth(treeLine * 0.45, treeLine * 0.95, c.y)
        if (unit(h, 22) > 0.03 + 0.35 * high * smooth(0.35, 0.6, c.patch)) return
        out.scale = 0.8 + 0.9 * unit(h, 2)
        setTint(out, ALPINE_CUSHIONS[Math.floor(c.region * 7 + unit(h, 6) * 1.5) % ALPINE_CUSHIONS.length], 0.1, h)
      },
    },
    {
      // Lupins: tall spikes in stands where the grass is tall, thickest by the water.
      n: 64, spacing: 3.2, geometry: lupin(),
      grow(c, h, out) {
        if (c.y > treeLine * 0.8) return
        const stand = Math.max(smooth(0.5, 0.75, c.region) * smooth(0.25, 0.5, c.patch), 0.8 * c.flow)
        if (unit(h, 22) > 0.8 * stand) return
        out.scale = 0.9 + 0.8 * unit(h, 2)
        setTint(out, LUPINS[(Math.floor(c.region * 11) + ((h >>> 6) % 2)) % LUPINS.length], 0.12, h)
      },
    },
    {
      // Stones, scattered and in small fields, more of them toward the heights.
      n: 48, spacing: 3.2, geometry: stone(),
      grow(c, h, out) {
        const high = smooth(treeLine * 0.4, treeLine * 1.3, c.y)
        if (unit(h, 22) > 0.04 + 0.3 * smooth(0.7, 0.9, c.patch) + 0.3 * high) return
        out.scale = 0.5 + 2.2 * unit(h, 2) * unit(h, 12)
        setTint(out, 0xe0e0dc, 0.3, h)
      },
    },
  ]
}

function desertLayers(): LayerSpec[] {
  return [
    {
      // Dry grass in clumps with bare sand between, greener by the water.
      n: 176, spacing: 0.8, shade: true, geometry: tuft(7, 0.5, 0x8a6a2a, 0xf0dc9a),
      grow(c, h, out) {
        if (c.rock > 0.5) return
        if (unit(h, 2) > 0.25 + 0.75 * Math.max(smooth(0.5, 0.72, c.patch), c.flow)) return
        const k = clumped(c, h, out, 1.7)
        if (!k) return
        out.scale = (0.6 + 0.6 * unit(h, 12)) * k * (1 + 0.4 * c.flow)
        const v = 0.85 + 0.3 * c.clump
        out.r = v * (1 - 0.35 * c.flow); out.g = v; out.b = v * (1 - 0.2 * c.flow)
      },
    },
    {
      // Foxtail seed heads standing out of the bigger clumps.
      n: 80, spacing: 1.6, geometry: seedGrass(5, 0.55, 0xa08048, 0xf4e6b8, 0.2),
      grow(c, h, out) {
        if (c.rock > 0.5) return
        if (unit(h, 22) > 0.4 * smooth(0.58, 0.78, c.patch)) return
        out.scale = 0.75 + 0.6 * unit(h, 2)
        setTint(out, unit(h, 4) < 0.6 ? 0xf8ecc8 : 0xe0b890, 0.15, h)
      },
    },
    {
      // Succulent rosettes, alone or in little colonies on firmer, rockier ground.
      n: 80, spacing: 1.6, geometry: rosette(),
      grow(c, h, out) {
        if (unit(h, 22) > 0.03 + 0.25 * smooth(0.3, 0.55, c.region) * smooth(0.45, 0.25, c.patch) + 0.15 * c.rock) return
        out.scale = 0.7 + 1.0 * unit(h, 2)
        setTint(out, unit(h, 4) < 0.5 ? 0xd85a3a : 0xc8a050, 0.15, h)
      },
    },
    {
      n: 80, spacing: 1.6, geometry: daisy(0.3, 7, 0.1, 0x7a7a3a, 0x5a2a10),
      grow(c, h, out) {
        if (c.rock > 0.5) return
        if (unit(h, 22) > 0.22 * Math.max(smooth(0.6, 0.8, c.patch), c.flow)) return
        out.scale = 0.75 + 0.6 * unit(h, 2)
        setTint(out, DESERT_BLOOMS[Math.floor(c.region * 9 + unit(h, 4)) % DESERT_BLOOMS.length], 0.1, h)
      },
    },
    {
      // Pebbles on the stony ground.
      n: 48, spacing: 3.2, geometry: stone(),
      grow(c, h, out) {
        if (unit(h, 22) > 0.03 + 0.4 * c.rock + 0.15 * smooth(0.75, 0.9, c.patch)) return
        out.scale = 0.4 + 1.4 * unit(h, 2) * unit(h, 12)
        setTint(out, 0xffd8a8, 0.25, h)
      },
    },
  ]
}

// Obsidian: black glass with magenta seams, so its plants lean magenta and violet with
// ember red, and the same rare cold accent.
const SEAMS = [0xd8206e, 0x9c1048, 0xb030c0, 0xc41c12, 0x7a18a8]

/** One of the palette's colours for the plant, or one time in twenty the cold accent. */
function ember(c: Ground, h: number, out: Plant, vary: number, palette: number[]): void {
  if (unit(h, 4) < 0.05) { setTint(out, CYAN, vary, h); return }
  setTint(out, palette[(Math.floor(c.region * 13) + ((h >>> 6) % 2)) % palette.length], vary, h)
}

function volcanicLayers(palette: number[]): LayerSpec[] {
  return [
    {
      // Dark blades with ember tips, in clumps, curling over. Thickest near the lava.
      n: 176, spacing: 0.8, shade: true, geometry: tuft(6, 0.5, 0x1a0e10, 0xd0402a, { glow: 0.45, curl: 0.25, width: 0.036 }),
      grow(c, h, out) {
        if (c.rock > 0.85 && c.flow < 0.3) return
        const fed = Math.max(smooth(0.5, 0.75, c.patch) * 0.7, c.flow)
        if (unit(h, 2) > 0.15 + 0.85 * fed) return
        const k = clumped(c, h, out, 1.9)
        if (!k) return
        out.scale = (0.55 + 0.7 * fed) * k
        const v = 0.8 + 0.4 * c.clump
        out.r = v; out.g = v * (0.85 + 0.3 * unit(h, 12)); out.b = v
      },
    },
    {
      // Anemones, in groves that share a colour, densest along the lava.
      n: 48, spacing: 3.2, geometry: anemone(),
      grow(c, h, out) {
        // Bare rock grows nothing, unless lava runs close by and feeds it.
        if (c.rock > 0.9 && c.flow < 0.3) return
        if (unit(h, 22) > 0.03 + 0.4 * smooth(0.62, 0.8, c.patch) + 0.6 * c.flow) return
        out.scale = (0.55 + 0.6 * unit(h, 2)) * (1 + 0.35 * c.flow)
        ember(c, h, out, 0.12, palette)
      },
    },
    {
      // Tube clumps, where the anemones are not, and in rings round the pools.
      n: 64, spacing: 3.2, geometry: tubes(),
      grow(c, h, out) {
        // Bare rock grows nothing, unless lava runs close by and feeds it.
        if (c.rock > 0.9 && c.flow < 0.3) return
        if (unit(h, 22) > 0.025 + 0.35 * smooth(0.42, 0.22, c.patch) + 0.4 * c.flow) return
        out.scale = (0.7 + 1.0 * unit(h, 2)) * (1 + 0.3 * c.flow)
        ember(c, h, out, 0.12, palette)
      },
    },
  ]
}

// Archipelago: coral, white and sunny yellow blooms on bright green.
const ISLE_BLOOMS = [0xffffff, 0xff7a5a, 0xffd23a, 0xff5a8a, 0xffffff]

function archipelagoLayers(): LayerSpec[] {
  return [
    {
      // Short lush turf in clumps, greenest inland, sparse and salt-bleached at the shore.
      n: 176, spacing: 0.8, shade: true, geometry: tuft(7, 0.4, 0x2e6a1c, 0xb8e070, { width: 0.034 }),
      grow(c, h, out) {
        const k = clumped(c, h, out, 2.4)
        if (!k) return
        const salt = smooth(0.6, 1, c.flow) * smooth(0.6, 0.3, c.region)
        out.scale = (0.9 + 0.7 * smooth(0.3, 0.7, c.region)) * k * (1 - 0.3 * salt)
        const v = 0.85 + 0.3 * c.clump
        out.r = v * (1 + 0.5 * salt); out.g = v; out.b = v * (1 - 0.3 * salt)
      },
    },
    {
      // Sea oats: pale seed heads leaning in the wind, in a band along the shore.
      n: 80, spacing: 1.6, geometry: seedGrass(5, 0.7, 0x9a9a5a, 0xf0e2b0, 0.2),
      grow(c, h, out) {
        if (unit(h, 22) > 0.03 + 0.6 * smooth(0.5, 0.9, c.flow)) return
        out.scale = 0.8 + 0.5 * unit(h, 2)
        setTint(out, 0xf4e8c0, 0.15, h)
      },
    },
    {
      // Tropical blooms in drifts.
      n: 80, spacing: 1.6, geometry: daisy(0.32, 6, 0.12, 0x2e6a1c, 0xffd23a),
      grow(c, h, out) {
        const band = Math.floor(c.patch * 9)
        if (unit(h, 22) > (band % 2 === 1 ? 0.6 : 0.05)) return
        out.scale = 0.8 + 0.6 * unit(h, 2)
        setTint(out, ISLE_BLOOMS[(band + (unit(h, 4) < 0.15 ? 1 : 0)) % ISLE_BLOOMS.length], 0.08, h)
      },
    },
  ]
}

function swampLayers(): LayerSpec[] {
  return [
    {
      // Low olive sedge in clumps over the mud.
      n: 176, spacing: 0.8, shade: true, geometry: tuft(6, 0.36, 0x262a10, 0x8a9440, { width: 0.026, curl: 0.1 }),
      grow(c, h, out) {
        if (unit(h, 2) > 0.6 + 0.4 * Math.max(smooth(0.4, 0.7, c.patch), c.flow)) return
        const k = clumped(c, h, out, 2.2)
        if (!k) return
        out.scale = (0.9 + 0.6 * c.flow) * k
        const v = 0.8 + 0.4 * c.clump
        out.r = v; out.g = v; out.b = v * 0.9
      },
    },
    {
      // Reed beds, thickest along the water.
      n: 80, spacing: 1.6, geometry: reeds(),
      grow(c, h, out) {
        if (unit(h, 22) > 0.06 + 0.85 * smooth(0.2, 0.8, c.flow) + 0.35 * smooth(0.55, 0.8, c.patch)) return
        out.scale = 0.75 + 0.6 * unit(h, 2)
        setTint(out, unit(h, 4) < 0.3 ? 0xc8b060 : 0xffffff, 0.2, h)
      },
    },
    {
      // Glowcaps in the damp hollows: teal like the sea, now and then a sickly green.
      n: 80, spacing: 1.6, geometry: glowcaps(),
      grow(c, h, out) {
        if (unit(h, 22) > 0.05 + 0.5 * smooth(0.5, 0.25, c.patch) * (0.5 + 0.5 * c.flow)) return
        out.scale = 1.5 + 1.2 * unit(h, 2)
        setTint(out, unit(h, 4) < 0.2 ? 0x9aff4a : 0x2ae8c8, 0.15, h)
      },
    },
  ]
}

/** Nothing grows: ice and the moon. */
const BARE: Flora = { layers: () => [], shade: 0xffffff }

/**
 * What grows on each planet, by its look (terrain.look: see the list in settings.ts). A
 * look missing here grows nothing.
 */
export const FLORA: Record<number, Flora> = {
  0: { layers: () => volcanicLayers(EMBERS), shade: 0x4a2a2a },
  1: { layers: () => desertLayers(), shade: 0xa08a68 },
  2: { layers: (treeLine) => alpineLayers(treeLine), shade: 0x7a9060 },
  3: { layers: () => archipelagoLayers(), shade: 0x6a9058 },
  4: BARE,
  5: { layers: () => volcanicLayers(SEAMS), shade: 0x605a70 },
  6: { layers: () => desertLayers(), shade: 0x8a6050 },
  7: BARE,
  8: { layers: () => swampLayers(), shade: 0x6a6a48 },
}
