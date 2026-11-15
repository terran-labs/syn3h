/**
 * Height and normal queries on the generated grid, matching the Rapier heightfield exactly.
 *
 * Rapier (parry) splits every cell into two triangles along the anti-diagonal from
 * (ix + 1, iz) to (ix, iz + 1); tests/world measured this against rays (the other diagonal
 * is off by up to half a metre, bilinear by a quarter). Interpolating on the same
 * triangles means `heightAt` returns the height the physics collides with, to float precision.
 *
 * The world wraps: the grid is one tile of a torus, and any (x, z) is first brought into the
 * tile with `wrapCoord`, so heights and normals repeat every `size` metres. The last row and
 * column of samples are the same world line as the first (see `sealSeam`).
 */
import { wrapCoord } from '../../../shared/wrap'
import type { TerrainData } from './generate'

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export class HeightSampler {
  constructor(public data: TerrainData) {}

  /** Grid coordinates of a world position, wrapped into the tile. */
  private locate(x: number, z: number): { ix: number; iz: number; fx: number; fz: number } {
    const { cell, resolution: n, size } = this.data
    const half = size / 2
    const gx = (wrapCoord(x, size) + half) / cell
    const gz = (wrapCoord(z, size) + half) / cell
    // Rounding can land exactly on the far edge; the last cell covers it.
    let ix = Math.floor(gx)
    let iz = Math.floor(gz)
    if (ix > n - 2) ix = n - 2
    if (iz > n - 2) iz = n - 2
    return { ix, iz, fx: gx - ix, fz: gz - iz }
  }

  heightAt(x: number, z: number): number {
    const { ix, iz, fx, fz } = this.locate(x, z)
    const n = this.data.resolution
    const h = this.data.heights
    const i = iz * n + ix
    const h00 = h[i]
    const h10 = h[i + 1] // x + 1
    const h01 = h[i + n] // z + 1
    const h11 = h[i + n + 1]
    return fx + fz <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
  }

  /** Face normal of the collider triangle under (x, z). */
  normalAt<T extends Vec3Like>(x: number, z: number, out: T): T {
    const { ix, iz, fx, fz } = this.locate(x, z)
    const n = this.data.resolution
    const h = this.data.heights
    const i = iz * n + ix
    const h00 = h[i]
    const h10 = h[i + 1]
    const h01 = h[i + n]
    const h11 = h[i + n + 1]
    let dx: number
    let dz: number
    if (fx + fz <= 1) {
      dx = h10 - h00
      dz = h01 - h00
    } else {
      dx = h11 - h01
      dz = h11 - h10
    }
    const c = this.data.cell
    const len = Math.sqrt(dx * dx + c * c + dz * dz)
    out.x = -dx / len
    out.y = c / len
    out.z = -dz / len
    return out
  }

  /** Grid sample by index, clamped. */
  sample(ix: number, iz: number): number {
    const n = this.data.resolution
    ix = ix < 0 ? 0 : ix >= n ? n - 1 : ix
    iz = iz < 0 ? 0 : iz >= n ? n - 1 : iz
    return this.data.heights[iz * n + ix]
  }
}

/**
 * Make the tile's far row and column the exact copy of its first, since sample n - 1 lies
 * at +size / 2, the image of -size / 2. Each pair is set to its mean, columns first, then
 * rows, so the four corners end equal. The shading masks are sealed the same way. Returns
 * the largest change made to any height, in metres.
 */
export function sealSeam(data: TerrainData): number {
  const n = data.resolution
  const seal = (h: Float32Array): number => {
    let worst = 0
    const pair = (a: number, b: number) => {
      const m = (h[a] + h[b]) / 2
      worst = Math.max(worst, Math.abs(h[a] - m))
      h[a] = m
      h[b] = m
    }
    for (let i = 0; i < n; i++) pair(i * n, i * n + n - 1)
    for (let i = 0; i < n; i++) pair(i, (n - 1) * n + i)
    return worst
  }
  seal(data.volcanic)
  seal(data.roadDist)
  return seal(data.heights)
}
