import { describe, expect, it } from 'vitest'
import { rubberBand, rubberPull, softLimit, springStep, SWING, swingResting, swingStep, type SwingAxis } from '../../src/ui/galaxy/Galaxy'

const LOW = -0.2, HIGH = 1.25
/** Run an axis, let go, for `seconds` at `fps`, with an optional long frame first. */
function run(axis: SwingAxis, seconds: number, fps: number, held = false, low = LOW, high = HIGH): { end: SwingAxis; trace: number[] } {
  const trace: number[] = []
  for (let t = 0; t < seconds - 1e-9; t += 1 / fps) { axis = swingStep(axis, 1 / fps, held, low, high); trace.push(axis.view) }
  return { end: axis, trace }
}

describe('galaxy swing', () => {
  it('follows a step on the spring without overshooting', () => {
    let x = 0, v = 0, most = 0
    for (let i = 0; i < 240; i++) { [x, v] = springStep(x, v, 1, SWING.follow, 1 / 120); most = Math.max(most, x) }
    expect(most).toBeLessThanOrEqual(1 + 1e-9)
    expect(x).toBeCloseTo(1, 6)
  })
  it('stays under the finger: most of a jump is followed within two frames at 30 fps', () => {
    const { trace } = run({ aim: 1, aimSpeed: 0, view: 0, viewSpeed: 0 }, 2 / 30, 30, true)
    expect(trace[1]).toBeGreaterThan(0.8)
  })
  it('ends in the same place at 30, 60 and 120 frames a second', () => {
    // A flick upward past the top limit: coast, stretch, spring back.
    const start: SwingAxis = { aim: 1.1, aimSpeed: 3, view: 1.08, viewSpeed: 2.5 }
    const ends = [30, 60, 120].map(fps => run(start, 1.5, fps).end)
    for (const end of ends) { expect(end.view).toBeCloseTo(ends[2].view, 3); expect(end.aim).toBeCloseTo(ends[2].aim, 3) }
    // Mid-flight too, not only at rest: a yaw coast at 0.3 s.
    const coast = [30, 60, 120].map(fps => run({ aim: 0, aimSpeed: 4, view: 0, viewSpeed: 0 }, 0.3, fps, false, -Infinity, Infinity).end.view)
    for (const v of coast) expect(v).toBeCloseTo(coast[2], 2)
  })
  it('stretches with rising resistance, never past the most it may', () => {
    let last = 0, give = Infinity
    for (let pull = 0.01; pull < 20; pull += 0.01) {
      const shown = rubberBand(pull)
      expect(shown).toBeGreaterThan(last); expect(shown).toBeLessThan(SWING.stretch)
      // Each extra bit of pull shows less than the one before: the resistance rises.
      expect(shown - last).toBeLessThan(give); give = shown - last
      expect(rubberPull(shown)).toBeCloseTo(pull, 6)
      last = shown
    }
    expect(rubberBand(-0.3)).toBeCloseTo(-rubberBand(0.3), 12)
    expect(softLimit(0.5, LOW, HIGH)).toBe(0.5)
    expect(softLimit(HIGH + 1, LOW, HIGH)).toBeGreaterThan(HIGH)
    expect(softLimit(HIGH + 1, LOW, HIGH)).toBeLessThan(HIGH + SWING.stretch)
  })
  it('springs back onto the limit exactly, without bouncing past it', () => {
    for (const [aim, edge] of [[HIGH + 0.15, HIGH], [LOW - 0.12, LOW]]) {
      const { end, trace } = run({ aim, aimSpeed: 0, view: aim, viewSpeed: 0 }, 2, 60)
      expect(end.view).toBe(edge); expect(end.aim).toBe(edge); expect(swingResting(end)).toBe(true)
      // Back from above stays above the limit all the way; from below, below.
      for (const view of trace) expect((view - edge) * (aim - edge)).toBeGreaterThanOrEqual(0)
    }
  })
  it('turns a coast that runs past the limit back within the stretch', () => {
    const { end, trace } = run({ aim: 1.0, aimSpeed: 6, view: 1.0, viewSpeed: 6 }, 3, 60)
    expect(Math.max(...trace)).toBeLessThan(HIGH + SWING.stretch + 0.01)
    expect(end.view).toBe(HIGH)
    // One settle, no bounce: after its peak the view only falls toward the limit.
    const peak = trace.indexOf(Math.max(...trace))
    for (let i = peak + 1; i < trace.length; i++) expect(trace[i]).toBeLessThanOrEqual(trace[i - 1] + 1e-12)
  })
  it('stays stable through a 250 ms frame', () => {
    let axis: SwingAxis = { aim: HIGH + 0.17, aimSpeed: 5, view: HIGH, viewSpeed: -40 }
    for (let i = 0; i < 20; i++) {
      axis = swingStep(axis, 0.25, false, LOW, HIGH)
      for (const v of Object.values(axis)) expect(Number.isFinite(v)).toBe(true)
      expect(Math.abs(axis.view - HIGH)).toBeLessThan(0.5)
    }
    expect(axis.view).toBe(HIGH)
  })
  it('comes to rest, so the lobby can go idle again', () => {
    expect(swingResting(run({ aim: 0, aimSpeed: 5, view: 0, viewSpeed: 0 }, 6, 30, false, -Infinity, Infinity).end)).toBe(true)
  })
})
