/**
 * Water-owned lens rule. The chase camera places the lens; this decides where it actually
 * goes near a water surface, so a dive reads as one slow move instead of a flicker or a cut.
 *
 * Pure maths: no three.js, no game state. `stepLens` is called once a frame with the chase
 * camera's desired lens height and the live (wavy) surface height under the lens.
 *
 * States:
 * - above / below, settled: the lens follows the chase camera, except that while the desired
 *   height lies inside the band round the surface it is held just clear of the surface on
 *   its current side. Waves cannot flip the side: only a desired height more than `band`
 *   beyond the surface does that.
 * - crossing: the lens eases from its held height to the desired height over `duration`
 *   seconds along a smoothstep, never reversing and never faster than `maxSpeed`.
 * - after a crossing, any remaining offset from the chase camera decays to exactly zero.
 */
export interface LensOptions {
  /** Half width of the dead band round the surface, metres. */
  band: number
  /** How far clear of the surface the lens is held while waiting, metres. */
  hold: number
  /** Duration of the crossing ease, seconds. */
  duration: number
  /** Speed limit on the lens relative to a still target, metres per second. */
  maxSpeed: number
  /** A jump of the desired lens larger than this in one frame is a teleport, metres. */
  teleport: number
  /** Rate the held height relaxes after a passing crest, metres per second. */
  relax: number
}
export const lensDefaults: LensOptions = { band: .35, hold: .22, duration: 1, maxSpeed: 4, teleport: 6, relax: .25 }

export interface LensState {
  side: 1 | -1
  /** Crossing progress 0..1, or -1 when settled. */
  t: number
  /** Lens height the crossing started from, as an offset from the surface. */
  from: number
  /** Last output lens height. */
  y: number
  /** Last desired lens height, for teleport detection. */
  desired: number
  /** Output minus desired, decaying to zero after a crossing. */
  offset: number
  /** Wave envelope: the held lens rides the recent highest (or lowest) surface, not each wave. */
  envelope: number
}
export const newLensState = (): LensState => ({ side: 1, t: -1, from: 0, y: NaN, desired: NaN, offset: 0, envelope: NaN })

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Reset to the chase camera's height on the side it is actually on. */
export function resetLens(state: LensState, desired: number, surface: number, o: LensOptions = lensDefaults): number {
  state.side = desired >= surface ? 1 : -1
  state.t = -1; state.offset = 0; state.desired = desired; state.envelope = surface
  state.y = state.side > 0 ? Math.max(desired, surface + o.hold) : Math.min(desired, surface - o.hold)
  state.offset = state.y - desired
  return state.y
}

/**
 * Advance the lens one frame. `surface` is -Infinity (or NaN) where there is no water: the
 * lens then returns to the chase camera immediately and the state resets to above.
 */
export function stepLens(state: LensState, desired: number, surface: number, dt: number, o: LensOptions = lensDefaults): number {
  dt = Math.max(0, Math.min(.25, dt))
  if (!Number.isFinite(surface)) { state.side = 1; state.t = -1; state.offset = 0; state.y = state.desired = desired; state.envelope = NaN; return desired }
  if (!Number.isFinite(state.y) || !Number.isFinite(state.envelope) || Math.abs(desired - state.desired) > o.teleport) return resetLens(state, desired, surface, o)
  state.desired = desired
  // The envelope jumps to a crest on the held side at once and relaxes slowly afterwards,
  // so the held lens rides the swell instead of bobbing with every wave.
  const relax = o.relax * dt
  state.envelope = state.side > 0
    ? Math.max(surface, Math.min(state.envelope, surface + o.band) - relax)
    : Math.min(surface, Math.max(state.envelope, surface - o.band) + relax)
  const relative = desired - surface
  if (state.t < 0) {
    // Settled: start a crossing only when the target is clearly on the other side.
    if (state.side * relative < -o.band) { state.t = 0; state.from = state.y - surface; state.side = state.side > 0 ? -1 : 1 }
  } else if (state.side * relative < -o.band) {
    // Target came back mid crossing: ease back from where the lens is now.
    state.side = state.side > 0 ? -1 : 1; state.t = 0; state.from = state.y - surface
  }
  const previous = state.y, limit = o.maxSpeed * dt
  let y: number
  if (state.t >= 0) {
    state.t = Math.min(1, state.t + dt / o.duration)
    const start = surface + state.from, s = smooth(state.t)
    y = start + (desired - start) * s
    // Monotonic and bounded: never back up against the crossing, never faster than the
    // limit. A target that runs ahead is caught by the settled offset decay afterwards.
    y = state.side < 0 ? Math.max(Math.min(y, previous), previous - limit) : Math.min(Math.max(y, previous), previous + limit)
    if (state.t >= 1) { state.t = -1; state.offset = y - desired }
  } else {
    // Settled: decay any leftover offset, then hold clear of the surface on our side.
    const decay = Math.min(Math.abs(state.offset), limit)
    state.offset -= Math.sign(state.offset) * decay
    if (Math.abs(state.offset) < 1e-4) state.offset = 0
    y = desired + state.offset
    y = state.side > 0 ? Math.max(y, state.envelope + o.hold) : Math.min(y, state.envelope - o.hold)
    if (Math.abs(desired - surface) > o.band + o.hold && state.offset === 0) y = desired
  }
  state.y = y
  return y
}

/**
 * How strongly the lens is in the waterline, 0..1: peaks mid crossing. Drives the brief
 * murky wash in the fog mix.
 */
export function lensWash(state: LensState): number {
  return state.t < 0 ? 0 : Math.sin(Math.PI * state.t)
}
