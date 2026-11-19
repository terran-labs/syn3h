/**
 * Buggy in water, headless, for before and after comparisons of the hull forces (liquidHull.ts).
 * Evidence, not a test: it reports and never judges. Uses the liquid scenario basins
 * (tests/vehicles/liquidScenarios.ts), the same ground the liquid tests and the handling report use.
 *
 *   npx tsx tools/buggy-water-probe.ts [out.json] [--set id=value ...]
 *
 * - sink: at rest at the surface of a 30 m pool, no throttle. Terminal sink speed, and seconds
 *   to the bed in 4 m and 12 m pools.
 * - bed: on the bed of a 12 m pool, full throttle for 8 s then coasting: speed reached on the
 *   bed and how far it coasts.
 * - paddle: full throttle from rest in calm water: speed and how deep the body rides.
 * - skim: entering open water at 10 to 35 m/s under full throttle: over the next 200 m, the body's
 *   height above the surface, its speed, and whether it is still up at the end.
 * - goesUnder: coasting off a 30 m/s skim, the speed at which its top goes under.
 * - climbOut: skimming in at 25 m/s toward a gentle (8 degree) shore 120 m away: does it drive
 *   out, and how long from the water's edge.
 */
import { writeFileSync } from 'node:fs'
import * as THREE from 'three/webgpu'
import { params } from '../shared/params'
import '../src/world/terrain/settings'
import { FIXED_DT, initPhysics } from '../src/core/physics'
import { Syn3hBuggy } from '../src/vehicles/Syn3hBuggy'
import { advance, ashore, basinBed, coast, dispose, entry, exitTime, fromRest, makeVehicle, type Basin, type Run } from '../tests/vehicles/liquidScenarios'

const args = process.argv.slice(2)
const out = args[0] && !args[0].startsWith('--') ? args[0] : '/tmp/buggy-water/probe.json'
const sets = args.flatMap((a, i) => (a === '--set' ? [args[i + 1]] : [])).map((kv) => { const [id, v] = kv.split('='); return [id, v === 'true' ? true : v === 'false' ? false : Number(v)] as const })
const reset = () => { for (const p of params.all()) params.set(p.def.id, p.def.default); for (const [id, v] of sets) params.set(id, v) }
const r2 = (x: number) => +x.toFixed(2)

/** Placed at the surface at rest in a `depth` m pool, no throttle: the fall to the bed. */
function sink(depth: number, seconds = 30) {
  reset()
  const basin: Basin = { liquid: 'water', length: 400, depth, slope: 15 }
  const { h, g, clock } = basinBed(basin)
  const v = makeVehicle('buggy', h, new THREE.Vector3(0, 0.2, -basin.length / 2))
  const run: Run = { clock, h, v, basin, trace: [], ground: g }
  v.input.y = 0
  // On the bed: the body's centre within 1.1 m of the floor (it rests about 0.7 m up).
  advance(run, seconds, (s) => s.y - g(s.z) < 1.1 && Math.abs(s.vy) < 0.2)
  const bedAt = run.trace.find((s) => s.y - g(s.z) < 1.2)
  const falling = run.trace.filter((s) => s.y < -1 && s.y - g(s.z) > 2)
  const terminal = falling.length ? Math.min(...falling.map((s) => s.vy)) : Math.min(...run.trace.map((s) => s.vy))
  const res = { depth, secondsToBed: bedAt ? r2(bedAt.t) : null, terminalSinkSpeed: r2(-terminal), trace: run.trace.filter((_, i) => i % 5 === 0).map((s) => [r2(s.t), r2(s.y), r2(s.vy)]) }
  dispose(run)
  return res
}

/** On the bed of a 12 m pool: drive 8 s, then coast. */
function bed() {
  reset()
  const basin: Basin = { liquid: 'water', length: 400, depth: 12, slope: 15 }
  const { h, g, clock } = basinBed(basin)
  const v = makeVehicle('buggy', h, new THREE.Vector3(0, -basin.depth + 1, -basin.length / 2))
  const run: Run = { clock, h, v, basin, trace: [], ground: g }
  v.input.y = 0
  advance(run, 4)
  run.trace.length = 0
  v.input.y = 1
  advance(run, 8)
  const driven = run.trace.at(-1)!
  const z0 = driven.z
  v.input.y = 0
  run.trace.length = 0
  advance(run, 8)
  const rest = run.trace.find((s) => s.speed < 0.3)
  const res = { speedOnBedAfter8s: r2(driven.speed), heightAboveBed: r2(driven.y - g(driven.z)), coastDistance: r2(Math.abs((rest ?? run.trace.at(-1)!).z - z0)), coastSeconds: rest ? r2(rest.t - run.trace[0].t + FIXED_DT) : null }
  dispose(run)
  return res
}

/** Placed at the surface of calm deep water, full throttle at once: measured from 4 s to 12 s. */
function paddle() {
  reset()
  const basin: Basin = { liquid: 'water', length: 600, depth: 8, slope: 15 }
  const { h, g, clock } = basinBed(basin)
  const v = makeVehicle('buggy', h, new THREE.Vector3(0, 0.1, -basin.length / 2 + 200))
  const run: Run = { clock, h, v, basin, trace: [], ground: g }
  v.input.y = 1
  advance(run, 12.5)
  const steady = run.trace.filter((s) => s.t > 4 && s.t < 12.5)
  const mean = (k: 'speed' | 'depth' | 'pitch') => steady.reduce((a, s) => a + s[k], 0) / Math.max(1, steady.length)
  const res = { speed: r2(mean('speed')), bodyCentreBelowSurface: r2(mean('depth')), pitch: r2(mean('pitch')), sank: steady.some((s) => s.depth > 0.9) }
  dispose(run)
  return res
}

/** Enter open water at `speed` m/s under full throttle; the next 200 m. */
function skim(speed: number) {
  reset()
  const run = entry('buggy', { liquid: 'water', length: 400, depth: 8, slope: 15 }, speed, 25)
  const over = run.trace.filter((s) => s.z < -10 && s.z > -210)
  const end = over.at(-1) ?? run.trace.at(-1)!
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
  const res = {
    entry: speed,
    reached200m: over.length > 0 && end.z <= -205,
    meanHeightAboveSurface: r2(mean(over.map((s) => -s.depth))),
    meanSpeed: r2(mean(over.map((s) => s.speed))),
    endSpeed: r2(end.speed),
    stillUpAtEnd: end.depth < 0.5,
    secondsFor200m: over.length ? r2(over.at(-1)!.t - over[0].t) : null,
  }
  dispose(run)
  return res
}

/** Coasting off a 30 m/s skim: the speed when its top goes under for good. */
function goesUnder() {
  reset()
  const c = coast('water', 30, 15)
  const t0 = c.run.trace[0]?.t ?? 0
  const at = c.under === null ? null : c.run.trace.find((s) => s.t - t0 >= c.under! - 1e-6)
  const res = { secondsToUnder: c.under === null ? null : r2(c.under), speedWhenUnder: at ? r2(at.speed) : null, coastDistance: r2(c.distance) }
  dispose(c.run)
  return res
}

/** Skim in at 25 m/s toward a gentle shore 120 m away. */
function climbOut() {
  reset()
  const run = entry('buggy', { liquid: 'water', length: 120, depth: 5, slope: 8 }, 25, 30)
  const res = { ashore: ashore(run), secondsWaterToShore: exitTime(run) === null ? null : r2(exitTime(run)!), sankOnTheWay: run.trace.some((s) => s.z < -5 && s.z > -110 && s.depth > 0.9) }
  dispose(run)
  return res
}

async function main() {
  await initPhysics()
  void Syn3hBuggy
  const result = {
    sets,
    sink30: sink(30), sink4: sink(4), sink12: sink(12),
    bed: bed(), paddle: paddle(),
    skim: [10, 15, 20, 25, 30, 35].map(skim),
    goesUnder: goesUnder(), climbOut: climbOut(),
  }
  writeFileSync(out, JSON.stringify(result))
  const brief = { ...result, sink30: { ...result.sink30, trace: undefined }, sink4: { ...result.sink4, trace: undefined }, sink12: { ...result.sink12, trace: undefined } }
  console.log(JSON.stringify(brief, null, 1))
}
void main()
