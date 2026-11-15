import { describe, expect, it } from 'vitest'
import { cordPull, cordSag, predict, reducedMass, type CordTuning } from '../../src/weapons/bungee/rope'
import { bungeeDamping, bungeeMaxPull, bungeeStiffness } from '../../src/weapons/bungee/params'

const DT = 1 / 50
const G = 9.81

/**
 * Two vehicles on one cord, each pulled by its own client from where it sees the other: the
 * other end's position and speed arrive `lag` seconds late. One dimension, no ground
 * friction, which is the worst case: real vehicles also lose energy to the ground.
 * Returns the largest stretch in each second.
 */
function lagged(t: CordTuning, m1: number, m2: number, lag: number, seconds: number, rest = 10, start = 30): number[] {
  let x1 = 0, v1 = 0, x2 = start, v2 = 0
  const delay = Math.round(lag / DT)
  const hist1: [number, number][] = []
  const hist2: [number, number][] = []
  const peaks: number[] = []
  const mu = reducedMass(m1, m2)
  for (let i = 0; i < seconds / DT; i++) {
    hist1.push([x1, v1]); hist2.push([x2, v2])
    const [x1late, v1seen] = hist1[Math.max(0, hist1.length - 1 - delay)]
    const [x2late, v2seen] = hist2[Math.max(0, hist2.length - 1 - delay)]
    // As Bungee.ts does: carry the late view forward by the known lag.
    const x1seen = predict(x1late, v1seen, lag)
    const x2seen = predict(x2late, v2seen, lag)
    // Client 1 pulls vehicle 1 toward where it sees vehicle 2, and client 2 the reverse.
    const f1 = cordPull(Math.abs(x2seen - x1), rest, Math.sign(x2seen - x1) * (v2seen - v1), mu, t) * Math.sign(x2seen - x1)
    const f2 = cordPull(Math.abs(x2 - x1seen), rest, Math.sign(x2 - x1seen) * (v2 - v1seen), mu, t) * Math.sign(x1seen - x2)
    v1 += (f1 / m1) * DT; x1 += v1 * DT
    v2 += (f2 / m2) * DT; x2 += v2 * DT
    const s = Math.max(0, Math.abs(x2 - x1) - rest)
    const k = Math.floor(i * DT)
    peaks[k] = Math.max(peaks[k] ?? 0, s)
  }
  return peaks
}

const tuning = (omega: number, zeta: number, pull = bungeeMaxPull.def.default): CordTuning => ({ omega, zeta, maxAccel: pull * G })

describe('bungee cord', () => {
  it('only ever pulls', () => {
    const t = tuning(1.4, 0.7)
    expect(cordPull(5, 10, 0, 100, t)).toBe(0)
    expect(cordPull(12, 10, -50, 100, t)).toBe(0)
    expect(cordPull(12, 10, 0, 100, t)).toBeGreaterThan(0)
    expect(cordPull(1000, 10, 0, 100, t)).toBeCloseTo(100 * t.maxAccel)
    expect(cordPull(1000, 10, 100, 100, t)).toBeCloseTo(150 * t.maxAccel)
  })

  it('sags when slack and is straight when taut', () => {
    expect(cordSag(10, 10)).toBe(0)
    expect(cordSag(10, 8)).toBe(0)
    expect(cordSag(10, 14)).toBeGreaterThan(2)
  })

  it('settles two vehicles 250 ms apart instead of flinging them', () => {
    const peaks = lagged(tuning(bungeeStiffness.def.default, bungeeDamping.def.default), 600, 600, 0.25, 20)
    expect(peaks[0]).toBeGreaterThan(5)
    expect(peaks[19]).toBeLessThan(0.05)
  })

  it('settles a tank and a buggy as well as two buggies', () => {
    const peaks = lagged(tuning(bungeeStiffness.def.default, bungeeDamping.def.default), 6000, 600, 0.25, 20)
    expect(peaks[19]).toBeLessThan(0.05)
  })

  // Every corner of the sliders' ranges, at the venue's worst normal lag: no setting a host
  // can choose makes the cord pump itself up.
  it('never grows its bounce at any slider setting', () => {
    const omegas = [bungeeStiffness.def.min!, bungeeStiffness.def.max!]
    const zetas = [bungeeDamping.def.min!, bungeeDamping.def.max!]
    const pulls = [bungeeMaxPull.def.min!, bungeeMaxPull.def.max!]
    for (const omega of omegas) for (const zeta of zetas) for (const pull of pulls) {
      for (const lag of [0.1, 0.25, 0.4]) {
      const peaks = lagged(tuning(omega, zeta, pull), 600, 600, lag, 40)
      const early = Math.max(...peaks.slice(0, 5))
      const late = Math.max(...peaks.slice(30))
      expect(late, `omega ${omega} zeta ${zeta} pull ${pull} lag ${lag}`).toBeLessThan(Math.max(0.5, early * 0.5))
      }
    }
  })

  it('holds a vehicle hanging from a ground anchor steady', () => {
    const t = tuning(bungeeStiffness.def.default, bungeeDamping.def.default)
    const m = 600
    // Anchor at height 0, vehicle hanging below on a 10 m cord, starting at rest length.
    let y = -10, v = 0
    const trace: number[] = []
    for (let i = 0; i < 20 / DT; i++) {
      const len = -y
      const f = cordPull(len, 10, -v, m, t)
      v += (f / m - G) * DT; y += v * DT
      trace.push(y)
    }
    const settled = -10 - G / (t.omega * t.omega)
    const last = trace.slice(-50)
    for (const p of last) expect(p).toBeCloseTo(settled, 1)
  })
})
