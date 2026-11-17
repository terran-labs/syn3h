/**
 * Reconnection must not depend on any handler succeeding.
 *
 * Bug: on a hosted check runner whose WebGPU instance had been dropped, a forced close left the
 * client "closed" with no retry for 30 s, so the room's hold expired and the player lost their
 * place. The disconnect handler (which disposes remote vehicles) threw inside ws.onclose, before
 * the retry was scheduled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Connection } from '../../src/net/Connection'

class Socket {
  static OPEN = 1
  readyState = 0
  binaryType = ''
  closed: { code?: number; reason?: string } | null = null
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: (() => void) | null = null
  sent: unknown[] = []
  constructor(readonly url: string) { sockets.push(this) }
  send(data: unknown): void { this.sent.push(data) }
  close(code?: number, reason?: string): void { this.closed = { code, reason }; this.readyState = 2 }
  /** The server accepted the connection. */
  accept(): void { this.readyState = 1; this.onopen?.() }
  /** The connection ended, as the browser reports it. */
  end(code = 4000, reason = 'closed'): void { this.readyState = 3; this.onclose?.({ code, reason, wasClean: true }) }
}
let sockets: Socket[]
const boom = () => { throw new Error('Instance dropped in popErrorScope') }

beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  vi.stubGlobal('WebSocket', Socket)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A connection whose first socket is open. */
function connected(): Connection {
  const c = new Connection('ws://fixture/ws?room=lobby')
  c.open()
  sockets[0].accept()
  return c
}
/** Sockets not yet closed by the connection or ended by the server. */
const live = () => sockets.filter((s) => !s.closed && s.readyState !== 3)

describe('a throwing handler never strands the connection', () => {
  it('a throwing close handler still schedules the retry, which reconnects', () => {
    const c = connected()
    c.onClose = boom
    sockets[0].end(4000)
    expect(c.state).toBe('closed')
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)
    sockets[1].accept()
    expect(c.state).toBe('open')
    expect(c.reconnects).toBe(1)
    // Reported once, with the error, not swallowed.
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(console.error).mock.calls[0])).toContain('Instance dropped')
  })

  it('a throwing open handler closes that socket and tries again, backing off', () => {
    const c = new Connection('ws://fixture/ws?room=lobby')
    c.onOpen = boom
    c.open()
    // Each failed open closes its socket; the waits before the next grow 500, 1000, 2000,
    // 4000 rather than looping at 500.
    for (const wait of [500, 1000, 2000, 4000]) {
      const s = sockets[sockets.length - 1]
      s.accept()
      // The hello was never sent: this socket is useless and is closed, not left open.
      expect(s.closed).not.toBeNull()
      s.end(s.closed!.code ?? 1000)
      const n = sockets.length
      vi.advanceTimersByTime(wait - 1)
      expect(sockets).toHaveLength(n)
      vi.advanceTimersByTime(1)
      expect(sockets).toHaveLength(n + 1)
    }
    expect(live()).toHaveLength(1)
    // Once the handler works, the connection opens and the backoff resets.
    c.onOpen = () => {}
    sockets[4].accept()
    expect(c.state).toBe('open')
    sockets[4].end()
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(6)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('a throwing message handler leaves the connection open and reports once, not per message', () => {
    const c = connected()
    c.onText = boom
    c.onBinary = boom
    for (let i = 0; i < 100; i++) {
      sockets[0].onmessage!({ data: 'text' })
      sockets[0].onmessage!({ data: new ArrayBuffer(8) })
    }
    expect(c.state).toBe('open')
    expect(sockets).toHaveLength(1)
    expect(console.error).toHaveBeenCalledTimes(2) // one per handler
    expect(c.handlerErrors).toEqual({ text: 100, binary: 100 })
    c.onText = vi.fn()
    sockets[0].onmessage!({ data: 'welcome' })
    expect(c.onText).toHaveBeenCalledWith('welcome')
  })

  it('a throwing connect attempt schedules the next one', () => {
    const c = connected()
    let fail = 2
    vi.stubGlobal('WebSocket', class extends Socket {
      constructor(url: string) {
        if (fail-- > 0) throw new Error('blocked')
        super(url)
      }
    })
    sockets[0].end()
    vi.advanceTimersByTime(500) // throws
    vi.advanceTimersByTime(1000) // throws
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    expect(sockets).toHaveLength(2)
    sockets[1].accept()
    expect(c.state).toBe('open')
  })
})

describe('reconnection as before', () => {
  it('backs off 500, 1000, 2000, 4000, 5000 while the server is down, and resets on open', () => {
    const c = connected()
    sockets[0].end()
    const waits = [500, 1000, 2000, 4000, 5000, 5000]
    for (const wait of waits) {
      const n = sockets.length
      vi.advanceTimersByTime(wait - 1)
      expect(sockets).toHaveLength(n)
      vi.advanceTimersByTime(1)
      expect(sockets).toHaveLength(n + 1)
      sockets[n].end(1006) // refused: never opened
    }
    vi.advanceTimersByTime(5000)
    sockets[sockets.length - 1].accept()
    expect(c.state).toBe('open')
    sockets[sockets.length - 1].end()
    const n = sockets.length
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(n + 1)
  })

  it('never holds two sockets: opening again replaces the one in hand', () => {
    const c = connected()
    c.open()
    expect(sockets).toHaveLength(2)
    expect(live()).toHaveLength(1)
    expect(sockets[0].closed).not.toBeNull()
    // The replaced socket's late close neither reports nor schedules a second retry.
    c.onClose = vi.fn()
    sockets[0].end()
    vi.advanceTimersByTime(10_000)
    expect(c.onClose).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(2)
  })

  it('a retry pending when the connection is opened again does not add a second socket', () => {
    const c = connected()
    sockets[0].end()
    c.open()
    vi.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(2)
    expect(live()).toHaveLength(1)
  })
})

describe('the game client on a lost connection', () => {
  async function client() {
    const { NetClient } = await import('../../src/net')
    const net = Object.create(NetClient.prototype)
    const removed: number[] = []
    Object.assign(net, {
      ctx: { onJoinStatus: vi.fn() }, conn: { state: 'closed', close: vi.fn() },
      bots: { remote: true, vehicles: [] }, botKinds: new Map(), players: new Map([[1, {}]]), wasHost: false,
      remotes: new Map([[2, {}], [3, {}], [4, {}]]), welcomed: true, pingsSent: 5,
      clock: { reset: vi.fn() }, raceBridge: { disconnect: vi.fn() }, resetGear: vi.fn(), event: vi.fn(),
      // Disposing the first remote throws, as on a page whose GPU instance was dropped.
      removeRemote(id: number) { net.remotes.delete(id); removed.push(id); if (id === 2) boom() },
    })
    return { net, removed }
  }

  it('runs every cleanup step when one throws, then throws for the Connection to report', async () => {
    const { net, removed } = await client()
    expect(() => net.onDisconnect()).toThrow('Instance dropped')
    expect(removed).toEqual([2, 3, 4])
    expect(net.welcomed).toBe(false)
    expect(net.pingsSent).toBe(0)
    expect(net.event).toHaveBeenCalledWith('Disconnected, reconnecting')
  })

  it('still tells the player why when stopping after a throwing cleanup', async () => {
    const { net } = await client()
    expect(() => net.onReplaced()).toThrow('Instance dropped')
    expect(net.conn.close).toHaveBeenCalledOnce()
    expect(net.players.size).toBe(0)
    expect(net.ctx.onJoinStatus).toHaveBeenCalledWith('This game continued in another tab.')
  })
})
