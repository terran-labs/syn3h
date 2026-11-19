/**
 * The bots' game tactics (src/bots/tactics.ts). Bugs caught: a pursuer that heads for where
 * its target was rather than where they will meet; two pursuers on one line; aim error that is
 * not what the setting says (the owner asked for it adjustable and low); more bots on one
 * person than the cap.
 */
import { describe, expect, it } from 'vitest'
import { aimDirection, angleBetween, assignTargets, interceptPoint, pincerOffset } from '../../src/bots/tactics'
import { seededRandom } from '../../src/bots/random'

describe('interception', () => {
  it('heads for the point where the pursuer and a crossing target arrive together', () => {
    const from = { x: 0, z: 0 }, at = { x: 40, z: -30 }, velocity = { x: -6, z: 0 }, speed = 15
    const p = interceptPoint(from, speed, at, velocity, 1)
    const t = (p.x - at.x) / velocity.x
    expect(t).toBeGreaterThan(0)
    expect(Math.hypot(p.x - from.x, p.z - from.z) / speed).toBeCloseTo(t, 3)
  })
  it('chases where the target is at skill 0, and blends toward the intercept in between', () => {
    const at = { x: 40, z: -30 }, velocity = { x: -6, z: 0 }
    expect(interceptPoint({ x: 0, z: 0 }, 15, at, velocity, 0)).toEqual(at)
    const half = interceptPoint({ x: 0, z: 0 }, 15, at, velocity, 0.5).x, full = interceptPoint({ x: 0, z: 0 }, 15, at, velocity, 1).x
    expect(half).toBeLessThan(at.x); expect(half).toBeGreaterThan(full)
  })
})

describe('pincer', () => {
  it('sends two pursuers to opposite flanks, and lets both close in at the end', () => {
    const a = pincerOffset(0, 2, 60), b = pincerOffset(1, 2, 60)
    expect(Math.sign(a)).toBe(-Math.sign(b)); expect(Math.abs(a)).toBeGreaterThan(2)
    expect(pincerOffset(0, 2, 5)).toBe(-0)
    expect(pincerOffset(0, 1, 60)).toBe(0)
  })
})

describe('aim error', () => {
  for (const error of [0, 3, 9, 20]) it(`misses by what the setting says (${error} degrees)`, () => {
    const random = seededRandom(7), from = { x: 0, y: 1, z: 0 }, at = { x: 0, y: 1, z: -80 }, still = { x: 0, y: 0, z: 0 }
    const misses: number[] = []
    for (let i = 0; i < 4000; i++) misses.push(angleBetween(aimDirection(from, at, still, Infinity, error, random), [0, 0, -1]))
    const rms = Math.sqrt(misses.reduce((s, m) => s + m * m, 0) / misses.length)
    // Yaw at sigma and pitch at half: the combined spread is sigma * sqrt(1.25).
    expect(rms).toBeCloseTo(error * Math.sqrt(1.25), 0)
  })
  it('leads a moving target for a shot that takes time to arrive', () => {
    const d = aimDirection({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -100 }, { x: 10, y: 0, z: 0 }, 100, 0, () => 0.5)
    expect(d[0]).toBeGreaterThan(0.05)
  })
})

describe('target assignment', () => {
  const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)
  it('puts at most the cap on one person, and the rest on each other', () => {
    const bots = [0, 1, 2, 3].map(i => ({ id: `b${i}`, position: { x: i * 3, z: 0 } }))
    const you = { id: 'you', position: { x: 1, z: 1 }, person: true, available: true }
    const out = assignTargets(bots, [you, ...bots.map(b => ({ ...b, person: false, available: true }))], 2, distance)
    expect([...out.values()].filter(t => t === 'you').length).toBe(2)
    for (const [bot, target] of out) expect(target).not.toBe(bot)
  })
  it('never targets someone unavailable', () => {
    const out = assignTargets([{ id: 'b0', position: { x: 0, z: 0 } }], [{ id: 'you', position: { x: 1, z: 0 }, person: true, available: false }], 2, distance)
    expect(out.get('b0')).toBeNull()
  })
})
