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
import { island } from './island'
import { createNavigator, pointsOfInterest } from '../../src/bots/nav'
import '../../src/bots/params'

beforeAll(initPhysics)
const DT = 0.02

/** Drive the real island for `seconds` and report where the mind went and how it fared. */
export function drive(seed: string, seconds: number, verbose = false, vehicleKind: 'buggy' | 'jet' | 'hovercraft' = 'buggy', world_ = 0) {
  const world = createWorld(9.81)
  const terrain = island(world, 1, { kind: world_ })
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const spawn = terrain.spawnPoint(0), sights = pointsOfInterest(terrain), navigator = createNavigator(terrain)
  const buggy = vehicleKind === 'jet' ? new Jet(game, terrain, spawn.position, spawn.heading) : vehicleKind === 'hovercraft' ? new Hovercraft(game, terrain, spawn.position, spawn.heading) : new Syn3hBuggy(game, terrain, spawn.position, spawn.heading); buggy.isLocal = false
  const mind = new Mind(buggy, terrain, createPilot(buggy, terrain)!, { seed, personality: DAYDREAM_PERSONALITY, navigator, places: () => sights })
  const kinds = new Set<string>(); let crashed = false, low = Infinity, path = 0, wet = 0, flipped = 0, slow = 0, far = 0, kind = ''
  const last = spawn.position.clone(), cells = new Set<string>(), up = new Vector3(), q = new Quaternion()
  for (let i = 0; i < seconds / DT; i++) {
    mind.step(DT, buggy.input); buggy.fixedUpdate(DT); world.step(); buggy.postPhysics(DT)
    const p = buggy.body.translation(), v = buggy.body.linvel()
    path += Math.hypot(p.x - last.x, p.z - last.z); last.set(p.x, p.y, p.z)
    far = Math.max(far, Math.hypot(p.x - spawn.position.x, p.z - spawn.position.z))
    cells.add(`${Math.floor(p.x / 64)}:${Math.floor(p.z / 64)}`)
    if (terrain.liquidHeightAt!(p.x, p.z)! > p.y) wet += DT
    if (i > 500) low = Math.min(low, p.y - Math.max(terrain.heightAt(p.x, p.z), terrain.liquidHeightAt!(p.x, p.z)!))
    if (up.set(0, 1, 0).applyQuaternion(q.copy(buggy.body.rotation())).y < 0.2) flipped += DT
    if (Math.hypot(v.x, v.z) < 1.5 && mind.activity.kind !== 'pause') slow += DT
    if (verbose && flipped > 0 && !crashed) { crashed = true; appendFileSync('/tmp/syn3h-island-drive.log', `  FLIPPED at ${(i * DT).toFixed(1)}s pos ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} ground ${terrain.heightAt(p.x, p.z).toFixed(0)} v ${Math.hypot(v.x, v.z).toFixed(1)} vy ${v.y.toFixed(1)}\n`) }
    if (mind.activity.kind !== kind) kinds.add(mind.caption)
    if (verbose && mind.activity.kind !== kind) {
      kind = mind.activity.kind; const d = mind.activity.destination
      appendFileSync('/tmp/syn3h-island-drive.log', `${(i * DT).toFixed(0).padStart(4)}s ${kind.padEnd(8)} at ${p.x.toFixed(0)},${p.z.toFixed(0)} y${p.y.toFixed(0)} -> ${d ? `${d.x.toFixed(0)},${d.z.toFixed(0)}` : '-'} abandoned ${mind.abandoned} path ${path.toFixed(0)}\n`)
    }
  }
  // How much of the map this vehicle could get to at all, in the same 64 m cells the
  // coverage is counted in: the planner is asked for a route to each cell centre it may stand on.
  let reachable = 0
  const half = terrain.size / 2, profile = createPilot(buggy, terrain)!.profile
  for (let x = -half + 32; x < half; x += 64) for (let z = -half + 32; z < half; z += 64) {
    if (navigator.passable(x, z, profile) && navigator.route(spawn.position, { x, z }, profile)?.reached) reachable++
  }
  world.free()
  if (process.env.BOT_CAPTIONS) appendFileSync('/tmp/syn3h-island-drive.log', `  captions: ${[...kinds].join(' | ')}\n`)
  return { reachable, low, path, wet, flipped, slow, far, cells: cells.size, abandoned: mind.abandoned }
}

type Run = ReturnType<typeof drive>
const record = (label: string, r: Run) => appendFileSync('/tmp/syn3h-island-drive.log', `${label} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])))}\n`)

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
const safe = (r: Run, vehicle: string) => r.flipped < 3 && (vehicle !== 'buggy' || r.wet < 1) && (vehicle !== 'jet' || r.low > 2)
const lively = (r: Run, seconds: number) => r.path > seconds * 4 && r.slow < seconds * 0.2 && r.cells >= Math.min(15, Math.ceil(r.reachable * 0.2))

describe('minds on the real generated worlds', () => {
  const worlds = [[0, 'volcanic'], [1, 'desert'], [2, 'alpine']] as const
  it.each(worlds.flatMap(([kind, name]) => (['buggy', 'hovercraft', 'jet'] as const).map(vehicle => [name, vehicle, kind] as const)))(
    '%s: a %s tours for five minutes, safely on every seed and lively on most', (name, vehicle, kind) => {
      const seeds = ['a', 'b', 'c']
      const runs = seeds.map(seed => { const r = drive(seed, 300, process.env.BOT_VERBOSE === '1', vehicle, kind); record(`${name} ${vehicle} ${seed}`, r); return r })
      for (const r of runs) expect(safe(r, vehicle), JSON.stringify(r)).toBe(true)
      expect(runs.filter(r => lively(r, 300)).length, JSON.stringify(runs)).toBeGreaterThanOrEqual(2)
    }, 60000)
})
