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
  /**
   * `Vehicle.canLiftOut`: a buggy sunk in lava or water, wings closed and not in the Zorb. Only
   * the buggy sinks (the others float or fly), so only the buggy is ever told how to get out.
   */
  canLiftOut: boolean
  /** The Zorb ball is out. */
  zorbed: boolean
  /** This world allows the Zorb (`zorb.speed` above 0). */
  zorbAvailable: boolean
}
/**
 * A hint. `cue: 'zorb'` means the Zorb control says it better than words: the shell pulses the
 * Zorb button where one is on screen and shows the text only where none is.
 */
export interface Hint { text: string; touchAction?: 'throttleUp' | 'special'; cue?: 'zorb' }

/** The jet's lift-off control, by input method. Throttle is R and F (src/core/Input.ts). */
export const liftOffHint = (touch: boolean): Hint => touch ? { text: 'Hold THR + to lift off', touchAction: 'throttleUp' } : { text: 'Hold E to lift off' }

/**
 * The Zorb floats any vehicle out of lava or water (the owner, 19 November 2026: "Enabling Zorb
 * is a much better way to go"). The text is the fallback for when no Zorb control is on screen.
 */
export const zorbHint = (touch: boolean): Hint => ({ text: touch ? 'The Zorb floats you out' : 'X: the Zorb floats you out', cue: 'zorb' })
/** Where a world turns the Zorb off, open wings still float a buggy out. */
export const wingsHint = (touch: boolean): Hint => touch ? { text: 'WINGS: lift out', touchAction: 'special' } : { text: 'Space: wings to lift out' }

/** How long the Zorb control pulses for one sinking, seconds. */
export const ZORB_CUE_SECONDS = 10
/** Seconds clear of the liquid before a new sinking may be cued again. */
const DRY_TO_REARM = 3

/**
 * Hints that appear in play only when the player seems stuck.
 *
 * The jet: W is nose-down pitch and does nothing on the ground; lift comes from the
 * throttle. Someone who picks the jet presses W first. After two seconds of pushing the
 * stick on a parked jet with no throttle, say how to lift off. It can repeat after a pause,
 * a few times at most, and never once the player has found the throttle.
 *
 * A buggy sunk in lava or water: once per sinking, after most of a second in it, point at the
 * Zorb, which floats it out (`zorbCue` while the Zorb control should pulse). The cue ends when
 * the Zorb is on, the buggy is out, or after ZORB_CUE_SECONDS. A new sinking counts only after
 * a few seconds clear, so bobbing at the surface does not restart it. Where the world has the
 * Zorb off, name the wings instead, once per sinking too.
 */
export class PlayHints {
  private pushing = 0
  private rest = 0
  private shown = 0
  private learned = false
  private stuck = 0
  private dry = DRY_TO_REARM
  private cued = false
  private cueLeft = 0
  /** True while the Zorb control should pulse. Read after `update`. */
  zorbCue = false
  update(dt: number, s: HintState): Hint | null {
    this.rest = Math.max(0, this.rest - dt); this.cueLeft = Math.max(0, this.cueLeft - dt)
    let sunk: Hint | null = null
    if (s.canLiftOut) {
      this.stuck += dt; this.dry = 0
      // Most of a second in the liquid, so a splash through a puddle says nothing.
      if (this.stuck >= 0.8 && !this.cued) {
        this.cued = true
        if (s.zorbAvailable) { this.cueLeft = ZORB_CUE_SECONDS; sunk = zorbHint(s.touch) } else sunk = wingsHint(s.touch)
      }
    } else {
      this.stuck = 0; this.dry += dt
      if (this.dry >= DRY_TO_REARM) this.cued = false
    }
    this.zorbCue = this.cueLeft > 0 && s.canLiftOut && !s.zorbed
    if (!this.zorbCue) this.cueLeft = 0
    if (sunk) return sunk
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
  reset(): void { this.pushing = 0; this.rest = 0; this.shown = 0; this.learned = false; this.stuck = 0; this.dry = DRY_TO_REARM; this.cued = false; this.cueLeft = 0; this.zorbCue = false }
}
