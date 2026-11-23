/**
 * Route planning cost per fixed step, with a fleet of minds dropped into a world together.
 *
 * A CPU profile of the first seconds after dropping into a world showed bot A* planning as
 * the top non idle cost, and bursty: one mind choosing what to do can test several places for
 * reachability in one step, and every mind chooses on its first step. This drives a mixed
 * fleet on the real island through its first seconds, counts route searches and expansions
 * in every 50 Hz step, and holds the worst step to the planning budget in Mind.ts.
 *
 * Wall time is recorded too, but only logged: the machine running tests may be busy.
 */
import { appendFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three/webgpu'
import type { Game } from '../../src/core/Game'
import { emptyInput } from '../../src/core/Input'
import { createWorld, initPhysics } from '../../src/core/physics'
import { MiraBuggy } from '../../src/vehicles/MiraBuggy'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { Jet } from '../../src/vehicles/Jet'
import type { Vehicle } from '../../src/vehicles/Vehicle'
import { Mind } from '../../src/bots/mind/Mind'
import { createPilot } from '../../src/bots/pilot'
import { isSafeGround } from '../../src/bots/BotBrain'
import { createNavigator, MAX_EXPANSIONS, pointsOfInterest } from '../../src/bots/nav'
import { SEARCHES_PER_STEP } from '../../src/bots/nav/budget'
import { island } from './island'
import '../../src/bots/params'

beforeAll(async () => { await initPhysics() })

const DT = 0.02
const LOG = process.env.BOT_BUDGET_LOG ?? '/tmp/syn3h-route-budget.log'
/** The game's mixed fleet, as BotManager spawns it, plus the daydreaming player. */
const FLEET = ['buggy', 'hovercraft', 'buggy', 'jet', 'buggy', 'hovercraft', 'buggy', 'jet'] as const

interface Step { searches: number; expansions: number; ms: number }

/** Drop a fleet into the island and record planning per fixed step for `seconds`. */
function fleetDrive(worldKind: number, bots: number, seconds: number, seed = 'budget') {
  const world = createWorld(9.81)
  const terrain = island(world, 1, { kind: worldKind })
  const game = { world, scene: new Scene(), tick: 0, input: { state: emptyInput() } } as unknown as Game
  const navigator = createNavigator(terrain), sights = pointsOfInterest(terrain)
  const steps: Step[] = []
  let current: Step = { searches: 0, expansions: 0, ms: 0 }
  // Count every search a mind asks for, however it gets there.
  const route = navigator.route
  navigator.route = (from, to, profile) => {
    const t = performance.now(), r = route(from, to, profile)
    current.ms += performance.now() - t
    if (!profile.flies) { current.searches++; current.expansions += navigator.lastQuery.expansions }
    return r
  }
  const centre = terrain.spawnPoint(0).position
  const vehicles: Vehicle[] = [], minds: Mind[] = []
  for (let i = 0; i < bots; i++) {
    // A ring round the player, as BotManager places them.
    let x = centre.x, z = centre.z
    for (let attempt = 0; attempt < 32; attempt++) {
      const angle = (i + attempt * 0.37) * 2.3999632297, radius = 24 + attempt % 4 * 4
      x = centre.x + Math.cos(angle) * radius; z = centre.z + Math.sin(angle) * radius
      if (isSafeGround(terrain, x, z) && !vehicles.some(v => Math.hypot(v.body.translation().x - x, v.body.translation().z - z) < 5)) break
    }
    const at = new Vector3(x, terrain.heightAt(x, z) + 2, z), kind = FLEET[i % FLEET.length]
    const v = kind === 'jet' ? new Jet(game, terrain, at, 0) : kind === 'hovercraft' ? new Hovercraft(game, terrain, at, 0) : new MiraBuggy(game, terrain, at, 0)
    v.isLocal = false; v.id = `bot-${i}`
    vehicles.push(v)
    minds.push(new Mind(v, terrain, createPilot(v, terrain)!, { seed: `${seed}:${i}`, navigator, places: () => sights, others: () => vehicles }))
  }
  let decidedBy = Infinity
  for (let i = 0; i < seconds / DT; i++) {
    current = { searches: 0, expansions: 0, ms: 0 }
    // Every mind starts paused with nothing to do; it has decided once its activity has a time left.
    if (decidedBy === Infinity && minds.every(m => m.activity.until > 0)) decidedBy = i
    for (let b = 0; b < bots; b++) { minds[b].step(DT, vehicles[b].input); vehicles[b].fixedUpdate(DT) }
    world.step()
    for (const v of vehicles) v.postPhysics(DT)
    steps.push(current)
  }
  world.free()
  const worst = (key: keyof Step) => steps.reduce((a, s) => Math.max(a, s[key]), 0)
  const sum = (key: keyof Step) => steps.reduce((a, s) => a + s[key], 0)
  const busy = steps.filter(s => s.searches > 0).length
  return {
    steps, kinds: minds.map(m => m.activity.kind), decidedBy,
    worstSearches: worst('searches'), worstExpansions: worst('expansions'), worstMs: worst('ms'),
    searches: sum('searches'), expansions: sum('expansions'), ms: sum('ms'), busySteps: busy,
  }
}

describe('route planning per fixed step', () => {
  it.each([0, 1, 2])('world kind %i: eight minds stay within the planning budget for their first ten seconds', (kind) => {
    const r = fleetDrive(kind, 8, 10)
    const summary = { worstSearches: r.worstSearches, worstExpansions: r.worstExpansions, worstMs: +r.worstMs.toFixed(1), searches: r.searches, expansions: r.expansions, ms: +r.ms.toFixed(0), busySteps: r.busySteps, decidedBy: r.decidedBy }
    appendFileSync(LOG, `kind ${kind} ${JSON.stringify(summary)} kinds ${r.kinds.join(',')}\n`)
    expect(r.searches).toBeGreaterThan(0)
    // The budget: never more than this many ground searches in one 50 Hz step, fleet wide.
    expect(r.worstSearches).toBeLessThanOrEqual(SEARCHES_PER_STEP)
    expect(r.worstExpansions).toBeLessThanOrEqual(MAX_EXPANSIONS + 1)
    // Waiting a step or two for a search must not leave anyone idling: every ground mind
    // has settled on something to do within the first second.
    expect(r.decidedBy).toBeLessThan(50)
  }, 120000)

  // A heavier fleet for longer, for measurement only: BOT_BUDGET_LONG=1 to run it.
  it.runIf(process.env.BOT_BUDGET_LONG === '1')('sixteen minds for a minute, logged', () => {
    for (const kind of [0, 1, 2]) {
      const r = fleetDrive(kind, 16, 60)
      const big = r.steps.map(s => s.expansions).sort((x, y) => y - x).slice(0, 5)
      appendFileSync(LOG, `long kind ${kind} ${JSON.stringify({ worstSearches: r.worstSearches, worstExpansions: r.worstExpansions, worstMs: +r.worstMs.toFixed(1), searches: r.searches, expansions: r.expansions, ms: +r.ms.toFixed(0), busySteps: r.busySteps, decidedBy: r.decidedBy, top5: big })}\n`)
    }
  }, 600000)

  it('is deterministic: the same fleet plans the same searches in the same steps', () => {
    const a = fleetDrive(0, 8, 6), b = fleetDrive(0, 8, 6)
    expect(b.steps.map(s => [s.searches, s.expansions])).toEqual(a.steps.map(s => [s.searches, s.expansions]))
    expect(b.kinds).toEqual(a.kinds)
  }, 120000)
})
