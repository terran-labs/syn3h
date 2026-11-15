import { appendFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initPhysics } from '../../src/core/physics'
import { params } from '../../shared/params'
import { chase } from './island-chase'
import '../../src/bots/params'
vi.mock('../../src/vehicles/effects', () => ({ attachVehicleEffects: () => () => {} }))

beforeAll(initPhysics)
beforeEach(() => { for (const p of params.all().filter(p => ['Bots', 'Daydream'].includes(p.def.group))) params.set(p.def.id, p.def.default) })
const LOG = process.env.BOT_CHASE_LOG ?? '/tmp/syn3h-island-chase.log'
const sweep = process.env.BOT_CHASE_SWEEP === '1'
const cases = sweep ? [42, 1, 7, 4242].flatMap(seed => [8, 11, 15].map(speed => [seed, speed] as const)) : [[42, 8], [1, 8], [7, 8], [4242, 8], [42, 11], [1, 11]] as const
describe('summit chase on the real island', () => {
  it.each(cases)('four bots follow a target up the volcano road (seed %i, speed %i)', (seed, speed) => {
    const verbose = process.env.BOT_VERBOSE === '1'
    const r = chase(seed, 4, 265, speed, 0, verbose ? line => appendFileSync(LOG, line + '\n') : sweep ? () => {} : undefined, false, process.env.BOT_PEER_CONTACTS !== '0')
    appendFileSync(LOG, `seed ${seed} speed ${speed} summit ${r.summit.toFixed(0)} arrived ${r.arrived}/4 ${JSON.stringify(r.bots.map(b => ({ id: b.id, gap: Math.round(b.gap), y: Math.round(b.height), fellAt: b.fellAt && Math.round(b.fellAt), offRoad: Math.round(b.offRoad), contact: b.lastContactBeforeFall })))}\n`)
    expect(r.summit).toBeGreaterThan(150)
    // Slow leaders used to trigger direct pursuit on narrow bends and repeated falls.
    expect(r.arrived).toBe(4)
    expect(r.bots.every(bot => bot.fellAt === null)).toBe(true)
  }, 120000)
})
