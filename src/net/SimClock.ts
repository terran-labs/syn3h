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
/** Smaller drift (frame timing noise, a better ping sample) is followed this slowly, s. */
const FOLLOW_SECONDS = 0.5

export class SimClock {
  private offset = 0
  private seeded = false

  /**
   * Once per rendered frame. `room` is the room clock now, `sim` the simulation's continuous
   * time for this frame (stepped time plus the part of a step not yet simulated), `dt` the
   * frame's length. All in seconds.
   */
  observe(room: number, sim: number, dt: number): void {
    const raw = room - sim
    if (!this.seeded || Math.abs(raw - this.offset) > SNAP_SECONDS) {
      // After a long frame the simulation drops time it could not run, a hidden tab stops
      // it, and reconnecting resyncs the room clock. Easing across such a gap would play
      // every remote vehicle fast or slow for seconds; wall time jumped, so this does too.
      this.offset = raw
      this.seeded = true
      return
    }
    this.offset += (raw - this.offset) * Math.min(1, Math.max(0, dt) / FOLLOW_SECONDS)
  }

  /**
   * Room time of the physics step that ends at simulation time `stepEnd`. `step` is the
   * step length: half of it is added because a step's result is on screen, on average, half
   * a step after the frame that ran it began, which keeps the stamp centred on the wall
   * clock (so latency estimates, and clients that still stamp wall time, are not biased).
   * Before the first frame has been observed this is `fallback`, the plain room clock.
   */
  at(stepEnd: number, step: number, fallback: number): number {
    return this.seeded ? stepEnd + step / 2 + this.offset : fallback
  }

  /** Forget the mapping; the next frame seeds it afresh. */
  reset(): void {
    this.seeded = false
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
