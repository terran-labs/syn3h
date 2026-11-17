/**
 * Removal is immediate and complete: a bot the host stops simulating is announced to the room
 * at once, and a remote that leaves is out of every gameplay list in the same step, whatever its
 * departure effect is still showing.
 */
import { describe, expect, it, vi } from 'vitest'
import { NetClient } from '../../src/net'
import { BOT_ID_BASE } from '../../shared/protocol'

// Each bot's body is its own; the world knows it while it is alive.
let handles = 0
const bodies = new Map<number, object>()
const body = () => { const b = { handle: ++handles }; bodies.set(b.handle, b); return b }
const world = { getRigidBody: (h: number) => bodies.get(h) }

function host(vehicles: object[]) {
  const net = Object.create(NetClient.prototype)
  const sent: object[] = []
  Object.assign(net, {
    bots: { vehicles }, botKinds: new Map(), stats: { botStatesSent: 0 },
    ctx: { game: { world }, player: {} }, clock: { now: () => 0 }, canonical: (p: number[]) => p,
    conn: { send: vi.fn() }, send: (m: object) => sent.push(m),
  })
  return { net, sent }
}

describe('a bot the host stops simulating', () => {
  it('is announced to the room at once, and only once', () => {
    const bot = (kind = 'buggy') => ({ kind, body: body(), getState: () => ({ p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: {} }) })
    const vehicles = [bot(), bot(), bot()]
    const { net, sent } = host(vehicles)
    net.sendBot = (id: number, b: { kind: string }) => { net.botKinds.set(id, b.kind) }
    net.sendBots()
    vehicles.length = 1
    net.sendBots()
    expect(sent).toEqual([{ type: 'bot-leave', bot: BOT_ID_BASE + 1 }, { type: 'bot-leave', bot: BOT_ID_BASE + 2 }])
    net.sendBots()
    expect(sent).toHaveLength(2)
  })
})

describe('a remote that leaves', () => {
  it('is out of every gameplay list and the physics world in the same step, while its departure plays', () => {
    const net = Object.create(NetClient.prototype)
    const vehicle = { detach: vi.fn(), dispose: vi.fn() }
    let finish!: () => void
    const game = { remove: vi.fn() }
    Object.assign(net, {
      remotes: new Map([[5, { vehicle, owned: true, disposeEffects: vi.fn() }]]), departing: new Map(), uiDirty: false,
      bungee: { forget: vi.fn() }, yoink: { forget: vi.fn() }, pesters: { forget: vi.fn() },
      ctx: { game, onRemoteVehicleLeaving: () => new Promise<void>(r => { finish = r }) },
    })
    net.removeRemote(5, true)
    expect(net.remotes.has(5)).toBe(false)
    expect(game.remove).toHaveBeenCalledWith(vehicle, false)
    expect(vehicle.detach).toHaveBeenCalled()
    expect(vehicle.dispose).not.toHaveBeenCalled()
    finish()
    return Promise.resolve().then(() => Promise.resolve()).then(() => expect(vehicle.dispose).toHaveBeenCalledOnce())
  })
})
