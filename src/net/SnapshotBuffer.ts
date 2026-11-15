/**
 * Timestamped states of one remote vehicle, and playback in the past.
 * A port of VehicleNet.js: interpolate between the two states around the playback time;
 * past the newest state, extrapolate for a while, then report the player as not responding.
 * Pure math, no Three.js, so it is unit tested directly.
 */
import type { WireInput } from '../../shared/protocol'

export type V3 = [number, number, number]
export type Q4 = [number, number, number, number]

export interface Snapshot {
  /** Server clock seconds. */
  t: number
  p: V3
  q: Q4
  v: V3
  w: V3
  input: WireInput
  /** Heartbeat from a hidden tab: the vehicle is parked, not lost. */
  paused?: boolean
}

/** The most one state can move the jitter estimate, seconds. A single late state (a Wi-Fi
 * hiccup, a garbage collection pause) must not make every remote vehicle lag by half a second
 * for the next twenty; sustained jitter still raises the estimate to its true size. */
export const JITTER_SAMPLE_CAP = 0.1

/** How long a paused player may go between heartbeats before counting as gone. Chrome
 * throttles timers in long hidden tabs to once a minute, so this is generous. */
export const PAUSE_TOLERANCE = 75

export type SampleMode = 'empty' | 'interpolate' | 'extrapolate' | 'stale'

export interface Sample {
  p: V3
  q: Q4
  v: V3
  w: V3
  input: WireInput
  mode: SampleMode
  /** How far past the newest state playback is, in seconds; 0 when interpolating. */
  overrun: number
  /** The newest state says the player's tab is hidden. */
  paused: boolean
}

export function emptySample(): Sample {
  return {
    p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
    input: { x: 0, y: 0, z: 0, w: 0, brakes: false, special: false, fire: false },
    mode: 'empty', overrun: 0, paused: false,
  }
}

export class SnapshotBuffer {
  /** Newest first. */
  readonly states: Snapshot[] = []
  /** Smoothed age of states on arrival (sender to us), seconds. */
  ping = 0
  /** Smoothed variation of that age, seconds. */
  jitter = 0
  /** The automatic interpolation delay, seconds. */
  autoDelay = 0.1

  constructor(readonly capacity = 32) {}

  get newest(): Snapshot | undefined {
    return this.states[0]
  }

  /**
   * Add a state. `now` is server seconds at arrival, `sendRate` the sender's rate, which sets
   * how quickly the ping and jitter estimates follow (VehicleNet.js 189-191).
   * Returns false for a state older than one already held.
   *
   * `measure` false stores the state without updating ping and jitter. The caller passes that
   * when its own main thread was stalled: states queued behind a long local frame arrive late
   * through no fault of the network, and counting them once sent the delay to 790 ms after a
   * 1.5 s stall, taking 20 s to recover.
   */
  push(s: Snapshot, now: number, sendRate = 20, measure = true): boolean {
    const head = this.states[0]
    if (head && s.t <= head.t) return false
    const age = now - s.t
    if (!head) {
      this.ping = age
    } else if (measure) {
      const k = Math.min(1, 1 / sendRate)
      const dev = Math.min(JITTER_SAMPLE_CAP, Math.abs(this.ping - age))
      this.jitter += (dev - this.jitter) * k
      this.ping += (Math.min(age, this.ping + JITTER_SAMPLE_CAP) - this.ping) * k
    }
    this.states.unshift(s)
    if (this.states.length > this.capacity) this.states.pop()
    return true
  }

  /**
   * The delay to play back at. `override` > 0 forces it; otherwise it eases toward
   * max(0.1, ping * 1.5 + jitter * 8) as in VehicleNet.js 79.
   */
  delay(dt: number, override = 0): number {
    if (override > 0) return override
    const target = this.ping * 1.5 + this.jitter * 8
    this.autoDelay = Math.max(0.1, this.autoDelay + (target - this.autoDelay) * Math.min(1, dt * 0.15))
    return this.autoDelay
  }

  /** Pose at server time `t`. */
  sample(t: number, maxExtrapolate: number, out: Sample = emptySample()): Sample {
    const s = this.states
    if (s.length === 0) {
      out.mode = 'empty'
      return out
    }
    const head = s[0]
    out.paused = Boolean(head.paused)
    if (t <= head.t) {
      // Find the newest state at or before t. Older than everything: hold the oldest.
      let i = 1
      while (i < s.length && s[i].t > t) i++
      if (i >= s.length) {
        copy(out, s[s.length - 1])
      } else {
        const lhs = s[i]
        const rhs = s[i - 1]
        const span = rhs.t - lhs.t
        const a = span > 1e-4 ? (t - lhs.t) / span : 0
        lerp3(out.p, lhs.p, rhs.p, a)
        lerp3(out.v, lhs.v, rhs.v, a)
        lerp3(out.w, lhs.w, rhs.w, a)
        slerp(out.q, lhs.q, rhs.q, a)
        Object.assign(out.input, lhs.input)
      }
      out.mode = 'interpolate'
      out.overrun = 0
      return out
    }
    // Past the newest state: carry on along its velocity, which we have from the sender.
    const over = t - head.t
    copy(out, head)
    out.overrun = over
    if (head.paused) {
      // A parked vehicle stays exactly where it was until the tab comes back.
      for (let k = 0; k < 3; k++) out.v[k] = out.w[k] = 0
      out.mode = over <= PAUSE_TOLERANCE ? 'extrapolate' : 'stale'
      return out
    }
    const dt = Math.min(over, maxExtrapolate)
    for (let k = 0; k < 3; k++) out.p[k] = head.p[k] + head.v[k] * dt
    out.mode = over <= maxExtrapolate ? 'extrapolate' : 'stale'
    return out
  }

  clear(): void {
    this.states.length = 0
  }
}

function copy(out: Sample, s: Snapshot): void {
  for (let k = 0; k < 3; k++) {
    out.p[k] = s.p[k]
    out.v[k] = s.v[k]
    out.w[k] = s.w[k]
  }
  for (let k = 0; k < 4; k++) out.q[k] = s.q[k]
  Object.assign(out.input, s.input)
}

function lerp3(out: number[], a: readonly number[], b: readonly number[], t: number): void {
  for (let k = 0; k < 3; k++) out[k] = a[k] + (b[k] - a[k]) * t
}

/** Shortest arc quaternion slerp. */
export function slerp(out: number[], a: readonly number[], b: readonly number[], t: number): void {
  let [bx, by, bz, bw] = b
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw
  if (cos < 0) {
    cos = -cos
    bx = -bx; by = -by; bz = -bz; bw = -bw
  }
  let ka: number
  let kb: number
  if (cos > 0.9995) {
    ka = 1 - t
    kb = t
  } else {
    const theta = Math.acos(cos)
    const sin = Math.sin(theta)
    ka = Math.sin((1 - t) * theta) / sin
    kb = Math.sin(t * theta) / sin
  }
  out[0] = a[0] * ka + bx * kb
  out[1] = a[1] * ka + by * kb
  out[2] = a[2] * ka + bz * kb
  out[3] = a[3] * ka + bw * kb
  const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1
  for (let k = 0; k < 4; k++) out[k] /= len
}
