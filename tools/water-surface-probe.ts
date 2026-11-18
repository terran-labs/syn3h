/**
 * Where is the water? Compares, on generated worlds, the height physics floats things at
 * (ProceduralTerrain.liquidHeightAt: lavaSurfaceAt plus the body's waves) with what the game
 * draws: the actual river and lake mesh vertices the game builds (volcanics.ts), and the
 * vertex shader's wave sum as it is written in surface.ts (fade by mesh spacing per quality
 * level). Read-only; prints a table.
 *
 *   npx tsx tools/water-surface-probe.ts
 */
import { params } from '../shared/params'
import '../src/world/terrain/settings'
import { applyPlanet } from '../src/world/planets'
import { currentTerrainSettings } from '../src/world/terrain/settings'
import { generateTerrain } from '../src/world/terrain/generate'
import { HeightSampler, sealSeam } from '../src/world/terrain/sampler'
import { lavaSurfaceAt } from '../src/world/terrain/lava'
import { riverPieces } from '../src/world/water/falls'
import { buildRiverSurface, buildStillSurface } from '../src/world/water/surface'
import { configureWorldWater } from '../src/world/terrain/ProceduralTerrain'
import { liquidWavesAt, liquidShoal, type LiquidBody } from '../src/world/water/liquidWaves'

const INLAND: LiquidBody = { kind: 'inland', liquid: 'water', frozen: false }
const smooth = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u) }
const q = (xs: number[], f: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN }
const r2 = (x: number) => +x.toFixed(2)

for (const [planet, seed] of [['desert', 4], ['desert', 77], ['alpine', 4], ['archipelago', 4], ['swamp', 4]] as const) {
  applyPlanet(planet, seed, { nameSeed: 1 })
  params.set('world.seaKind', 1)
  const settings = currentTerrainSettings()
  const data = generateTerrain(seed, settings); sealSeam(data)
  configureWorldWater(data.size, seed)
  const ground = new HeightSampler(data)
  const sea = data.settings.dry ? -Infinity : Number(params.get('world.lavaAltitude')!.value)
  const lava = data.lava
  const waterAt = (x: number, z: number) => {
    let y = sea
    for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.radius ** 2) y = Math.max(y, b.surface)
    return y
  }
  // Rest heights: drawn river ribbon vertices against the physics surface at the same spot.
  const above: number[] = [], centre: number[] = []
  let inPhysics = 0, notInPhysics = 0
  for (const r of lava.rivers) {
    if (r.points.length < 2) continue
    const pieces = riverPieces(ground, r.points, r.width, waterAt, 9.81, Number(params.get('water.riverMaxSpeed')?.value ?? 4))
    if (pieces.points.length < 2) continue
    const geo = buildRiverSurface(ground, pieces.points, r.width + 1.5, () => 1, 3)
    const pos = geo.getAttribute('position')
    const cols = Math.max(3, 2 * Math.round((r.width + 1.5) / 3 / 2) + 1)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const phys = lavaSurfaceAt(lava, x, z, -Infinity)
      if (!Number.isFinite(phys)) { notInPhysics++; continue }
      inPhysics++
      above.push(phys - y)
      if (i % cols === (cols - 1) / 2) centre.push(phys - y)
    }
  }
  // The same river, split by cause, sampled every 3 m along its planned centre line:
  //  drape = planned surface minus the drawn (draped) centre line there;
  //  overlap = the physics answer (highest body at that spot) minus this river's planned surface;
  //  depth = planned surface minus the ground (how deep physics thinks the water is).
  const drape: number[] = [], overlap: number[] = [], depthPlanned: number[] = [], depthDrawn: number[] = []
  for (const r of lava.rivers) {
    if (r.points.length < 2) continue
    const pieces = riverPieces(ground, r.points, r.width, waterAt, 9.81, 4)
    const d = pieces.points
    if (d.length < 2) continue
    const drawnAt = (x: number, z: number) => {
      let best = Infinity, y = NaN
      for (let i = 0; i < d.length - 1; i++) {
        const a = d[i], c = d[i + 1], dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz
        let t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t))
        const e = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2
        if (e < best) { best = e; y = a.y + (c.y - a.y) * t }
      }
      return best < 1 ? y : NaN
    }
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i], c = r.points[i + 1], n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 3))
      for (let k = 0; k < n; k++) {
        const t = k / n, x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t, planned = a.y + (c.y - a.y) * t
        const drawn = drawnAt(x, z)
        if (!Number.isFinite(drawn)) continue
        if (planned <= waterAt(x, z) + 0.05) continue
        drape.push(planned - drawn)
        overlap.push(lavaSurfaceAt(lava, x, z, -Infinity) - planned)
        depthPlanned.push(planned - ground.heightAt(x, z)); depthDrawn.push(drawn - ground.heightAt(x, z))
      }
    }
  }
  const st = (xs: number[]) => ({ n: xs.length, median: r2(q(xs, 0.5)), p90: r2(q(xs, 0.9)), max: r2(q(xs, 1)), over30cm: xs.filter((v) => v > 0.3).length })
  const split = { drape: st(drape), overlap: st(overlap), physicsDepth: st(depthPlanned), drawnDepth: st(depthDrawn) }
  // Lake and pool rings: rest height.
  const lakeRest: number[] = []
  for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) {
    const geo = buildStillSurface(ground, b.x, b.surface, b.z, b.radius, 3)
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) { const phys = lavaSurfaceAt(lava, pos.getX(i), pos.getZ(i), -Infinity); if (Number.isFinite(phys)) lakeRest.push(phys - pos.getY(i)) }
  }
  // Waves on inland water: physics sums every component; the shader drops those shorter than
  // 3 to 5 mesh spacings. Spacing per quality level 0..5 (volcanics.ts stillSpacing).
  const waveGap: Record<string, number> = {}
  const body = lava.lake ?? lava.pools[0]
  if (body) {
    for (const [level, spacing] of [[0, 4], [1, 3], [2, 2], [3, 1.5], [4, 1], [5, 0.75]] as const) {
      let worst = 0
      for (let t = 0; t < 60; t += 0.7) {
        const f = liquidWavesAt(INLAND, t)
        for (let k = 0; k < 40; k++) {
          const a = (k / 40) * Math.PI * 2, rr = body.radius * 0.6 * ((k % 5) / 5)
          const x = body.x + Math.cos(a) * rr, z = body.z + Math.sin(a) * rr
          const depth = body.surface - ground.heightAt(x, z)
          const s = liquidShoal(f, depth)
          let phys = 0, drawn = 0
          for (const c of f.components) {
            const v = c.amplitude * Math.sin(c.kx * x + c.kz * z + c.phase)
            phys += v
            drawn += v * smooth(spacing * 3, spacing * 5, (Math.PI * 2) / Math.max(1e-4, Math.hypot(c.kx, c.kz)))
          }
          worst = Math.max(worst, Math.abs((phys - drawn) * s))
        }
      }
      waveGap[`q${level}`] = r2(worst)
    }
  }
  console.log(JSON.stringify({
    world: `${planet} ${seed}`, size: data.size, rivers: lava.rivers.length, lakes: (lava.lake ? 1 : 0) + lava.pools.length,
    riverVertices: { inPhysics, outsidePhysicsRiver: notInPhysics },
    physicsAboveDrawnRiver_m: { median: r2(q(above, 0.5)), p90: r2(q(above, 0.9)), max: r2(q(above, 1)), over30cm: above.filter((d) => d > 0.3).length },
    centreLine_m: { median: r2(q(centre, 0.5)), p90: r2(q(centre, 0.9)), max: r2(q(centre, 1)) },
    lakeRest_m: { max: r2(Math.max(0, ...lakeRest.map(Math.abs))) },
    inlandWaveMissingFromMesh_m: waveGap,
    riverSplit_m: split,
  }))
}
