/**
 * Plasma Thunder's rules (src/weapons/thunderRules.ts), as the owner approved them on 18
 * November 2026. Bugs these catch: a bolt that skips off a cliff face or skips for ever; a fuse
 * that goes off in the shooter's face or against its own vehicle; a fuse that tags in Tag; a
 * detonation reported by a client that does not own the vehicle it claims; two clients drawing
 * different fireworks for the same shot.
 */
import { describe, expect, it } from 'vitest'
import { BURST_MARGIN, burstPointPlausible, detonationEffect, fireworkSeed, fireworkShape, fuseArmed, fuseRadius, mayReport, nearestOnSegment, skipOff, type V3 } from '../../src/weapons/thunderRules'

const rule = { left: 3, maxAngle: 35, keep: 0.85, bounce: 0.5 }
const up: V3 = [0, 1, 0]
const isBot = (id: number) => id >= 0xff00

describe('Plasma Thunder skips', () => {
  it('skips off ground met shallowly: the bounce and the speed along the ground are kept as set', () => {
    // 10 degrees down onto flat ground at 110 m/s.
    const a = 10 * Math.PI / 180, v: V3 = [110 * Math.cos(a), -110 * Math.sin(a), 0]
    const out = skipOff(v, up, rule)!
    expect(out).not.toBeNull()
    expect(out[0]).toBeCloseTo(v[0] * 0.85, 6)
    expect(out[1]).toBeCloseTo(-v[1] * 0.5, 6)
  })
  it('detonates on steep ground, with no skips left, or when leaving the surface', () => {
    const steep: V3 = [50, -80, 0]
    expect(skipOff(steep, up, rule)).toBeNull()
    expect(skipOff([100, -5, 0], up, { ...rule, left: 0 })).toBeNull()
    expect(skipOff([100, 5, 0], up, rule)).toBeNull()
  })
})

describe('Plasma Thunder fuse', () => {
  it('arms only after its time, and reaches farther for a vehicle in the air', () => {
    expect(fuseArmed(0.1, 0.25)).toBe(false); expect(fuseArmed(0.25, 0.25)).toBe(true)
    const r = { ground: 3, air: 8, airHeight: 5 }
    expect(fuseRadius(1, r)).toBe(3); expect(fuseRadius(12, r)).toBe(8)
  })
  it('finds how close a step of flight passes a vehicle', () => {
    const near = nearestOnSegment([0, 0, 0], [10, 0, 0], [4, 3, 0])
    expect(near.distance).toBeCloseTo(3, 6); expect(near.point).toEqual([4, 0, 0])
    expect(nearestOnSegment([0, 0, 0], [10, 0, 0], [-4, 3, 0]).distance).toBeCloseTo(5, 6)
  })
  it('knocks but never tags; contact tags', () => {
    expect(detonationEffect('fuse')).toEqual({ tag: false, contact: true })
    expect(detonationEffect('contact')).toEqual({ tag: true, contact: true })
    expect(detonationEffect('end')).toEqual({ tag: false, contact: false })
  })
})

describe('who may report a detonation', () => {
  const host = 1, shooter = 2, victim = 3, bot = 0xff00
  it('the caught vehicle\'s own client, or the host for a bot; never against the shooter itself', () => {
    expect(mayReport('fuse', victim, shooter, victim, host, isBot)).toBe(true)
    expect(mayReport('fuse', shooter, shooter, victim, host, isBot)).toBe(false)
    expect(mayReport('contact', host, shooter, bot, host, isBot)).toBe(true)
    expect(mayReport('contact', victim, shooter, bot, host, isBot)).toBe(false)
    expect(mayReport('fuse', shooter, shooter, shooter, host, isBot)).toBe(false)
  })
  it('an end only by the shooter\'s client, or the host for a bot\'s shot', () => {
    expect(mayReport('end', shooter, shooter, undefined, host, isBot)).toBe(true)
    expect(mayReport('end', victim, shooter, undefined, host, isBot)).toBe(false)
    expect(mayReport('end', host, bot, undefined, host, isBot)).toBe(true)
  })
})

describe('fireworks', () => {
  it('every client picks the same shape for a shot, and shots differ', () => {
    expect(fireworkSeed(4, 17)).toBe(fireworkSeed(4, 17))
    const shapes = new Set(Array.from({ length: 60 }, (_, i) => fireworkShape(fireworkSeed(4, i))))
    expect(shapes.size).toBeGreaterThan(3)
  })
})

describe('where a detonation may be reported', () => {
  // A 2048 m tile: the planet's radius is 2048 / (2 sqrt(pi)), about 578 m; a 120 m flare.
  const size = 2048, flare = 120, ceiling = size / (2 * Math.sqrt(Math.PI)) + flare + BURST_MARGIN
  it('takes anywhere in the world, up to the planet radius and the flare height above it', () => {
    expect(burstPointPlausible([0, 0, 0], size, flare)).toBe(true)
    expect(burstPointPlausible([-1024, 300, 1023], size, flare)).toBe(true)
    expect(burstPointPlausible([0, ceiling - 1, 0], size, flare)).toBe(true)
  })
  it('refuses a point far outside the tile, far up or down, or not a number', () => {
    expect(burstPointPlausible([1e30, 0, 0], size, flare)).toBe(false)
    expect(burstPointPlausible([0, 0, size / 2 + BURST_MARGIN + 1], size, flare)).toBe(false)
    expect(burstPointPlausible([0, ceiling + 1, 0], size, flare)).toBe(false)
    expect(burstPointPlausible([0, -BURST_MARGIN - 1, 0], size, flare)).toBe(false)
    expect(burstPointPlausible([0, Number.NaN, 0], size, flare)).toBe(false)
  })
})
