import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetClient } from '../../src/net'
import { Connection } from '../../src/net/Connection'
import { CLOSE_REPLACED } from '../../shared/protocol'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('legacy full-room fallback', () => {
  it('handles the existing refusal with local bots and a persistent visible notice', () => {
    vi.useFakeTimers()
    const bots = { remote: true, vehicles: [] }
    const net = Object.create(NetClient.prototype)
    Object.assign(net, { ctx: { onJoinStatus: vi.fn() }, conn: { state: 'closed', close: vi.fn() },
      bots, botKinds: new Map(), remotes: new Map(), players: new Map([[1, {}]]),
      wasHost: false, onDisconnect: vi.fn(), welcomed: false })
    net.onMessage({ type: 'error', message: 'room is full' })
    expect(net.conn.close).toHaveBeenCalledOnce()
    expect(net.onDisconnect).toHaveBeenCalledWith(false)
    expect(bots.remote).toBe(false)
    expect(net.isHost).toBe(false)
    expect(net.players.size).toBe(0)
    expect(net.ctx.onJoinStatus).toHaveBeenCalledWith('No room available. Playing locally with bots.')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores late socket callbacks after deliberately stopping retries', () => {
    vi.useFakeTimers()
    const sockets: any[] = []
    class Socket {
      close = vi.fn()
      constructor() { sockets.push(this) }
    }
    vi.stubGlobal('WebSocket', Socket)
    const connection = new Connection('ws://fixture/ws?room=lobby')
    connection.onOpen = vi.fn(); connection.onText = vi.fn(); connection.onClose = vi.fn()
    connection.open()
    sockets[0].onopen()
    connection.close()
    sockets[0].onmessage({ data: 'late welcome' }); sockets[0].onclose(); sockets[0].onopen()
    vi.advanceTimersByTime(10000)
    expect(sockets).toHaveLength(1)
    expect(connection.onOpen).toHaveBeenCalledOnce()
    expect(connection.onText).not.toHaveBeenCalled()
    expect(connection.onClose).not.toHaveBeenCalled()
    expect(connection.state).toBe('closed')
  })
})

describe('a place taken over by another tab', () => {
  it('stops without resuming when the room closes it with 4003 replaced, and says so', () => {
    vi.useFakeTimers()
    const sockets: any[] = []
    class Socket {
      close = vi.fn()
      constructor() { sockets.push(this) }
    }
    vi.stubGlobal('WebSocket', Socket)
    const connection = new Connection('ws://fixture/ws?room=lobby')
    const net = Object.create(NetClient.prototype)
    Object.assign(net, { ctx: { onJoinStatus: vi.fn() }, conn: connection,
      bots: { remote: true, vehicles: [] }, botKinds: new Map(), remotes: new Map(), players: new Map([[1, {}]]),
      wasHost: false, onDisconnect: vi.fn(), welcomed: false })
    connection.onClose = (code) => { if (code === CLOSE_REPLACED) net.onReplaced(); else net.onDisconnect() }
    connection.open()
    sockets[0].onopen()
    sockets[0].onclose({ code: CLOSE_REPLACED, reason: 'replaced', wasClean: true })
    vi.advanceTimersByTime(10000)
    // No second socket: it does not reconnect with its secret and take the place back.
    expect(sockets).toHaveLength(1)
    expect(net.onDisconnect).toHaveBeenCalledWith(false)
    expect(net.ctx.onJoinStatus).toHaveBeenCalledWith('This game continued in another tab.')
    expect(connection.closes.at(-1)).toMatchObject({ code: CLOSE_REPLACED, reason: 'replaced', wasOpen: true })
  })

  it('still reconnects after any other close', () => {
    vi.useFakeTimers()
    const sockets: any[] = []
    class Socket {
      close = vi.fn()
      constructor() { sockets.push(this) }
    }
    vi.stubGlobal('WebSocket', Socket)
    const connection = new Connection('ws://fixture/ws?room=lobby')
    connection.onClose = vi.fn()
    connection.open()
    sockets[0].onopen()
    sockets[0].onclose({ code: 1006, reason: '', wasClean: false })
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)
    sockets[1].onopen()
    expect(connection.reconnects).toBe(1)
  })
})
