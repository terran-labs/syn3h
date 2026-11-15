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
  const spawn = terrain.spawnPoint(0), sights = pointsOfInterest(terrain)
  const buggy = vehicleKind === 'jet' ? new Jet(game, terrain, spawn.position, spawn.heading) : vehicleKind === 'hovercraft' ? new Hovercraft(game, terrain, spawn.position, spawn.heading) : new Syn3hBuggy(game, terrain, spawn.position, spawn.heading); buggy.isLocal = false
  const mind = new Mind(buggy, terrain, createPilot(buggy, terrain)!, { seed, personality: DAYDREAM_PERSONALITY, navigator: createNavigator(terrain), places: () => sights })
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
  world.free()
  if (process.env.BOT_CAPTIONS) appendFileSync('/tmp/syn3h-island-drive.log', `  captions: ${[...kinds].join(' | ')}\n`)
  return { low, path, wet, flipped, slow, far, cells: cells.size, abandoned: mind.abandoned }
}

describe('a mind on the real island', () => {
  it.each(['a', 'b', 'c', 'd'])('explores for five minutes: covers ground, stays dry and upright (seed %s)', seed => {
    const r = drive(seed, 300, process.env.BOT_VERBOSE === '1')
    appendFileSync('/tmp/syn3h-island-drive.log', `${seed} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])))}\n`)
    expect(r.wet).toBeLessThan(1)
    expect(r.flipped).toBeLessThan(3)
    expect(r.path).toBeGreaterThan(1800)
    expect(r.far).toBeGreaterThan(300)
    expect(r.cells).toBeGreaterThan(25)
    expect(r.slow).toBeLessThan(45)
  })
})

describe('fliers and floaters on the real island', () => {
  it.each(['a', 'b'])('a jet in hover mode tours for five minutes without touching the ground (seed %s)', seed => {
    const r = drive(seed, 300, process.env.BOT_VERBOSE === '1', 'jet')
    appendFileSync('/tmp/syn3h-island-drive.log', `jet ${seed} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])))}\n`)
    expect(r.low).toBeGreaterThan(2); expect(r.flipped).toBeLessThan(2); expect(r.path).toBeGreaterThan(1800); expect(r.cells).toBeGreaterThan(20)
  })
  it.each(['a', 'b'])('a hovercraft cruises for five minutes, lava and sea included (seed %s)', seed => {
    const r = drive(seed, 300, false, 'hovercraft')
    appendFileSync('/tmp/syn3h-island-drive.log', `hovercraft ${seed} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])))}\n`)
    expect(r.flipped).toBeLessThan(2); expect(r.path).toBeGreaterThan(1800); expect(r.cells).toBeGreaterThan(20); expect(r.slow).toBeLessThan(45)
  })
})

describe('other worlds', () => {
  it.each([[1, 'desert', 'buggy'], [2, 'alpine', 'buggy'], [1, 'desert', 'jet'], [2, 'alpine', 'jet'], [2, 'alpine', 'hovercraft']] as const)('world %i (%s): a %s tours for five minutes', (kind, name, vehicle) => {
    const r = drive('a', 300, process.env.BOT_VERBOSE === '1', vehicle, kind)
    appendFileSync('/tmp/syn3h-island-drive.log', `${name} ${vehicle} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])))}\n`)
    expect(r.flipped).toBeLessThan(3); expect(r.path).toBeGreaterThan(1500); expect(r.slow).toBeLessThan(60)
    if (vehicle === 'buggy') expect(r.wet).toBeLessThan(1)
    if (vehicle === 'jet') expect(r.low).toBeGreaterThan(2)
  })
})
