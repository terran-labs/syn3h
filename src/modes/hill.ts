/**
 * Where the hill is: the ring road around the volcano's caldera, from `terrain.summit()`.
 * Pure and deterministic: every client derives the same zone from the same world; the
 * host's copy is the one the server uses. Assumes nothing about where spawns or the origin
 * are: a terrain without a summit gets a disc around spawn point 0.
 */
import type { HillZone } from '../../shared/protocol'

/** The parts of the Terrain interface this reads. */
export interface HillTerrain {
  heightAt(x: number, z: number): number
  spawnPoint(index: number): { position: { x: number; z: number } }
  summit?(): {
    x: number
    z: number
    rimRadius: number
    rimHeight: number
    lake: { radius: number; surface: number } | null
  } | null
}

/** Half the zone's width around the rim road at scale 1: the road (11 m) plus its shoulders. */
const HALF_WIDTH = 14
/** The rim road climbs and dips around its mean height; count vehicles within this below it. */
const BELOW = 15
/** How far above the road a vehicle still counts: a jump or a hover. */
const HEADROOM = 25

export function computeHillZone(t: HillTerrain, scale = 1): HillZone {
  const half = HALF_WIDTH * scale
  const s = t.summit?.() ?? null
  if (s && s.rimRadius > 0) {
    // Never reach into the lava: standing in it is how you lose.
    const inner = Math.max(s.lake ? s.lake.radius + 2 : 0, s.rimRadius - half)
    return finish({
      x: s.x, z: s.z, inner, outer: Math.max(inner + 4, s.rimRadius + half),
      yMin: s.rimHeight - BELOW, yMax: s.rimHeight + HEADROOM,
    })
  }
  // No volcano in this world: a disc where everyone starts.
  const p = t.spawnPoint(0).position
  const h = t.heightAt(p.x, p.z)
  return finish({ x: p.x, z: p.z, inner: 0, outer: 25 * scale, yMin: h - 6, yMax: h + HEADROOM })
}

/** Round so tiny float differences between clients never look like a new zone. */
function finish(z: HillZone): HillZone {
  const r = (n: number) => Math.round(n * 100) / 100
  return { x: r(z.x), z: r(z.z), inner: r(z.inner), outer: r(z.outer), yMin: r(z.yMin), yMax: r(z.yMax) }
}
