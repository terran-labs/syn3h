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
    expect(Number.isFinite(r.minClear)).toBe(true)
  }, 60000)
})
