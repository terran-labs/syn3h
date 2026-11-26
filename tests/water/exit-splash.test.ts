/**
 * Splashes coming out of the water (spraySim.ts exitSplash): one for each crossing, none for a hull
 * riding the surface, spray within its pool however many vehicles cross, and nothing non-finite.
 */
import { describe, expect, it } from 'vitest'
import { SpraySim, sprayCapacity, type WakeShape } from '../../src/world/water/spraySim'
import { easeWake, submergedFraction, wakePresence } from '../../src/world/water/waterEffectsMath'

const flat = { liquidHeightAt: () => 0 }
const DT = 1 / 60
type Phase = { seconds: number; vy: number; sub: (t: number) => number }

/** A vehicle's dive and climb as phases of vertical speed and wetted fraction; y follows vy. */
function run(sim: SpraySim, phases: Phase[], shape: WakeShape = { ball: 0 }, id = 'a', x0 = 0) {
  let y = 1
  // Each phase's `sub` gets the time since that phase began.
  for (const p of phases) for (let i = 0; i < Math.round(p.seconds / DT); i++) {
    sim.step(DT); y += p.vy * DT
    sim.vehicle(id, x0, y, 0, 6, p.vy, 0, p.sub((i + 1) * DT), DT, 1, shape)
  }
}
const dry = () => 0, wet = () => 1
/** In from the air, under, back up and out, and dry again. */
const dive = (deep: number, rise: number): Phase[] => [
  { seconds: .5, vy: 0, sub: dry },
  { seconds: .1, vy: -4, sub: (t) => Math.min(1, t / .05) },
  { seconds: deep / 2, vy: -2, sub: wet },
  { seconds: (deep + 1) / rise, vy: rise, sub: wet },
  { seconds: .3, vy: rise, sub: (t) => Math.max(0, 1 - t * 4) },
  { seconds: 1, vy: 0, sub: dry },
]

describe('exit splash', () => {
  for (const [name, shape] of [['hull', { ball: 0 }], ['ball', { ball: 1 }]] as const) {
    it(`a ${name} entering and leaving splashes once each way`, () => {
      const sim = new SpraySim(sprayCapacity(2), flat)
      run(sim, dive(4, 4), shape)
      expect(sim.entries).toBe(1)
      expect(sim.exits).toBe(1)
    })

    it(`a ${name} bobbing at the surface throws no exit splash`, () => {
      const sim = new SpraySim(sprayCapacity(2), flat)
      // Settled on the water, then 10 s riding a swell: up and down with its wetted share.
      run(sim, [{ seconds: 1, vy: 0, sub: () => .5 }, ...Array.from({ length: 20 }, (_, k) => ({ seconds: .5, vy: k % 2 ? .8 : -.8, sub: (t: number) => .5 + .25 * Math.sin(t * 6 + k) }))], shape)
      expect(sim.exits).toBe(0)
    })
  }

  it('a hull fully under but at the surface, rising on a wave, throws none', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    run(sim, [{ seconds: 1, vy: 0, sub: wet }, ...Array.from({ length: 20 }, (_, k) => ({ seconds: .5, vy: k % 2 ? .5 : -.5, sub: wet })), { seconds: .3, vy: .5, sub: () => .3 }])
    expect(sim.exits).toBe(0)
  })

  it('keeps spray within its pool and finite with 16 vehicles crossing', () => {
    const cap = sprayCapacity(0), sim = new SpraySim(cap, flat)
    const a = new Float32Array(cap.droplets * 4), b = new Float32Array(cap.droplets * 4)
    for (let round = 0; round < 3; round++) {
      for (const p of dive(6, 5)) for (let i = 0; i < Math.round(p.seconds / DT); i++) {
        sim.step(DT)
        for (let v = 0; v < 16; v++) sim.vehicle(`v${v}`, v * 30, 0, 0, 8, p.vy, 0, p.sub((i + 1) * DT), DT, 1, { ball: v % 4 === 0 ? 1 : 0, mass: 30 + v * 200, beam: 1 + v * .1 })
        expect(sim.dropletCount).toBeLessThanOrEqual(cap.droplets)
      }
      const n = sim.packDroplets(a, b)
      for (let i = 0; i < n * 4; i++) expect(Number.isFinite(a[i]) && Number.isFinite(b[i])).toBe(true)
    }
    // More vehicles than the tier's slots: each still splashes once going in and once coming out.
    expect(cap.vehicles).toBeLessThan(16)
    expect(sim.entries).toBe(16 * 3)
    expect(sim.exits).toBe(16 * 3)
  })

  it('stays finite given non-finite state', () => {
    const cap = sprayCapacity(1), sim = new SpraySim(cap, flat)
    run(sim, dive(3, 4), { ball: 1 })
    for (const bad of [NaN, Infinity]) { sim.step(bad); sim.vehicle('a', 0, 0, 0, 1, bad, 0, bad, bad, 1, { ball: bad, mass: bad, beam: bad }) }
    run(sim, dive(3, 4), { ball: 0, mass: NaN, beam: Infinity }, 'b', 50)
    const a = new Float32Array(cap.droplets * 4), b = new Float32Array(cap.droplets * 4), n = sim.packDroplets(a, b)
    for (let i = 0; i < n * 4; i++) expect(Number.isFinite(a[i]) && Number.isFinite(b[i])).toBe(true)
  })
})

/**
 * As the game sends it (WaterEffects.ts): the wetted fraction scaled by the wake's eased
 * presence, which fades to nothing once the craft's top is under, with the depth of its top and
 * its height. Surface at y = 0. `ball` is a Zorb's radius (its fraction measured over its bottom
 * metre), else a hull `height` tall; `path` gives its centre height each frame.
 */
function sent(sim: SpraySim, path: number[], opts: { ball?: number; height?: number; forward?: number } = {}) {
  const r = opts.ball ?? 0, h = r ? 2 * r : opts.height ?? 1.2, forward = opts.forward ?? 6
  let presence = 1
  for (let i = 0; i < path.length; i++) {
    const y = path[i], vy = i ? (y - path[i - 1]) / DT : 0, top = y + h / 2, bottom = y - h / 2
    presence = easeWake(presence, wakePresence(top, h, 0), DT)
    const fraction = (r ? submergedFraction(bottom, bottom + 1, 0) : submergedFraction(bottom, top, 0)) * presence
    sim.step(DT)
    sim.vehicle('a', i * forward * DT, 0, 0, forward, vy, 0, fraction, DT, 1, { ball: r, under: -top, height: h })
  }
}
const line = (from: number, to: number, seconds: number) => { const n = Math.round(seconds / DT); return Array.from({ length: n + 1 }, (_, i) => from + (to - from) * i / n) }

describe('exit splash, as the game sends it', () => {
  it('a Zorb rising from deep throws one exit splash and no entry splash', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    sent(sim, [...line(-9, -9, .5), ...line(-9, 4, 1.2), ...line(4, 4, 1)], { ball: 1.5 })
    expect(sim.exits).toBe(1)
    expect(sim.entries).toBe(0)
  })

  it('a hull that dives in and comes back up splashes once going in and once coming out', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    sent(sim, [...line(3, 3, .3), ...line(3, -4, .8), ...line(-4, -4, .5), ...line(-4, 2, 1), ...line(2, 2, 1)])
    expect(sim.entries).toBe(1)
    expect(sim.exits).toBe(1)
  })

  it('a buggy driving up out of the shallows throws no exit splash', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    // Wading with its top above the water, then climbing a beach until clear.
    sent(sim, [...line(.2, .2, 1), ...line(.2, 1.5, 3), ...line(1.5, 1.5, 1)])
    expect(sim.exits).toBe(0)
  })

  it('still splashes going in from the air', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    sent(sim, [...line(4, 4, .3), ...line(4, -.3, .4), ...line(-.3, -.3, 1)])
    expect(sim.entries).toBe(1)
    expect(sim.exits).toBe(0)
  })

  it('a hull wading and climbing a beach throws no entry splash', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    // Already in: its bottom never clears the water while it wades at speed and its top bobs.
    sent(sim, [...line(-.2, -.2, .5), ...Array.from({ length: 180 }, (_, i) => -.2 + .25 * Math.sin(i / 6)), ...line(-.2, .4, 1)], { forward: 12 })
    expect(sim.entries).toBe(0)
  })

  it('a hull that sinks and half surfaces again throws no entry splash', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    sent(sim, [...line(-.2, -.2, .3), ...line(-.2, -.9, 1), ...line(-.9, -.1, 1), ...line(-.1, -.1, 1)], { forward: 12 })
    expect(sim.entries).toBe(0)
  })

  it('a craft hovering clear of the water throws no entry splash however its envelope dips', () => {
    const sim = new SpraySim(sprayCapacity(2), flat)
    // Its real bottom 0.3 to 0.9 m clear; the fraction sent says wet (WaterEffects' envelope round
    // the body reaches 0.5 m below its centre).
    let presence = 1
    for (let i = 0; i < 300; i++) {
      const y = 1.2 + .3 * Math.sin(i / 8), h = 1, top = y + h / 2
      presence = easeWake(presence, wakePresence(top, h, 0), DT)
      sim.step(DT)
      sim.vehicle('a', i * .2, 0, 0, 12, .3 * Math.cos(i / 8) * 60 / 8, 0, submergedFraction(y - 1.6, y + .5, 0) * presence, DT, 1, { ball: 0, under: -top, height: h })
    }
    expect(sim.entries).toBe(0)
  })
})

describe('the Zorb breach', () => {
  /** Droplets alive just after a Zorb of radius 2.5 breaches from `deep` metres at `rise` m/s. */
  const breach = (deep: number, rise: number, tier = 2) => {
    const sim = new SpraySim(sprayCapacity(tier), flat)
    const up = line(-deep - 5, 6, (deep + 11) / rise)
    sent(sim, up, { ball: 2.5 })
    return sim
  }
  it('is bigger from deeper', () => {
    expect(breach(8, 10).dropletCount).toBeGreaterThan(breach(2.5, 10).dropletCount * 1.5)
  })
  for (const tier of [0, 1, 2]) it(`stays within the pool and finite at tier ${tier}`, () => {
    const sim = breach(20, 14, tier), cap = sprayCapacity(tier)
    expect(sim.exits).toBe(1)
    expect(sim.dropletCount).toBeLessThanOrEqual(cap.droplets)
    const a = new Float32Array(cap.droplets * 4), b = new Float32Array(cap.droplets * 4), n = sim.packDroplets(a, b)
    for (let i = 0; i < n * 4; i++) expect(Number.isFinite(a[i]) && Number.isFinite(b[i])).toBe(true)
  })
})

describe('a craft wholly under', () => {
  it('lays no wake or trail on the surface over it', () => {
    for (const ball of [0, 2.5]) {
      const sim = new SpraySim(sprayCapacity(2), flat)
      // Moving along 4 m under at 6 m/s for 2 s, as the game sends it.
      sent(sim, line(-4 - (ball || .6), -4 - (ball || .6), 2), { ball, forward: 6 })
      expect(sim.wakePoints).toBe(0)
    }
  })
})

