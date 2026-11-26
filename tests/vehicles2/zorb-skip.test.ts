/**
 * Zorb skipping on water and lava (zorb.ts `zorbSkimAt`, the shared planing contact of skip.ts).
 * Invariants only: how far, how many skips and how much speed are tuning, reported by
 * tools/handling-report.ts. Speeds here are multiples of the zorbed buggy's derived planing
 * speed (`ballPlaning`), so retuning the water.skip.* settings moves the scenarios with it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { FIXED_DT, initPhysics } from '../../src/core/physics'
import { params } from '../../shared/params'
import { decodeState, encodeState } from '../../shared/protocol'
import { emptyInput } from '../../src/core/Input'
import { ballPlaning, coast, skipsOf, speedAt, zorbLaunch, type ZorbRun } from './zorbSkipScenarios'

beforeAll(initPhysics)
const IDS = ['water.skip.planingScale', 'water.skip.minSpeed', 'water.skip.angle', 'water.skip.friction', 'water.skip.keep', 'water.zorb.planing']
let planing = 0
beforeAll(() => { planing = ballPlaning() })
afterEach(() => { for (const id of IDS) params.set(id, params.get(id)!.def.default) })

const finite = (r: ZorbRun) => r.trace.every((s) => Number.isFinite(s.y + s.z + s.vy + s.speed + s.base + s.skipping))
const loss = (r: ZorbRun, seconds: number) => 1 - speedAt(r.trace, seconds) / r.trace[0].speed

describe('zorb skipping', () => {
  for (const liquid of ['water', 'lava'] as const) {
    it(`a fast shallow ball skips off ${liquid} and keeps far more of its speed than a slow one`, () => {
      const fast = zorbLaunch({ liquid, depth: 30 }, planing * 2.5, 8)
      const slow = zorbLaunch({ liquid, depth: 30 }, planing * 0.5, 8)
      try {
        coast(fast, 3); coast(slow, 3)
        expect(skipsOf(fast.trace)).toBeGreaterThanOrEqual(1)
        expect(skipsOf(slow.trace)).toBe(0)
        expect(loss(fast, 2)).toBeLessThan(loss(slow, 2) * 0.5)
        expect(finite(fast) && finite(slow)).toBe(true)
      } finally { fast.dispose(); slow.dispose() }
    })
  }

  it('rolling slowly into water settles into it and floats', () => {
    const r = zorbLaunch({ liquid: 'water', depth: 30 }, planing * 0.3, 2)
    try {
      coast(r, 6)
      expect(skipsOf(r.trace)).toBe(0)
      // Floating, wet, with buoyancy rather than skimming lift carrying it.
      const end = r.trace[r.trace.length - 1]
      expect(end.base).toBeLessThan(0)
      expect(end.skipping).toBeLessThan(0.5)
    } finally { r.dispose() }
  })

  it('never falls through a shallow bed, on waves or diving in steeply, and stays finite', () => {
    for (const [speed, angle] of [[2.5, 8], [3, 45], [1, 60]]) {
      const r = zorbLaunch({ liquid: 'water', depth: 2, waves: 'sea' }, planing * speed, angle, 3)
      try {
        coast(r, 5)
        expect(finite(r)).toBe(true)
        // A contact can overlap the bed by up to one step's travel before Rapier pushes it out;
        // falling through goes deeper and never comes back. It must end resting on top.
        const step = planing * speed * FIXED_DT
        for (const s of r.trace) expect(s.y - r.radius).toBeGreaterThan(r.bed(s.z) - step)
        const end = r.trace[r.trace.length - 1]
        expect(end.y - r.radius).toBeGreaterThan(r.bed(end.z) - 0.05)
      } finally { r.dispose() }
    }
  })

  it('a skipping ball survives a network round trip: copies built from its state agree', () => {
    const a = zorbLaunch({ liquid: 'water', depth: 30, waves: 'sea' }, planing * 2.5, 8)
    const copies: ZorbRun[] = []
    try {
      coast(a, 0.5)
      expect(skipsOf(a.trace) + a.trace.filter((s) => s.base <= 0).length).toBeGreaterThan(0)
      const t = a.v.body.translation(), q = a.v.body.rotation(), v = a.v.body.linvel(), w = a.v.body.angvel()
      const wire = decodeState(encodeState({ id: 0, t: a.clock.t, p: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z], input: { ...emptyInput(), zorb: true } }))!
      expect(wire.input.zorb).toBe(true)
      for (let i = 0; i < 2; i++) {
        const c = zorbLaunch({ liquid: 'water', depth: 30, waves: 'sea' }, 0, 0)
        c.clock.t = wire.t
        c.v.body.setTranslation({ x: wire.p[0], y: wire.p[1], z: wire.p[2] }, true)
        c.v.body.setRotation({ x: wire.q[0], y: wire.q[1], z: wire.q[2], w: wire.q[3] }, true)
        c.v.body.setLinvel({ x: wire.v[0], y: wire.v[1], z: wire.v[2] }, true)
        c.v.body.setAngvel({ x: wire.w[0], y: wire.w[1], z: wire.w[2] }, true)
        copies.push(c)
      }
      const n = a.trace.length
      coast(a, 1.5); for (const c of copies) coast(c, 1.5)
      const path = (r: ZorbRun, from = 0) => r.trace.slice(from).map((s) => new THREE.Vector3(0, s.y, s.z))
      const pa = path(a, n), [p1, p2] = copies.map((c) => path(c))
      // Copies from the same state follow the same path, and the owner's. Not bit for bit:
      // each Rapier world keeps its own contact history, and the wire carries 32 bit floats.
      // Measured 17 November 2026: under 5 mm apart after 1.5 s of skipping.
      expect(Math.max(...p1.map((p, i) => p.distanceTo(p2[i])))).toBeLessThan(0.1)
      expect(Math.max(...p1.map((p, i) => p.distanceTo(pa[i])))).toBeLessThan(0.1)
    } finally { a.dispose(); for (const c of copies) c.dispose() }
  })
})
