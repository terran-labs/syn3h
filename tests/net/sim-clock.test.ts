import { describe, expect, it } from 'vitest'
import { SendPacer, SimClock } from '../../src/net/SimClock'

const STEP = 1 / 50
const MAX_STEPS = 5

/**
 * Replay the game loop (src/core/Game.ts) at a display rate: frames of wall time, fixed
 * steps out of an accumulator, the frame hook after them. Returns, for every step, the wall
 * time of the frame that ran it and the room time the SimClock gave it.
 */
function replay(fps: number, seconds: number, opts: { roomAhead?: number; stallAt?: number; stall?: number } = {}) {
  const clock = new SimClock()
  const roomAhead = opts.roomAhead ?? 1000
  let wall = 0
  let sim = 0
  let acc = 0
  const steps: { wall: number; sim: number; stamp: number }[] = []
  const frames = Math.round(fps * seconds)
  for (let f = 0; f < frames; f++) {
    let frame = 1 / fps
    if (opts.stallAt === f) frame += opts.stall ?? 0
    wall += frame
    acc += Math.min(0.25, frame)
    let n = 0
    while (acc >= STEP && n < MAX_STEPS) {
      // As in NetClient: the step's result is at sim + STEP, and game.time moves on after.
      steps.push({ wall, sim: sim + STEP, stamp: clock.at(sim + STEP, STEP, wall + roomAhead) })
      acc -= STEP
      sim += STEP
      n++
    }
    if (n === MAX_STEPS) acc = 0
    clock.observe(wall + roomAhead, sim + acc, frame)
  }
  return steps
}

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)

describe('SimClock', () => {
  for (const fps of [60, 120]) {
    it(`gives each physics step an evenly spaced room time at ${fps} frames a second`, () => {
      const steps = replay(fps, 20).slice(100)
      // What stamping with the wall clock did: an error that swings by most of a step or more.
      const wallError = spread(steps.map((s) => s.wall - s.sim))
      expect(wallError).toBeGreaterThan(0.006)
      // Stamp error: the stamp against the step's own time is constant to well under a
      // millisecond (0.03 m at 30 m/s), where the wall clock was 7 to 40 ms out.
      const stampError = spread(steps.map((s) => s.stamp - s.sim))
      expect(stampError).toBeLessThan(0.0005)
      // Per-step advance: every step is one step after the last, never zero and never double.
      const advance = steps.slice(1).map((s, i) => s.stamp - steps[i].stamp)
      expect(Math.min(...advance)).toBeGreaterThan(STEP - 0.0005)
      expect(Math.max(...advance)).toBeLessThan(STEP + 0.0005)
    })

  }

  for (const fps of [24, 30, 45]) {
    it(`leaves a device at ${fps} frames a second on the plain room clock, as before`, () => {
      // Below the physics rate states leave in bursts; exact stamps there made every watcher's
      // playback delay rise to its cap (measured in two browsers), so the old timing is kept.
      const steps = replay(fps, 20).slice(100)
      for (const s of steps) expect(s.stamp).toBe(s.wall + 1000)
    })
  }

  for (const fps of [24, 30, 45, 60, 120]) {
    it(`stays centred on the wall clock at ${fps} frames a second`, () => {
      // So latency estimates are not biased, and a client that still stamps wall time and
      // one that stamps simulation time agree on average.
      const steps = replay(fps, 20).slice(100)
      // Only the last step of each frame: the one that is sent or sampled when frames keep up.
      const last = steps.filter((s, i) => i + 1 === steps.length || steps[i + 1].wall !== s.wall)
      const mean = last.reduce((a, s) => a + (s.stamp - 1000 - s.wall), 0) / last.length
      expect(Math.abs(mean)).toBeLessThan(STEP / 2 + 0.001)
    })
  }

  it('is the plain room clock until a frame has been observed, and again after a reset', () => {
    const c = new SimClock()
    expect(c.at(5, STEP, 123)).toBe(123)
    c.observe(1005, 5, 1 / 60)
    expect(c.at(5, STEP, 123)).toBeCloseTo(1005 + STEP / 2)
    c.reset()
    expect(c.at(5, STEP, 123)).toBe(123)
  })

  it('adopts a stall at once and is even again from the next step', () => {
    // One frame of 1.5 s at 60 frames a second: the loop simulates five steps and drops the
    // rest, so simulation time falls about 0.15 s behind the wall clock for good.
    const steps = replay(60, 20, { stallAt: 600, stall: 1.5 })
    // A hitch counts as slow frames for about a second (plain room clock), then even again.
    const after = steps.filter((s) => s.wall > 600 / 60 + 1.5 + 3)
    const before = steps.filter((s) => s.wall < 600 / 60)
    const drift = (after[0].stamp - after[0].sim) - (before[before.length - 1].stamp - before[before.length - 1].sim)
    expect(drift).toBeGreaterThan(0.1)
    expect(spread(after.map((s) => s.stamp - s.sim))).toBeLessThan(0.0005)
    // And never behind the wall clock by more than a frame and a step once past it.
    for (const s of after) expect(Math.abs(s.stamp - 1000 - s.wall)).toBeLessThan(1 / 60 + STEP)
  })

  it('switches with hysteresis, so a device near the line does not flap', () => {
    const c = new SimClock()
    let sim = 0
    const run = (frame: number, n: number) => { for (let i = 0; i < n; i++) c.observe(1000 + (sim += frame), sim, frame) }
    run(1 / 60, 200)
    expect(c.steady).toBe(true)
    // Exactly the physics rate sits between the two thresholds: it keeps whichever state it had.
    run(1 / 50, 400)
    expect(c.steady).toBe(true)
    run(1 / 30, 200)
    expect(c.steady).toBe(false)
    run(1 / 50, 400)
    expect(c.steady).toBe(false)
    run(1 / 60, 200)
    expect(c.steady).toBe(true)
  })

  it('adopts simulation time falling behind at once, not over half a second', () => {
    const c = new SimClock()
    let sim = 0
    let wall = 0
    for (let i = 0; i < 200; i++) { wall += 1 / 60; sim += 1 / 60; c.observe(1000 + wall, sim, 1 / 60) }
    // One frame in which 60 ms of simulation was dropped.
    wall += 1 / 60 + 0.06; sim += 1 / 60
    c.observe(1000 + wall, sim, 1 / 60)
    expect(c.at(sim, STEP, 0) - sim).toBeCloseTo(1000 + wall - sim + STEP / 2, 6)
  })

  it('follows a room clock resync: a jump at once, a small correction smoothly', () => {
    const c = new SimClock()
    let sim = 0
    for (let i = 0; i < 100; i++) c.observe(1000 + (sim += 1 / 60), sim, 1 / 60)
    const base = c.at(sim, STEP, 0) - sim
    // A better ping sample moves the room clock 8 ms: no step is ever more than that out,
    // and each frame moves the mapping by a fraction of a millisecond.
    let last = base
    for (let i = 0; i < 120; i++) {
      c.observe(1000.008 + (sim += 1 / 60), sim, 1 / 60)
      const now = c.at(sim, STEP, 0) - sim
      expect(now - last).toBeLessThan(0.0005)
      expect(now - last).toBeGreaterThanOrEqual(0)
      last = now
    }
    expect(last - base).toBeGreaterThan(0.007)
    // Reconnecting to a room whose clock is an hour away is adopted in one frame.
    c.observe(4600 + (sim += 1 / 60), sim, 1 / 60)
    expect(c.at(sim, STEP, 0) - sim).toBeCloseTo(4600 + STEP / 2, 6)
  })
})

describe('SendPacer', () => {
  const rateOf = (stepHz: number, asked: number, seconds = 60) => {
    const p = new SendPacer()
    let sent = 0
    for (let i = 0; i < stepHz * seconds; i++) if (p.step(1 / stepHz, asked)) sent++
    return sent / seconds
  }

  for (const asked of [15, 20, 30]) {
    it(`sends ${asked} states a second when asked for ${asked}`, () => {
      // Restarting the wait from zero gave 12.5, 16.7 and 25 at 50 steps a second.
      expect(rateOf(50, asked)).toBeCloseTo(asked, 0)
      expect(Math.abs(rateOf(50, asked) - asked)).toBeLessThan(0.2)
    })
  }

  it('cannot send faster than the steps, and sends on every step when asked to', () => {
    expect(rateOf(50, 60)).toBeCloseTo(50, 5)
    expect(rateOf(60, 20)).toBeCloseTo(20, 1)
  })

  it('never leaves a gap longer than the interval rounded up to a step', () => {
    const p = new SendPacer()
    let gap = 0
    let worst = 0
    for (let i = 0; i < 5000; i++) {
      gap++
      if (p.step(STEP, 20)) {
        worst = Math.max(worst, gap)
        gap = 0
      }
    }
    expect(worst).toBe(3)
  })

  it('does not burst after a hidden tab', () => {
    const p = new SendPacer()
    for (let i = 0; i < 5000; i++) p.hold(STEP, 20)
    let sent = 0
    for (let i = 0; i < 10; i++) if (p.step(STEP, 20)) sent++
    // Ten steps are 0.2 s: four states at 20 a second, at most one more for the banked wait.
    expect(sent).toBeLessThanOrEqual(5)
    expect(sent).toBeGreaterThanOrEqual(4)
  })
})
