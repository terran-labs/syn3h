/**
 * A stuck buggy is freed by another bot's grapple within a bounded time, in the standard
 * cases: wedged nose-down in a notch, and bogged in a pond. Real physics and the real
 * grapple (see scenarios.ts). Slow for a unit test (a few seconds each) because it is the
 * rescue itself; tools/rescue-trials.ts runs many more seeds for the success rate.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { initPhysics } from '../../../src/core/physics'
import { allowGrapple, trial } from './scenarios'

beforeAll(async () => {
  vi.stubGlobal('window', { performance })
  await initPhysics()
  allowGrapple()
})

describe('grapple rescue', () => {
  for (const scenario of ['notch', 'shore'] as const) {
    it(`frees a buggy stuck in a ${scenario} within a minute`, () => {
      for (const seed of [1, 2]) {
        const r = trial(scenario, seed)
        expect(r.stuckAlone, `${scenario} ${seed}: the buggy got out by itself, so the scenario proves nothing`).toBe(true)
        expect(r.freed, `${scenario} ${seed}: ${r.phases.join(' > ')}`).toBe(true)
        expect(r.seconds).toBeLessThan(60)
      }
    }, 120_000)
  }

  it('frees a passive player bogged 2.6 m deep with a hovercraft rescuer within 75 s', () => {
    for (const seed of [1, 2]) {
      const r = trial('pond', seed, 75, 4, undefined, { depth: 2.6, assist: false, rescuer: 'hovercraft' })
      expect(r.stuckAlone).toBe(true)
      expect(r.freed, `pond ${seed}: ${r.phases.join(' > ')}`).toBe(true)
    }
  }, 120_000)
})
