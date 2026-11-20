/**
 * Terrain render geometry: the grid split into square chunks, each with three levels of
 * detail (every sample, every 2nd, every 4th) chosen by distance from the camera.
 *
 *  - Chunks let the camera and the shadow pass frustum cull most of the world.
 *  - Levels share one vertex buffer per chunk and differ only in their index buffer, so
 *    switching costs nothing and regeneration rewrites each vertex once.
 *  - Neighbouring chunks at different levels leave cracks along their shared edge. Each
 *    chunk hangs a skirt (a strip of vertical triangles, both windings) from its border
 *    to hide them, which is simpler than stitching edges and costs a few hundred triangles.
 *  - The full level uses Rapier's triangle split, so up close the visible surface is the
 *    collided surface. Coarser levels are only used beyond LOD_NEAR.
 *  - The world wraps. Each chunk is drawn once, at whichever image of it (the tile repeats
 *    every `size` metres) is nearest the camera, so the 8 x 8 chunks always surround the
 *    camera and there is ground in every direction. The shift is a whole tile, so it is
 *    invisible: the heights are periodic and the seam row is shared (see `sealSeam`).
 */
import * as THREE from 'three/webgpu'
import { longFrames } from '../../core/longFrames'
import { wrapCoord } from '../../../shared/wrap'
import { overHorizon } from '../curve'
import type { TerrainData } from './generate'

/** Cells per chunk side. 512 cells / 64 = 8 x 8 chunks. */
export const CHUNK_CELLS = 64
/** Index strides of the levels of detail. */
const STRIDES = [1, 2, 4] as const
/** Camera distance (m) to a chunk's bounding box beyond which the next level is used. */
export const LOD_NEAR = 250
/** Quarter detail only this far out: 16 m sampling breaks up mesa cliffs and road paint. */
export const LOD_FAR = 900
/** How far skirts hang below the border, enough to cover the worst crack on a steep flank. */
const SKIRT_DEPTH = 15

export interface TriangleStats {
  /** Triangles in the visible chunks at their current levels. */
  drawn: number
  /** Triangles the same chunks would cost at full detail. */
  full: number
  /** Chunks at each level. */
  levels: number[]
}

export interface TerrainMeshes {
  group: THREE.Group
  /** Rewrite heights, normals and masks in place after regeneration (same resolution). */
  update(data: TerrainData): void
  /** The same as `update`, one chunk per step, for a rebuild spread across frames. */
  updateSteps(data: TerrainData): Generator<void>
  /** Pick each chunk's level of detail for a camera position. */
  updateLod(camera: THREE.Vector3): void
  /** Height of the currently drawn triangle, in the unbent periodic tile. */
  heightAt(x: number, z: number): number
  /** Distances at which chunks drop to half and quarter detail. Defaults LOD_NEAR, LOD_FAR. */
  setLodDistances(near: number, far: number): void
  stats(camera?: THREE.Camera): TriangleStats
  dispose(): void
}

/** Grid triangles at `stride` plus skirt quads (both windings) along the four edges. */
function chunkIndices(cells: number, stride: number): Uint32Array {
  const v = cells + 1
  const skirtBase = v * v
  const out: number[] = []
  for (let z = 0; z < cells; z += stride) {
    for (let x = 0; x < cells; x += stride) {
      const a = z * v + x // (x, z)
      const b = a + stride // (x + s, z)
      const c = a + stride * v // (x, z + s)
      const e = c + stride // (x + s, z + s)
      // Anti-diagonal b to c, as Rapier splits cells. Counter-clockwise seen from above.
      out.push(a, c, b, b, c, e)
    }
  }
  const border = (edge: number, k: number) =>
    edge === 0 ? k : edge === 1 ? cells * v + k : edge === 2 ? k * v : k * v + cells
  for (let edge = 0; edge < 4; edge++) {
    for (let k = 0; k < cells; k += stride) {
      const t0 = border(edge, k)
      const t1 = border(edge, k + stride)
      const s0 = skirtBase + edge * v + k
      const s1 = skirtBase + edge * v + k + stride
      out.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0)
    }
  }
  return new Uint32Array(out)
}

function fillChunk(geometry: THREE.BufferGeometry, data: TerrainData, x0: number, z0: number, cells: number): void {
  const n = data.resolution
  const h = data.heights
  const c = data.cell
  const half = data.size / 2
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const nor = geometry.getAttribute('normal') as THREE.BufferAttribute
  const vol = geometry.getAttribute('volcanic') as THREE.BufferAttribute
  const road = geometry.getAttribute('road') as THREE.BufferAttribute
  const P = pos.array as Float32Array
  const N = nor.array as Float32Array
  const V = vol.array as Float32Array
  const RD = road.array as Float32Array
  const copy = (to: number, from: number, dy: number) => {
    P[to * 3] = P[from * 3]
    P[to * 3 + 1] = P[from * 3 + 1] - dy
    P[to * 3 + 2] = P[from * 3 + 2]
    N[to * 3] = N[from * 3]
    N[to * 3 + 1] = N[from * 3 + 1]
    N[to * 3 + 2] = N[from * 3 + 2]
    V[to] = V[from]
    RD[to] = RD[from]
  }
  let k = 0
  for (let z = 0; z <= cells; z++) {
    const iz = z0 + z
    for (let x = 0; x <= cells; x++, k++) {
      const ix = x0 + x
      const i = iz * n + ix
      P[k * 3] = -half + ix * c
      P[k * 3 + 1] = h[i]
      P[k * 3 + 2] = -half + iz * c
      // Smooth vertex normals from central differences; the shading looks better than the
      // faceted physics normals and differs from them by a few degrees at most. Neighbours
      // wrap across the seam (sample n - 1 is sample 0), so both sides shade alike.
      const l = h[ix > 0 ? i - 1 : i + n - 2]
      const r = h[ix < n - 1 ? i + 1 : i - (n - 2)]
      const d = h[iz > 0 ? i - n : i + (n - 2) * n]
      const u = h[iz < n - 1 ? i + n : i - (n - 2) * n]
      const dx = (r - l) / (2 * c)
      const dz = (u - d) / (2 * c)
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz)
      N[k * 3] = -dx * inv
      N[k * 3 + 1] = inv
      N[k * 3 + 2] = -dz * inv
      V[k] = data.volcanic[i]
      RD[k] = data.roadDist[i]
    }
  }
  const v = cells + 1
  const skirtBase = v * v
  for (let j = 0; j <= cells; j++) {
    copy(skirtBase + j, j, SKIRT_DEPTH)
    copy(skirtBase + v + j, cells * v + j, SKIRT_DEPTH)
    copy(skirtBase + 2 * v + j, j * v, SKIRT_DEPTH)
    copy(skirtBase + 3 * v + j, j * v + cells, SKIRT_DEPTH)
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  vol.needsUpdate = true
  road.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
}

interface Chunk {
  x0: number
  z0: number
  cells: number
  levels: THREE.Mesh[]
  /** The geometry whose attributes all levels share. */
  base: THREE.BufferGeometry
  /** Bounding box at the drawn image, used for culling stats and level of detail. */
  box: THREE.Box3
  level: number
  /** World offset of the drawn image from the canonical tile: whole multiples of size. */
  ox: number
  oz: number
  /** Centre of the chunk in the canonical tile. */
  cx: number
  cz: number
}

export function createTerrainMeshes(data: TerrainData, material: THREE.Material): TerrainMeshes {
  const spanStart = longFrames.start()
  try {
    return buildTerrainMeshes(data, material)
  } finally {
    longFrames.end('terrain.mesh.create', spanStart)
  }
}

function buildTerrainMeshes(data: TerrainData, material: THREE.Material): TerrainMeshes {
  const group = new THREE.Group()
  group.name = 'terrain'
  const cellsPerSide = data.resolution - 1
  const cells = Math.min(CHUNK_CELLS, cellsPerSide)
  if (cellsPerSide % cells !== 0) throw new Error(`terrain cells ${cellsPerSide} not a multiple of ${cells}`)
  const perSide = cellsPerSide / cells
  const indices = STRIDES.map((s) => new THREE.BufferAttribute(chunkIndices(cells, Math.min(s, cells)), 1))
  const chunks: Chunk[] = []

  for (let cz = 0; cz < perSide; cz++) {
    for (let cx = 0; cx < perSide; cx++) {
      const v = cells + 1
      const verts = v * v + 4 * v
      const base = new THREE.BufferGeometry()
      base.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
      base.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
      base.setAttribute('volcanic', new THREE.BufferAttribute(new Float32Array(verts), 1))
      base.setAttribute('road', new THREE.BufferAttribute(new Float32Array(verts), 1))
      const chunk: Chunk = {
        x0: cx * cells, z0: cz * cells, cells, levels: [], base, box: new THREE.Box3(), level: 0, ox: 0, oz: 0,
        cx: -data.size / 2 + (cx + 0.5) * cells * data.cell, cz: -data.size / 2 + (cz + 0.5) * cells * data.cell,
      }
      fillChunk(base, data, chunk.x0, chunk.z0, cells)
      chunk.levels = indices.map((index, level) => {
        const g = level === 0 ? base : new THREE.BufferGeometry()
        if (level > 0) for (const name in base.attributes) g.setAttribute(name, base.attributes[name])
        g.setIndex(index)
        g.boundingBox = base.boundingBox
        g.boundingSphere = base.boundingSphere
        const mesh = new THREE.Mesh(g, material)
        mesh.receiveShadow = true
        // The placeholder sun has one small shadow box that follows the camera, so a
        // terrain-cast shadow would only add self-shadowing acne. Revisit with cascades.
        mesh.castShadow = false
        mesh.matrixAutoUpdate = false
        mesh.visible = level === 0
        group.add(mesh)
        return mesh
      })
      chunk.box.copy(base.boundingBox!)
      chunks.push(chunk)
    }
  }

  const size = data.size
  /** Move a chunk to the image nearest (x, z). */
  const place = (ch: Chunk, x: number, z: number) => {
    const ox = size * Math.round((x - ch.cx) / size)
    const oz = size * Math.round((z - ch.cz) / size)
    if (ox === ch.ox && oz === ch.oz) return
    ch.ox = ox
    ch.oz = oz
    for (const m of ch.levels) {
      m.position.set(ox, 0, oz)
      m.updateMatrix()
    }
    ch.box.copy(ch.base.boundingBox!).translate(new THREE.Vector3(ox, 0, oz))
  }
  let lodNear = LOD_NEAR
  let lodFar = LOD_FAR
  const setLevel = (ch: Chunk, level: number) => {
    if (ch.level === level) return
    ch.levels[ch.level].visible = false
    ch.levels[level].visible = true
    ch.level = level
  }

  return {
    group,
    heightAt(x, z) {
      const gx = (wrapCoord(x, size) + size / 2) / data.cell
      const gz = (wrapCoord(z, size) + size / 2) / data.cell
      const cx = Math.min(perSide - 1, Math.floor(gx / cells))
      const cz = Math.min(perSide - 1, Math.floor(gz / cells))
      const ch = chunks[cz * perSide + cx]
      const stride = Math.min(STRIDES[ch.level], cells)
      const lx = gx - ch.x0, lz = gz - ch.z0
      const ix = Math.min(cells - stride, Math.floor(lx / stride) * stride)
      const iz = Math.min(cells - stride, Math.floor(lz / stride) * stride)
      const fx = (lx - ix) / stride, fz = (lz - iz) / stride
      const positions = ch.base.getAttribute('position')
      const row = cells + 1, i = iz * row + ix
      const h00 = positions.getY(i), h10 = positions.getY(i + stride)
      const h01 = positions.getY(i + stride * row), h11 = positions.getY(i + stride * (row + 1))
      return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
        : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
    },
    update(next) {
      for (const _ of this.updateSteps(next)) { /* One chunk per step. */ }
    },
    *updateSteps(next) {
      for (const ch of chunks) {
        const spanStart = longFrames.start()
        try {
          fillChunk(ch.base, next, ch.x0, ch.z0, ch.cells)
          ch.box.copy(ch.base.boundingBox!).translate(new THREE.Vector3(ch.ox, 0, ch.oz))
          for (const m of ch.levels) {
            m.geometry.boundingBox = ch.base.boundingBox
            m.geometry.boundingSphere = ch.base.boundingSphere
          }
        } finally {
          longFrames.end('terrain.mesh.chunk', spanStart)
        }
        yield
      }
    },
    updateLod(camera) {
      for (const ch of chunks) {
        place(ch, camera.x, camera.z)
        const d = ch.box.distanceToPoint(camera)
        setLevel(ch, d < lodNear ? 0 : d < lodFar ? 1 : 2)
        // On a round world, most chunks are behind the planet: do not draw those.
        const b = ch.box
        const hx = (b.max.x - b.min.x) / 2
        const hz = (b.max.z - b.min.z) / 2
        ch.levels[ch.level].visible = !overHorizon(b.min.x + hx, b.min.z + hz, Math.sqrt(hx * hx + hz * hz), b.max.y)
      }
    },
    setLodDistances(near, far) {
      lodNear = Math.max(0, near)
      lodFar = Math.max(lodNear, far)
    },
    stats(camera) {
      let frustum: THREE.Frustum | null = null
      if (camera) {
        camera.updateMatrixWorld()
        frustum = new THREE.Frustum().setFromProjectionMatrix(
          new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        )
      }
      const out: TriangleStats = { drawn: 0, full: 0, levels: STRIDES.map(() => 0) }
      for (const ch of chunks) {
        if (frustum && !frustum.intersectsBox(ch.box)) continue
        out.drawn += indices[ch.level].count / 3
        out.full += indices[0].count / 3
        out.levels[ch.level]++
      }
      return out
    },
    dispose() {
      for (const ch of chunks) for (const m of ch.levels) m.geometry.dispose()
    },
  }
}
