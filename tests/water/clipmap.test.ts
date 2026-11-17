/**
 * The liquid clipmap: a crack or an overlap between rings shows as a seam of sky or a band of
 * doubled water, and an upside-down triangle shows the underwater look from above.
 */
import { describe, expect, it } from 'vitest'
import { CLIPMAP_LAYOUTS, Clipmap, clipmapIndices, clipmapReach, shortestGeometricWave } from '../../src/world/water/clipmap'
import { MeshBasicNodeMaterial } from 'three/webgpu'

describe('liquid clipmap', () => {
  it('faces every triangle upward', () => {
    const cells = 16, row = cells + 1, h = cells / 2
    const pos = (i: number) => [(i % row) - h, Math.floor(i / row) - h] as const
    for (const hole of [false, true]) {
      const index = clipmapIndices(cells, 1, -1, hole)
      for (let i = 0; i < index.length; i += 3) {
        const [ax, az] = pos(index[i]), [bx, bz] = pos(index[i + 1]), [cx, cz] = pos(index[i + 2])
        // y of (b - a) x (c - a)
        expect((bz - az) * (cx - ax) - (bx - ax) * (cz - az)).toBeGreaterThan(0)
      }
    }
  })

  it('leaves exactly the finer level uncovered, wherever the camera is', () => {
    const layout = { cells: 16, base: 1, levels: 4 }
    const map = new Clipmap(layout, new MeshBasicNodeMaterial())
    try {
      for (const [x, z] of [[0, 0], [3.3, -7.9], [131.7, 55.2], [-1000.4, 2.6]]) {
        map.update(x, z, 0)
        const meshes = map.group.children as import('three/webgpu').Mesh[]
        // Sample points on a fine lattice; each must be covered by exactly one level.
        // The outer ring snaps by two of its cells, so it always covers this far round the camera.
        const reach = clipmapReach(layout) - 2 * layout.base * 2 ** (layout.levels - 1) - 0.01
        for (let sx = -reach; sx <= reach; sx += reach / 37) for (let sz = -reach; sz <= reach; sz += reach / 41) {
          const px = x + sx, pz = z + sz
          let covered = 0
          for (const mesh of meshes) {
            const cell = (mesh.userData as { clipmap: { cell: number } }).clipmap.cell
            const gx = (px - mesh.position.x) / cell, gz = (pz - mesh.position.z) / cell
            const h = layout.cells / 2
            if (Math.abs(gx) >= h || Math.abs(gz) >= h) continue
            // Which cell this point is in, and is that cell drawn?
            const ix = Math.floor(gx), iz = Math.floor(gz)
            const a = (iz + h) * (layout.cells + 1) + (ix + h)
            const index = mesh.geometry.getIndex()!.array
            let drawn = false
            for (let i = 0; i < index.length; i += 6) if (Math.min(index[i], index[i + 1], index[i + 2], index[i + 3], index[i + 4], index[i + 5]) === a) { drawn = true; break }
            if (drawn) covered++
          }
          expect(covered, `point ${px.toFixed(1)}, ${pz.toFixed(1)}`).toBe(1)
        }
      }
    } finally { map.dispose() }
  })

  it('reaches past the fog at every quality level and draws longer waves further out', () => {
    for (const layout of CLIPMAP_LAYOUTS) {
      expect(clipmapReach(layout)).toBeGreaterThanOrEqual(8000)
      let previous = 0
      for (const d of [0, 10, 50, 200, 1000, 5000]) {
        const shortest = shortestGeometricWave(layout, d)
        expect(shortest).toBeGreaterThanOrEqual(previous)
        previous = shortest
      }
    }
  })
})
