/**
 * Draws the forest the generator planted (`data.trees`) as instanced conifers.
 *
 * One low polygon tree (a trunk and three stacked cones, about 30 triangles) is instanced
 * thousands of times. The trees are split into a grid of patches, one InstancedMesh each,
 * so the renderer frustum culls most of the forest, and patches beyond the draw distance
 * are hidden. Colour varies a little per tree. Trees have no collision: cars pass through.
 */
import * as THREE from 'three/webgpu'
import type { System } from '../../core/Game'
import { TREE_STRIDE } from './forest'
import { hash2 } from './noise'
import type { HeightSampler } from './sampler'

/** Patches per side of the world. */
const PATCHES = 8

/** A conifer about 11 m tall with its foot at the origin, with vertex colours. */
function coniferGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const nor: number[] = []
  const SEG = 6
  const ring = (i: number) => {
    const a = (i / SEG) * Math.PI * 2
    return [Math.cos(a), Math.sin(a)] as const
  }
  // A cone or frustum from radius r0 at y0 to radius r1 at y1.
  const band = (y0: number, r0: number, y1: number, r1: number, c: THREE.Color, cTop: THREE.Color) => {
    const slope = (r0 - r1) / (y1 - y0)
    for (let i = 0; i < SEG; i++) {
      const [ax, az] = ring(i)
      const [bx, bz] = ring(i + 1)
      const quad = [
        [ax * r0, y0, az * r0, ax, az, c], [bx * r0, y0, bz * r0, bx, bz, c], [bx * r1, y1, bz * r1, bx, bz, cTop],
        [ax * r0, y0, az * r0, ax, az, c], [bx * r1, y1, bz * r1, bx, bz, cTop], [ax * r1, y1, az * r1, ax, az, cTop],
      ] as const
      for (const [x, y, z, nx, nz, cc] of quad) {
        pos.push(x, y, z)
        const l = Math.hypot(1, slope)
        nor.push(nx / l, slope / l, nz / l)
        col.push(cc.r, cc.g, cc.b)
      }
    }
  }
  const bark = new THREE.Color(0x4a3524)
  const low = new THREE.Color(0x1f4a2a)
  const high = new THREE.Color(0x3f7a3c)
  band(0, 0.42, 2.6, 0.3, bark, bark)
  band(1.8, 2.9, 6.0, 0.5, low, high)
  band(4.6, 2.2, 8.6, 0.35, low, high)
  band(7.4, 1.5, 11.2, 0, low, high)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

export class Trees implements System {
  private readonly group = new THREE.Group()
  private readonly geometry = coniferGeometry()
  private readonly material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
  private patches: THREE.InstancedMesh[] = []
  private drawDistance = 1600
  /** Trees currently planted. */
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

  rebuild(): void {
    this.clear()
    const data = this.sampler.data
    const trees = data.trees
    this.count = trees.length / TREE_STRIDE
    if (!this.count) return
    const half = data.size / 2
    const cell = data.size / PATCHES
    const buckets: number[][] = Array.from({ length: PATCHES * PATCHES }, () => [])
    for (let i = 0; i < this.count; i++) {
      const x = trees[i * TREE_STRIDE]
      const z = trees[i * TREE_STRIDE + 2]
      const px = Math.min(PATCHES - 1, Math.max(0, Math.floor((x + half) / cell)))
      const pz = Math.min(PATCHES - 1, Math.max(0, Math.floor((z + half) / cell)))
      buckets[pz * PATCHES + px].push(i)
    }
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const tint = new THREE.Color()
    for (const list of buckets) {
      if (!list.length) continue
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, list.length)
      const box = new THREE.Box3()
      list.forEach((i, k) => {
        const x = trees[i * TREE_STRIDE], y = trees[i * TREE_STRIDE + 1], z = trees[i * TREE_STRIDE + 2]
        const s = trees[i * TREE_STRIDE + 3]
        const h = hash2(i, 7, data.seed)
        q.setFromAxisAngle(up, ((h & 255) / 255) * Math.PI * 2)
        const girth = s * (0.85 + 0.3 * (((h >>> 8) & 255) / 255))
        // Sink the foot a little so trees on slopes do not hover.
        m.compose(new THREE.Vector3(x, y - 0.4, z), q, new THREE.Vector3(girth, s, girth))
        mesh.setMatrixAt(k, m)
        const v = 0.78 + 0.4 * (((h >>> 16) & 255) / 255)
        mesh.setColorAt(k, tint.setRGB(v, v * (0.95 + 0.1 * (((h >>> 24) & 255) / 255)), v * 0.92))
        box.expandByPoint(new THREE.Vector3(x, y, z))
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
    }
  }

  update(): void {
    const c = this.camera.position
    for (const p of this.patches) {
      p.visible = p.boundingSphere!.distanceToPoint(c) < this.drawDistance
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
    this.geometry.dispose()
    this.material.dispose()
  }
}
