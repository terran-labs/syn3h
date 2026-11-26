/**
 * The waterline's drawn height follows the triangles the sea mesh really draws. Bug caught: the
 * clipmap's diagonal rule changes (clipmap.ts clipmapIndices) and the drawn height interpolates
 * across the other diagonal, so the line on the lens leaves the water's drawn edge by tens of pixels.
 */
import { describe, expect, it } from 'vitest'
import { clipmapIndices } from '../../src/world/water/clipmap'
import { cellTriangle } from '../../src/world/water/drawnSurface'

describe('drawn surface', () => {
  it('picks the same triangle of each cell as the clipmap draws', () => {
    const cells = 16, h = cells / 2, row = cells + 1
    const index = clipmapIndices(cells, 0, 0, false)
    const vertex = (i: number): [number, number] => [(i % row) - h, Math.floor(i / row) - h]
    const key = (t: [number, number][]) => t.map(([x, z]) => `${x},${z}`).sort().join(' ')
    let seed = 3
    const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
    for (let t = 0; t < index.length; t += 3) {
      const tri = [vertex(index[t]), vertex(index[t + 1]), vertex(index[t + 2])]
      const ix = Math.min(...tri.map((p) => p[0])), iz = Math.min(...tri.map((p) => p[1]))
      const local = tri.map(([x, z]) => [x - ix, z - iz] as [number, number])
      // A point well inside this triangle: its centroid nudged a little at random.
      const cu = local.reduce((s, p) => s + p[0], 0) / 3 + (r() - 0.5) * 0.1
      const cv = local.reduce((s, p) => s + p[1], 0) / 3 + (r() - 0.5) * 0.1
      expect(key(cellTriangle(ix, iz, cu, cv)), `cell ${ix},${iz}`).toBe(key(local))
    }
  })
})
