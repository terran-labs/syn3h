/**
 * The conductor of the adaptive score. It turns raw game state into a smoothed mood, asks
 * the composer for the next sixteenths and schedules them on the synthesiser a fraction of
 * a second ahead of the audio clock.
 *
 * What feeds the mood:
 *  - speed and throttle      raise intensity quickly and let it fall slowly
 *  - combat                  shots and hits nearby add heat, which decays over seconds
 *  - altitude and clearance  raise lift: choir, brighter filters, a higher arpeggio
 *  - lava proximity          darkens the harmony toward phrygian
 *  - submersion              is exposed as `depth` for the master lowpass
 *  - the match               holding the hill is triumph, a contested hill is tension
 */
import { defineParam, params } from '../../../shared/params'
import { Composer, levels, unit, type Mood, type Role } from './Composer'
import { ScoreSynth } from './ScoreSynth'

const tune = (id: string, label: string, value: number, min: number, max: number, step = 0.01) => defineParam({ id: `audio.score.${id}`, label, group: 'Adaptive score', scope: 'client', default: value, min, max, step })
/** How strongly play drives the score. 0 keeps it ambient, 2 makes a slow roll feel like a chase. */
export const scoreEnergy = tune('energy', 'Score intensity', 1, 0, 2)
export const scoreTempo = tune('tempo', 'Tempo scale', 1, 0.6, 1.4)
export const scoreReverb = tune('reverb', 'Hall size', 0.9, 0, 1.5)
/**
 * The cheaper instrument set, for phones. The quality system may set it; the score also sets
 * it itself when the browser reports the audio thread falling behind.
 */
export const scoreLite = defineParam({ id: 'audio.score.lite', label: 'Lighter score (for phones)', group: 'Adaptive score', scope: 'client', default: false })
/** 0 follows the world seed, so each world has its own key and themes. */
export const scoreSeed = tune('seed', 'Theme seed (0 = world)', 0, 0, 999999, 1)

export interface ScoreInput {
  /** True in play, false in the lobby, where the score stays ambient. */
  playing: boolean
  /** Metres per second. */
  speed: number
  throttle: number
  airborne: boolean
  /** Metres above the ground under the vehicle. */
  clearance: number
  /** Metres above the world's zero height. */
  altitude: number
  /** Metres below a liquid surface; zero or less when dry. */
  submerged: number
  /** 0..1 nearness of lava. */
  lava: number
}
export interface MatchMood { holding: boolean; contested: boolean; /** 0..1 share of the winning score. */ progress: number }

/** Seconds of music scheduled ahead of the audio clock. Covers a dropped frame or three. */
const LOOKAHEAD = 0.22
/** Seconds between surges the game may trigger. A release that comes too often stops meaning anything. */
const SURGE_COOLDOWN = 40
/** Move `value` toward `target` with a time constant in seconds. */
const follow = (value: number, target: number, tau: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / tau))

export class Score {
  /** The instruments. Replaced when the lighter tier is switched on or off, so read it afresh each time. */
  synth: ScoreSynth
  private strain = 0
  private nextPoll = 0
  private underrunEvents = -1
  /** The smoothed mood the music is following, for the lab and for tests. */
  readonly mood: Mood & { depth: number; heat: number; energy: number } = { intensity: 0, lift: 0, darkness: 0.3, triumph: 0, depth: 0, heat: 0, energy: 0 }
  private composer: Composer
  private seed: number
  private nextTime = 0
  private last = 0
  private bpm = 88
  private active = false
  private match: MatchMood = { holding: false, contested: false, progress: 0 }
  private tension = 0
  private release = 0
  private airTime = 0
  private lastCue = -Infinity

  constructor(private readonly context: BaseAudioContext, private readonly output: AudioNode, seed: number) {
    this.seed = seed
    this.composer = new Composer(seed)
    this.synth = new ScoreSynth(context, output, scoreLite.value)
    // Where the browser can tell us how hard the audio thread is working, watch it. Two bad
    // readings in a row and the score steps down to its lighter instruments, for good.
    const capacity = (context as { renderCapacity?: { start(options: { updateInterval: number }): void; addEventListener(type: 'update', listener: (event: { averageLoad: number; underrunRatio: number }) => void): void } }).renderCapacity
    if (capacity) {
      try {
        capacity.addEventListener('update', event => {
          this.load = { average: event.averageLoad, underruns: event.underrunRatio }
          this.strained(event.underrunRatio > 0.01 || event.averageLoad > 0.75)
        })
        capacity.start({ updateInterval: 2 })
      } catch { /* Not measurable here; the quality system can still set the tier. */ }
    }
  }
  /** The audio thread's last reported load (share of real time spent rendering) and underrun ratio, where the browser reports them. */
  load: { average: number; underruns: number } | null = null
  get playing(): boolean { return this.active }
  get tempo(): number { return this.bpm }
  get mode(): string { return this.composer.mode }
  /** Where the music is in its theme, still, build, release arc. */
  get role(): Role { return this.composer.role }
  /** Jump the arc: `climb` starts the swell toward a release eight bars away, `surge` toward one two bars away. */
  cue(role: Role | 'surge'): void { this.composer.cue(role); this.lastCue = this.context.currentTime }

  /** Fade the score in or out. It keeps no audio scheduled while inactive. */
  setActive(active: boolean, seconds = 2): void {
    if (active === this.active) return
    this.active = active
    this.synth.setLevel(active ? 1 : 0, seconds)
  }
  /** A new seed means new themes and usually a new key. Takes effect on the next sixteenth. */
  setSeed(seed: number): void { if (seed !== this.seed) { this.seed = seed; this.composer = new Composer(seed) } }
  /** Report a shot or a hit. `amount` is roughly 0.1 for a distant shot and 0.5 for being hit. */
  combat(amount: number): void {
    this.mood.heat = unit(this.mood.heat + Math.max(0, amount))
    // Being tagged is answered at once, outside the bar grid.
    if (amount >= 0.45 && this.active) this.synth.braam()
  }
  setMatch(match: MatchMood | null): void { this.match = match ?? { holding: false, contested: false, progress: 0 } }
  /**
   * A big moment in play. A win (strength 1) brings the release now. A capture brings a surge,
   * a release two bars away, unless one was cued in the last while; then only the drop lands.
   */
  accent(strength = 1): void {
    if (!this.active) return
    const now = this.context.currentTime, role = this.composer.role
    if (strength >= 1) this.cue('release')
    else if (now - this.lastCue > SURGE_COOLDOWN && role !== 'climb' && role !== 'release') this.cue('surge')
    else this.synth.impact(undefined, strength)
  }

  /** Step down to the lighter instruments after two strained readings in a row. */
  private strained(bad: boolean): void {
    this.strain = this.active && bad ? this.strain + 1 : 0
    if (this.strain >= 2 && !scoreLite.value) params.set(scoreLite.def.id, true)
  }
  /** Chrome's other counter: output frames the device was left without. Polled every two seconds. */
  private pollUnderruns(now: number): void {
    const stats = (this.context as { playbackStats?: { underrunEvents?: number; fallbackFramesEvents?: number } }).playbackStats
    if (!stats || now < this.nextPoll) return
    this.nextPoll = now + 2
    const events = stats.underrunEvents ?? stats.fallbackFramesEvents ?? 0
    if (this.underrunEvents >= 0) this.strained(events - this.underrunEvents >= 2)
    this.underrunEvents = events
  }

  update(input: ScoreInput): void {
    this.pollUnderruns(this.context.currentTime)
    if (scoreLite.value !== this.synth.lite) {
      // Swap the instruments: fade the old set out and let the new one take the next sixteenth.
      const old = this.synth
      old.setLevel(0, 0.4); setTimeout(() => old.dispose(), 1500)
      this.synth = new ScoreSynth(this.context, this.output, scoreLite.value)
      this.synth.setLevel(this.active ? 1 : 0, 0.6)
    }
    const now = this.context.currentTime, dt = Math.min(0.25, Math.max(0, now - this.last))
    this.last = now
    const m = this.mood, scale = scoreEnergy.value
    const speed = unit(input.speed / 60)
    m.energy = follow(m.energy, unit(speed * 0.85 + unit(Math.abs(input.throttle)) * 0.15), speed > m.energy ? 1.2 : 5, dt)
    m.heat *= Math.exp(-dt / 9)
    this.tension = follow(this.tension, this.match.contested ? 1 : 0, 1.5, dt)
    const lift = input.airborne ? unit(input.clearance / 80) * 0.7 + unit(input.altitude / 400) * 0.3 : unit(input.altitude / 600) * 0.3
    const depth = unit(input.submerged / 2.5)
    m.lift = follow(m.lift, input.playing ? lift : 0.25, 2.5, dt)
    m.depth = follow(m.depth, input.playing ? depth : 0, 0.25, dt)
    m.triumph = follow(m.triumph, input.playing ? unit((this.match.holding ? 0.6 : 0) + this.match.progress * 0.5) : 0, 3, dt)
    m.intensity = follow(m.intensity, input.playing ? unit((0.12 + 0.5 * m.energy + 0.8 * m.heat + 0.25 * this.tension) * scale) : 0, 1, dt)
    m.darkness = follow(m.darkness, input.playing ? unit(0.34 + 0.6 * m.heat + 0.55 * unit(input.lava) + 0.2 * depth - 0.3 * m.lift - 0.25 * m.triumph) : 0.1, 2, dt)

    // Leaving the ground: after a moment of real flight the music surges toward a release.
    const flying = input.playing && input.airborne && input.clearance > 12
    const was = this.airTime
    this.airTime = flying ? this.airTime + dt : 0
    if (this.active && was < 1.2 && this.airTime >= 1.2 && now - this.lastCue > SURGE_COOLDOWN && this.composer.role !== 'climb' && this.composer.role !== 'release') this.cue('surge')

    const level = levels(m)
    this.bpm = follow(this.bpm, level.bpm * scoreTempo.value, 4, dt)
    // The release arrives at once and fades over the section that follows it.
    this.release = follow(this.release, this.composer.role === 'release' && this.active ? 1 : 0, this.composer.role === 'release' ? 0.4 : 5, dt)
    this.synth.setLevels(level, m.depth, scoreReverb.value, { tension: this.composer.tension, release: this.release })
    if (!this.active) return
    // After a stall (a hidden tab, a long frame) start again from now; never play catch-up.
    if (this.nextTime < now - 0.05) this.nextTime = now + 0.06
    const duration = 15 / this.bpm
    while (this.nextTime < now + LOOKAHEAD) {
      this.synth.play(this.composer.step(m), this.nextTime, duration)
      this.nextTime += duration
    }
  }

  dispose(): void { this.active = false; this.synth.dispose() }
}
