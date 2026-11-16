import { describe, expect, it } from 'vitest'
import { Object3D } from 'three/webgpu'
import { RemoteArrivals, type ParkableVehicle } from '../../src/net/arrivals'

/** A vehicle that records being parked and shown, and a compile the test resolves by hand. */
function vehicle() {
  const v = { object: new Object3D(), parked: false, shown: 0, setParked(p: boolean) { v.parked = p } }
  return v
}
function compiler() {
  const pending: (() => void)[] = []
  return { compile: () => new Promise<void>(resolve => pending.push(resolve)), finish: async () => { for (const r of pending.splice(0)) r(); await Promise.resolve(); await Promise.resolve() } }
}

describe('remote arrivals', () => {
  it('drops a remote that leaves while queued: never shown, no leak, no throw', async () => {
    const c = compiler(), shown: ParkableVehicle[] = []
    const arrivals = new RemoteArrivals(v => shown.push(v), () => 1, c.compile)
    const bot = vehicle()
    arrivals.admit(1001, bot, false)
    expect(bot.parked).toBe(true)
    arrivals.drop(1001)
    await c.finish()
    expect(() => arrivals.update(10_000)).not.toThrow()
    expect(shown).toHaveLength(0)
    expect(arrivals.pending).toBe(0)
  })

  it('shows people as soon as they are ready, then bots one per interval', async () => {
    const c = compiler(), shown: unknown[] = []
    const arrivals = new RemoteArrivals(v => shown.push(v), () => 1, c.compile)
    const bots = [vehicle(), vehicle(), vehicle()], person = vehicle()
    bots.forEach((b, i) => arrivals.admit(1000 + i, b, false))
    arrivals.admit(7, person, true)
    await c.finish()
    arrivals.update(0)
    expect(shown[0]).toBe(person)
    expect(shown).toHaveLength(2)
    arrivals.update(500); expect(shown).toHaveLength(2)
    arrivals.update(1000); expect(shown).toHaveLength(3)
    arrivals.update(2000); expect(shown).toHaveLength(4)
    expect([person, ...bots].every(v => !v.parked)).toBe(true)
  })

  it('shows at once where nothing can compile ahead', () => {
    const arrivals = new RemoteArrivals(() => {}, () => 1, () => null)
    const bot = vehicle()
    arrivals.admit(1000, bot, false)
    expect(bot.parked).toBe(false)
    expect(arrivals.pending).toBe(0)
  })
})
