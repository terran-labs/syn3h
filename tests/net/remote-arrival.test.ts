import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NetClient } from '../../src/net'
import { createVehicle } from '../../src/vehicles'

vi.mock('../../src/vehicles', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/vehicles')>(),
  createVehicle: vi.fn(),
}))

function vehicle(kind = 'tank') {
  return { kind, body: { translation: () => ({ x: 1, y: 2, z: 3 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }), bodyType: () => 0, setRotation: vi.fn() }, setColors: vi.fn() }
}
function fixture() {
  const info = { id: 2, name: 'Guest', kind: 'jet', colors: ['#123456', '#abcdef'] }
  const previous = { vehicle: vehicle(), owned: true, disposeEffects: vi.fn(), clearance: 1, buffer: { states: [] } }
  const replacement = vehicle('jet')
  vi.mocked(createVehicle).mockReturnValue(replacement as any)
  const callback = vi.fn()
  const net = Object.create(NetClient.prototype)
  Object.assign(net, { ctx: { game: { add: vi.fn(), remove: vi.fn() }, terrain: {}, onRemoteVehicleChanged: callback, audio: { play: vi.fn() } }, remotes: new Map([[2, previous]]), attachEffects: vi.fn(() => vi.fn()) })
  return { net, info, previous, replacement, callback }
}
beforeEach(() => vi.clearAllMocks())
describe('remote vehicle arrival callback', () => {
  it('notifies once after replacement is registered and recoloured', () => {
    const f = fixture()
    f.callback.mockImplementation(v => {
      expect(f.net.remotes.get(2).vehicle).toBe(v)
      expect(v.setColors).toHaveBeenCalledWith(...f.info.colors)
    })
    f.net.applyProfile(f.info)
    f.net.applyProfile(f.info)
    expect(f.callback).toHaveBeenCalledExactlyOnceWith(f.replacement)
  })
  it.each(['tank', 'buggy-classic'])('does not notify for an unchanged kind or legacy alias: %s', kind => {
    const f = fixture()
    f.previous.vehicle.kind = kind === 'tank' ? 'tank' : 'buggy'
    f.net.applyProfile({ ...f.info, kind })
    expect(f.callback).not.toHaveBeenCalled()
    expect(createVehicle).not.toHaveBeenCalled()
  })
  it('does not notify for an unknown profile or initial spawn', () => {
    const f = fixture()
    f.net.remotes.clear()
    f.net.applyProfile(f.info)
    f.net.spawnRemote(f.info, { p: [1, 2, 3], q: [0, 0, 0, 1] })
    expect(f.callback).not.toHaveBeenCalled()
  })
  it('keeps the replacement when a cosmetic callback throws', () => {
    const f = fixture()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    f.callback.mockImplementation(() => { throw new Error('effect unavailable') })
    try {
      expect(() => f.net.applyProfile(f.info)).not.toThrow()
      expect(f.net.remotes.get(2).vehicle).toBe(f.replacement)
      expect(warn).toHaveBeenCalledOnce()
    } finally { warn.mockRestore() }
  })
  it('allows callers without an effect hook', () => {
    const f = fixture()
    delete f.net.ctx.onRemoteVehicleChanged
    expect(() => f.net.applyProfile(f.info)).not.toThrow()
  })
})
