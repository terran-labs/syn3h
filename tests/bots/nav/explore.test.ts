import { describe, expect, it } from 'vitest'
import { ExplorationMap, pointsOfInterest } from '../../../src/bots/nav/explore'
import { createNavigator } from '../../../src/bots/nav/grid'
import { AIR, GROUND, island, seeded } from './fixtures'

const log = (line: string) => process.stdout.write(`${line}\n`)

describe('points of interest', () => {
  it('names the places worth driving to, the same every time', () => {
    const t = island('volcanic', 1)
    const pois = pointsOfInterest(t)
    expect(pointsOfInterest(t)).toEqual(pois)
    const kinds = new Map<string, number>()
    for (const p of pois) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1)
    log(`volcanic 1 points of interest: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}`)
    expect(kinds.get('spawn')).toBe(8)
    for (const k of ['summit', 'road-end', 'road-mid', 'vent', 'peak', 'shore']) expect(kinds.get(k), k).toBeGreaterThan(0)
    const half = t.size / 2
    for (const p of pois) {
      expect(Math.abs(p.x) < half && Math.abs(p.z) < half && Number.isFinite(p.y)).toBe(true)
      for (const q of pois) if (q !== p) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(24)
    }
    expect(pois.find((p) => p.kind === 'spawn')!.name).toBe('Pad 1')
    // Shore points stand on dry ground right by the liquid.
    for (const p of pois.filter((p) => p.kind === 'shore')) {
      expect(t.heightAt(p.x, p.z)).toBeGreaterThanOrEqual(t.liquidHeightAt!(p.x, p.z) + 0.5)
    }
    // Only the volcanic world has vents.
    expect(pointsOfInterest(island('alpine', 4242)).some((p) => p.kind === 'vent')).toBe(false)
  })
})

describe('exploration map', () => {
  it('counts entries into cells, not calls', () => {
    const t = island('volcanic', 1)
    const map = new ExplorationMap(t)
    expect(map.visitedFraction()).toBe(0)
    expect(map.visit(10, 10)).toBe(true)
    expect(map.visit(12, 11)).toBe(false)
    expect(map.visitsAt(10, 10)).toBe(1)
    map.visit(200, 200)
    map.visit(10, 10)
    expect(map.visitsAt(10, 10)).toBe(2)
    expect(map.visitedFraction()).toBeGreaterThan(0)
    map.reset()
    expect(map.visitedFraction()).toBe(0)
  })

  it('a ground vehicle explores somewhere new each time, repeatably', () => {
    const t = island('volcanic', 1)
    const nav = createNavigator(t)
    const run = (seed: number) => {
      const map = new ExplorationMap(t)
      const random = seeded(seed)
      const p = t.spawnPoint(0).position
      let here = { x: p.x, z: p.z }
      const picks: string[] = []
      let fraction = 0
      for (let leg = 0; leg < 12; leg++) {
        const f = map.pickFrontier(here, GROUND, nav, random)!
        expect(f, `leg ${leg}`).not.toBeNull()
        expect(f.route.reached).toBe(true)
        expect(nav.passable(f.x, f.z, GROUND)).toBe(true)
        expect(map.cellAt(f.x, f.z)).not.toBe(map.cellAt(here.x, here.z))
        picks.push(`${f.kind}:${Math.round(f.x)},${Math.round(f.z)}`)
        // Drive it: visit every few metres along the route.
        for (let i = 1; i < f.route.points.length; i++) {
          const a = f.route.points[i - 1], b = f.route.points[i]
          for (let s = 0; s <= 4; s++) map.visit(a.x + ((b.x - a.x) * s) / 4, a.z + ((b.z - a.z) * s) / 4)
        }
        here = { x: f.x, z: f.z }
        const next = map.visitedFraction()
        expect(next).toBeGreaterThanOrEqual(fraction)
        fraction = next
      }
      return { picks, fraction }
    }
    const a = run(42)
    log(`explored ${(a.fraction * 100).toFixed(1)}% of land cells in 12 legs: ${a.picks.join(' ')}`)
    expect(run(42)).toEqual(a)
    expect(run(43).picks).not.toEqual(a.picks)
    expect(new Set(a.picks).size).toBeGreaterThan(9)
  })

  it('an aircraft can pick anywhere on the island', () => {
    const t = island('alpine', 4242)
    const map = new ExplorationMap(t)
    const f = map.pickFrontier({ x: 0, z: 0 }, AIR, createNavigator(t), seeded(1))!
    expect(f.route.reached).toBe(true)
    expect(f.route.points.every((p) => Number.isFinite(p.y))).toBe(true)
  })
})
