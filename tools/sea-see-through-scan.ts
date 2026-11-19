/**
 * Where does land above the waterline show through the sea? A headless ray cast over the real
 * terrain, drawn on the bent planet exactly as curve.ts bends it.
 *
 *   npx tsx tools/sea-see-through-scan.ts [planet] [seed] [planetSize] [roundness]
 *
 * From a lens 1.2 m over open sea, straight rays (alpha blending shows what lies along the
 * unrefracted line) are cast at 32 headings and pitches from 0.5 to 20 degrees down. Each ray
 * that enters the sea is followed on; if it next meets ground above sea level, that land is
 * blended through the water with the transmission the water shader gives the entry pixel. The
 * shader's opacity is evaluated twice: as on main (flat grazing angle, depth along the refracted
 * path) and with the fix (true grazing angle on the bent surface, and whole where the straight
 * line cannot reach the bed). Reports the worst places, how much land shows, and the share of
 * clear water left elsewhere.
 */
import { params } from '../shared/params'
import '../src/world/terrain/settings'
import '../src/world/water/params'
import { applyPlanet } from '../src/world/planets'
import { currentTerrainSettings } from '../src/world/terrain/settings'
import { generateTerrain } from '../src/world/terrain/generate'
import { HeightSampler, sealSeam } from '../src/world/terrain/sampler'
import { curveRadius } from '../src/world/curve'

const [planet = 'alpine', seed = '4', planetSize = '1', roundness = '0.75'] = process.argv.slice(2)
applyPlanet(planet, Number(seed)); params.set('terrain.planetSize', Number(planetSize))
const data = generateTerrain(Number(seed), currentTerrainSettings()); sealSeam(data)
const g = new HeightSampler(data), sea = Number(params.get('world.lavaAltitude')!.value)
const R = curveRadius(data.size, Number(roundness)), clarity = Number(params.get('water.clarity')?.value ?? 10)
const IOR2 = 1.333 * 1.333, EYE = 1.2
const MARCH_GEOMETRIC = Number(process.env.MARCH_G ?? 8), MARCH_EVEN = Number(process.env.MARCH_E ?? 0)

const smooth = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u) }
/**
 * The fix's march, as surface.ts does it: does the straight line from the camera, entering at
 * (x, z) going along (dx, dz) at grazing sine `up`, get below the bed before it comes back out of
 * the curving sea? 1 yes (we see the bed), 0 no (what lies behind is above the water).
 */
function reachesBed(x0: number, z0: number, dx: number, dz: number, ex: number, ey: number, vx: number, vy: number, up: number, depth: number): number {
  // Exact on the drawn sphere: step along the straight line from its entry (ex, ey) in the
  // heading's plane (camera ground point at the origin, the planet's centre at (0, -R)), take
  // its height over the sphere and the bed's depth at the ground point under it.
  const sinA = Math.max(up, 1e-3), chord = 2 * sinA * R
  let best = -1e9, u = Math.max(depth, 0.05) / sinA
  const at = (s: number) => {
    const px = ex + s * vx, py = ey + s * vy, rho = Math.hypot(px, py + R), t = Math.atan2(px, py + R)
    const gd = R * t, bed = sea - g.heightAt(x0 + dx * gd, z0 + dz * gd)
    best = Math.max(best, (R - rho) - bed)
  }
  for (let k = 0; k < MARCH_GEOMETRIC; k++, u *= 2) at(Math.min(u, chord * 0.95))
  for (let k = 1; k <= MARCH_EVEN; k++) at((chord * 0.95 * k) / (MARCH_EVEN + 1))
  return smooth(0, 0.3, best)
}
/** The water shader's opacity from above, given the sight line's grazing sine and the depth. */
function opacity(up: number, depth: number, fixed: boolean, reach = 1): number {
  up = Math.min(1, Math.abs(up))
  const cosBelow = Math.sqrt(1 - (1 - up * up) / IOR2)
  const kept = Math.exp((-2.3 * Math.max(depth, 0) / cosBelow) / clarity)
  const mirror = Math.pow(1 - up, 5) * 0.98 + 0.02
  let a = 1 - (1 - mirror) * kept
  if (fixed) a = Math.max(a, 1 - reach)
  return a
}

interface Hit { x: number; z: number; heading: number; pitch: number; land: number; through: number; throughFixed: number; depth: number }
const hits: Hit[] = []
let clearRays = 0, clearRaysFixedOpaque = 0
const size = data.size
for (let k = 0; k < 6000; k++) {
  const x0 = (Math.sin(k * 12.9898) * 0.5) * size * 0.95, z0 = (Math.cos(k * 78.233) * 0.5) * size * 0.95
  const d0 = sea - g.heightAt(x0, z0)
  if (d0 < 0.5 || d0 > 15) continue
  for (let hi = 0; hi < 32; hi++) {
    const h = (hi / 32) * Math.PI * 2, dx = -Math.sin(h), dz = -Math.cos(h)
    for (const pitchDeg of [0.5, 1, 2, 3, 5, 7, 10, 14, 20]) {
      const p = (pitchDeg * Math.PI) / 180
      // The ray in the plane of the heading: from (0, EYE) above the sea at the camera, centre at (0, -R).
      const vx = Math.cos(p), vy = -Math.sin(p)
      // Entry: |O + s v - C| = R with O = (0, EYE), C = (0, -R).
      const oy = EYE + R, b = oy * vy, c = oy * oy - R * R, disc = b * b - c
      if (disc < 0) continue
      const s0 = -b - Math.sqrt(disc)
      const ex = s0 * vx, ey = EYE + s0 * vy
      const t0 = Math.atan2(ex, ey + R), d = R * t0
      const wx = x0 + dx * d, wz = z0 + dz * d, depth = sea - g.heightAt(wx, wz)
      if (depth <= 0) continue
      // Grazing sine on the flat world (main) and on the bent surface (the fix).
      const flatUp = EYE / Math.hypot(d, EYE)
      const nx = Math.sin(t0), ny = Math.cos(t0), lx = -ex, ly = EYE - ey, ll = Math.hypot(lx, ly)
      const bentUp = (lx * nx + ly * ny) / ll
      const through = 1 - opacity(flatUp, depth, false), throughFixed = 1 - opacity(bentUp, depth, true, reachesBed(x0, z0, dx, dz, ex, ey, vx, vy, bentUp, depth))
      // Follow the straight line on until it meets ground, or runs 1.5 km.
      // Only land the line reaches after coming back out of the curving sea, 20 m on or more:
      // land behind the water, not a beach at the water's own edge.
      let land = -Infinity, out = false
      for (let s = s0 + 1; s < s0 + 1500; s += 2) {
        const px = s * vx, py = EYE + s * vy, rho = Math.hypot(px, py + R), t = Math.atan2(px, py + R)
        if (t > Math.PI) break
        const above = rho - R, gd = R * t, gx = x0 + dx * gd, gz = z0 + dz * gd, ground = g.heightAt(gx, gz) - sea
        if (above > 0) out = true
        if (above <= ground) { if (out && s - s0 > 20) land = ground; break }
      }
      if (land > 5) hits.push({ x: x0, z: z0, heading: h, pitch: pitchDeg, land, through, throughFixed, depth })
      else if (depth < 1.5 && pitchDeg >= 10) { clearRays++; if (throughFixed < through * 0.5) clearRaysFixedOpaque++ }
    }
  }
}
hits.sort((a, b) => b.through - a.through)
const strong = hits.filter((h) => h.through > 0.1)
console.log(JSON.stringify({
  world: `${planet} ${seed} ${data.size} m roundness ${roundness}`, drawnRadius: Math.round(R),
  raysSeeingLandThroughSea: hits.length, ofThemOver10pc: strong.length,
  worstThroughMain: +(hits[0]?.through ?? 0).toFixed(2), worstThroughFixed: +Math.max(0, ...hits.map((h) => h.throughFixed)).toFixed(3),
  worst: hits.slice(0, 5).map((h) => ({ x: +h.x.toFixed(0), z: +h.z.toFixed(0), heading: +h.heading.toFixed(3), pitchDeg: h.pitch, landHeight: +h.land.toFixed(0), depth: +h.depth.toFixed(1), through: +h.through.toFixed(2), throughFixed: +h.throughFixed.toFixed(3) })),
  worstAfterFix: [...hits].sort((a, b) => b.throughFixed - a.throughFixed).slice(0, 4).map((h) => ({ x: +h.x.toFixed(0), z: +h.z.toFixed(0), heading: +h.heading.toFixed(3), pitchDeg: h.pitch, landHeight: +h.land.toFixed(0), depth: +h.depth.toFixed(1), through: +h.through.toFixed(2), throughFixed: +h.throughFixed.toFixed(3) })),
  nearShallowsSteep: { rays: clearRays, madeMuchMoreOpaqueByFix: clearRaysFixedOpaque },
}))
