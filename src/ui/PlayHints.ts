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
  /** `Vehicle.canLiftOut`: a buggy sitting in lava or water with its wings closed, where opening them lifts it out. */
  canLiftOut: boolean
}
export interface Hint { text: string; touchAction?: 'throttleUp' | 'special' }

/** The jet's lift-off control, by input method. Throttle is R and F (src/core/Input.ts). */
export const liftOffHint = (touch: boolean): Hint => touch ? { text: 'Hold THR + to lift off', touchAction: 'throttleUp' } : { text: 'Hold E to lift off' }

/** The wings lift a buggy out of lava or water. Space on a keyboard, the WINGS button on touch. */
export const wingsHint = (touch: boolean): Hint => touch ? { text: 'WINGS: lift out', touchAction: 'special' } : { text: 'Space: wings to lift out' }

/**
 * Hints that appear in play only when the player seems stuck.
 *
 * The jet: W is nose-down pitch and does nothing on the ground; lift comes from the
 * throttle. Someone who picks the jet presses W first. After two seconds of pushing the
 * stick on a parked jet with no throttle, say how to lift off. It can repeat after a pause,
 * a few times at most, and never once the player has found the throttle.
 *
 * A buggy in lava or water: it sinks in and crawls; its wings lift it out. While it sits
 * there with the wings closed, say so, again every nine seconds, five times at most.
 */
export class PlayHints {
  private pushing = 0
  private rest = 0
  private shown = 0
  private learned = false
  private stuck = 0
  private wingRest = 0
  private wingShown = 0
  update(dt: number, s: HintState): Hint | null {
    this.rest = Math.max(0, this.rest - dt); this.wingRest = Math.max(0, this.wingRest - dt)
    if (s.canLiftOut) {
      this.stuck += dt
      // Most of a second in the liquid, so a splash through a puddle says nothing.
      if (this.stuck >= 0.8 && this.wingRest <= 0 && this.wingShown < 5) { this.wingRest = 9; this.wingShown++; return wingsHint(s.touch) }
    } else this.stuck = 0
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
  reset(): void { this.pushing = 0; this.rest = 0; this.shown = 0; this.learned = false; this.stuck = 0; this.wingRest = 0; this.wingShown = 0 }
}
