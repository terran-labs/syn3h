import { appendFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Quaternion, Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { DAYDREAM_PERSONALITY } from '../../src/bots/Daydream'
import { Mind } from '../../src/bots/mind/Mind'
import { createPilot } from '../../src/bots/pilot'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { Jet } from '../../src/vehicles/Jet'
import { applyPlanetForTest, island, resetPlanet } from './island'
import { createNavigator, pointsOfInterest } from '../../src/bots/nav'
import '../../src/bots/params'
import { params } from '../../shared/params'

beforeAll(async () => {
  await initPhysics()
  if (process.env.BOT_FORWARD_FLIGHT !== undefined) params.set('bots.jetForwardFlight', process.env.BOT_FORWARD_FLIGHT === '1')
})
const DT = 0.02
const DRIVE_LOG = process.env.BOT_DRIVE_LOG ?? '/tmp/syn3h-island-drive.log'

/** Drive the real island for `seconds` and report where the mind went and how it fared. */
export function drive(seed: string, seconds: number, verbose = false, vehicleKind: 'buggy' | 'jet' | 'hovercraft' = 'buggy', world_: number | string = 0, countReachable = true) {
  // A number is one of the three original world kinds with default settings; a name is a
  // planet recipe, applied as the game applies it, with its own gravity and sea.
  const planet = typeof world_ === 'string' ? applyPlanetForTest(world_, 1) : null
  const world = createWorld(planet?.gravity ?? 9.81)
  const terrain = planet ? island(world, 1, planet.settings, planet.seaLevel, true) : island(world, 1, { kind: world_ as number })
  if (planet) resetPlanet()
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const spawn = terrain.spawnPoint(0), sights = pointsOfInterest(terrain), navigator = createNavigator(terrain)
  const buggy = vehicleKind === 'jet' ? new Jet(game, terrain, spawn.position, spawn.heading) : vehicleKind === 'hovercraft' ? new Hovercraft(game, terrain, spawn.position, spawn.heading) : new Syn3hBuggy(game, terrain, spawn.position, spawn.heading); buggy.isLocal = false
  const mind = new Mind(buggy, terrain, createPilot(buggy, terrain)!, { seed, personality: DAYDREAM_PERSONALITY, navigator, places: () => sights })
  const kinds = new Set<string>(); let flight = 0, soaked = false, travel = 0, lastSteer = 0, side = 0, reversals = 0, crashed = false, low = Infinity, path = 0, wet = 0, flipped = 0, slow = 0, far = 0, kind = ''
  const last = spawn.position.clone(), cells = new Set<string>(), up = new Vector3(), q = new Quaternion()
  for (let i = 0; i < seconds / DT; i++) {
    mind.step(DT, buggy.input); buggy.fixedUpdate(DT); world.step(); buggy.postPhysics(DT)
    const p = buggy.body.translation(), v = buggy.body.linvel()
    path += Math.hypot(p.x - last.x, p.z - last.z); last.set(p.x, p.y, p.z)
    // How busy the steering is: wheel travel per second (1 is centre to full lock), and how
    // often it swaps sides. A smooth driver moves the wheel little and seldom reverses it.
    if (buggy.input.special) flight += DT
    const sx = buggy.input.x
    travel += Math.abs(sx - lastSteer); lastSteer = sx
    if (Math.abs(sx) > 0.15 && Math.sign(sx) !== side) { if (side !== 0) reversals++; side = Math.sign(sx) }
    far = Math.max(far, Math.hypot(p.x - spawn.position.x, p.z - spawn.position.z))
    cells.add(`${Math.floor(p.x / 64)}:${Math.floor(p.z / 64)}`)
    if (terrain.liquidHeightAt!(p.x, p.z)! > p.y) { wet += DT; if (verbose && !soaked) { soaked = true; appendFileSync(DRIVE_LOG, `  WET at ${(i * DT).toFixed(1)}s pos ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)} ground ${terrain.heightAt(p.x, p.z).toFixed(1)} liquid ${terrain.liquidHeightAt!(p.x, p.z)!.toFixed(1)} v ${Math.hypot(v.x, v.z).toFixed(1)} act ${mind.activity.kind} dest ${JSON.stringify(mind.activity.destination)} trouble ${mind.troubleFor.toFixed(1)}\n`) } }
    if (i > 500) low = Math.min(low, p.y - Math.max(terrain.heightAt(p.x, p.z), terrain.liquidHeightAt!(p.x, p.z)!))
    if (up.set(0, 1, 0).applyQuaternion(q.copy(buggy.body.rotation())).y < 0.2) flipped += DT
    if (Math.hypot(v.x, v.z) < 1.5 && mind.activity.kind !== 'pause') slow += DT
    if (verbose && flipped > 0 && !crashed) { crashed = true; appendFileSync(DRIVE_LOG, `  FLIPPED at ${(i * DT).toFixed(1)}s pos ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} ground ${terrain.heightAt(p.x, p.z).toFixed(0)} v ${Math.hypot(v.x, v.z).toFixed(1)} vy ${v.y.toFixed(1)} flight ${buggy.input.special} input ${JSON.stringify(buggy.input)} dest ${JSON.stringify(mind.activity.destination)}\n`) }
    if (mind.activity.kind !== kind) kinds.add(mind.caption)
    if (verbose && mind.activity.kind !== kind) {
      kind = mind.activity.kind; const d = mind.activity.destination
      appendFileSync(DRIVE_LOG, `${(i * DT).toFixed(0).padStart(4)}s ${kind.padEnd(8)} at ${p.x.toFixed(0)},${p.z.toFixed(0)} y${p.y.toFixed(0)} -> ${d ? `${d.x.toFixed(0)},${d.z.toFixed(0)}` : '-'} abandoned ${mind.abandoned} path ${path.toFixed(0)}\n`)
    }
  }
  // How much of the map this vehicle could get to at all, in the same 64 m cells the
  // coverage is counted in: the planner is asked for a route to each cell centre it may stand on.
  let reachable = 0
  const half = terrain.size / 2, profile = createPilot(buggy, terrain)!.profile
  if (countReachable) for (let x = -half + 32; x < half; x += 64) for (let z = -half + 32; z < half; z += 64) {
    if (navigator.passable(x, z, profile) && navigator.route(spawn.position, { x, z }, profile)?.reached) reachable++
  }
  world.free()
  if (process.env.BOT_CAPTIONS) appendFileSync(DRIVE_LOG, `  captions: ${[...kinds].join(' | ')}\n`)
  return { flight, gravity: planet?.gravity ?? 9.81, steerTravel: travel / seconds * 100, reversals: reversals / seconds * 60, reachable, low, path, wet, flipped, slow, far, cells: cells.size, abandoned: mind.abandoned }
}

type Run = ReturnType<typeof drive>
const record = (label: string, r: Run) => appendFileSync(DRIVE_LOG, `${label} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])))}\n`)

/**
 * What these tests assert, and why. The terrain is still being reshaped, so nothing here is
 * a number tuned to one island.
 *
 *  - Safety holds on every run: a wheeled vehicle is never in liquid for a second, nothing
 *    lies flipped for three, an aircraft never comes within two metres of the surface.
 *  - Liveliness is judged against what the world offers: it must keep moving (an average of
 *    at least 4 m/s, a fifth of the time at most spent crawling) and visit a share of the
 *    64 m cells it could actually reach (a fifth of them, or 15, whichever is fewer).
 *  - Liveliness is a majority rule over seeds, because one unlucky drive on one terrain is
 *    not a defect; safety is not.
 */
/**
 * The blocking suite drives each world and vehicle once, for a minute, and checks safety
 * and that it moves at all. BOT_TOUR=1 runs the full tour (three seeds, five minutes, and
 * the liveliness majority) as a report: liveliness is tuned by feel and does not block.
 */
const TOUR = process.env.BOT_TOUR === '1'
const SECONDS = TOUR ? 300 : 60, SEEDS = TOUR ? ['a', 'b', 'c'] : ['a']
const safe = (r: Run, vehicle: string) => r.flipped < 3 && (vehicle !== 'buggy' || r.wet < 1) && (vehicle !== 'jet' || r.low > 2)
// Grip, and so every speed a wheeled vehicle can hold, scales with the square root of
// gravity: on the Moon (1.62 m/s^2) a buggy that covers 0.4 of the Earth distance is doing as well.
const lively = (r: Run, seconds: number, gravity = 9.81) => r.path > seconds * 4 * Math.min(1, Math.sqrt(gravity / 9.81)) && r.slow < seconds * 0.2 && r.cells >= Math.ceil(Math.min(15, r.reachable * 0.2) * Math.min(1, Math.sqrt(gravity / 9.81)))

describe('minds on the real generated worlds', () => {
  const worlds = [[0, 'volcanic'], [1, 'desert'], [2, 'alpine']] as const
  it.each(worlds.flatMap(([kind, name]) => (['buggy', 'hovercraft', 'jet'] as const).map(vehicle => [name, vehicle, kind] as const)))(
    '%s: a %s tours safely and keeps moving (BOT_TOUR=1: five minutes, three seeds, lively on most)', (name, vehicle, kind) => {
      const runs = SEEDS.map(seed => { const r = drive(seed, SECONDS, process.env.BOT_VERBOSE === '1', vehicle, kind, TOUR); record(`${name} ${vehicle} ${seed}`, r); return r })
      for (const r of runs) { expect(safe(r, vehicle), JSON.stringify(r)).toBe(true); expect(r.path, JSON.stringify(r)).toBeGreaterThan(30) }
      if (TOUR) expect(runs.filter(r => lively(r, SECONDS)).length, JSON.stringify(runs)).toBeGreaterThanOrEqual(2)
    }, 60000)
})

describe('minds on the newer planets', () => {
  const planets = ['archipelago', 'ice', 'obsidian', 'badlands', 'moon', 'swamp'] as const
  it.each(planets.flatMap(planet => (['buggy', 'hovercraft', 'jet'] as const).map(vehicle => [planet, vehicle] as const)))(
    '%s: a %s tours safely and keeps moving (BOT_TOUR=1: five minutes, three seeds, lively on most)', (planet, vehicle) => {
      const runs = SEEDS.map(seed => { const r = drive(seed, SECONDS, process.env.BOT_VERBOSE === '1', vehicle, planet, TOUR); record(`${planet} ${vehicle} ${seed}`, r); return r })
      const gravity = runs[0].gravity, unsafe = runs.filter(r => !safe(r, vehicle)).length, dull = runs.filter(r => !lively(r, SECONDS, gravity)).length
      appendFileSync('/tmp/syn3h-planets.log', `${planet} ${vehicle}: unsafe ${unsafe}/${runs.length} dull ${dull}/${runs.length} ${runs.map(r => `[path ${Math.round(r.path)} wet ${Math.round(r.wet)} flipped ${Math.round(r.flipped)} low ${Math.round(r.low)} slow ${Math.round(r.slow)} cells ${r.cells}/${r.reachable}]`).join(' ')}\n`)
      for (const r of runs) { expect(safe(r, vehicle), JSON.stringify(r)).toBe(true); expect(r.path, JSON.stringify(r)).toBeGreaterThan(30) }
      if (TOUR) expect(runs.filter(r => lively(r, SECONDS, gravity)).length, JSON.stringify(runs)).toBeGreaterThanOrEqual(2)
    }, 120000)
})
