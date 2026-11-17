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
  // deep-pond: a sunk buggy towed along the bed of deep water must come out (see liquids.test.ts).
  for (const scenario of ['notch', 'shore', 'deep-pond'] as const) {
    it(`frees a buggy stuck in a ${scenario} within a minute`, () => {
      for (const seed of [1, 2]) {
        const r = trial(scenario, seed)
        expect(r.stuckAlone, `${scenario} ${seed}: the buggy got out by itself, so the scenario proves nothing`).toBe(true)
        expect(r.freed, `${scenario} ${seed}: ${r.phases.join(' > ')}`).toBe(true)
        expect(r.seconds).toBeLessThan(60)
      }
    }, 120_000)
  }
})
