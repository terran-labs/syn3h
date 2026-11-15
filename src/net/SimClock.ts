/**
 * Room time as the physics simulation sees it, and an even send cadence.
 * Pure math, no browser or Three.js, so both are unit tested directly.
 *
 * Why: a vehicle's pose only changes on fixed physics steps, but the room clock is wall
 * time. Stamping a state with the wall clock, or playing remote vehicles back at the wall
 * clock, mixes the two. Whenever the display rate is not a multiple of the physics rate the
 * difference is a sawtooth as wide as a physics step or more:
 *
 *  - a sender at 60 frames a second stamped its states up to 13 ms wrong, at 30 up to 27 ms:
 *    0.4 m and 0.8 m of noise along the path at 30 m/s, baked into every copy of it;
 *  - a receiver sampled its remote vehicles 16.7 ms apart four steps running and then
 *    33.3 ms, or twice at the same instant below 50 frames a second, while its own vehicle
 *    advanced an even step each time. The copies juddered against it.
 *
 * So both ends use the simulation's own time, mapped onto the room clock by an offset that
 * is measured once a frame and followed slowly. Step times are then exactly one step apart.
 */

/** A difference this large is a stall, a hidden tab or a clock resync: adopt it at once. */
const SNAP_SECONDS = 0.1
/**
 * The simulation can fall behind the room clock (a long frame drops the time it could not
 * simulate) but never gets ahead of it. Falling behind by more than this is adopted at once,
 * or every remote vehicle would be played that much late until the slow follow caught up.
 */
const BEHIND_SECONDS = 0.03
/** Smaller drift (frame timing noise, a better ping sample) is followed this slowly, s. */
const FOLLOW_SECONDS = 0.5
/**
 * Frames longer than this (smoothed) mean the device is not running a frame for every physics
 * step: below about 47 frames a second. Then the mapping is not used and callers get the plain room clock, exactly as
 * before SimClock existed. Measured in two browsers: a sender at 11 frames a second sends
 * its states in bursts, one per frame; with exact simulation stamps their age on arrival
 * swings by most of a frame, the receiver's jitter estimate sees it, and the playback delay
 * went from 100 ms to its 150 ms cap for everyone watching that player. Wall clock stamps
 * hide that swing at the cost of position noise, which is the better trade for a device
 * already struggling. Even at 45 frames a second the replay test showed 10 ms more delay,
 * so the line is drawn at the physics rate. The second number is where it counts as keeping
 * up again; a single long frame counts as no more than FRAME_SAMPLE_CAP, so one hitch costs
 * about a second of the old behaviour, not several.
 */
const SLOW_FRAME_SECONDS = 0.0215
const STEADY_FRAME_SECONDS = 0.0195
const FRAME_SAMPLE_CAP = 0.1

export class SimClock {
  private offset = 0
  private seeded = false
  /** Smoothed frame length, seconds, and whether frames are currently too long to trust. */
  private frame = 0
  private slow = false

  /**
   * Once per rendered frame. `room` is the room clock now, `sim` the simulation's continuous
   * time for this frame (stepped time plus the part of a step not yet simulated), `dt` the
   * frame's length. All in seconds.
   */
  observe(room: number, sim: number, dt: number): void {
    const length = Math.max(0, dt)
    const sample = Math.min(length, FRAME_SAMPLE_CAP)
    this.frame = this.seeded ? this.frame + (sample - this.frame) * Math.min(1, length / FOLLOW_SECONDS) : sample
    if (this.frame > SLOW_FRAME_SECONDS) this.slow = true
    else if (this.frame < STEADY_FRAME_SECONDS) this.slow = false
    const raw = room - sim
    const diff = raw - this.offset
    if (!this.seeded || diff > BEHIND_SECONDS || diff < -SNAP_SECONDS) {
      // After a long frame the simulation drops time it could not run, a hidden tab stops
      // it, and reconnecting resyncs the room clock. Easing across such a gap would play
      // every remote vehicle fast or slow for seconds; wall time jumped, so this does too.
      this.offset = raw
      this.seeded = true
      return
    }
    this.offset += diff * Math.min(1, length / FOLLOW_SECONDS)
  }

  /** True while the mapping is in use: a frame has been observed and frames are keeping up. */
  get steady(): boolean {
    return this.seeded && !this.slow
  }

  /**
   * Room time of the physics step that ends at simulation time `stepEnd`. `step` is the
   * step length: half of it is added because a step's result is on screen, on average, half
   * a step after the frame that ran it began, which keeps the stamp centred on the wall
   * clock (so latency estimates, and clients that still stamp wall time, are not biased).
   * Before the first frame has been observed, and while frames are too long (see
   * SLOW_FRAME_SECONDS), this is `fallback`, the plain room clock.
   */
  at(stepEnd: number, step: number, fallback: number): number {
    return this.steady ? stepEnd + step / 2 + this.offset : fallback
  }

  /** Forget the mapping; the next frame seeds it afresh. */
  reset(): void {
    this.seeded = false
    this.slow = false
  }
}

/**
 * Decides which fixed steps send a state, so the average rate is the one asked for.
 * Restarting the wait from zero after each send rounded the interval up to whole steps:
 * at 50 steps a second "20" really sent 16.7, "30" sent 25 and "15" sent 12.5. Carrying the
 * remainder alternates short and long gaps instead (two steps, then three) and averages
 * true. The uneven gaps cost nothing because states carry simulation time (SimClock).
 */
export class SendPacer {
  private waited = 0

  /** Call each fixed step of length `dt`; true when a state is due. `rate` per second. */
  step(dt: number, rate: number): boolean {
    const interval = 1 / Math.max(1, rate)
    this.waited += dt
    // A hair of tolerance: 3 × (1/60) is a rounding error short of 1/20.
    if (this.waited < interval - 1e-9) return false
    // Keep the remainder, but never bank more than one interval (a hidden tab, a long
    // frame): the room does not want a burst when we come back.
    this.waited = Math.min(this.waited - interval, interval)
    return true
  }

  /** Hold the timer without sending (the tab is hidden; a heartbeat speaks for us). */
  hold(dt: number, rate: number): void {
    this.waited = Math.min(this.waited + dt, 1 / Math.max(1, rate))
  }
}
