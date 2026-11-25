/**
 * Splashes coming out of the water (spraySim.ts exitSplash): one for each crossing, none for a hull
 * riding the surface, spray within its pool however many vehicles cross, and nothing non-finite.
 */
import { describe, expect, it } from 'vitest'
import { SpraySim, sprayCapacity, type WakeShape } from '../../src/world/water/spraySim'

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
