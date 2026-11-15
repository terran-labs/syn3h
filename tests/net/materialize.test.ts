import { describe, expect, it, vi } from 'vitest'
import { NetClient } from '../../src/net'

// Exercise the real network entry points without constructing a renderer or opening sockets.
function fixture() {
  const player = { object: { userData: {} as Record<string, unknown> }, body: { handle: 7 } }
  const other = { object: { userData: {} as Record<string, unknown> }, body: { handle: 8 } }
  const net = Object.create(NetClient.prototype)
  Object.assign(net, {
    id: 1, ctx: { player, game: { time: 1 }, terrain: {} }, conn: { state: 'closed' },
    remotes: new Map(), bots: null, stats: { shotsFired: 0, rams: 0 },
    clock: { now: () => 1 }, lasers: { aim: vi.fn(() => ({ o: [0, 0, 0], d: [0, 0, -1] })), spawn: vi.fn() },
  })
  return { net, player, other }
}

describe('materialize hold in networking', () => {
  it('blocks outgoing beams while held and resumes firing when the flag is deleted', () => {
    const { net, player } = fixture()
    player.object.userData.materializing = true
    net.fire()
    expect(net.lasers.aim).not.toHaveBeenCalled()
    expect(net.stats.shotsFired).toBe(0)
    delete player.object.userData.materializing
    net.fire()
    expect(net.lasers.spawn).toHaveBeenCalledOnce()
    expect(net.stats.shotsFired).toBe(1)
  })

  it('does not judge beam hits on the local player until the hold ends', () => {
    const { net, player } = fixture()
    expect(net.judgedId(7)).toBe(1)
    player.object.userData.materializing = true
    expect(net.judgedId(7)).toBeNull()
    delete player.object.userData.materializing
    expect(net.judgedId(7)).toBe(1)
  })

  it.each(['player', 'other'] as const)('ignores contact when %s is held, before reading physics or sending a tag', held => {
    const f = fixture()
    f[held].object.userData.materializing = true
    expect(f.net.touching(f.player, f.other)).toBe(false)
    f.net.onContact(2, f.other)
    expect(f.net.stats.rams).toBe(0)
  })

  it('refuses a Pester launch during the hold without touching the projectile system', () => {
    const { net, player } = fixture()
    player.object.userData.materializing = true
    expect(net.launchPester(2)).toBe(false)
    expect(net.lasers.aim).not.toHaveBeenCalled()
  })
  it('drops relayed shoves received during the hold instead of queuing them until release', () => {
    const { net, player } = fixture()
    net.shoves = { add: vi.fn() }
    player.object.userData.materializing = true
    net.onMessage({ type: 'shove', from: 2, push: [3, 0, 0] })
    expect(net.shoves.add).not.toHaveBeenCalled()
  })

  it('drains already queued shoves without applying them during the hold', () => {
    const { net, player } = fixture()
    Object.assign(player.body, { linvel: () => ({ x: 0, y: 0, z: 0 }), setLinvel: vi.fn() })
    net.shoves = { take: vi.fn(() => [{ from: 2, push: [3, 0, 0] }]) }
    player.object.userData.materializing = true
    net.applyShoves()
    expect(net.shoves.take).toHaveBeenCalledOnce()
    expect((player.body as any).setLinvel).not.toHaveBeenCalled()
  })

})
