import { describe, expect, it } from 'vitest'
import { ServerClock } from '../../src/net/Clock'
import { type Snapshot, SnapshotBuffer } from '../../src/net/SnapshotBuffer'
import { emptyInputLike } from './helpers'

const snap = (t: number, x: number, vx = 10, yaw = 0): Snapshot => ({
  t,
  p: [x, 0, 0],
  q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
  v: [vx, 0, 0],
  w: [0, 0, 0],
  input: { ...emptyInputLike(), y: x },
})

function filled(): SnapshotBuffer {
  const b = new SnapshotBuffer(8)
  // A vehicle moving at 10 m/s, sampled 20 times a second.
  for (let i = 0; i <= 10; i++) b.push(snap(i * 0.05, i * 0.5, 10, i * 0.1), i * 0.05 + 0.03)
  return b
}

describe('SnapshotBuffer', () => {
  it('keeps the newest states up to capacity and drops out of order ones', () => {
    const b = filled()
    expect(b.states.length).toBe(8)
    expect(b.newest!.t).toBeCloseTo(0.5)
    expect(b.push(snap(0.2, 99), 0.6)).toBe(false)
    expect(b.newest!.p[0]).toBe(5)
  })

  it('interpolates position and rotation between the two states around the playback time', () => {
    const s = filled().sample(0.375, 1)
    expect(s.mode).toBe('interpolate')
    expect(s.p[0]).toBeCloseTo(3.75)
    // Yaw halfway between 0.7 and 0.8 rad.
    expect(2 * Math.asin(s.q[1])).toBeCloseTo(0.75, 3)
    // Input comes from the older state, which is what the vehicle was doing at that time.
    expect(s.input.y).toBeCloseTo(3.5)
  })

  it('holds the oldest state when playback is older than the buffer', () => {
    const s = filled().sample(-5, 1)
    expect(s.mode).toBe('interpolate')
    expect(s.p[0]).toBeCloseTo(1.5)
  })

  it('extrapolates along the newest velocity, then reports stale', () => {
    const b = filled()
    const e = b.sample(0.7, 1)
    expect(e.mode).toBe('extrapolate')
    expect(e.p[0]).toBeCloseTo(5 + 10 * 0.2)
    const stale = b.sample(3, 1)
    expect(stale.mode).toBe('stale')
    // Stops moving after the extrapolation limit.
    expect(stale.p[0]).toBeCloseTo(5 + 10 * 1)
  })

  it('estimates ping and derives the automatic delay with a 0.1 s floor', () => {
    const b = filled()
    expect(b.ping).toBeCloseTo(0.03, 3)
    expect(b.jitter).toBeLessThan(0.005)
    let d = 0
    for (let i = 0; i < 2000; i++) d = b.delay(0.02)
    expect(d).toBeCloseTo(0.1, 3)
    // High latency raises it toward ping * 1.5 + jitter * 8.
    b.ping = 0.2
    b.jitter = 0.01
    for (let i = 0; i < 5000; i++) d = b.delay(0.02)
    expect(d).toBeCloseTo(0.38, 2)
    expect(b.delay(0.02, 0.25)).toBe(0.25)
  })

  it('holds a paused vehicle still and keeps it responding through slow heartbeats', () => {
    const b = new SnapshotBuffer()
    b.push({ ...snap(0, 3, 10), paused: true }, 0)
    const s = b.sample(30, 1)
    expect(s.mode).toBe('extrapolate')
    expect(s.paused).toBe(true)
    expect(s.p[0]).toBe(3)
    expect(b.sample(200, 1).mode).toBe('stale')
  })

  it('picks the shortest arc between quaternions', () => {
    const b = new SnapshotBuffer()
    b.push({ ...snap(0, 0), q: [0, 0, 0, 1] }, 0)
    b.push({ ...snap(1, 0), q: [0, 0, 0, -1] }, 1)
    const s = b.sample(0.5, 1)
    expect(Math.abs(s.q[3])).toBeCloseTo(1)
  })
})

describe('ServerClock', () => {
  it('uses the lowest round trip sample for the offset', () => {
    let local = 1000
    const c = new ServerClock(() => local)
    // Server is 5000 s ahead. Round trip 100 ms, symmetric.
    local = 1100
    c.pong(1000, 5001.05)
    expect(c.now()).toBeCloseTo(5001.1, 3)
    // A slow sample with asymmetric delay must not move the estimate.
    local = 2400
    c.pong(1400, 5001.5)
    expect(c.now()).toBeCloseTo(5002.4, 3)
    expect(c.synced).toBe(true)
  })
})
