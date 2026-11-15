/**
 * Headless terrains for navigator tests: the real generated island without a renderer or
 * physics world, and small synthetic height functions.
 */
import { worldLavaAltitude } from '../../../shared/params'
import { applyPlanet } from '../../../src/world/planets'
import type { Terrain, TerrainRoadPath } from '../../../src/world/Terrain'
import { generateTerrain, type TerrainData } from '../../../src/world/terrain/generate'
import { lavaSurfaceAt } from '../../../src/world/terrain/lava'
import { HeightSampler } from '../../../src/world/terrain/sampler'
import { currentTerrainSettings } from '../../../src/world/terrain/settings'
import { spawnPointAt } from '../../../src/world/terrain/spawn'
import { rimRoadRadius } from '../../../src/world/terrain/roads'
import type { NavProfile } from '../../../src/bots/pilot/types'

export const GROUND: NavProfile = { maxGrade: 0.45, liquid: 'blocked', flies: false, roadCost: 0.35, cruiseAltitude: 0 }
export const HOVER: NavProfile = { maxGrade: 0.35, liquid: 'surface', flies: false, roadCost: 0.6, cruiseAltitude: 0 }
export const AIR: NavProfile = { maxGrade: 1, liquid: 'ignored', flies: true, roadCost: 1, cruiseAltitude: 30 }

export interface IslandTerrain extends Terrain { data: TerrainData }

const cache = new Map<string, IslandTerrain>()

/** The generated island for a planet kind and seed, as a Terrain. Cached per test file. */
export function island(kind: string, seed: number): IslandTerrain {
  const key = `${kind}.${seed}`
  const old = cache.get(key)
  if (old) return old
  applyPlanet(kind, seed)
  const data = generateTerrain(seed, currentTerrainSettings())
  const sea = worldLavaAltitude.value
  applyPlanet('volcanic', 1)
  const s = new HeightSampler(data)
  const t: IslandTerrain = {
    data,
    size: data.size,
    heightAt: (x, z) => s.heightAt(x, z),
    normalAt: (x, z, out) => s.normalAt(x, z, out),
    spawnPoint(i) {
      const p = spawnPointAt(s, i)
      return { position: { x: p.x, y: p.y, z: p.z }, heading: p.heading } as never
    },
    liquidHeightAt: (x, z) => lavaSurfaceAt(data.lava, x, z, sea),
    liquidKindAt(x, z) {
      return lavaSurfaceAt(data.lava, x, z, sea) > s.heightAt(x, z) ? 'water' : null
    },
    roadPaths: () => data.roads as readonly TerrainRoadPath[],
    vents: () => data.vents,
    summit() {
      const v = data.layout.volcano
      const rim = data.roads.find((r) => r.kind === 'rim')!
      const rimHeight = rim.points.reduce((a, p) => a + p.y, 0) / rim.points.length
      const lake = data.lava.lake
      return { x: v.x, z: v.z, rimRadius: rimRoadRadius(data), rimHeight, lake: lake ? { radius: lake.radius, surface: lake.surface } : null }
    },
    dispose() {},
  }
  cache.set(key, t)
  return t
}

/**
 * Interpolate a height function between samples 4 m apart on the same two triangles per
 * cell the Rapier heightfield uses (see sampler.ts), so a synthetic world behaves like the
 * real one: linear between samples, with no step hiding between them.
 */
function triangulated(size: number, fn: (x: number, z: number) => number): (x: number, z: number) => number {
  const cell = 4, half = size / 2, n = Math.floor(size / cell)
  return (x, z) => {
    let gx = (x + half) / cell, gz = (z + half) / cell
    gx = Math.max(0, Math.min(n, gx)); gz = Math.max(0, Math.min(n, gz))
    const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz))
    const fx = gx - ix, fz = gz - iz
    const at = (i: number, j: number) => fn(-half + i * cell, -half + j * cell)
    const h00 = at(ix, iz), h10 = at(ix + 1, iz), h01 = at(ix, iz + 1), h11 = at(ix + 1, iz + 1)
    return fx + fz <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
  }
}

/**
 * A synthetic square world from a height function (sampled every 4 m and triangulated like
 * the collider) and an optional liquid function.
 */
export function synthetic(
  size: number,
  shape: (x: number, z: number) => number,
  extra: { liquid?: (x: number, z: number) => number; roads?: TerrainRoadPath[]; wrapSize?: number } = {},
): Terrain & { regenerate(): void } {
  let listeners: (() => void)[] = []
  const height = triangulated(size, shape)
  return {
    wrapSize: extra.wrapSize,
    regenerate() { for (const l of listeners) l() },
    size,
    heightAt: height,
    normalAt: (_x, _z, out) => out,
    spawnPoint: () => ({ position: { x: 0, y: height(0, 0), z: 0 }, heading: 0 }) as never,
    liquidHeightAt: extra.liquid,
    roadPaths: extra.roads ? () => extra.roads! : undefined,
    onRegenerate(l) { listeners.push(l); return () => { listeners = listeners.filter((x) => x !== l) } },
    dispose() {},
  }
}

/** Small seeded generator for repeatable picks (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RouteCheck {
  /** Steepest climb and descent (negative) met, rise over run, sampled every 4 m or less. */
  climb: number
  descent: number
  /** Samples where ground stands less than 0.5 m above liquid. */
  wet: number
  /** Samples over liquid at all (ground below the liquid surface). */
  overLiquid: number
  /** Longest leg between waypoints. */
  longest: number
}

/** Walk a route on the real surface and report what a vehicle would meet. */
export function checkRoute(t: Terrain, points: readonly { x: number; z: number }[], surface = false): RouteCheck {
  const liquid = (x: number, z: number) => t.liquidHeightAt?.(x, z) ?? -Infinity
  const at = (x: number, z: number) => (surface ? Math.max(t.heightAt(x, z), liquid(x, z)) : t.heightAt(x, z))
  const out: RouteCheck = { climb: 0, descent: 0, wet: 0, overLiquid: 0, longest: 0 }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    out.longest = Math.max(out.longest, len)
    const n = Math.max(1, Math.ceil(len / 4))
    let prev = at(a.x, a.z)
    for (let s = 1; s <= n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n, z = a.z + ((b.z - a.z) * s) / n
      const y = at(x, z)
      const g = (y - prev) / (len / n)
      out.climb = Math.max(out.climb, g)
      out.descent = Math.min(out.descent, g)
      const h = t.heightAt(x, z), l = liquid(x, z)
      if (h < l + 0.5) out.wet++
      if (h < l) out.overLiquid++
      prev = y
    }
  }
  return out
}
