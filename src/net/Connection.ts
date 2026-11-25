/**
 * A WebSocket that reconnects. Binary frames arrive as ArrayBuffer, text as string.
 */
import { longFrames } from '../core/longFrames'
export type ConnectionState = 'connecting' | 'open' | 'closed'

/** Close code for a socket this client gave up on because its open handler failed. */
const CLOSE_HANDLER_FAILED = 4010

type Handler = 'open' | 'text' | 'binary' | 'close'

/**
 * Reconnection never depends on a handler succeeding: the retry is scheduled before the close
 * handler runs, and every handler runs guarded. A handler that throws is reported with
 * console.error the first time (with its stack) and counted after that, so a handler that
 * fails on every message does not flood the console. A page whose renderer had lost its GPU
 * once threw from the disconnect handler inside onclose, before the retry, and sat "closed"
 * until the room gave its place away.
 */
export class Connection {
  state: ConnectionState = 'closed'
  /** Seconds until the next attempt while closed, for the HUD. */
  retryAt = 0
  /** Opens after the first, so diagnostics can tell a dropped and recovered connection. */
  reconnects = 0
  /** The last few closes, newest last: what ended each socket, for diagnostics. */
  readonly closes: { code: number; reason: string; clean: boolean; wasOpen: boolean; at: number; openMs: number; rxMs: number; txMs: number }[] = []
  /** When the current socket opened, and last received or sent anything (performance.now()). */
  private openedAt = 0
  private lastRx = 0
  private lastTx = 0
  /** Handler failures by handler, for diagnostics; only the first of each is logged. */
  readonly handlerErrors: Partial<Record<Handler, number>> = {}
  private opened = false
  onOpen: () => void = () => {}
  onText: (text: string) => void = () => {}
  onBinary: (data: ArrayBuffer) => void = () => {}
  /** An open socket closed; the room's close code and reason, when it gave one. */
  onClose: (code?: number, reason?: string) => void = () => {}

  private ws: WebSocket | null = null
  private backoff = 500
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  /** The address, or a function giving it afresh for each attempt (a reconnect may ask for a different public room). */
  constructor(readonly url: string | (() => string)) {}

  open(): void {
    this.stopped = false
    this.connect()
  }

  close(): void {
    // Closing our own socket is rare and deliberate; say where from, for the drop diagnostics.
    if (this.ws) console.info('Mira: closing the room connection', new Error().stack?.split('\n').slice(2, 5).join(' | '))
    this.stopped = true
    this.clearTimer()
    const ws = this.ws
    this.ws = null
    this.state = 'closed'
    ws?.close()
  }

  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.send(data); this.lastTx = performance.now() }
  }

  /** Run a handler; a throw is reported (first time) and counted, never propagated. */
  private guard(name: Handler, fn: () => void): boolean {
    try {
      fn()
      return true
    } catch (error) {
      const n = (this.handlerErrors[name] ?? 0) + 1
      this.handlerErrors[name] = n
      if (n === 1) console.error(`Connection: the ${name} handler threw; the connection carries on.`, error)
      return false
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private connect(): void {
    // One socket at a time: a retry still pending, or a socket still in hand, is replaced.
    this.clearTimer()
    const previous = this.ws
    this.ws = null
    if (previous) {
      console.info('Mira: replacing the room connection', new Error().stack?.split('\n').slice(2, 5).join(' | '))
      try { previous.close() } catch { /* already closing */ }
    }
    this.state = 'connecting'
    let ws: WebSocket
    try {
      ws = new WebSocket(typeof this.url === 'function' ? this.url() : this.url)
    } catch {
      this.scheduleRetry()
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws || this.stopped) return
      this.state = 'open'
      this.openedAt = this.lastRx = this.lastTx = performance.now()
      if (this.opened) this.reconnects++
      this.opened = true
      if (this.guard('open', () => this.onOpen())) {
        this.backoff = 500
        return
      }
      // Without its hello this socket is no use: close it, and the close retries with the
      // backoff still growing, so a handler that keeps failing does not spin at 500 ms.
      try { ws.close(CLOSE_HANDLER_FAILED, 'open handler failed') } catch { /* closing */ }
    }
    ws.onmessage = (e) => {
      if (this.ws !== ws || this.stopped) return
      this.lastRx = performance.now()
      if (typeof e.data === 'string') {
        const text = e.data
        const start = longFrames.start()
        try { this.guard('text', () => this.onText(text)) }
        finally { longFrames.end('network.text', start) }
      } else if (e.data instanceof ArrayBuffer) {
        const data = e.data
        const start = longFrames.start()
        try { this.guard('binary', () => this.onBinary(data)) }
        finally { longFrames.end('network.binary', start) }
      }
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      const wasOpen = this.state === 'open'
      const now = performance.now(), since = (t: number) => wasOpen ? Math.round(now - t) : -1
      this.closes.push({ code: e.code, reason: e.reason, clean: e.wasClean, wasOpen, at: Math.round(now), openMs: since(this.openedAt), rxMs: since(this.lastRx), txMs: since(this.lastTx) })
      if (this.closes.length > 10) this.closes.shift()
      this.state = 'closed'
      // The retry first: nothing a handler does can then stop it, except a deliberate close().
      this.scheduleRetry()
      if (wasOpen) this.guard('close', () => this.onClose(e.code, e.reason))
    }
    // onclose always follows onerror, which is where we retry.
    ws.onerror = () => {}
  }

  private scheduleRetry(): void {
    this.state = 'closed'
    if (this.stopped) return
    this.clearTimer()
    this.retryAt = performance.now() + this.backoff
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.stopped) return
      try {
        this.connect()
      } catch (error) {
        console.error('Connection: a reconnect attempt failed; trying again.', error)
        this.scheduleRetry()
      }
    }, this.backoff)
    this.backoff = Math.min(5000, this.backoff * 2)
  }
}

/**
 * Where the room server is: same host in production, VITE_SERVER_URL in development.
 * `extra` adds query parameters after the room (public overflow: assign, prefer, full).
 */
export function serverUrl(room: string, extra: Record<string, string> = {}): string {
  let q = `/ws?room=${encodeURIComponent(room)}`
  for (const [k, v] of Object.entries(extra)) q += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`
  // An HTTPS page (production, or a dev server behind the preview broker) can only open
  // secure sockets, so it uses its own origin; the dev server proxies /ws to the room server.
  if (import.meta.env.PROD || location.protocol === 'https:') {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${q}`
  }
  // HTTP development also uses Vite's same-origin proxy, including isolated room ports.
  const base = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? `ws://${location.host}`
  return base.replace(/\/+$/, '').replace(/\/ws$/, '') + q
}
