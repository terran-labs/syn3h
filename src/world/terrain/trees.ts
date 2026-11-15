/**
 * Draws the flora the generator planted (`data.trees`) as instanced low polygon plants.
 *
 * Each species (see SPECIES in forest.ts) has one procedural mesh under 60 triangles with
 * vertex colours, instanced thousands of times. Plants are split into a grid of patches,
 * one InstancedMesh per species present in each patch, so the renderer frustum culls most
 * of them and patches beyond the draw distance are hidden. Colour varies a little per
 * plant. Crystal shards glow so they read at night. Plants have no collision: cars pass
 * through, so nothing can trap or flip a vehicle.
 *
 * The world wraps: each patch is drawn at whichever image of it is nearest the camera,
 * like the terrain chunks, so forest continues across the seam.
 */
import * as THREE from 'three/webgpu'
import { overHorizon } from '../curve'
import type { System } from '../../core/Game'
import { SPECIES, SPECIES_COUNT, TREE_STRIDE } from './forest'
import { hash2 } from './noise'
import type { HeightSampler } from './sampler'

/** Patches per side of the world. */
const PATCHES = 8

/** Accumulates triangles with flat-ish normals and vertex colours. */
class Builder {
  readonly pos: number[] = []
  readonly nor: number[] = []
  readonly col: number[] = []

  /**
   * A frustum (or cone when r1 is 0) along the segment a to b, with `seg` sides, coloured
   * c at a and cTop at b. Normals point out from the axis.
   */
  tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg: number, c: THREE.Color, cTop: THREE.Color, phase = 0): this {
    const axis = b.clone().sub(a)
    const len = axis.length()
    axis.normalize()
    const side = Math.abs(axis.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const u = side.clone().cross(axis).normalize()
    const v = axis.clone().cross(u).normalize()
    const slope = (r0 - r1) / len
    const dir = (i: number) => {
      const t = ((i + phase) / seg) * Math.PI * 2
      return u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t))
    }
    for (let i = 0; i < seg; i++) {
      const da = dir(i)
      const db = dir(i + 1)
      const quad: [THREE.Vector3, number, THREE.Vector3, THREE.Color][] = [
        [a, r0, da, c], [a, r0, db, c], [b, r1, db, cTop],
        [a, r0, da, c], [b, r1, db, cTop], [b, r1, da, cTop],
      ]
      // A cone's tip quad collapses to one triangle; skip the degenerate half.
      const tris = r1 === 0 ? quad.slice(0, 3) : quad
      for (const [o, r, d, cc] of tris) {
        this.pos.push(o.x + d.x * r, o.y + d.y * r, o.z + d.z * r)
        const nn = d.clone().addScaledVector(axis, slope).normalize()
        this.nor.push(nn.x, nn.y, nn.z)
        this.col.push(cc.r, cc.g, cc.b)
      }
    }
    return this
  }

  /** One triangle with a single colour and its face normal. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, colTip = col): this {
    const nn = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
    if (nn.y < 0) nn.negate()
    for (const [p, cc] of [[a, col], [b, colTip], [c, col]] as const) {
      this.pos.push(p.x, p.y, p.z)
      this.nor.push(nn.x, nn.y, nn.z)
      this.col.push(cc.r, cc.g, cc.b)
    }
    return this
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    return g
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const C = (hex: number) => new THREE.Color(hex)
const UP = (y0: number, y1: number) => [V(0, y0, 0), V(0, y1, 0)] as const

/** A conifer about 11 m tall: a trunk and three stacked cones. 42 triangles. */
function conifer(): THREE.BufferGeometry {
  const bark = C(0x4a3524), low = C(0x1f4a2a), high = C(0x3f7a3c)
  return new Builder()
    .tube(...UP(0, 2.6), 0.42, 0.3, 6, bark, bark)
    .tube(...UP(1.8, 6.0), 2.9, 0.5, 6, low, high)
    .tube(...UP(4.6, 8.6), 2.2, 0.35, 6, low, high)
    .tube(...UP(7.4, 11.2), 1.5, 0, 6, low, high)
    .build()
}

/** A rounder broadleaf tree about 8 m tall: a trunk and a lumpy crown. 46 triangles. */
function broadleaf(): THREE.BufferGeometry {
  const bark = C(0x5a4030), low = C(0x3d6b28), mid = C(0x5e8f34), high = C(0x7aa844)
  return new Builder()
    .tube(...UP(0, 3.4), 0.45, 0.3, 5, bark, bark)
    .tube(...UP(2.6, 4.6), 1.4, 3.3, 6, low, mid)
    .tube(...UP(4.6, 6.6), 3.3, 2.6, 6, mid, mid, 0.5)
    .tube(...UP(6.6, 8.2), 2.6, 0, 6, mid, high, 0.5)
    .build()
}

/** A low bush about 1.5 m tall. 15 triangles. */
function bush(): THREE.BufferGeometry {
  const low = C(0x35552a), high = C(0x5f7f3a)
  return new Builder()
    .tube(...UP(-0.2, 0.7), 1.0, 1.25, 5, low, low)
    .tube(...UP(0.7, 1.5), 1.25, 0, 5, low, high)
    .build()
}

/** A saguaro-like cactus about 5.5 m tall with two arms. 52 triangles. */
function cactus(): THREE.BufferGeometry {
  const base = C(0x3f6a33), top = C(0x6a9a48)
  return new Builder()
    .tube(...UP(0, 4.8), 0.42, 0.36, 6, base, top)
    .tube(V(0, 4.8, 0), V(0, 5.4, 0), 0.36, 0, 6, top, top)
    // Right arm: an elbow out, then up.
    .tube(V(0, 1.9, 0), V(1.05, 2.15, 0), 0.26, 0.24, 4, base, base)
    .tube(V(1.05, 2.0, 0), V(1.05, 3.7, 0), 0.24, 0.2, 4, base, top)
    // Left arm, higher and shorter.
    .tube(V(0, 2.8, 0), V(-0.85, 3.0, 0.2), 0.22, 0.2, 4, base, base)
    .tube(V(-0.85, 2.85, 0.2), V(-0.85, 4.1, 0.2), 0.2, 0.16, 4, base, top)
    .build()
}

/** A palm about 9 m tall: a leaning trunk and seven drooping fronds. 48 triangles. */
function palm(): THREE.BufferGeometry {
  const bark = C(0x7a5a3a), barkTop = C(0x9a7a52), leaf = C(0x3f7a2a), leafTip = C(0x8fae3e)
  const b = new Builder()
    .tube(V(0, 0, 0), V(0.5, 3.2, 0), 0.36, 0.3, 5, bark, bark)
    .tube(V(0.5, 3.2, 0), V(1.3, 6.2, 0), 0.3, 0.25, 5, bark, barkTop)
    .tube(V(1.3, 6.2, 0), V(2.1, 8.6, 0), 0.25, 0.2, 5, barkTop, barkTop)
  const crown = V(2.1, 8.6, 0)
  const FRONDS = 7
  for (let i = 0; i < FRONDS; i++) {
    const a = (i / FRONDS) * Math.PI * 2 + 0.3
    const dx = Math.cos(a), dz = Math.sin(a)
    // Each frond rises a little, then droops: two triangles, a broad base and a tip.
    const mid = crown.clone().add(V(dx * 2.4, 0.5, dz * 2.4))
    const tip = crown.clone().add(V(dx * 4.4, -1.4, dz * 4.4))
    const w = V(-dz * 0.7, 0, dx * 0.7)
    b.tri(crown, mid.clone().add(w), mid.clone().sub(w), leaf, leaf)
    b.tri(mid.clone().add(w), tip, mid.clone().sub(w), leaf, leafTip)
  }
  return b.build()
}

/** A charred dead trunk about 6 m tall with two broken branches. 26 triangles. */
function snag(): THREE.BufferGeometry {
  const char = C(0x1c1714), ash = C(0x4a423c)
  return new Builder()
    .tube(...UP(-0.2, 6.2), 0.5, 0.12, 5, char, ash)
    .tube(V(0, 3.0, 0), V(1.5, 4.4, 0.3), 0.18, 0.05, 4, char, ash)
    .tube(V(0, 4.2, 0), V(-1.1, 5.3, -0.6), 0.14, 0.04, 4, char, ash)
    .build()
}

/** A cluster of three crystal shards about 2.6 m tall. 45 triangles. */
function crystal(): THREE.BufferGeometry {
  const deep = C(0x0f5a5c), bright = C(0x7ff8ee)
  const b = new Builder()
  const shard = (base: THREE.Vector3, top: THREE.Vector3, r: number) => {
    const neck = base.clone().lerp(top, 0.72)
    b.tube(base, neck, r, r * 0.9, 4, deep, bright)
    b.tube(neck, top, r * 0.9, 0, 4, bright, bright)
  }
  shard(V(0, -0.3, 0), V(0.15, 2.6, 0.1), 0.42)
  shard(V(0.5, -0.3, 0.2), V(1.3, 1.6, 0.6), 0.3)
  shard(V(-0.4, -0.3, -0.1), V(-1.0, 1.3, -0.7), 0.26)
  return b.build()
}

const GEOMETRY: Record<number, () => THREE.BufferGeometry> = {
  [SPECIES.conifer]: conifer,
  [SPECIES.broadleaf]: broadleaf,
  [SPECIES.bush]: bush,
  [SPECIES.cactus]: cactus,
  [SPECIES.palm]: palm,
  [SPECIES.snag]: snag,
  [SPECIES.crystal]: crystal,
}

/** Metres each species' foot sinks below the ground, so plants on slopes do not hover. */
const FOOT_SINK: Record<number, number> = {
  [SPECIES.conifer]: 0.4, [SPECIES.broadleaf]: 0.4, [SPECIES.bush]: 0.1, [SPECIES.cactus]: 0.3,
  [SPECIES.palm]: 0.3, [SPECIES.snag]: 0.2, [SPECIES.crystal]: 0.1,
}

export class Trees implements System {
  private readonly group = new THREE.Group()
  private readonly geometries = new Map<number, THREE.BufferGeometry>()
  private readonly material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
  /** Crystals glow teal so they read against the lava at night. */
  private readonly glow = new THREE.MeshStandardNodeMaterial({
    vertexColors: true, roughness: 0.35, metalness: 0, emissive: new THREE.Color(0x19d6c6), emissiveIntensity: 1.6,
  })
  private patches: THREE.InstancedMesh[] = []
  private drawDistance = 1600
  /** Plants currently planted. */
  count = 0

  constructor(private readonly scene: THREE.Scene, private readonly sampler: HeightSampler, private readonly camera: THREE.Camera) {
    this.group.name = 'trees'
    scene.add(this.group)
    this.rebuild()
  }

  /** Hide patches further than this from the camera. */
  setDrawDistance(metres: number): void {
    this.drawDistance = metres
  }

  private geometryFor(species: number): THREE.BufferGeometry {
    let g = this.geometries.get(species)
    if (!g) {
      g = (GEOMETRY[species] ?? conifer)()
      this.geometries.set(species, g)
    }
    return g
  }

  rebuild(): void {
    this.clear()
    const data = this.sampler.data
    const trees = data.trees
    this.count = trees.length / TREE_STRIDE
    if (!this.count) return
    const half = data.size / 2
    const cell = data.size / PATCHES
    // One bucket per patch per species.
    const buckets: number[][] = Array.from({ length: PATCHES * PATCHES * SPECIES_COUNT }, () => [])
    for (let i = 0; i < this.count; i++) {
      const x = trees[i * TREE_STRIDE]
      const z = trees[i * TREE_STRIDE + 2]
      const sp = Math.min(SPECIES_COUNT - 1, Math.max(0, trees[i * TREE_STRIDE + 4] | 0))
      const px = Math.min(PATCHES - 1, Math.max(0, Math.floor((x + half) / cell)))
      const pz = Math.min(PATCHES - 1, Math.max(0, Math.floor((z + half) / cell)))
      buckets[(pz * PATCHES + px) * SPECIES_COUNT + sp].push(i)
    }
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const p = new THREE.Vector3()
    const sc = new THREE.Vector3()
    const tint = new THREE.Color()
    buckets.forEach((list, b) => {
      if (!list.length) return
      const species = b % SPECIES_COUNT
      const material = species === SPECIES.crystal ? this.glow : this.material
      const mesh = new THREE.InstancedMesh(this.geometryFor(species), material, list.length)
      const box = new THREE.Box3()
      const sink = FOOT_SINK[species] ?? 0.4
      list.forEach((i, k) => {
        const x = trees[i * TREE_STRIDE], y = trees[i * TREE_STRIDE + 1], z = trees[i * TREE_STRIDE + 2]
        const s = trees[i * TREE_STRIDE + 3]
        const h = hash2(i, 7, data.seed)
        q.setFromAxisAngle(up, ((h & 255) / 255) * Math.PI * 2)
        const girth = s * (0.85 + 0.3 * (((h >>> 8) & 255) / 255))
        m.compose(p.set(x, y - sink * s, z), q, sc.set(girth, s, girth))
        mesh.setMatrixAt(k, m)
        const v = 0.78 + 0.4 * (((h >>> 16) & 255) / 255)
        mesh.setColorAt(k, tint.setRGB(v, v * (0.95 + 0.1 * (((h >>> 24) & 255) / 255)), v * 0.92))
        box.expandByPoint(p.set(x, y, z))
      })
      box.expandByScalar(20)
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.boundingBox = box
      mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere())
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      this.patches.push(mesh)
      this.group.add(mesh)
    })
  }

  update(): void {
    const c = this.camera.position
    const size = this.sampler.data.size
    for (const p of this.patches) {
      const s = p.boundingSphere!
      const ox = size * Math.round((c.x - s.center.x) / size)
      const oz = size * Math.round((c.z - s.center.z) / size)
      if (ox !== p.position.x || oz !== p.position.z) {
        p.position.set(ox, 0, oz)
        p.updateMatrix()
      }
      const dx = s.center.x + ox - c.x, dy = s.center.y - c.y, dz = s.center.z + oz - c.z
      p.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) - s.radius < this.drawDistance &&
        !overHorizon(s.center.x + ox, s.center.z + oz, s.radius, s.center.y + s.radius)
    }
  }

  private clear(): void {
    for (const p of this.patches) {
      this.group.remove(p)
      p.dispose()
    }
    this.patches = []
    this.count = 0
  }

  dispose(): void {
    this.clear()
    this.scene.remove(this.group)
    for (const g of this.geometries.values()) g.dispose()
    this.geometries.clear()
    this.material.dispose()
    this.glow.dispose()
  }
}
