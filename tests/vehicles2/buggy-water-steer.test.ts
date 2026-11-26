/**
 * Steering a buggy on water (src/vehicles/skip.ts SkipKeel and applyWetGrip). Invariants only:
 * how tight it turns, skipping or wallowing, is tuning, reported by tools/handling-report.ts.
 * The bug each catches: steering on water turns the buggy's path the wrong way, or not at all.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { initPhysics } from '../../src/core/physics'
import { skipAngle } from '../../src/vehicles/skip'
import * as buggy from '../vehicles/miraScenarios'
import { coastFor, skipLaunch, type SkipRun } from './waterSkipScenarios'

beforeAll(initPhysics)
const course = (l: { x: number; z: number }) => Math.atan2(l.x, -l.z)
const turned = (from: number, to: number) => { let d = to - from; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d }

/** Which way full lock `steer` turns the buggy's path on dry ground (the sign every surface must share). */
async function dryWay(steer: number): Promise<number> {
  const { bed, b } = await buggy.cruise(15)
  const c0 = course(b.body.linvel())
  b.input.x = steer
  bed.run(1)
  return Math.sign(turned(c0, course(b.body.linvel())))
}

/** The path's turn (radians) over `seconds` of full lock `steer`, from a run already on the water. */
function waterTurn(run: SkipRun, steer: number, seconds: number): number {
  const c0 = course(run.v.body.linvel())
  run.v.input.x = steer
  coastFor(run, seconds)
  return turned(c0, course(run.v.body.linvel()))
}

describe('steering on water', () => {
  it('full lock turns the path the way it does on dry ground, skimming and wallowing', async () => {
    for (const steer of [1, -1]) {
      const way = await dryWay(steer)
      expect(way).not.toBe(0)
      // Skimming: three times the planing speed, flat out, past the first hops.
      const skim = skipLaunch('buggy', (p) => p * 3, skipAngle.value / 3, { throttle: 1 })
      // Wallowing: a skip from just above the planing speed under throttle, decayed into the wallow.
      const wallow = skipLaunch('buggy', (p) => p * 1.5, skipAngle.value / 3, { throttle: 1 })
      try {
        coastFor(skim, 3); coastFor(wallow, 20)
        for (const run of [skim, wallow]) {
          const d = waterTurn(run, steer, 3)
          expect(Math.sign(d)).toBe(way)
          expect(run.trace.every((s) => s.finite)).toBe(true)
        }
      } finally { skim.dispose(); wallow.dispose() }
    }
  })
})
