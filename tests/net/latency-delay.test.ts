/**
 * The latency proxy delivers in order (server/latencyDelay.ts).
 *
 * Bug this catches: the proxy gave each message its own timer, computed from Date.now(), while
 * Node starts timers from the loop time cached for the turn. Messages handled in one turn a
 * millisecond apart could fire in reverse, and a client that saw the room's mode-1 zone update
 * after its switch back to mode 0 stayed in mode 1 (and one that saw a score update after the
 * hill's 'contest' kept showing the old holder). The dry run's latency smoke failed on both.
 * Real timers: the fault lives in how Node schedules them, which fake timers do not model.
 */
import { describe, expect, it } from 'vitest'
import { delayedSender } from '../../server/latencyDelay'

/** Spin for `ms` without yielding, as framing and JSON work does inside one turn. */
function busy(ms: number): void {
  const t = Date.now()
  while (Date.now() - t < ms) { /* spin */ }
}

describe('latency proxy delivery', () => {
  it('keeps order for messages handled in one turn with the clock moving between them', async () => {
    const got: string[] = []
    // The first message draws the most jitter, the later ones none: their due times are held
    // back to the first's, which is exactly when separate timers used to fire them early.
    const draws = [1, 0, 0]
    let i = 0
    const send = delayedSender((m: string) => got.push(m), { rtt: 150, jitter: 30, random: () => draws[i++ % 3] })
    // Each held-back message used to fire first about one time in three (its delay and the
    // timer's start are read from clocks that round to the millisecond differently), so 40
    // bursts make the old scheduler fail all but about once in a million runs.
    const bursts = 40
    for (let burst = 0; burst < bursts; burst++) {
      for (const m of ['zone-mode-1', 'param-mode-0', 'game-mode-0']) {
        send(`${burst}:${m}`)
        busy(1)
      }
      await new Promise((r) => setTimeout(r, 1))
    }
    await new Promise((r) => setTimeout(r, 400))
    const expected = Array.from({ length: bursts }, (_, b) => b).flatMap((b) => ['zone-mode-1', 'param-mode-0', 'game-mode-0'].map((m) => `${b}:${m}`))
    expect(got).toEqual(expected)
  })

  it('still delays each message by about half the round trip', async () => {
    const sent = Date.now()
    const arrived: number[] = []
    const send = delayedSender(() => arrived.push(Date.now() - sent), { rtt: 100, jitter: 0 })
    send(); send()
    await new Promise((r) => setTimeout(r, 200))
    expect(arrived).toHaveLength(2)
    for (const ms of arrived) expect(ms).toBeGreaterThanOrEqual(49)
  })

  it('holds everything behind a lost message, in order', async () => {
    const got: number[] = []
    // Per message: the loss draw (under 0.1 is lost), for a lost one the resend draw, then jitter.
    const draws = [0.5, 0, /* second: lost once */ 0, 0.5, 0, /* third */ 0.5, 0]
    let i = 0
    const send = delayedSender((n: number) => got.push(n), { rtt: 20, jitter: 10, loss: 0.1, rto: 60, random: () => draws[i++] ?? 1 })
    send(1); send(2); send(3)
    await new Promise((r) => setTimeout(r, 40))
    expect(got).toEqual([1])
    await new Promise((r) => setTimeout(r, 120))
    expect(got).toEqual([1, 2, 3])
  })
})
