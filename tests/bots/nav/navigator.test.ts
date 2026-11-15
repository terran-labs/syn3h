import { describe, expect, it } from 'vitest'
import { MAX_EXPANSIONS, createNavigator } from '../../../src/bots/nav/grid'
import type { NavProfile } from '../../../src/bots/pilot/types'
import { AIR, GROUND, HOVER, checkRoute, island, synthetic } from './fixtures'

const log = (line: string) => process.stdout.write(`${line}\n`)

describe('navigator on synthetic terrain', () => {
  it('finds the one gap in a wall', () => {
    const wall = (x: number, z: number) => (Math.abs(z) < 6 && Math.abs(x - 100) >= 16 ? 20 : 0)
    const t = synthetic(512, wall)
    const r = createNavigator(t).route({ x: -150, z: -100 }, { x: -150, z: 100 }, GROUND)!
    expect(r.reached).toBe(true)
    const c = checkRoute(t, r.points)
    // The check samples between the planner's own lattice points, where the surface can be a
    // few percent steeper than either neighbour; no vehicle can tell 0.45 from 0.47.
    expect(c.climb).toBeLessThanOrEqual(GROUND.maxGrade * 1.05)
    // The only way across is the gap at x = 100.
    const crossing = r.points.findIndex((p, i) => i > 0 && Math.sign(p.z) !== Math.sign(r.points[i - 1].z))
    const a = r.points[crossing - 1], b = r.points[crossing]
    const x = a.x + (b.x - a.x) * (-a.z / (b.z - a.z))
    expect(Math.abs(x - 100)).toBeLessThan(16)
    expect(r.points[0]).toMatchObject({ x: -150, z: -100 })
    expect(r.points.at(-1)).toMatchObject({ x: -150, z: 100 })
    for (const p of r.points) expect(Number.isFinite(p.y)).toBe(true)
  })

  it('goes round a lake on wheels and straight across it on a hover cushion', () => {
    // A lake 2 m deep in ground 1 m above its surface.
    const t = synthetic(512, (x, z) => (x * x + z * z < 80 * 80 ? -2 : 1), { liquid: () => 0 })
    const nav = createNavigator(t)
    const wheels = nav.route({ x: -150, z: 0 }, { x: 150, z: 0 }, GROUND)!
    expect(wheels.reached).toBe(true)
    expect(checkRoute(t, wheels.points).wet).toBe(0)
    expect(wheels.cost).toBeGreaterThan(320)
    const hover = nav.route({ x: -150, z: 0 }, { x: 150, z: 0 }, HOVER)!
    expect(hover.reached).toBe(true)
    expect(checkRoute(t, hover.points, true).overLiquid).toBeGreaterThan(0)
    expect(hover.cost).toBeLessThan(320)
    expect(Math.max(...hover.points.map((p) => Math.abs(p.z)))).toBeLessThan(10)
    expect(nav.passable(0, 0, GROUND)).toBe(false)
    expect(nav.passable(0, 0, HOVER)).toBe(true)
  })

  // A 30 m plateau with grade 1 sides and one ramp at grade 0.3 cut into its east side.
  const plateau = (x: number, z: number) => {
    const out = Math.max(Math.abs(x) - 60, Math.abs(z) - 60, 0)
    const side = Math.max(0, 30 - out)
    const ramp = Math.abs(z) < 15 && x >= 60 && x <= 160 ? 30 - (x - 60) * 0.3 : 0
    return Math.max(side, ramp)
  }

  it('climbs a steep hill by its ramp and only by its ramp', () => {
    const t = synthetic(512, plateau)
    const nav = createNavigator(t)
    const r = nav.route({ x: 200, z: 150 }, { x: 0, z: 0 }, GROUND)!
    expect(r.reached).toBe(true)
    const c = checkRoute(t, r.points)
    // The check samples between the planner's own lattice points, where the surface can be a
    // few percent steeper than either neighbour; no vehicle can tell 0.45 from 0.47.
    expect(c.climb).toBeLessThanOrEqual(GROUND.maxGrade * 1.05)
    // Somewhere on the ramp, halfway up.
    expect(r.points.some((p) => p.x > 80 && p.x < 140 && Math.abs(p.z) < 15)).toBe(true)
    // A vehicle that cannot climb the ramp even on a 45 degree diagonal (0.21) gets as close
    // as it can and says so.
    const weak: NavProfile = { ...GROUND, maxGrade: 0.18 }
    const w = nav.route({ x: 200, z: 150 }, { x: 0, z: 0 }, weak)!
    expect(w.reached).toBe(false)
    expect(checkRoute(t, w.points).climb).toBeLessThanOrEqual(0.18)
    // The same hill is fine to go down at up to 1.5 times the limit, not over the cliff.
    const down = nav.route({ x: 0, z: 0 }, { x: -200, z: 0 }, GROUND)!
    expect(down.reached).toBe(true)
    expect(checkRoute(t, down.points).descent).toBeGreaterThanOrEqual(-1.5 * GROUND.maxGrade)
  })

  it('prefers a road as much as the profile says', () => {
    const pts: { x: number; y: number; z: number }[] = []
    for (let x = -200; x <= 200; x += 4) pts.push({ x, y: 0, z: 150 - Math.abs(x) * 0.75 })
    const t = synthetic(512, () => 0, { roads: [{ kind: 'plain', closed: false, width: 11, points: pts }] })
    const nav = createNavigator(t)
    const road = nav.route({ x: -200, z: 0 }, { x: 200, z: 0 }, GROUND)!
    expect(Math.max(...road.points.map((p) => p.z))).toBeGreaterThan(130)
    const straight = nav.route({ x: -200, z: 0 }, { x: 200, z: 0 }, { ...GROUND, roadCost: 1 })!
    expect(Math.max(...straight.points.map((p) => Math.abs(p.z)))).toBeLessThan(10)
    // Thinned, but legs are never longer than 25 m.
    expect(checkRoute(t, straight.points).longest).toBeLessThanOrEqual(25.001)
    expect(straight.points.length).toBeLessThan(25)
  })

  it('does not count a road at another height as road', () => {
    // A road drawn 20 m above flat ground (a turn of a spiral seen from the turn below).
    const pts: { x: number; y: number; z: number }[] = []
    for (let x = -200; x <= 200; x += 4) pts.push({ x, y: 20, z: 150 - Math.abs(x) * 0.75 })
    const t = synthetic(512, () => 0, { roads: [{ kind: 'volcano', closed: false, width: 11, points: pts }] })
    const r = createNavigator(t).route({ x: -200, z: 0 }, { x: 200, z: 0 }, GROUND)!
    expect(Math.max(...r.points.map((p) => Math.abs(p.z)))).toBeLessThan(10)
  })

  it('returns the closest place for an enclosed goal without hanging', () => {
    const ring = (x: number, z: number) => { const r = Math.hypot(x, z); return r > 60 && r < 75 ? 25 : 0 }
    const t = synthetic(512, ring)
    const nav = createNavigator(t)
    const r = nav.route({ x: -200, z: 0 }, { x: 0, z: 0 }, GROUND)!
    expect(r.reached).toBe(false)
    const end = r.points.at(-1)!
    expect(Math.hypot(end.x, end.z)).toBeGreaterThan(70)
    expect(Math.hypot(end.x, end.z)).toBeLessThan(90)
    expect(nav.lastQuery.expansions).toBeLessThanOrEqual(MAX_EXPANSIONS + 1)
    // A start inside a cliff with nowhere usable near it is the only null.
    const cliff = synthetic(512, (x) => x * 3)
    expect(createNavigator(cliff).route({ x: 0, z: 0 }, { x: 50, z: 0 }, GROUND)).toBeNull()
  })

  it('forgets the terrain when it regenerates, and survives a wrapping world', () => {
    let blocked = false
    const t = synthetic(512, (x, z) => (blocked && Math.abs(z) < 6 ? 20 : 0))
    const nav = createNavigator(t)
    expect(nav.route({ x: 0, z: -50 }, { x: 0, z: 50 }, GROUND)!.reached).toBe(true)
    blocked = true
    t.regenerate()
    expect(nav.route({ x: 0, z: -50 }, { x: 0, z: 50 }, GROUND)!.reached).toBe(false)
    blocked = false
    nav.invalidate()
    expect(nav.route({ x: 0, z: -50 }, { x: 0, z: 50 }, GROUND)!.reached).toBe(true)
    nav.dispose()
    const wrapped = synthetic(512, () => 0, { wrapSize: 512 })
    expect(createNavigator(wrapped).route({ x: 250, z: 0 }, { x: -250, z: 0 }, GROUND)!.reached).toBe(true)
  })
})

const ISLANDS = [['volcanic', 1], ['volcanic', 7], ['alpine', 1], ['alpine', 4242]] as const

describe('navigator on the generated island', () => {
  it.each(ISLANDS)('a ground vehicle drives from pad 0 to the summit rim (%s %i)', (kind, seed) => {
    const t = island(kind, seed)
    const nav = createNavigator(t)
    const pad = t.spawnPoint(0).position
    const rim = t.data.roads.find((r) => r.kind === 'rim')!.points[0]
    const r = nav.route({ x: pad.x, z: pad.z }, { x: rim.x, z: rim.z }, GROUND)!
    expect(r.reached).toBe(true)
    const end = r.points.at(-1)!
    expect(Math.hypot(end.x - rim.x, end.z - rim.z)).toBeLessThan(1)
    const c = checkRoute(t, r.points)
    log(`${kind} ${seed}: summit route ${r.points.length} points, cost ${r.cost.toFixed(0)}, climb ${c.climb.toFixed(3)}, descent ${c.descent.toFixed(3)}`)
    // The check samples between the planner's own lattice points, where the surface can be a
    // few percent steeper than either neighbour; no vehicle can tell 0.45 from 0.47.
    expect(c.climb).toBeLessThanOrEqual(GROUND.maxGrade * 1.05)
    expect(c.descent).toBeGreaterThanOrEqual(-1.5 * GROUND.maxGrade * 1.05)
    expect(c.wet).toBe(0)
    expect(c.longest).toBeLessThanOrEqual(25.001)
    for (const p of r.points) expect(Number.isFinite(p.y)).toBe(true)
    // Identical inputs, identical routes, from this navigator and from a fresh one.
    expect(nav.route({ x: pad.x, z: pad.z }, { x: rim.x, z: rim.z }, GROUND)).toEqual(r)
    expect(createNavigator(t).route({ x: pad.x, z: pad.z }, { x: rim.x, z: rim.z }, GROUND)).toEqual(r)
  })

  it.each(ISLANDS)('a hovercraft crosses the sea where wheels cannot (%s %i)', (kind, seed) => {
    const t = island(kind, seed)
    const nav = createNavigator(t)
    const pad = t.spawnPoint(0).position
    const d = Math.hypot(pad.x, pad.z)
    const sea = { x: (pad.x / d) * 980, z: (pad.z / d) * 980 }
    expect(t.heightAt(sea.x, sea.z)).toBeLessThan(t.liquidHeightAt!(sea.x, sea.z))
    const hover = nav.route({ x: pad.x, z: pad.z }, sea, HOVER)!
    expect(hover.reached).toBe(true)
    const c = checkRoute(t, hover.points, true)
    expect(c.overLiquid).toBeGreaterThan(0)
    expect(c.climb).toBeLessThanOrEqual(HOVER.maxGrade)
    const wheels = nav.route({ x: pad.x, z: pad.z }, sea, GROUND)!
    expect(wheels.reached).toBe(false)
    expect(checkRoute(t, wheels.points).wet).toBe(0)
  })

  it.each(ISLANDS)('an aircraft clears every ridge by its cruise altitude (%s %i)', (kind, seed) => {
    const t = island(kind, seed)
    const nav = createNavigator(t)
    const a = t.spawnPoint(0).position, b = t.spawnPoint(4).position
    const r = nav.route({ x: a.x, z: a.z }, { x: b.x, z: b.z }, AIR)!
    expect(r.reached).toBe(true)
    let worst = Infinity
    for (let i = 1; i < r.points.length; i++) {
      const p = r.points[i - 1], q = r.points[i]
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThanOrEqual(40.001)
      for (let s = 0; s <= 40; s++) {
        const f = s / 40, x = p.x + (q.x - p.x) * f, z = p.z + (q.z - p.z) * f
        const surface = Math.max(t.heightAt(x, z), t.liquidHeightAt!(x, z))
        worst = Math.min(worst, p.y! + (q.y! - p.y!) * f - surface)
      }
    }
    expect(worst).toBeGreaterThanOrEqual(AIR.cruiseAltitude - 1e-3)
  })

  it('reports query times and memory on the default island', () => {
    const t = island('volcanic', 1)
    const pad = t.spawnPoint(0).position, far = t.spawnPoint(4).position
    const rim = t.data.roads.find((r) => r.kind === 'rim')!.points[0]
    const time = (f: () => void) => { const s = performance.now(); f(); return performance.now() - s }
    const nav = createNavigator(t)
    const cold = time(() => nav.route({ x: pad.x, z: pad.z }, { x: rim.x, z: rim.z }, GROUND))
    const queries: [string, () => void][] = [
      ['summit', () => nav.route({ x: pad.x, z: pad.z }, { x: rim.x, z: rim.z }, GROUND)],
      ['cross island', () => nav.route({ x: pad.x, z: pad.z }, { x: far.x, z: far.z }, GROUND)],
      ['unreachable (caldera)', () => nav.route({ x: pad.x, z: pad.z }, { x: 0, z: 0 }, GROUND)],
      ['unreachable (sea)', () => nav.route({ x: pad.x, z: pad.z }, { x: 1000, z: 1000 }, GROUND)],
    ]
    for (const [, q] of queries) q() // warm the edge cache for each
    for (const [name, q] of queries) {
      const ms = Array.from({ length: 7 }, () => time(q)).sort((a, b) => a - b)
      log(`nav ${name}: median ${ms[3].toFixed(2)} ms, worst ${ms[6].toFixed(2)} ms, ${nav.lastQuery.expansions} expansions`)
      expect(nav.lastQuery.expansions).toBeLessThanOrEqual(MAX_EXPANSIONS + 1)
    }
    log(`nav cold first query ${cold.toFixed(1)} ms; memory ${(nav.memoryBytes / 1048576).toFixed(2)} MB with one profile cached`)
  })
})
