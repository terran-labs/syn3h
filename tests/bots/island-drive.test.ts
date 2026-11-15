import { appendFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Quaternion, Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics } from '../../src/core/physics'
import { Syn3hBuggy } from '../../src/vehicles/Syn3hBuggy'
import { DAYDREAM_PERSONALITY } from '../../src/bots/Daydream'
import { Mind } from '../../src/bots/mind/Mind'
import { createGroundPilot } from '../../src/bots/pilot/ground'
import { island } from './island'
import { createNavigator } from '../../src/bots/nav'
import '../../src/bots/params'

beforeAll(initPhysics)
const DT = 0.02

/** Drive the real island for `seconds` and report where the mind went and how it fared. */
export function drive(seed: string, seconds: number, verbose = false) {
  const world = createWorld(9.81)
  const terrain = island(world, 1)
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const spawn = terrain.spawnPoint(0)
  const buggy = new Syn3hBuggy(game, terrain, spawn.position, spawn.heading); buggy.isLocal = false
  const mind = new Mind(buggy, terrain, createGroundPilot(buggy), { seed, personality: DAYDREAM_PERSONALITY, navigator: createNavigator(terrain) })
  let path = 0, wet = 0, flipped = 0, slow = 0, far = 0, kind = ''
  const last = spawn.position.clone(), cells = new Set<string>(), up = new Vector3(), q = new Quaternion()
  for (let i = 0; i < seconds / DT; i++) {
    mind.step(DT, buggy.input); buggy.fixedUpdate(DT); world.step(); buggy.postPhysics(DT)
    const p = buggy.body.translation(), v = buggy.body.linvel()
    path += Math.hypot(p.x - last.x, p.z - last.z); last.set(p.x, p.y, p.z)
    far = Math.max(far, Math.hypot(p.x - spawn.position.x, p.z - spawn.position.z))
    cells.add(`${Math.floor(p.x / 64)}:${Math.floor(p.z / 64)}`)
    if (terrain.liquidHeightAt!(p.x, p.z)! > p.y) wet += DT
    if (up.set(0, 1, 0).applyQuaternion(q.copy(buggy.body.rotation())).y < 0.2) flipped += DT
    if (Math.hypot(v.x, v.z) < 1.5 && mind.activity.kind !== 'pause') slow += DT
    if (verbose && mind.activity.kind !== kind) {
      kind = mind.activity.kind; const d = mind.activity.destination
      appendFileSync('/tmp/syn3h-island-drive.log', `${(i * DT).toFixed(0).padStart(4)}s ${kind.padEnd(8)} at ${p.x.toFixed(0)},${p.z.toFixed(0)} y${p.y.toFixed(0)} -> ${d ? `${d.x.toFixed(0)},${d.z.toFixed(0)}` : '-'} abandoned ${mind.abandoned} path ${path.toFixed(0)}\n`)
    }
  }
  world.free()
  return { path, wet, flipped, slow, far, cells: cells.size, abandoned: mind.abandoned }
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
