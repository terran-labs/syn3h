import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetClient } from '../../src/net'
import { params } from '../../shared/params'

afterEach(() => { vi.restoreAllMocks(); params.set('world.gravity', 9.81) })

/** A client stand-in with only what onParamChange and resendUnsent read. */
function client(state: { open: boolean; welcomed: boolean; everWelcomed: boolean; host: number; id: number }) {
  const net = Object.create(NetClient.prototype)
  Object.assign(net, {
    conn: { state: state.open ? 'open' : 'closed' }, welcomed: state.welcomed, everWelcomed: state.everWelcomed,
    unsentWorld: new Map(), game: { host: state.host }, id: state.id, send: vi.fn(),
  })
  return net
}

describe('a host\'s world settings changed while the connection was down', () => {
  it('are held while it is down and set again (so sent) when the host is welcomed back', () => {
    const net = client({ open: false, welcomed: false, everWelcomed: true, host: 1, id: 1 })
    net.onParamChange('world.gravity', 3, 'local')
    expect(net.send).not.toHaveBeenCalled()
    expect([...net.unsentWorld]).toEqual([['world.gravity', 3]])
    // The welcome replaced our world with the room's; the host's change comes back.
    params.set('world.gravity', 9.81, 'remote')
    const set = vi.spyOn(params, 'set')
    net.resendUnsent()
    expect(set).toHaveBeenCalledWith('world.gravity', 3)
    expect(net.unsentWorld.size).toBe(0)
    // Once connected, the same change goes straight out.
    Object.assign(net, { conn: { state: 'open' }, welcomed: true })
    net.onParamChange('world.gravity', 3, 'local')
    expect(net.send).toHaveBeenCalledWith({ type: 'param', id: 'world.gravity', value: 3 })
  })

  it('are dropped when the player comes back and is not the host', () => {
    const net = client({ open: false, welcomed: false, everWelcomed: true, host: 2, id: 1 })
    net.onParamChange('world.gravity', 3, 'local')
    const set = vi.spyOn(params, 'set')
    net.resendUnsent()
    expect(set).not.toHaveBeenCalled()
    expect(net.unsentWorld.size).toBe(0)
  })

  it('are not held before the first welcome (the hello carries them) or when they came from the room', () => {
    const fresh = client({ open: false, welcomed: false, everWelcomed: false, host: 0, id: 0 })
    fresh.onParamChange('world.gravity', 3, 'local')
    expect(fresh.unsentWorld.size).toBe(0)
    const back = client({ open: false, welcomed: false, everWelcomed: true, host: 1, id: 1 })
    back.onParamChange('world.gravity', 3, 'remote')
    expect(back.unsentWorld.size).toBe(0)
  })
})
