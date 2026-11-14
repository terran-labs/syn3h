/**
 * Where the hill is. Reads only public terrain data (the object behind the Terrain
 * interface exposes `data.lava.lake`, `data.roads` and `data.layout.volcano`), duck typed so a
 * terrain without them still gets a zone. Pure and deterministic: every client derives the
 * same zone from the same seed; the host's copy is the one the server uses.
 */
import type { HillZone } from '../../shared/protocol'

interface Pt { x: number; y: number; z: number }

/** The parts of a terrain this reads. All optional. */
export interface HillTerrain {
  heightAt(x: number, z: number): number
  data?: {
    lava?: { lake?: { x: number; z: number; radius: number; surface: number } | null }
    roads?: { kind: string; closed: boolean; points: Pt[] }[]
    layout?: { volcano?: { x: number; z: number; calderaRadius: number } }
  }
}

/** Half the zone's width around the rim road at scale 1: the road (11 m) plus its shoulders. */
const HALF_WIDTH = 14
/** How far above the road a vehicle still counts: a jump or a hover. */
const HEADROOM = 25

export function computeHillZone(t: HillTerrain, scale = 1): HillZone {
  const d = t.data
  const lake = d?.lava?.lake ?? null
  const rim = d?.roads?.find((r) => r.kind === 'rim' && r.closed && r.points.length >= 8)
  const volcano = d?.layout?.volcano
  const half = HALF_WIDTH * scale

  if (rim) {
    let cx: number
    let cz: number
    if (lake) {
      cx = lake.x
      cz = lake.z
    } else {
      cx = rim.points.reduce((s, p) => s + p.x, 0) / rim.points.length
      cz = rim.points.reduce((s, p) => s + p.z, 0) / rim.points.length
    }
    const dists = rim.points.map((p) => Math.hypot(p.x - cx, p.z - cz))
    const r = dists.reduce((s, v) => s + v, 0) / dists.length
    const ys = rim.points.map((p) => p.y)
    // Never reach into the lava: standing in it is how you lose.
    const inner = Math.max(lake ? lake.radius + 2 : 0, r - half)
    return finish({ x: cx, z: cz, inner, outer: Math.max(inner + 4, r + half), yMin: Math.min(...ys) - 4, yMax: Math.max(...ys) + HEADROOM })
  }

  if (volcano) {
    // No road: a band just outside the caldera, at the height the ground has there.
    const r = volcano.calderaRadius * 1.15
    const hs = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2
      return t.heightAt(volcano.x + Math.cos(a) * r, volcano.z + Math.sin(a) * r)
    })
    const inner = Math.max(lake ? lake.radius + 2 : 0, r - half)
    return finish({ x: volcano.x, z: volcano.z, inner, outer: Math.max(inner + 4, r + half), yMin: Math.min(...hs) - 6, yMax: Math.max(...hs) + HEADROOM })
  }

  // A terrain with no volcano at all (the placeholder): a disc at the origin.
  const h = t.heightAt(0, 0)
  return finish({ x: 0, z: 0, inner: 0, outer: 25 * scale, yMin: h - 6, yMax: h + HEADROOM })
}

/** Round so tiny float differences between clients never look like a new zone. */
function finish(z: HillZone): HillZone {
  const r = (n: number) => Math.round(n * 100) / 100
  return { x: r(z.x), z: r(z.z), inner: r(z.inner), outer: r(z.outer), yMin: r(z.yMin), yMax: r(z.yMax) }
}
