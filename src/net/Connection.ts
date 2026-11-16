/**
 * A WebSocket that reconnects. Binary frames arrive as ArrayBuffer, text as string.
 */
export type ConnectionState = 'connecting' | 'open' | 'closed'

export class Connection {
  state: ConnectionState = 'closed'
  /** Seconds until the next attempt while closed, for the HUD. */
  retryAt = 0
  /** Opens after the first, so diagnostics can tell a dropped and recovered connection. */
  reconnects = 0
  /** The last few closes, newest last: what ended each socket, for diagnostics. */
  readonly closes: { code: number; reason: string; clean: boolean; wasOpen: boolean; at: number }[] = []
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

  constructor(readonly url: string) {}

  open(): void {
    this.stopped = false
    this.connect()
  }

  close(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const ws = this.ws
    this.ws = null
    this.state = 'closed'
    ws?.close()
  }

  send(data: string | Uint8Array<ArrayBuffer>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data)
  }

  private connect(): void {
    this.state = 'connecting'
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.scheduleRetry()
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws || this.stopped) return
      this.state = 'open'
      this.backoff = 500
      if (this.opened) this.reconnects++
      this.opened = true
      this.onOpen()
    }
    ws.onmessage = (e) => {
      if (this.ws !== ws || this.stopped) return
      if (typeof e.data === 'string') this.onText(e.data)
      else if (e.data instanceof ArrayBuffer) this.onBinary(e.data)
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      const wasOpen = this.state === 'open'
      this.closes.push({ code: e.code, reason: e.reason, clean: e.wasClean, wasOpen, at: Math.round(performance.now()) })
      if (this.closes.length > 10) this.closes.shift()
      this.state = 'closed'
      if (wasOpen) this.onClose(e.code, e.reason)
      this.scheduleRetry()
    }
    // onclose always follows onerror, which is where we retry.
    ws.onerror = () => {}
  }

  private scheduleRetry(): void {
    this.state = 'closed'
    if (this.stopped) return
    this.retryAt = performance.now() + this.backoff
    this.timer = setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(5000, this.backoff * 2)
  }
}

/** Where the room server is: same host in production, VITE_SERVER_URL in development. */
export function serverUrl(room: string): string {
  const q = `/ws?room=${encodeURIComponent(room)}`
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
