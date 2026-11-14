/**
 * Height and normal queries on the generated grid, matching the Rapier heightfield exactly.
 *
 * Rapier (parry) splits every cell into two triangles along the anti-diagonal from
 * (ix + 1, iz) to (ix, iz + 1); tests/world measured this against rays (the other diagonal
 * is off by up to half a metre, bilinear by a quarter). Interpolating on the same
 * triangles means `heightAt` returns the height the physics collides with, to float precision.
 */
import type { TerrainData } from './generate'

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export class HeightSampler {
  constructor(public data: TerrainData) {}

  /** Grid coordinates of a world position, clamped to the grid. */
  private locate(x: number, z: number): { ix: number; iz: number; fx: number; fz: number } {
    const { cell, resolution: n, size } = this.data
    const half = size / 2
    let gx = (x + half) / cell
    let gz = (z + half) / cell
    const max = n - 1
    gx = gx < 0 ? 0 : gx > max ? max : gx
    gz = gz < 0 ? 0 : gz > max ? max : gz
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
