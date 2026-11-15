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

/**
 * The alien flower of the volcanic worlds: a dark stalk that curls over like a fern
 * crozier, a glowing bulb hanging from its tip, and three spores drifting above it. The
 * bulb and spores take the plant's colour and pulse.
 */
function alienFlower(): THREE.BufferGeometry {
  const b = new Builder()
  const dark = new THREE.Color(0x1c0b26)
  const mid = new THREE.Color(0x4a1a5e)
  const white = new THREE.Color(0xffffff)
  // The stalk: up, then curling forward and down.
  const pts: number[][] = []
  for (let i = 0; i <= 6; i++) {
    const t = i / 6
    const curl = t * t * 3.6
    pts.push([Math.sin(curl) * 0.34 * t, 0.95 * t + (Math.cos(curl) - 1) * 0.22 * t, 0.04 * t])
  }
  for (let i = 0; i < 6; i++) {
    const w0 = 0.05 * (1 - i / 9), w1 = 0.05 * (1 - (i + 1) / 9)
    ribbon(b, pts[i], pts[i + 1], w0, w1, i < 3 ? dark : mid, i < 2 ? dark : mid, i / 6, (i + 1) / 6, i > 3 ? 0.25 : 0)
  }
  // The bulb: an octahedron hanging at the tip.
  const [bx, by, bz] = [pts[6][0], pts[6][1] - 0.1, pts[6][2]]
  const R = 0.12
  const top = [bx, by + R * 1.3, bz], bot = [bx, by - R * 1.5, bz]
  const ring = [0, 1, 2, 3].map((k) => [bx + Math.cos(k * Math.PI / 2) * R, by, bz + Math.sin(k * Math.PI / 2) * R])
  for (let k = 0; k < 4; k++) {
    const p = ring[k], q = ring[(k + 1) % 4]
    b.v(top[0], top[1], top[2], white, 1, 1, 1); b.v(p[0], p[1], p[2], white, 1, 1, 1); b.v(q[0], q[1], q[2], white, 1, 1, 1)
    b.v(bot[0], bot[1], bot[2], white, 1, 1, 0.6); b.v(q[0], q[1], q[2], white, 1, 1, 1); b.v(p[0], p[1], p[2], white, 1, 1, 1)
  }
  // Spores: small glowing shards above the stalk. A sway above 1 marks them as drifting.
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.4, r = 0.16 + k * 0.07, y = 1.05 + k * 0.16
    const x = Math.cos(a) * r, z = Math.sin(a) * r, s = 0.05
    b.v(x, y + s * 1.6, z, white, 2 + k, 1, 1)
    b.v(x - s, y, z + s * 0.5, white, 2 + k, 1, 1)
    b.v(x + s, y, z - s * 0.5, white, 2 + k, 1, 1)
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
const DESERT_BLOOMS = [0xff8a2a, 0xff4f8a, 0xfff06a, 0xff6a3a]
// Cyan, magenta, acid green, violet: lit from inside.
const ALIEN_BLOOMS = [0x22f0ff, 0xff38d8, 0x7dff3a, 0x9a5cff, 0x22f0ff]

function layersFor(kind: number, treeLine: number): LayerSpec[] {
  if (kind === KIND_ALPINE) {
    return [
      {
        n: 176, spacing: 0.8, geometry: tuft(6, 0.42, 0x2c5a1c, 0x9ccc58, 0, 0, 0.032),
        grow(c, h, out) {
          if (c.y > treeLine) return
          // Meadow almost everywhere, thinning toward the tundra.
          if (unit(h, 22) > 0.95 - 0.5 * smooth(treeLine * 0.6, treeLine, c.y)) return
          out.scale = 0.7 + 0.7 * unit(h, 2) + 0.4 * c.patch
          setTint(out, 0xffffff, 0.3, h)
        },
      },
      {
        n: 80, spacing: 1.6, geometry: daisy(0.55, 7, 0.2, 0x3d7a2a, 0xffc832),
        grow(c, h, out) {
          if (c.y > treeLine) return
          // Flowers come in drifts.
          if (unit(h, 22) > 0.1 + 0.75 * smooth(0.5, 0.8, c.patch)) return
          out.scale = 0.75 + 0.6 * unit(h, 2)
          setTint(out, ALPINE_BLOOMS[(h >>> 4) % ALPINE_BLOOMS.length], 0.12, h)
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
      n: 80, spacing: 1.6, geometry: alienFlower(),
      grow(c, h, out) {
        if (c.rock > 0.9) return
        // Groves of them, and the odd one standing alone.
        if (unit(h, 22) > 0.02 + 0.22 * smooth(0.62, 0.82, c.patch)) return
        out.scale = 0.8 + 1.0 * unit(h, 2)
        // A grove shares a colour, with strays.
        const pick = unit(h, 4) < 0.25 ? (h >>> 6) % ALIEN_BLOOMS.length : Math.floor(c.patch * 23) % ALIEN_BLOOMS.length
        setTint(out, ALIEN_BLOOMS[pick], 0.1, h)
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
  private readonly ground: Ground = { x: 0, z: 0, y: 0, patch: 0, rock: 0 }
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
    if (y < worldLavaAltitude.value + 0.7 || lavaSurfaceAt(data.lava, wx, wz, -1e9) > y - 0.3) return
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
