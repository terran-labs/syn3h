/**
 * Estimate of the server's clock, in seconds, from ping/pong round trips.
 * Keeps the offset from the lowest round trip seen recently: that sample has the least
 * queueing delay, so half its round trip is the best guess at one way latency.
 */
export class ServerClock {
  /** Server ms minus local ms. */
  private offset = 0
  private samples: { rtt: number; offset: number }[] = []
  synced = false
  /** Smoothed round trip time in seconds, for the HUD. */
  rtt = 0

  constructor(private readonly localNow: () => number = () => performance.now()) {}

  /** Server seconds now. */
  now(): number {
    return (this.localNow() + this.offset) / 1000
  }

  /** A first, rough sync from a message that carries the server time but no round trip. */
  seed(serverTime: number): void {
    if (this.synced) return
    this.offset = serverTime * 1000 - this.localNow()
  }

  /** `sentAt` is the local ms the ping left; `serverTime` is the server's seconds in the pong. */
  pong(sentAt: number, serverTime: number): void {
    const now = this.localNow()
    const rtt = now - sentAt
    if (rtt < 0 || rtt > 10000) return
    this.samples.push({ rtt, offset: serverTime * 1000 + rtt / 2 - now })
    if (this.samples.length > 8) this.samples.shift()
    let best = this.samples[0]
    for (const s of this.samples) if (s.rtt < best.rtt) best = s
    this.offset = best.offset
    this.rtt = this.synced ? this.rtt + (rtt / 1000 - this.rtt) * 0.3 : rtt / 1000
    this.synced = true
  }

  reset(): void {
    this.samples = []
    this.synced = false
  }
}
