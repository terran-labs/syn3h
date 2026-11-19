/**
 * The world from straight above, for maps (Terrain.mapColourAt): a grid of 0xRRGGBB colours
 * baked once per world, sea and freeze. Its own ground palette by height and slope, snow
 * above the snow line, shore at the waterline, the sea as water or lava, ice when frozen,
 * and the lake, pools and rivers. No renderer imports, so tests read it directly.
 */
import { Vector3 } from 'three/webgpu'
import type { TerrainData } from './generate'
import { lavaSurfaceAt } from './lava'
import { paletteFor, SEA_ICE } from './palettes'
import type { HeightSampler } from './sampler'
import { KIND_VOLCANIC } from './settings'

/** Cells across the baked grid: 8 m each on a 2 km world, finer than any minimap draws. */
export const MAP_GRID = 256

const mixHex = (a: number, b: number, t: number) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return (((a >> 16 & 255) * (1 - t) + (b >> 16 & 255) * t) << 16) | (((a >> 8 & 255) * (1 - t) + (b >> 8 & 255) * t) << 8) | ((a & 255) * (1 - t) + (b & 255) * t)
}

/**
 * Bake the grid, row by row from the north-west corner (x and z from -size/2). About 65,000
 * height, slope and liquid reads: 15 to 40 ms on a desktop, once per world and seed.
 */
export function bakeMapColours(data: TerrainData, sampler: Pick<HeightSampler, 'heightAt' | 'normalAt'>, sea: { sea: number; lava: boolean; frozen: boolean; snow: number },
  /** The river lines the water is drawn at (falls.ts waterRiverLines); planned lines if undefined. */
  rivers?: readonly (readonly { x: number; y: number; z: number }[])[]): Uint32Array {
  const n = MAP_GRID, size = data.size, pal = paletteFor(data.settings.look), dry = data.settings.dry > 0
  const summit = Math.max(1, data.layout.summitHeight), out = new Uint32Array(n * n), normal = new Vector3()
  const lakeIsLava = data.settings.kind === KIND_VOLCANIC
  const water = (depth: number) => sea.lava ? mixHex(0x2a0703, 0xff7a1a, 0.35 + 0.4 * Math.max(0, 1 + depth / 30))
    : sea.frozen ? mixHex(SEA_ICE.old, SEA_ICE.floe, 0.5) : mixHex(pal.seaDeep, pal.seaShallow, 1 + depth / 40)
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = ((ix + 0.5) / n - 0.5) * size, z = ((iz + 0.5) / n - 0.5) * size
    const h = sampler.heightAt(x, z)
    let c: number
    if (!dry && h <= sea.sea) c = water(h - sea.sea)
    else {
      const slope = 1 - sampler.normalAt(x, z, normal).y
      c = mixHex(pal.groundDark, pal.groundLight, 0.3 + 0.6 * Math.max(0, h) / summit)
      c = mixHex(c, pal.rockDark, (slope - 0.12) * 4)
      if (!dry) c = mixHex(c, pal.shore, (6 - (h - sea.sea)) / 4)
      if (h > sea.snow) c = mixHex(c, pal.snow, (h - sea.snow) / 30)
      // Lake, pools and rivers above the sea: lava on a volcano's world, else water.
      if (!dry && lavaSurfaceAt(data.lava, x, z, -Infinity, rivers) > h - 0.5) c = lakeIsLava ? 0xff7a1a : mixHex(pal.seaDeep, pal.seaShallow, 0.6)
    }
    out[iz * n + ix] = c
  }
  return out
}
