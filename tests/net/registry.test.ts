/** The player count behind GET /status: see server/registry.ts for what it promises. */
import { describe, expect, it } from 'vitest'
import { REFRESH_MS, RoomRegistry, STALE_MS } from '../../server/registry'

describe('RoomRegistry', () => {
  it('is empty until a room reports', () => {
    expect(new RoomRegistry().totals(1000)).toEqual({ rooms: 0, players: 0 })
  })

  it('counts players across rooms, taking each room\'s latest report', () => {
    const r = new RoomRegistry()
    r.report('lobby', 1, 1000)
    r.report('lobby', 2, 2000)
    r.report('demo', 3, 2500)
    expect(r.totals(3000)).toEqual({ rooms: 2, players: 5 })
    r.report('lobby', 1, 4000)
    expect(r.totals(4000)).toEqual({ rooms: 2, players: 4 })
  })

  it('forgets a room that reports nobody', () => {
    const r = new RoomRegistry()
    r.report('lobby', 2, 1000)
    r.report('demo', 1, 1000)
    r.report('lobby', 0, 2000)
    expect(r.totals(2000)).toEqual({ rooms: 1, players: 1 })
    r.report('demo', 0, 3000)
    expect(r.totals(3000)).toEqual({ rooms: 0, players: 0 })
    expect(r.save()).toEqual({})
  })

  it('keeps a room that refreshes, and drops one silent for ten minutes', () => {
    const r = new RoomRegistry()
    r.report('busy', 2, 0)
    r.report('reset-by-a-deploy', 3, 0)
    // The busy room repeats its count every couple of minutes; the other never speaks again.
    for (let t = REFRESH_MS; t <= STALE_MS + REFRESH_MS; t += REFRESH_MS) r.report('busy', 2, t)
    // Just inside ten minutes the silent room still counts: "occupied" errs on the long side.
    expect(r.totals(STALE_MS)).toEqual({ rooms: 2, players: 5 })
    expect(r.totals(STALE_MS + 1)).toEqual({ rooms: 1, players: 2 })
    expect(Object.keys(r.save())).toEqual(['busy'])
  })

  it('survives being saved and loaded, and ignores damaged entries', () => {
    const r = new RoomRegistry()
    r.report('lobby', 2, 1000)
    r.report('demo', 1, 1500)
    const again = new RoomRegistry(JSON.parse(JSON.stringify(r.save())))
    expect(again.totals(2000)).toEqual({ rooms: 2, players: 3 })
    const damaged = new RoomRegistry({ a: { players: -1, at: 1 }, b: { players: 2.5, at: 1 }, c: { players: 2, at: NaN }, d: null as never, ok: { players: 4, at: 1 } })
    expect(damaged.totals(2)).toEqual({ rooms: 1, players: 4 })
  })

  it('refuses nonsense reports', () => {
    const r = new RoomRegistry()
    r.report('', 3, 1)
    r.report('x'.repeat(200), 3, 1)
    r.report('lobby', 2.5, 1)
    r.report('lobby', NaN, 1)
    r.report('lobby', -4, 1)
    expect(r.totals(2)).toEqual({ rooms: 0, players: 0 })
    // An absurd count is capped, not believed.
    r.report('lobby', 1e9, 1)
    expect(r.totals(2).players).toBe(1000)
  })
})
