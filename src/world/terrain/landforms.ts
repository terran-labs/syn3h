/**
 * Landforms: the world's features beyond the central mountain. Stage 1 of the plan in the
 * world settings design note.
 *
 *  - Isles: extra islands out in the sea, each a wobbled disc of land with channels of open
 *    water round it. They join the island mask (shapeHeight's `rr`), so they get the same
 *    coast, beaches, plains, rocks and dunes as the home island.
 *  - Peaks: extra mountains standing on land, away from the central mountain, its ring road,
 *    the spawn pads and the roads in from them. Each is a cone, a horn, a mesa or a crater,
 *    drawn from the seed with odds that depend on the biome.
 *
 * Everything is placed from its own random stream (`subSeed(seed, 21)`), so the rest of a
 * seed's layout is unchanged. Distances are measured round the wrap, so a landform near
 * the edge of the tile continues on the other side and the seams stay continuous. No
 * liquids yet: lakes and lava on landforms are stage 2.
 *
 * No renderer imports.
 */
import { perlin, ridged, rng, smoothstep, subSeed } from './noise'

export type PeakType = 'cone' | 'horn' | 'mesa' | 'crater'

export interface Isle { x: number; z: number; radius: number; seed: number }
export interface Peak { x: number; z: number; radius: number; height: number; type: PeakType; seed: number }

/** What a biome favours, as relative odds per type. Index: `terrain.look` (shared/recipes.ts BIOME_NAMES). */
const BIOME_ODDS: readonly Readonly<Record<PeakType, number>>[] = [
  { cone: 0.55, horn: 0.15, mesa: 0.05, crater: 0.25 }, // Volcanic
  { cone: 0.1, horn: 0.05, mesa: 0.6, crater: 0.25 }, // Desert
  { cone: 0.2, horn: 0.7, mesa: 0.1, crater: 0 }, // Alpine
  { cone: 0.4, horn: 0.2, mesa: 0.4, crater: 0 }, // Isles
  { cone: 0.2, horn: 0.5, mesa: 0, crater: 0.3 }, // Ice
  { cone: 0.6, horn: 0.3, mesa: 0, crater: 0.1 }, // Obsidian
  { cone: 0, horn: 0.1, mesa: 0.8, crater: 0.1 }, // Badlands
  { cone: 0.25, horn: 0, mesa: 0, crater: 0.75 }, // Moon
  { cone: 0.4, horn: 0, mesa: 0.5, crater: 0.1 }, // Mire
]

function pickType(look: number, roll: number): PeakType {
  const odds = BIOME_ODDS[look] ?? BIOME_ODDS[0]
  const types = Object.keys(odds) as PeakType[]
  let total = 0
  for (const t of types) total += odds[t]
  let r = roll * total
  for (const t of types) { r -= odds[t]; if (r < 0) return t }
  return types[types.length - 1]
}

/** The shortest signed offset from b to a on a tile `size` wide. */
export function wrapDelta(a: number, b: number, size: number): number {
  const d = a - b
  return d - size * Math.round(d / size)
}

const dist = (ax: number, az: number, bx: number, bz: number, size: number) =>
  Math.hypot(wrapDelta(ax, bx, size), wrapDelta(az, bz, size))

/** Sea between two neighbouring landmasses, metres. */
const CHANNEL = 60

/**
 * Up to `count` islands out in the sea, clear of the home island (`homeReach`, its radius
 * with its widest cape) and of each other by a channel. Fewer if they will not fit.
 */
export function placeIsles(seed: number, count: number, size: number, homeReach: number): Isle[] {
  const next = rng(subSeed(seed, 21))
  const isles: Isle[] = []
  for (let tries = 0; isles.length < count && tries < count * 40; tries++) {
    const radius = size * (0.045 + 0.07 * next())
    const x = (next() - 0.5) * size
    const z = (next() - 0.5) * size
    // Room for its own capes (the coast wobbles out by up to a third) and a channel.
    const reach = radius * 1.35
    if (Math.hypot(x, z) < homeReach + reach + CHANNEL) continue
    if (isles.some((o) => dist(x, z, o.x, o.z, size) < o.radius * 1.35 + reach + CHANNEL)) continue
    isles.push({ x, z, radius, seed: subSeed(seed, 200 + isles.length) })
  }
  return isles
}

/** The island mask value (`rr`, 1 at the waterline, lower inland) of the nearest isle at (x, z). */
export function isleMask(isles: readonly Isle[], x: number, z: number, size: number, wobble: number, coastWobble: number): number {
  let best = Infinity
  for (const i of isles) {
    const dx = wrapDelta(x, i.x, size)
    const dz = wrapDelta(z, i.z, size)
    // Cheap reject: beyond any cape this isle could have.
    if (dx > i.radius * 2 || dx < -i.radius * 2 || dz > i.radius * 2 || dz < -i.radius * 2) continue
    // The world's broad coast field barely varies across a small isle, so each has its own
    // capes and bays as well, at its own scale.
    const f = 2.2 / i.radius
    const own = perlin(dx * f, dz * f, i.seed) + 0.25 * perlin(dx * f * 2, dz * f * 2, i.seed + 1)
    const rr = Math.sqrt(dx * dx + dz * dz) / i.radius - coastWobble * (wobble + 1.3 * own)
    if (rr < best) best = rr
  }
  return best
}

/** Places a peak must keep away from: the centre (radius) and the spawn pads with the roads in. */
export interface KeepOut {
  /** Nothing within this radius of the tile centre: the central mountain and its ring road. */
  centre: number
  pads: readonly { x: number; z: number }[]
  /** `rr` at a point, for checking it is land. */
  maskAt(x: number, z: number): number
}

/**
 * Up to `count` peaks on land. `scale` is the planet's `terrain.mesaHeight` (the recipe's
 * idea of how tall mountains are); `k` the tile's size relative to the medium 2048 m.
 */
export function placePeaks(seed: number, count: number, size: number, look: number, scale: number, keep: KeepOut): Peak[] {
  const next = rng(subSeed(seed, 22))
  const k = Math.min(1.25, Math.max(0.6, size / 2048))
  const peaks: Peak[] = []
  for (let tries = 0; peaks.length < count && tries < count * 200; tries++) {
    const type = pickType(look, next())
    const x = (next() - 0.5) * size
    const z = (next() - 0.5) * size
    const radius = (90 + 110 * next()) * k
    const height = type === 'crater'
      ? radius * (0.25 + 0.1 * next())
      : Math.min(radius * 1.4, Math.max(40, scale * (1.1 + 0.9 * next())))
    const s = next()
    if (Math.hypot(x, z) < keep.centre + radius) continue
    // The pads, and the road from each pad in toward the centre.
    let blocked = false
    for (const p of keep.pads) {
      // The same clearances the massifs keep (shapeHeight): the pad's clearing and a corridor in.
      if (dist(x, z, p.x, p.z, size) < 110 + radius * 0.8) { blocked = true; break }
      const len = Math.hypot(p.x, p.z)
      const along = (x * p.x + z * p.z) / len
      if (along > 0 && along < len) {
        const across = Math.abs(x * p.z - z * p.x) / len
        if (across < 70 + radius * 0.8) { blocked = true; break }
      }
    }
    if (blocked) continue
    if (peaks.some((o) => dist(x, z, o.x, o.z, size) < o.radius + radius)) continue
    // Its centre well inland, and most of its foot on land.
    if (keep.maskAt(x, z) > 0.75) continue
    let wet = 0
    for (let a = 0; a < 6; a++) if (keep.maskAt(x + Math.cos(a) * radius * 0.8, z + Math.sin(a) * radius * 0.8) > 1) wet++
    if (wet > 2) continue
    peaks.push({ x, z, radius, height, type, seed: subSeed(seed, 100 + peaks.length) + Math.floor(s * 1000) })
  }
  return peaks
}

/** Height fraction of a peak at normalised radius t (0 at its centre, 1 at its foot). */
function profile(type: PeakType, t: number): number {
  const u = 1 - t
  switch (type) {
    case 'horn': return 0.1 * u + 0.2 * u * u + 0.7 * u * u * u * u
    case 'mesa': return 0.16 * u + 0.4 * smoothstep(0.93, 0.74, t) + 0.44 * smoothstep(0.62, 0.45, t)
    case 'crater': {
      // A raised rim round a bowl sunk below the plain.
      const rim = smoothstep(0.55, 0.78, t) * smoothstep(1.0, 0.8, t)
      const bowl = smoothstep(0.75, 0.2, t)
      return 0.45 * rim - bowl
    }
    default: {
      // A cone with a small summit crater.
      const cone = 0.2 * u + 0.34 * u * u + 0.46 * u * u * u
      return cone - 0.12 * smoothstep(0.1, 0.0, t)
    }
  }
}

/** Rock influence of the last `peaksHeight` call, 0 to 1, for the ground's palette. */
export let peaksVolcanic = 0

/**
 * The height all peaks add at (x, z), metres. `roughness` (terrain.roughness) breaks up
 * their flanks. Sets `peaksVolcanic`.
 */
export function peaksHeight(peaks: readonly Peak[], x: number, z: number, size: number, roughness: number, volcanicLook: boolean): number {
  let h = 0
  let rock = 0
  for (const p of peaks) {
    const dx = wrapDelta(x, p.x, size)
    if (dx > p.radius || dx < -p.radius) continue
    const dz = wrapDelta(z, p.z, size)
    if (dz > p.radius || dz < -p.radius) continue
    const t = Math.sqrt(dx * dx + dz * dz) / p.radius
    if (t >= 1) continue
    let f = profile(p.type, t)
    if (p.type !== 'mesa' && p.type !== 'crater') {
      // Ridged rock on the flanks, from the offset to the peak, so it wraps with it.
      const rough = ridged(dx * 0.02, dz * 0.02, p.seed, 2) - 0.35
      f += roughness * 0.25 * rough * smoothstep(1.0, 0.3, t) * (f > 0 ? f : 0)
    }
    h += p.height * f
    const r = (p.type === 'cone' && volcanicLook ? 0.8 : 0.35) * smoothstep(1.0, 0.5, t)
    if (r > rock) rock = r
  }
  peaksVolcanic = rock
  return h
}
