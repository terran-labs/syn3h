import type { VehicleKind } from '../vehicles'

/** What the hints need to know about the player's vehicle this frame. */
export interface HintState {
  kind: VehicleKind
  /** Touch controls are in use, so name the on-screen button, not a key. */
  touch: boolean
  /** Metres above the ground. */
  altitude: number
  /** Metres a second. */
  speed: number
  /** Stick or keys, each -1 to 1: steer, pitch or drive, throttle. */
  steer: number
  pitch: number
  throttle: number
  /** The jet's hover mode (its starting mode), as opposed to forward flight. */
  hoverMode: boolean
}
export interface Hint { text: string; touchAction?: 'throttleUp' | 'special' }

/** The jet's lift-off control, by input method. Throttle is R and F (src/core/Input.ts). */
export const liftOffHint = (touch: boolean): Hint => touch ? { text: 'Hold THR + to lift off', touchAction: 'throttleUp' } : { text: 'Hold R to lift off' }

/**
 * Hints that appear in play only when the player seems stuck.
 *
 * The jet: W is nose-down pitch and does nothing on the ground; lift comes from the
 * throttle. Someone who picks the jet presses W first. After two seconds of pushing the
 * stick on a parked jet with no throttle, say how to lift off. It can repeat after a pause,
 * a few times at most, and never once the player has found the throttle.
 */
export class PlayHints {
  private pushing = 0
  private rest = 0
  private shown = 0
  private learned = false
  update(dt: number, s: HintState): Hint | null {
    this.rest = Math.max(0, this.rest - dt)
    if (s.kind !== 'jet') { this.pushing = 0; return null }
    if (s.throttle !== 0) { this.learned = true; this.pushing = 0; return null }
    const parked = s.hoverMode && s.altitude < 2.5 && s.speed < 3
    const trying = Math.abs(s.pitch) > 0.3 || Math.abs(s.steer) > 0.3
    if (!parked || !trying) { this.pushing = 0; return null }
    this.pushing += dt
    if (this.pushing < 2 || this.rest > 0 || this.learned || this.shown >= 3) return null
    this.pushing = 0; this.rest = 12; this.shown++
    return liftOffHint(s.touch)
  }
  /** A new vehicle starts fresh. */
  reset(): void { this.pushing = 0; this.rest = 0; this.shown = 0; this.learned = false }
}
