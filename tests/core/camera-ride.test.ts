import { appendFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { initPhysics } from '../../src/core/physics'
import { ride } from '../bots/camera-ride'
import '../../src/bots/params'

beforeAll(initPhysics)
describe('chase camera on a real drive', () => {
  it.each([['a', 0], ['b', 0], ['a', 2]] as const)('seed %s on world %i', (seed, kind) => {
    const r = ride(seed, 180, kind)
    appendFileSync('/tmp/syn3h-camera-ride.log', `${seed} world ${kind} ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(3)])))}\n`)
    // The lens stays well clear of the ground, so no corner of the view is ever inside it.
    expect(r.minClear).toBeGreaterThan(0.9); expect(r.clippedShare).toBe(0)
    // The ground almost never hides the car, and the camera never snaps toward it.
    expect(r.hiddenShare).toBeLessThan(0.02); expect(r.maxPop).toBeLessThan(0.5)
    // The view rides over the suspension, never twitches, and still looks where the car is going.
    expect(r.bounce).toBeLessThan(8); expect(r.maxKick).toBeLessThan(25); expect(r.lag).toBeLessThan(15)
  }, 60000)
})
