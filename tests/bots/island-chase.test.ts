import { appendFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initPhysics } from '../../src/core/physics'
import { params } from '../../shared/params'
import { chase } from './island-chase'
import '../../src/bots/params'
vi.mock('../../src/vehicles/effects', () => ({ attachVehicleEffects: () => () => {} }))

beforeAll(initPhysics)
beforeEach(() => { for (const p of params.all().filter(p => ['Bots', 'Daydream'].includes(p.def.group))) params.set(p.def.id, p.def.default) })
describe('summit chase on the real island', () => {
  it.each([42, 1])('four bots follow a target up the volcano road (seed %i)', seed => {
    const verbose = process.env.BOT_VERBOSE === '1'
    const r = chase(seed, 4, 265, 11, 0, verbose ? line => appendFileSync('/tmp/syn3h-island-chase.log', line + '\n') : undefined)
    appendFileSync('/tmp/syn3h-island-chase.log', `seed ${seed} summit ${r.summit.toFixed(0)} arrived ${r.arrived}/4 ${JSON.stringify(r.bots.map(b => ({ id: b.id, gap: Math.round(b.gap), y: Math.round(b.height), fellAt: b.fellAt && Math.round(b.fellAt), offRoad: Math.round(b.offRoad) })))}\n`)
    expect(r.summit).toBeGreaterThan(150)
  }, 120000)
})
