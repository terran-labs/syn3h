/**
 * A WebSocket that reconnects. Binary frames arrive as ArrayBuffer, text as string.
 */
export type ConnectionState = 'connecting' | 'open' | 'closed'

export class Connection {
  state: ConnectionState = 'closed'
  /** Seconds until the next attempt while closed, for the HUD. */
  retryAt = 0
  onOpen: () => void = () => {}
  onText: (text: string) => void = () => {}
  onBinary: (data: ArrayBuffer) => void = () => {}
  onClose: () => void = () => {}

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
    this.ws?.close()
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
      this.state = 'open'
      this.backoff = 500
      this.onOpen()
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.onText(e.data)
      else if (e.data instanceof ArrayBuffer) this.onBinary(e.data)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      const wasOpen = this.state === 'open'
      this.state = 'closed'
      if (wasOpen) this.onClose()
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
  // Using the page's host name rather than localhost lets phones on the LAN reach the dev server.
  const base = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? `ws://${location.hostname || 'localhost'}:8787`
  return base.replace(/\/+$/, '').replace(/\/ws$/, '') + q
}
