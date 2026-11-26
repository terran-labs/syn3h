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
    // Bounce limit: the camera does not thrash. 12, not 8: one bot drive's bounce moves by several
    // m/s² with any handling change (Balanced read 7.8 on world 2 seed a, Assisted 9.2), and the
    // handling report lists it per world and seed. 17 was a real regression; 9 is noise.
    expect(r.bounce).toBeLessThan(12); expect(r.maxKick).toBeLessThan(25); expect(r.lag).toBeLessThan(15)
  }, 60000)
})
