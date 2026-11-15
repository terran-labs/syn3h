import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeState, encodeState } from '../../shared/protocol'
import { PausedHeartbeat } from '../../src/net/PausedHeartbeat'
import { SnapshotBuffer } from '../../src/net/SnapshotBuffer'
import { emptyInputLike } from './helpers'

function make() {
  const sent: number[] = []
  let resumed = 0
  const hb = new PausedHeartbeat({ interval: 1000, send: () => sent.push(Date.now()), resumed: () => resumed++ })
  return { hb, sent, resumed: () => resumed }
}

describe('PausedHeartbeat', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => { vi.useRealTimers() })

  it("sends a paused state at once and then once a second while the player's own pause holds in a visible tab", () => {
    const { hb, sent } = make()
    hb.setPaused(true)
    expect(sent).toEqual([0])
    vi.advanceTimersByTime(5000)
    // One at once, then one a second: no faster, no slower.
    expect(sent).toEqual([0, 1000, 2000, 3000, 4000, 5000])
    expect(hb.paused).toBe(true)
  })

  it('stops on resume and says so once, so the delay estimate starts afresh as after a hidden tab', () => {
    const { hb, sent, resumed } = make()
    hb.setPaused(true)
    vi.advanceTimersByTime(2500)
    hb.setPaused(false)
    expect(resumed()).toBe(1)
    expect(hb.paused).toBe(false)
    const before = sent.length
    vi.advanceTimersByTime(5000)
    expect(sent.length).toBe(before)
    // Resuming what is not paused is nothing, and does not restart anybody's estimate.
    hb.setPaused(false)
    expect(resumed()).toBe(1)
  })

  it('does not double up when paused twice (the reason changing from hidden to user)', () => {
    const { hb, sent } = make()
    hb.setPaused(true)
    hb.setPaused(true)
    vi.advanceTimersByTime(3000)
    expect(sent).toEqual([0, 1000, 2000, 3000])
  })

  it('follows page visibility only until the pause state has spoken', () => {
    const { hb, sent, resumed } = make()
    // A page that never calls setPaused: hidden counts as paused, as before.
    hb.visibility(true)
    expect(hb.paused).toBe(true)
    hb.visibility(false)
    expect(hb.paused).toBe(false)
    expect(resumed()).toBe(1)
    // Once the pause state decides, visibility cannot start or stop it: a player who paused,
    // switched tabs and came back is still paused.
    hb.setPaused(true)
    hb.visibility(false)
    expect(hb.paused).toBe(true)
    hb.setPaused(false)
    hb.visibility(true)
    expect(hb.paused).toBe(false)
    expect(sent.length).toBe(2)
  })

  it('stops for good on dispose without counting as a resume', () => {
    const { hb, sent, resumed } = make()
    hb.setPaused(true)
    hb.stop()
    vi.advanceTimersByTime(5000)
    expect(sent).toEqual([0])
    expect(resumed()).toBe(0)
  })
})

describe('a paused heartbeat as the others see it', () => {
  it('reads as paused and still there between one-second heartbeats, never as not responding', () => {
    // What NetClient.sendHeartbeat puts on the wire: the pose, no motion, the paused flag.
    const wire = (t: number) => decodeState(encodeState({ id: 0, t, p: [5, 1, 5], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], input: emptyInputLike(), paused: true }))!
    const b = new SnapshotBuffer(32)
    // The player was driving at 20 m/s, then paused.
    b.push({ t: 9.95, p: [4, 1, 5], q: [0, 0, 0, 1], v: [20, 0, 0], w: [0, 0, 0], input: emptyInputLike() }, 9.98)
    for (let t = 10; t <= 40; t++) {
      const s = wire(t)
      b.push({ t: s.t, p: s.p, q: s.q, v: s.v, w: s.w, input: s.input, paused: s.paused }, t + 0.03)
      // Sampled all through the following second, with the usual one second extrapolation limit.
      for (const ahead of [0.1, 0.5, 0.99, 1.4]) {
        const got = b.sample(t + ahead, 1)
        expect(got.paused).toBe(true)
        expect(got.mode).not.toBe('stale')
        // Held exactly where it stopped, not carried on along its old velocity.
        expect(got.p[0]).toBe(5)
      }
    }
  })
})
