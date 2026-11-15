/**
 * What the ground is made of at a point, for anything that should respond to it: tyre marks
 * today, and dust, sound or grip later. Plain numbers and no renderer imports, so tests and
 * the server can read it.
 *
 * The terrain material (material.ts) decides the same things per pixel on the GPU, with
 * noise. This is the CPU's coarser reading of the same rules, using the same thresholds at
 * their midpoints: it names the surface a wheel is on, it does not reproduce every patch.
 */
import { wrapCoord } from '../../../shared/wrap'
import type { TerrainData } from './generate'
import { ROAD_WIDTH } from './roadConstants'

export const SURFACE_KINDS = [
  'dust', 'sand', 'grass', 'mud', 'snow', 'ice', 'glass', 'regolith', 'rock', 'road', 'track',
] as const
/**
 * dust: dry soil, ash and clay. sand: loose sand and pale beaches. grass: meadow and turf.
 * mud: the swamp's wet ground. snow: lying snow. ice: the ice moon's plains. glass: obsidian.
 * regolith: the Moon's powder. rock: cliffs, basalt and scorched shores. road: a made road.
 * track: a worn dirt track.
 */
export type SurfaceKind = (typeof SURFACE_KINDS)[number]

/** Everything the classifier reads, so it can be tested without generating a world. */
export interface SurfaceInput {
  /** `terrain.look`: index into the palettes. */
  look: number
  /** 0 flat, 1 vertical (one minus the normal's y). */
  slope: number
  /** Ground height in metres. */
  height: number
  /** Sea level in metres. */
  sea: number
  /** True when the sea is lava, which scorches its shore to rock. */
  lavaSea: boolean
  /** Height where snow starts; a huge number on worlds with none. */
  snowHeight: number
  /** 0..1, how volcanic the ground is (the basalt mask). */
  volcanic: number
  /** Metres to the nearest road centreline. */
  roadDist: number
  /** True when this world's roads are made roads, false for worn tracks. */
  madeRoad: boolean
}

// Looks, by index into palettes.ts LOOK_NAMES.
const DESERT = 1, ALPINE = 2, ARCHIPELAGO = 3, ICE = 4, OBSIDIAN = 5, MOON = 7, SWAMP = 8

/** The bare ground of each look, away from cliffs, snow, shore and roads. */
const BASE: readonly SurfaceKind[] = ['dust', 'sand', 'grass', 'grass', 'ice', 'glass', 'dust', 'regolith', 'mud']

export function classifySurface(i: SurfaceInput): SurfaceKind {
  // Roads are painted over everything else, snow included.
  if (i.madeRoad) {
    if (i.roadDist < ROAD_WIDTH / 2) return 'road'
  } else if (i.roadDist < 2.4) {
    // The worn band is the two ruts at 1.3 m and the strip between and beside them.
    return 'track'
  }
  // Snow lies above the line and thins on steep faces (material.ts: 45 m ramp, slope 0.22 to 0.5).
  if (i.height > i.snowHeight + 22 && i.slope < 0.36) return 'snow'
  // Cliff rock from a slope of 0.16 to 0.38.
  if (i.slope > 0.27) return 'rock'
  // Basalt: the volcanic mask, stronger where it is not flat.
  if (i.volcanic * (0.5 + 0.4 * Math.min(1, Math.max(0, (i.slope - 0.03) / 0.17))) > 0.45) return 'rock'
  // The shore band, strongest within a few metres of the waterline.
  if (i.height - i.sea < 5) {
    if (i.lavaSea) return 'rock'
    if (i.look === DESERT || i.look === ARCHIPELAGO || i.look === ALPINE) return 'sand'
  }
  // Alpine meadow gives way to tundra and scree well below the snow.
  if (i.look === ALPINE && i.height > i.snowHeight * 0.67) return 'dust'
  return BASE[i.look] ?? 'dust'
}

/** Bilinear read of a per-sample grid (roadDist, volcanic) at a world position, wrapped. */
export function sampleGrid(data: TerrainData, grid: Float32Array, x: number, z: number): number {
  const { cell, resolution: n, size } = data
  const half = size / 2
  const gx = (wrapCoord(x, size) + half) / cell
  const gz = (wrapCoord(z, size) + half) / cell
  const ix = Math.min(n - 2, Math.floor(gx))
  const iz = Math.min(n - 2, Math.floor(gz))
  const fx = gx - ix
  const fz = gz - iz
  const i = iz * n + ix
  const top = grid[i] + (grid[i + 1] - grid[i]) * fx
  const bottom = grid[i + n] + (grid[i + n + 1] - grid[i + n]) * fx
  return top + (bottom - top) * fz
}
