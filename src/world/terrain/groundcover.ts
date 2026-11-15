/**
 * Ground cover: grass and small flowers round the camera, different on each kind of world.
 *
 *  - alpine:   lush green grass with drifts of white, yellow, violet and red flowers
 *  - desert:   clumps of dry golden grass with a few bright desert blooms
 *  - volcanic: sparse black and crimson blades with ember tips, and alien flowers: a curled
 *              violet stalk carrying a glowing bulb and drifting spores, pulsing in slow waves
 *
 * Nothing here is large: no trees, bushes or cacti.
 *
 * How it is drawn. Each layer is one mesh of N x N instances laid on a grid of cells that
 * scrolls with the camera, like a treadmill: a slot always shows the cell nearest the camera
 * whose index matches it, so when the camera moves only the rows that scrolled are
 * recomputed. What grows in a cell is decided by an integer hash of the cell, so it is the
 * same for every player and repeats exactly at the world's edge. Blades are placed, turned,
 * swayed by the wind and faded out with distance in the vertex shader. Purely visual: no
 * collision, and vehicles drive through it.
 */
import * as THREE from 'three/webgpu'
import {
  attribute, cameraPosition, cameraViewMatrix, cos, float, mix, normalize, sin, smoothstep, time, uniform, vec2, vec3,
} from 'three/tsl'
import { defineParam, worldLavaAltitude } from '../../../shared/params'
import { wrapCoord } from '../../../shared/wrap'
import type { System } from '../../core/Game'
import { lavaSurfaceAt } from './lava'
import { phash2, pperlin } from './noise'
import type { HeightSampler } from './sampler'
import { KIND_ALPINE, KIND_DESERT } from './settings'

export const groundCover = defineParam({
  id: 'terrain.groundCover', label: 'Grass and flowers', group: 'Terrain', scope: 'world', default: 1, min: 0, max: 1, step: 0.05,
})

/** Nothing grows within this height of the sea level: the largest wave crest plus 0.3 m. */
const SHORE_MARGIN = 1.8

const UP = new THREE.Vector3()

interface Plant {
  /** Height multiplier; 0 means nothing grows in this cell. */
  scale: number
  r: number
  g: number
  b: number
}

interface LayerSpec {
  /** Slots per side. */
  n: number
  /** Metres between cells. Must divide every tile size. */
  spacing: number
  geometry: THREE.BufferGeometry
  /** What grows in a cell, given the ground there. */
  grow(c: Ground, h: number, out: Plant): void
}

/** The ground at one cell, gathered once and handed to `grow`. */
interface Ground {
  x: number
  z: number
  y: number
  /** 0..1 patch noise, for drifts and clumps. */
  patch: number
  /** 0..1 broader noise, for regions: tall or short grass, lush or dry. */
  region: number
  /** 0..1 how volcanic (rocky) the ground is. */
  rock: number
}

// ---------------------------------------------------------------------------------------
// Geometry: small procedural meshes with per-vertex colour, sway (0 at the root, 1 at the
// tip), tint (how much of the plant's own colour the vertex takes) and glow.
// ---------------------------------------------------------------------------------------

class Builder {
  pos: number[] = []
  col: number[] = []
  sway: number[] = []
  tint: number[] = []
  glow: number[] = []
  v(x: number, y: number, z: number, c: THREE.Color, sway: number, tint = 0, glow = 0): void {
    this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.sway.push(sway); this.tint.push(tint); this.glow.push(glow)
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1))
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 1))
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1))
    return g
  }
}

/** A tuft of tapered blades leaning outward. One triangle per blade. */
function tuft(blades: number, height: number, root: number, tip: number, tipGlow = 0, curl = 0, width = 0.028): THREE.BufferGeometry {
  const b = new Builder()
  const cr = new THREE.Color(root)
  const ct = new THREE.Color(tip)
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7
    const out = 0.06 + 0.16 * ((i * 37) % 10) / 10
    const h = height * (0.65 + 0.35 * ((i * 53) % 10) / 10)
    const cx = Math.cos(a) * out, cz = Math.sin(a) * out
    // Blade faces sideways to its lean, so the tuft has volume from every direction.
    const wx = -Math.sin(a) * width, wz = Math.cos(a) * width
    const lean = 0.22 + curl
    b.v(cx - wx, 0, cz - wz, cr, 0)
    b.v(cx + wx, 0, cz + wz, cr, 0)
    b.v(cx + Math.cos(a) * h * lean, h, cz + Math.sin(a) * h * lean, ct, 1, 0, tipGlow)
  }
  return b.build()
}

/** A thin upright ribbon from (x0, y0, z0) to (x1, y1, z1), two triangles. */
function ribbon(b: Builder, p0: number[], p1: number[], w0: number, w1: number, c0: THREE.Color, c1: THREE.Color, s0: number, s1: number, glow = 0): void {
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2]
  const l = Math.hypot(dx, dz)
  // Width runs across the ribbon's own lean, or along x when it stands straight up.
  const wx = l > 1e-4 ? -dz / l : 1, wz = l > 1e-4 ? dx / l : 0
  const a = [p0[0] - wx * w0, p0[1], p0[2] - wz * w0], c = [p0[0] + wx * w0, p0[1], p0[2] + wz * w0]
  const d = [p1[0] - wx * w1, p1[1], p1[2] - wz * w1], e = [p1[0] + wx * w1, p1[1], p1[2] + wz * w1]
  b.v(a[0], a[1], a[2], c0, s0, 0, glow); b.v(c[0], c[1], c[2], c0, s0, 0, glow); b.v(d[0], d[1], d[2], c1, s1, 0, glow)
  b.v(c[0], c[1], c[2], c0, s0, 0, glow); b.v(e[0], e[1], e[2], c1, s1, 0, glow); b.v(d[0], d[1], d[2], c1, s1, 0, glow)
}

/** A daisy-like flower: a stem, a ring of petals in the plant's colour, a bright centre. */
function daisy(height: number, petals: number, radius: number, stem: number, centre: number): THREE.BufferGeometry {
  const b = new Builder()
  const cs = new THREE.Color(stem)
  const cc = new THREE.Color(centre)
  const white = new THREE.Color(0xffffff)
  ribbon(b, [0, 0, 0], [0.03, height, 0.02], 0.014, 0.01, cs, cs, 0, 1)
  ribbon(b, [0, 0, 0], [0.02, height, 0.03], 0.014, 0.01, cs, cs, 0, 1)
  const hx = 0.03, hz = 0.02
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * Math.PI * 2, a1 = ((i + 0.72) / petals) * Math.PI * 2, am = (a0 + a1) / 2
    // Petals tilt up a little, like a shallow cup, so they read from the side.
    b.v(hx, height, hz, white, 1, 1)
    b.v(hx + Math.cos(a0) * radius * 0.45, height + 0.02, hz + Math.sin(a0) * radius * 0.45, white, 1, 1)
    b.v(hx + Math.cos(am) * radius, height + 0.05, hz + Math.sin(am) * radius, white, 1, 1)
    b.v(hx, height, hz, white, 1, 1)
    b.v(hx + Math.cos(am) * radius, height + 0.05, hz + Math.sin(am) * radius, white, 1, 1)
    b.v(hx + Math.cos(a1) * radius * 0.45, height + 0.02, hz + Math.sin(a1) * radius * 0.45, white, 1, 1)
  }
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2
    b.v(hx, height + 0.035, hz, cc, 1)
    b.v(hx + Math.cos(a0) * radius * 0.3, height + 0.025, hz + Math.sin(a0) * radius * 0.3, cc, 1)
    b.v(hx + Math.cos(a1) * radius * 0.3, height + 0.025, hz + Math.sin(a1) * radius * 0.3, cc, 1)
  }
  return b.build()
}

/** Two ribbons crossed at right angles along a path: a stem with volume from every side. */
function stem(b: Builder, pts: number[][], w0: number, w1: number, c0: THREE.Color, c1: THREE.Color, glow0 = 0, glow1 = 0): void {
  const n = pts.length - 1
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n
    const a = w0 + (w1 - w0) * t0, c = w0 + (w1 - w0) * t1
    const ca = c0.clone().lerp(c1, t0), cb = c0.clone().lerp(c1, t1)
    const g = glow0 + (glow1 - glow0) * t1
    const p = pts[i], q = pts[i + 1]
    for (const [wx, wz] of [[1, 0], [0, 1]]) {
      b.v(p[0] - wx * a, p[1], p[2] - wz * a, ca, t0, 0, g); b.v(p[0] + wx * a, p[1], p[2] + wz * a, ca, t0, 0, g); b.v(q[0] - wx * c, q[1], q[2] - wz * c, cb, t1, 0, g)
      b.v(p[0] + wx * a, p[1], p[2] + wz * a, ca, t0, 0, g); b.v(q[0] + wx * c, q[1], q[2] + wz * c, cb, t1, 0, g); b.v(q[0] - wx * c, q[1], q[2] - wz * c, cb, t1, 0, g)
    }
  }
}

/**
 * A lupin: a tall spike with blossoms spiralling up it, largest at the bottom. The
 * blossoms take the plant's colour.
 */
function lupin(): THREE.BufferGeometry {
  const b = new Builder()
  const green = new THREE.Color(0x3d7a2a)
  const white = new THREE.Color(0xffffff)
  const pale = new THREE.Color(0xd8d8ff)
  const H = 0.85
  stem(b, [[0, 0, 0], [0.02, H * 0.5, 0.01], [0.03, H, 0.02]], 0.014, 0.006, green, green)
  for (let k = 0; k < 11; k++) {
    const t = k / 10
    const y = H * (0.36 + 0.62 * t)
    const a = k * 2.4
    const size = 0.085 * (1 - 0.6 * t)
    const cx = 0.03 * (y / H), cz = 0.02 * (y / H)
    const ox = Math.cos(a), oz = Math.sin(a)
    // A small petal standing out from the spike and tipping down.
    b.v(cx, y + size * 0.5, cz, k % 2 ? white : pale, 0.5 + 0.5 * t, 1)
    b.v(cx + ox * size - oz * size * 0.5, y - size * 0.2, cz + oz * size + ox * size * 0.5, white, 0.5 + 0.5 * t, 1)
    b.v(cx + ox * size + oz * size * 0.5, y - size * 0.2, cz + oz * size - ox * size * 0.5, white, 0.5 + 0.5 * t, 1)
  }
  return b.build()
}

/** A stone: a squashed, uneven lump, darker underneath. Its size comes from the plant's scale. */
function stone(): THREE.BufferGeometry {
  const b = new Builder()
  const top = new THREE.Color(0xa6a49c)
  const side = new THREE.Color(0x77756f)
  const low = new THREE.Color(0x4d4b47)
  const ring: number[][] = []
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    const r = 0.26 + 0.1 * (((k * 7) % 5) / 5)
    ring.push([Math.cos(a) * r, 0.06 + 0.05 * ((k * 3) % 4) / 4, Math.sin(a) * r])
  }
  const apex = [0.03, 0.24, -0.02]
  for (let k = 0; k < 6; k++) {
    const p = ring[k], q = ring[(k + 1) % 6]
    b.v(apex[0], apex[1], apex[2], top, 0); b.v(p[0], p[1], p[2], k % 2 ? side : top, 0); b.v(q[0], q[1], q[2], side, 0)
    // The skirt, down into the ground.
    b.v(p[0], p[1], p[2], side, 0); b.v(p[0] * 1.15, -0.08, p[2] * 1.15, low, 0); b.v(q[0], q[1], q[2], side, 0)
    b.v(q[0], q[1], q[2], side, 0); b.v(p[0] * 1.15, -0.08, p[2] * 1.15, low, 0); b.v(q[0] * 1.15, -0.08, q[2] * 1.15, low, 0)
  }
  return b.build()
}

/**
 * The alien bloom of the volcanic worlds: a pale violet stalk carrying a crown of long
 * tapering petals that arch out and droop like the arms of a sea anemone. The petals take
 * the plant's colour and are lit from within, brightest at the heart.
 */
function anemone(): THREE.BufferGeometry {
  const b = new Builder()
  const root = new THREE.Color(0x2a1238)
  const neck = new THREE.Color(0x8a4ab0)
  const white = new THREE.Color(0xffffff)
  const H = 0.9
  stem(b, [[0, 0, 0], [0.05, H * 0.45, 0.02], [-0.02, H, 0.03]], 0.05, 0.03, root, neck, 0, 0.25)
  const hx = -0.02, hz = 0.03
  const ARMS = 6
  for (let k = 0; k < ARMS; k++) {
    const a = (k / ARMS) * Math.PI * 2 + 0.3
    const ox = Math.cos(a), oz = Math.sin(a)
    const len = 0.5 + 0.12 * ((k * 5) % 3)
    // An arm: out and up, then over and down, tapering to a point.
    const pts: number[][] = []
    for (let i = 0; i <= 3; i++) {
      const t = i / 3
      const r = len * (t * 0.9 + 0.1 * t * t)
      const y = H + 0.34 * Math.sin(t * 2.5) - 0.2 * t * t
      pts.push([hx + ox * r, y, hz + oz * r])
    }
    for (let i = 0; i < 3; i++) {
      const w0 = 0.075 * (1 - i / 3.3), w1 = 0.075 * (1 - (i + 1) / 3.3)
      const p = pts[i], q = pts[i + 1]
      const g0 = 1 - 0.25 * (i / 3), g1 = 1 - 0.25 * ((i + 1) / 3)
      // Width runs across the arm, level with the ground.
      const sx = -oz, sz = ox
      b.v(p[0] - sx * w0, p[1], p[2] - sz * w0, white, 0.6 + 0.13 * i, 1, g0)
      b.v(p[0] + sx * w0, p[1], p[2] + sz * w0, white, 0.6 + 0.13 * i, 1, g0)
      b.v(q[0] - sx * w1, q[1], q[2] - sz * w1, white, 0.73 + 0.13 * i, 1, g1)
      b.v(p[0] + sx * w0, p[1], p[2] + sz * w0, white, 0.6 + 0.13 * i, 1, g0)
      b.v(q[0] + sx * w1, q[1], q[2] + sz * w1, white, 0.73 + 0.13 * i, 1, g1)
      b.v(q[0] - sx * w1, q[1], q[2] - sz * w1, white, 0.73 + 0.13 * i, 1, g1)
    }
  }
  return b.build()
}

/**
 * A second alien growth: a clump of tapering tubes of different heights, like tube worms
 * on a sea vent, dark at the root and glowing toward their open tips.
 */
function tubes(): THREE.BufferGeometry {
  const b = new Builder()
  const root = new THREE.Color(0x1a0c18)
  const white = new THREE.Color(0xffffff)
  for (let k = 0; k < 6; k++) {
    const a = k * 2.4 + 0.5
    const r = 0.05 + 0.12 * ((k * 3) % 4) / 4
    const h = 0.28 + 0.62 * (((k * 7) % 6) / 6)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const lean = 0.22
    const tip = [x + Math.cos(a) * h * lean, h, z + Math.sin(a) * h * lean]
    const w0 = 0.05, w1 = 0.028
    for (const [wx, wz] of [[1, 0], [0, 1]]) {
      b.v(x - wx * w0, 0, z - wz * w0, root, 0); b.v(x + wx * w0, 0, z + wz * w0, root, 0); b.v(tip[0] - wx * w1, tip[1], tip[2] - wz * w1, white, 1, 1, 1)
      b.v(x + wx * w0, 0, z + wz * w0, root, 0); b.v(tip[0] + wx * w1, tip[1], tip[2] + wz * w1, white, 1, 1, 1); b.v(tip[0] - wx * w1, tip[1], tip[2] - wz * w1, white, 1, 1, 1)
    }
  }
  return b.build()
}

// ---------------------------------------------------------------------------------------
// What grows where
// ---------------------------------------------------------------------------------------

const unit = (h: number, shift: number) => ((h >>> shift) & 1023) / 1023

function setTint(out: Plant, hex: number, vary: number, h: number): void {
  const k = 1 - vary / 2 + vary * unit(h, 12)
  out.r = ((hex >> 16) & 255) / 255 * k
  out.g = ((hex >> 8) & 255) / 255 * k
  out.b = (hex & 255) / 255 * k
}

const ALPINE_BLOOMS = [0xffffff, 0xffffff, 0xffd84a, 0xffd84a, 0xb07cf0, 0xff5a6e, 0x7ab8ff]
const LUPIN_BLOOMS = [0x5a6cff, 0x9a5cff, 0xff7ac8, 0x4aa8ff, 0xd0a0ff]
const DESERT_BLOOMS = [0xff8a2a, 0xff4f8a, 0xfff06a, 0xff6a3a]
// Cyan, magenta, acid green, violet: lit from inside.
const ALIEN_BLOOMS = [0x22f0ff, 0xff38d8, 0x7dff3a, 0x9a5cff, 0x22f0ff]

function layersFor(kind: number, treeLine: number): LayerSpec[] {
  if (kind === KIND_ALPINE) {
    return [
      {
        // Grass that changes across the land: tall and lush in some regions, short turf in
        // others, with sun-dried gold patches and bare ground showing through.
        n: 176, spacing: 0.8, geometry: tuft(6, 0.42, 0x2c5a1c, 0x9ccc58, 0, 0, 0.032),
        grow(c, h, out) {
          if (c.y > treeLine) return
          const thin = 0.5 * smooth(treeLine * 0.6, treeLine, c.y) + 0.45 * smooth(0.3, 0.12, c.patch)
          if (unit(h, 22) > 0.97 - thin) return
          const tall = smooth(0.35, 0.7, c.region)
          out.scale = (0.45 + 1.35 * tall) * (0.75 + 0.5 * unit(h, 2))
          // Lush deep green, fresh green, or dry gold, by patch.
          const dry = smooth(0.62, 0.85, c.patch) * (1 - tall * 0.5)
          const deep = smooth(0.45, 0.2, c.patch)
          const k = 0.85 + 0.3 * unit(h, 12)
          out.r = (1 + 0.55 * dry - 0.25 * deep) * k
          out.g = (1 + 0.1 * dry - 0.12 * deep) * k
          out.b = (1 - 0.35 * dry + 0.1 * deep) * k
        },
      },
      {
        // Daisies in drifts, each drift mostly one colour.
        n: 80, spacing: 1.6, geometry: daisy(0.5, 7, 0.2, 0x3d7a2a, 0xffc832),
        grow(c, h, out) {
          if (c.y > treeLine) return
          const band = Math.floor(c.patch * 9)
          const drift = band % 2 === 1 ? 0.7 : 0.06
          if (unit(h, 22) > drift) return
          out.scale = 0.7 + 0.9 * unit(h, 2)
          const pick = unit(h, 4) < 0.15 ? (h >>> 6) % ALPINE_BLOOMS.length : band % ALPINE_BLOOMS.length
          setTint(out, ALPINE_BLOOMS[pick], 0.12, h)
        },
      },
      {
        // Lupins: tall spikes in blue, violet and pink, standing in stands where the grass is tall.
        n: 64, spacing: 3.2, geometry: lupin(),
        grow(c, h, out) {
          if (c.y > treeLine * 0.8) return
          if (unit(h, 22) > 0.75 * smooth(0.5, 0.75, c.region) * smooth(0.25, 0.5, c.patch)) return
          out.scale = 0.9 + 0.9 * unit(h, 2)
          setTint(out, LUPIN_BLOOMS[(Math.floor(c.region * 11) + ((h >>> 6) % 2)) % LUPIN_BLOOMS.length], 0.15, h)
        },
      },
      {
        // Stones, scattered and in small fields, more of them toward the heights.
        n: 64, spacing: 3.2, geometry: stone(),
        grow(c, h, out) {
          const high = smooth(treeLine * 0.4, treeLine * 1.3, c.y)
          if (unit(h, 22) > 0.05 + 0.35 * smooth(0.7, 0.9, c.patch) + 0.3 * high) return
          out.scale = 0.5 + 2.2 * unit(h, 2) * unit(h, 12)
          setTint(out, 0xffffff, 0.3, h)
        },
      },
    ]
  }
  if (kind === KIND_DESERT) {
    return [
      {
        n: 176, spacing: 0.8, geometry: tuft(7, 0.5, 0x8a6a2a, 0xf0dc9a),
        grow(c, h, out) {
          if (c.rock > 0.5) return
          // Dry grass grows in clumps with bare sand between.
          if (unit(h, 22) > 0.85 * smooth(0.52, 0.74, c.patch)) return
          out.scale = 0.6 + 0.8 * unit(h, 2)
          setTint(out, 0xffffff, 0.25, h)
        },
      },
      {
        n: 80, spacing: 1.6, geometry: daisy(0.34, 5, 0.17, 0x8a8a3a, 0x5a2a10),
        grow(c, h, out) {
          if (c.rock > 0.5) return
          if (unit(h, 22) > 0.3 * smooth(0.6, 0.8, c.patch)) return
          out.scale = 0.7 + 0.7 * unit(h, 2)
          setTint(out, DESERT_BLOOMS[(h >>> 4) % DESERT_BLOOMS.length], 0.1, h)
        },
      },
    ]
  }
  return [
    {
      // Black blades with ember tips, curling over.
      n: 176, spacing: 0.8, geometry: tuft(5, 0.5, 0x140a0c, 0xb0203a, 0.5, 0.3, 0.04),
      grow(c, h, out) {
        if (c.rock > 0.85) return
        if (unit(h, 22) > 0.55 * smooth(0.5, 0.75, c.patch)) return
        out.scale = 0.6 + 0.9 * unit(h, 2)
        setTint(out, 0xffffff, 0.3, h)
      },
    },
    {
      // Anemone blooms, in groves that share a colour, with the odd one alone.
      n: 64, spacing: 3.2, geometry: anemone(),
      grow(c, h, out) {
        if (c.rock > 0.9) return
        if (unit(h, 22) > 0.04 + 0.6 * smooth(0.6, 0.8, c.patch)) return
        out.scale = 0.55 + 0.75 * unit(h, 2)
        const pick = unit(h, 4) < 0.2 ? (h >>> 6) % ALIEN_BLOOMS.length : Math.floor(c.region * 17) % ALIEN_BLOOMS.length
        setTint(out, ALIEN_BLOOMS[pick], 0.1, h)
      },
    },
    {
      // Tube clumps, where the anemones are not.
      n: 64, spacing: 3.2, geometry: tubes(),
      grow(c, h, out) {
        if (c.rock > 0.9) return
        if (unit(h, 22) > 0.03 + 0.5 * smooth(0.42, 0.22, c.patch)) return
        out.scale = 0.7 + 1.2 * unit(h, 2)
        setTint(out, ALIEN_BLOOMS[(Math.floor(c.region * 13) + 2) % ALIEN_BLOOMS.length], 0.1, h)
      },
    },
  ]
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------------------
// One scrolling layer
// ---------------------------------------------------------------------------------------

/** Camera cells are snapped to blocks this size, so rows are recomputed a few times a second, not every frame. */
const BLOCK = 8

class Layer {
  readonly mesh: THREE.Mesh
  private readonly origin: THREE.InstancedBufferAttribute
  private readonly param: THREE.InstancedBufferAttribute
  private readonly tintAttr: THREE.InstancedBufferAttribute
  private readonly cellX: Int32Array
  private readonly cellZ: Int32Array
  private readonly plant: Plant = { scale: 0, r: 1, g: 1, b: 1 }
  private readonly ground: Ground = { x: 0, z: 0, y: 0, patch: 0, region: 0, rock: 0 }
  private filled = false

  constructor(private readonly spec: LayerSpec, private readonly sampler: HeightSampler, private readonly seed: number) {
    const count = spec.n * spec.n
    const g = spec.geometry as THREE.InstancedBufferGeometry
    g.instanceCount = count
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    this.param = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)
    this.tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    g.setAttribute('aOrigin', this.origin)
    g.setAttribute('aParam', this.param)
    g.setAttribute('aPlantTint', this.tintAttr)
    this.cellX = new Int32Array(count)
    this.cellZ = new Int32Array(count)
    this.mesh = new THREE.Mesh(g, coverMaterial(spec.n * spec.spacing * 0.5))
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
  }

  /** Bring every slot to the cell nearest the camera that it stands for. */
  follow(camX: number, camZ: number, amount: number): void {
    const { n, spacing } = this.spec
    const lowX = Math.floor(camX / spacing / BLOCK) * BLOCK - n / 2
    const lowZ = Math.floor(camZ / spacing / BLOCK) * BLOCK - n / 2
    let changed = false
    for (let j = 0; j < n; j++) {
      const cz = lowZ + ((((j - lowZ) % n) + n) % n)
      for (let i = 0; i < n; i++) {
        const cx = lowX + ((((i - lowX) % n) + n) % n)
        const s = j * n + i
        if (this.filled && this.cellX[s] === cx && this.cellZ[s] === cz) continue
        this.cellX[s] = cx
        this.cellZ[s] = cz
        this.plantCell(s, cx, cz, amount)
        changed = true
      }
    }
    this.filled = true
    if (changed) {
      this.origin.needsUpdate = true
      this.param.needsUpdate = true
      this.tintAttr.needsUpdate = true
    }
  }

  private plantCell(s: number, cx: number, cz: number, amount: number): void {
    const data = this.sampler.data
    const { spacing } = this.spec
    const cells = Math.round(data.size / spacing)
    const h = phash2(cx, cz, this.seed, cells)
    const x = (cx + 0.1 + 0.8 * unit(h, 0)) * spacing
    const z = (cz + 0.1 + 0.8 * unit(h, 10)) * spacing
    const P = this.param.array as Float32Array
    P[s * 2] = unit(h, 5) * Math.PI * 2
    P[s * 2 + 1] = 0
    const O = this.origin.array as Float32Array
    O[s * 3] = x
    O[s * 3 + 2] = z
    if (unit(phash2(cx, cz, this.seed + 3, cells), 3) > amount) return
    const y = this.sampler.heightAt(x, z)
    O[s * 3 + 1] = y
    // Dry, gentle ground, off the roads.
    const wx = wrapCoord(x, data.size), wz = wrapCoord(z, data.size)
    // Clear of the sea by the tallest wave the Water Lab's waves can raise (1.5 m, its
    // WAVE_MAX_AMPLITUDE in shared/water/waves.ts) plus a little.
    if (y < worldLavaAltitude.value + SHORE_MARGIN || lavaSurfaceAt(data.lava, wx, wz, -1e9) > y - 0.3) return
    if (this.sampler.normalAt(x, z, UP).y < 0.84) return
    const half = data.size / 2
    const gi = Math.min(data.resolution - 1, Math.round((wz + half) / data.cell)) * data.resolution +
      Math.min(data.resolution - 1, Math.round((wx + half) / data.cell))
    if (data.roadDist[gi] < 7.5) return
    const g = this.ground
    g.x = x; g.z = z; g.y = y
    g.rock = data.volcanic[gi]
    const pc = Math.max(1, Math.round(data.size * 0.012))
    g.patch = 0.5 + 0.5 * pperlin((x / data.size) * pc, (z / data.size) * pc, this.seed + 9, pc, pc)
    const rc = Math.max(1, Math.round(data.size * 0.004))
    g.region = 0.5 + 0.5 * pperlin((x / data.size) * rc, (z / data.size) * rc, 4242, rc, rc)
    const p = this.plant
    p.scale = 0
    this.spec.grow(g, h, p)
    if (!(p.scale > 0)) return
    P[s * 2 + 1] = p.scale
    const T = this.tintAttr.array as Float32Array
    T[s * 3] = p.r; T[s * 3 + 1] = p.g; T[s * 3 + 2] = p.b
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

/**
 * Turns the glow down as the camera's exposure rises at night, so glowing plants keep their
 * colour instead of burning out to white. Set each frame by GroundCover.
 */
const glowDim = uniform(1)

/** The shared material: placement, wind and fade in the vertex stage; colour and glow after. */
function coverMaterial(reach: number): THREE.MeshStandardNodeMaterial {
  const origin = attribute<'vec3'>('aOrigin', 'vec3')
  const param = attribute<'vec2'>('aParam', 'vec2')
  const plantTint = attribute<'vec3'>('aPlantTint', 'vec3')
  const local = attribute<'vec3'>('position', 'vec3')
  const sway = attribute<'float'>('aSway', 'float')
  const baseColor = attribute<'vec3'>('color', 'vec3')
  const tintMix = attribute<'float'>('aTint', 'float')
  const glow = attribute<'float'>('aGlow', 'float')

  const c = cos(param.x)
  const s = sin(param.x)
  // Fade out toward the edge of the treadmill, so plants grow in as you approach.
  const dist = vec2(origin.x, origin.z).sub(vec2(cameraPosition.x, cameraPosition.z)).length()
  const size = param.y.mul(smoothstep(reach, reach * 0.55, dist))
  const turned = vec3(local.x.mul(c).add(local.z.mul(s)), local.y, local.z.mul(c).sub(local.x.mul(s))).mul(size)
  // Wind: a slow gust front crossing the world plus each plant's own flutter, bending the
  // tips and leaving the roots still. Spores (sway above 1) drift and bob instead.
  const tipness = sway.min(1)
  const gust = sin(origin.x.mul(0.07).add(origin.z.mul(0.05)).add(time.mul(1.3))).mul(0.5).add(0.5)
  const flutter = sin(time.mul(2.6).add(origin.x.mul(1.7)).add(origin.z.mul(2.3)))
  const bend = tipness.mul(tipness).mul(size).mul(gust.mul(0.16).add(flutter.mul(0.035)))
  const drifting = smoothstep(1.5, 2, sway)
  const bob = sin(time.mul(1.1).add(sway.mul(2.4)).add(origin.x)).mul(0.07).mul(drifting).mul(size)
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
  material.positionNode = origin.add(turned).add(vec3(bend, bob, bend.mul(0.6)))
  // Lit as if facing up: soft, even light with no dark backs to the blades.
  material.normalNode = normalize(cameraViewMatrix.transformDirection(vec3(0, 1, 0)))
  const col = baseColor.mul(mix(vec3(1), plantTint, tintMix))
  material.colorNode = col
  // Glow pulses in slow waves that travel across the ground, so a grove breathes together.
  const pulse = sin(time.mul(1.6).sub(origin.x.mul(0.11)).sub(origin.z.mul(0.08))).mul(0.35).add(0.75)
  material.emissiveNode = col.mul(glow).mul(pulse).mul(float(0.9)).mul(glowDim)
  return material
}

// ---------------------------------------------------------------------------------------

export class GroundCover implements System {
  private readonly group = new THREE.Group()
  private layers: Layer[] = []
  private amount = -1
  private enabled = true

  /** `exposureOver` reports how many times its daytime value the camera exposure is now. */
  constructor(
    private readonly scene: THREE.Scene, private readonly sampler: HeightSampler, private readonly camera: THREE.Camera,
    private readonly exposureOver: () => number = () => 1,
  ) {
    this.group.name = 'groundcover'
    scene.add(this.group)
    this.rebuild()
  }

  /** Off on the weakest devices. */
  setEnabled(on: boolean): void {
    this.enabled = on
    this.group.visible = on
  }

  /** The terrain changed: replant for the new world. */
  rebuild(): void {
    for (const l of this.layers) { this.group.remove(l.mesh); l.dispose() }
    const data = this.sampler.data
    this.layers = layersFor(data.settings.kind, data.layout.summitHeight * 0.3).map((spec, i) => {
      const layer = new Layer(spec, this.sampler, (data.seed * 31 + 77 + i * 1013) | 0)
      this.group.add(layer.mesh)
      return layer
    })
    this.amount = groundCover.value
  }

  update(): void {
    if (!this.enabled) return
    if (groundCover.value !== this.amount) this.rebuild()
    // At zero nothing is drawn at all.
    this.group.visible = this.amount > 0
    if (this.amount <= 0) return
    const over = this.exposureOver()
    glowDim.value = over > 1 ? 1 / over : 1
    const p = this.camera.position
    for (const l of this.layers) l.follow(p.x, p.z, this.amount)
  }

  dispose(): void {
    for (const l of this.layers) { this.group.remove(l.mesh); l.dispose() }
    this.layers = []
    this.scene.remove(this.group)
  }
}
