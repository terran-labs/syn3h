/**
 * Terrain render geometry: the grid split into square chunks so the camera and the shadow
 * pass can frustum cull most of the world, with the same triangle split as the Rapier
 * heightfield so the visible surface is the collided surface.
 */
import * as THREE from 'three/webgpu'
import type { TerrainData } from './generate'

/** Cells per chunk side. 512 cells / 128 = 4 x 4 = 16 draw calls at most. */
export const CHUNK_CELLS = 128

export interface TerrainMeshes {
  group: THREE.Group
  /** Rewrite heights, normals and masks in place after regeneration (same resolution). */
  update(data: TerrainData): void
  dispose(): void
}

function chunkIndices(cells: number): Uint32Array {
  const v = cells + 1
  const out = new Uint32Array(cells * cells * 6)
  let k = 0
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const a = z * v + x // (x, z)
      const b = a + 1 // (x + 1, z)
      const c = a + v // (x, z + 1)
      const e = c + 1 // (x + 1, z + 1)
      // Anti-diagonal b to c, as Rapier splits cells. Counter-clockwise seen from above.
      out[k++] = a; out[k++] = c; out[k++] = b
      out[k++] = b; out[k++] = c; out[k++] = e
    }
  }
  return out
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
  const RD = road.array as Float32Array
  const P = pos.array as Float32Array
  const N = nor.array as Float32Array
  const V = vol.array as Float32Array
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
      // faceted physics normals and differs from them by a few degrees at most.
      const l = h[ix > 0 ? i - 1 : i]
      const r = h[ix < n - 1 ? i + 1 : i]
      const d = h[iz > 0 ? i - n : i]
      const u = h[iz < n - 1 ? i + n : i]
      const dx = (r - l) / ((ix > 0 && ix < n - 1 ? 2 : 1) * c)
      const dz = (u - d) / ((iz > 0 && iz < n - 1 ? 2 : 1) * c)
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz)
      N[k * 3] = -dx * inv
      N[k * 3 + 1] = inv
      N[k * 3 + 2] = -dz * inv
      V[k] = data.volcanic[i]
      RD[k] = data.roadDist[i]
    }
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  vol.needsUpdate = true
  road.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
}

export function createTerrainMeshes(data: TerrainData, material: THREE.Material): TerrainMeshes {
  const group = new THREE.Group()
  group.name = 'terrain'
  const cellsPerSide = data.resolution - 1
  const cells = Math.min(CHUNK_CELLS, cellsPerSide)
  const perSide = Math.ceil(cellsPerSide / cells)
  const indexCache = new Map<number, THREE.BufferAttribute>()
  const chunks: { geometry: THREE.BufferGeometry; x0: number; z0: number; cells: number }[] = []

  for (let cz = 0; cz < perSide; cz++) {
    for (let cx = 0; cx < perSide; cx++) {
      const x0 = cx * cells
      const z0 = cz * cells
      // Chunks are square; the last row and column clamp if the grid is not a multiple.
      const w = Math.min(cells, cellsPerSide - x0, cellsPerSide - z0)
      const verts = (w + 1) * (w + 1)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
      geometry.setAttribute('volcanic', new THREE.BufferAttribute(new Float32Array(verts), 1))
      geometry.setAttribute('road', new THREE.BufferAttribute(new Float32Array(verts), 1))
      let index = indexCache.get(w)
      if (!index) {
        index = new THREE.BufferAttribute(chunkIndices(w), 1)
        indexCache.set(w, index)
      }
      geometry.setIndex(index)
      fillChunk(geometry, data, x0, z0, w)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.receiveShadow = true
      // Self shadowing a heightfield in a small shadow box mostly produces acne; vehicles
      // and props cast, the ground receives.
      mesh.castShadow = false
      mesh.matrixAutoUpdate = false
      group.add(mesh)
      chunks.push({ geometry, x0, z0, cells: w })
    }
  }

  return {
    group,
    update(next) {
      for (const ch of chunks) fillChunk(ch.geometry, next, ch.x0, ch.z0, ch.cells)
    },
    dispose() {
      for (const ch of chunks) ch.geometry.dispose()
    },
  }
}
