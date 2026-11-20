/**
 * Map of the score (16 November 2026):
 *  - Layers. Held: pads, drone, men's choir, wind in the void. Notes: a picked chord, the
 *    sequencer, bass, low drums, strings, bell, telemetry beeps, and the theremin lead (the
 *    `lead` in Composer.ts, the `leadBus` in ScoreSynth.ts). Late in the arc: brass, organ,
 *    high choir, halo, shimmer, riser and the endless rise.
 *  - What brings them in. Intensity (speed, throttle, combat heat) brings the sequencer at
 *    0.1, bass and drums from 0.28, a full chase at 0.8. The arc (theme, still, build, climb,
 *    release, afterglow, eight bars each, about 28 s at lobby tempo) brings the strings, the
 *    lead and the release's brass, organ and choir. Lift brings the choir; lava and combat
 *    darken the mode; the match brings triumph.
 *  - The build (arc.ts). Growth rises from 0 over `audio.buildTime` (300 s) of play. It caps
 *    intensity, so layers arrive over minutes, and opens the arc: build at 0.35, the theme at
 *    0.55 (and only when the lead is present enough), climb and release at 0.8. Until then the
 *    arc stays in its still section. Before: the score opened on a release and pressing Play
 *    surged into another, so the full mix arrived within 5 s.
 *  - The lead. Its presence follows the world's hour: a quarter by day, full at night, eased
 *    across dusk and dawn; at most half its former level, further back in the hall, with
 *    rests between phrases. By day it waits for the climb.
 *  - The lobby. Growth 0, intensity 0.06: pads, drone and slow glass tones, no lead, no climb.
 *    Before: intensity 0.2 and the whole arc, with the lead sounding over half the time.
 *
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
import { Composer, levels, seeded, unit, type Mood, type Role } from './Composer'
import { ScoreSynth } from './ScoreSynth'
import { OPENS, intensityCeiling, leadPresence, roleOpen, worldHour } from './arc'
import { leadDaylight, leadLobby, leadVolume, scoreBuildTime } from '../params'

const tune = (id: string, label: string, value: number, min: number, max: number, step = 0.01) => defineParam({ id: `audio.score.${id}`, label, group: 'Adaptive score', scope: 'client', default: value, min, max, step })
/** How strongly play drives the score. 0 keeps it ambient, 2 makes a slow roll feel like a chase. */
export const scoreEnergy = tune('energy', 'Score intensity', 1, 0, 2)
export const scoreTempo = tune('tempo', 'Tempo scale', 1, 0.6, 1.4)
export const scoreReverb = tune('reverb', 'Hall size', 0.9, 0, 1.5)
/**
 * The lobby's mix (the owner, 17 November 2026: "more ambient and celestial", fewer twangy
 * strings). In the lobby the plucked string, the bell and the telemetry beeps give way to glass
 * tones that swell in slowly, and the shimmer and the hall come forward.
 */
export const lobbyGlass = tune('lobbyGlass', 'Lobby: glass tones', 1, 0, 2)
export const lobbyShimmer = tune('lobbyShimmer', 'Lobby: high shimmer', 0.45, 0, 1)
export const lobbyHall = tune('lobbyHall', 'Lobby: hall send (times the hall size)', 1.35, 0.5, 2)
export const lobbyPad = tune('lobbyPad', 'Lobby: pads and drone', 1, 0, 1.5)
/** The plucked string, the bell and the telemetry beeps in the lobby: 0 since 17 November 2026. */
export const lobbyPluck = tune('lobbyPluck', 'Lobby: plucked string, bell and beeps (the old lobby)', 0, 0, 1)
/**
 * The cheaper instrument set, for phones. The quality system may set it; the score also sets
 * it itself when the browser reports the audio thread falling behind.
 */
export const scoreLite = defineParam({ id: 'audio.score.lite', label: 'Lighter score (for phones)', group: 'Adaptive score', scope: 'client', default: false })
/** The feedback-delay-network hall in place of the convolution: about a quarter of the cost. The lighter tier always uses it. */
export const scoreNetworkHall = defineParam({ id: 'audio.score.networkHall', label: 'Algorithmic hall (cheaper)', group: 'Adaptive score', scope: 'client', default: false })
const option = (id: string, label: string) => defineParam({ id: `audio.score.${id}`, label, group: 'Adaptive score', scope: 'client', default: true })
/** Tag beams near you become notes: each lands on the next sixteenth, pitched from the chord, climbing as they come. */
export const scoreTagNotes = option('tagNotes', 'Plasma Tag plays notes')
/** Nearby vehicles each carry part of the arrangement, heard from their side. Alone you hear only your own line. */
export const scoreConvoy = option('convoy', 'Convoy harmony')
/** The sequencer and plucked strings trace the skyline ahead of your vehicle. */
export const scoreTerrain = option('terrain', 'Terrain as melody')
/** Whistlers and dawn chorus at altitude, and a telemetry beep bent by whatever is closing on you. */
export const scoreWeather = option('weather', 'Space weather')
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
  /**
   * Nearby vehicles, nearest first, for convoy harmony: metres away, where they sit from
   * left (-1) to right (1) of the listener, and optionally how fast they are closing in m/s.
   */
  convoy?: readonly { distance: number; pan: number; closing?: number }[]
  /** Sixteen ground heights in metres along the way ahead, nearest first, for terrain as melody. */
  relief?: readonly number[]
  /** Strength of the game's wind at the listener, 0 calm to 1 gale. The score quietens its own wind layer under it, and space weather comes more often in a gust. */
  wind?: number
}
export interface MatchMood { holding: boolean; contested: boolean; /** 0..1 share of the winning score. */ progress: number }

/**
 * Seconds of music scheduled ahead of the audio clock. Notes are scheduled from the frame
 * loop, so a main-thread stall longer than this drops the notes inside it. 0.35 s rides out
 * the usual hitches (a shader compile, a terrain rebuild step) and the mood still answers
 * within a beat.
 */
const LOOKAHEAD = 0.35
/**
 * The lobby's intensity: below the sequencer, so the lobby is pads, drone and glass tones.
 * It was 0.2 (sequencer moving) until 16 November 2026, when the owner asked for a calmer lobby.
 */
const LOBBY_INTENSITY = 0.06
/** Seconds for the lead's presence to follow the hour and the lobby: dusk eases it in, it never switches. */
const PRESENCE_TAU = 8
/** Seconds between surges the game may trigger. A release that comes too often stops meaning anything. */
const SURGE_COOLDOWN = 40
/** Move `value` toward `target` with a time constant in seconds. */
const follow = (value: number, target: number, tau: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / tau))

/** Whether the score stepped itself down to the lighter tier this session (kept across audio graph rebuilds). */
let steppedDown = false

/** One line for Copy diagnostics: the music tier in use, whether the step-down fired, the underrun count. */
export function scoreReportLine(score: Score | undefined): string {
  if (!score) return 'Music: not started'
  const tier = score.synth.lite ? 'lighter' : 'full'
  const why = steppedDown ? ', stepped down this session under audio strain' : scoreLite.value ? ', lighter by setting' : ''
  const underruns = score.underruns === null ? 'underruns not reported' : `${score.underruns} underrun events`
  return `Music: ${tier} score${why}; ${underruns}`
}

export class Score {
  /** The instruments. Replaced when the lighter tier is switched on or off, so read it afresh each time. */
  synth: ScoreSynth
  private strain = 0
  private nextPoll = 0
  private underrunEvents = -1
  /** Underrun events the browser reported on this context at the last poll, or null where it reports none. */
  underruns: number | null = null
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
  private convoy: { distance: number; pan: number; closing: number }[] = []
  private convoyAt = -Infinity
  private relief: number[] | null = null
  private reliefAt = -Infinity
  private wasPlaying = false
  private opened = false
  private readonly tags: number[] = []
  private tagIndex = 0
  private lastTag = -Infinity
  private nextWeather = 0
  private readonly chance = seeded(8675309)
  private lastCue = -Infinity
  /** 0..1, how far the piece has built since play began (arc.ts). 0 in the lobby. */
  growth = 0
  /** 0..1, how far forward the theremin lead may come now, smoothed. */
  presence = 0
  private lobby = true

  constructor(private readonly context: BaseAudioContext, private readonly output: AudioNode, seed: number) {
    this.seed = seed
    this.composer = this.compose(seed)
    this.synth = new ScoreSynth(context, output, scoreLite.value, scoreLite.value || scoreNetworkHall.value)
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
  private compose(seed: number): Composer {
    const composer = new Composer(seed)
    composer.allow = role => roleOpen(role, this.growth, this.presence, this.lobby)
    return composer
  }
  /** The audio thread's last reported load (share of real time spent rendering) and underrun ratio, where the browser reports them. */
  load: { average: number; underruns: number } | null = null
  /** Times the main thread stalled past the lookahead and the score restarted from now, dropping the notes in between. */
  stalls = 0
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
    // The piece opens bare: pads and drone, and the rest arrives over minutes (arc.ts).
    if (active && !this.opened) { this.opened = true; this.composer.cue('still') }
  }
  /** A new seed means new themes and usually a new key. Takes effect on the next sixteenth. */
  setSeed(seed: number): void { if (seed !== this.seed) { this.seed = seed; this.composer = this.compose(seed) } }
  /** Report a shot or a hit. `amount` is roughly 0.1 for a distant shot and 0.5 for being hit. */
  combat(amount: number): void {
    this.mood.heat = unit(this.mood.heat + Math.max(0, amount))
    if (scoreTagNotes.value && this.active && this.tags.length < 8) this.tags.push(amount)
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
    else if (this.growth >= OPENS.climb && now - this.lastCue > SURGE_COOLDOWN && role !== 'climb' && role !== 'release') this.cue('surge')
    else this.synth.impact(undefined, strength)
  }

  /** Step down to the lighter instruments after two strained readings in a row. */
  private strained(bad: boolean): void {
    this.strain = this.active && bad ? this.strain + 1 : 0
    if (this.strain >= 2 && !scoreLite.value) { params.set(scoreLite.def.id, true); steppedDown = true }
  }
  /** Chrome's other counter: output frames the device was left without. Polled every two seconds. */
  private pollUnderruns(now: number): void {
    const stats = (this.context as { playbackStats?: { underrunEvents?: number; fallbackFramesEvents?: number } }).playbackStats
    if (!stats || now < this.nextPoll) return
    this.nextPoll = now + 2
    const events = stats.underrunEvents ?? stats.fallbackFramesEvents ?? 0
    if (this.underrunEvents >= 0) this.strained(events - this.underrunEvents >= 2)
    this.underrunEvents = events
    this.underruns = events
  }

  /** Space weather: whistlers come more often the higher you fly; the chorus only in open air. */
  private weather(input: ScoreInput, now: number): void {
    const on = scoreWeather.value && this.active && input.playing
    // Something closing at 30 m/s raises the telemetry beep about a semitone and a half: a real Doppler shift, exaggerated threefold.
    const closing = on ? this.convoy[0]?.closing ?? 0 : 0
    this.synth.doppler = 1 + Math.max(-0.3, Math.min(0.3, 3 * closing / 340))
    if (!on || now < this.nextWeather) return
    const lift = this.mood.lift, place = this.chance() * 1.6 - 0.8
    if (lift > 0.45 && this.chance() < 0.4) this.synth.chorus(now + 0.05, 3 + Math.floor(this.chance() * 4), place)
    else this.synth.whistler(now + 0.05, 5000 + this.chance() * 3000, 700 + this.chance() * 500, 0.8 + this.chance() * 0.9, place)
    // Every 7 to 23 seconds on the ground, every 2 to 7 high up.
    this.nextWeather = now + (4 + this.chance() * 10) / (0.6 + 1.5 * lift + unit(input.wind ?? 0))
  }

  update(input: ScoreInput): void {
    this.pollUnderruns(this.context.currentTime)
    if (scoreLite.value !== this.synth.lite || (scoreLite.value || scoreNetworkHall.value) !== this.synth.network) {
      // Swap the instruments: fade the old set out and let the new one take the next sixteenth.
      const old = this.synth
      old.setLevel(0, 0.4); setTimeout(() => old.dispose(), 1500)
      this.synth = new ScoreSynth(this.context, this.output, scoreLite.value, scoreLite.value || scoreNetworkHall.value)
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
    // The build: growth rises over the build time in play and is 0 in the lobby. It caps the
    // intensity, so bass and drums come with minutes of play, and opens the arc's sections.
    this.growth = input.playing && this.active ? Math.min(1, this.growth + dt / Math.max(1, scoreBuildTime.value)) : 0
    this.lobby = !input.playing
    const hour = worldHour()
    this.presence = follow(this.presence, leadPresence(input.playing, hour, leadVolume.value, leadDaylight.value, leadLobby.value), PRESENCE_TAU, dt)
    m.intensity = follow(m.intensity, input.playing ? Math.min(intensityCeiling(this.growth), unit((0.12 + 0.5 * m.energy + 0.8 * m.heat + 0.25 * this.tension) * scale)) : LOBBY_INTENSITY, 1, dt)
    m.darkness = follow(m.darkness, input.playing ? unit(0.34 + 0.6 * m.heat + 0.55 * unit(input.lava) + 0.2 * depth - 0.3 * m.lift - 0.25 * m.triumph) : 0.1, 2, dt)

    // Leaving the ground: after a moment of real flight the music surges toward a release.
    const flying = input.playing && input.airborne && input.clearance > 12
    const was = this.airTime
    this.airTime = flying ? this.airTime + dt : 0
    if (this.active && this.growth >= OPENS.climb && was < 1.2 && this.airTime >= 1.2 && now - this.lastCue > SURGE_COOLDOWN && this.composer.role !== 'climb' && this.composer.role !== 'release') this.cue('surge')

    // Pressing Play no longer surges: the piece starts its slow build from the bare opening.
    // Back in the lobby, whatever section was playing gives way to the still opening.
    if (this.active && !input.playing && this.wasPlaying && this.composer.role !== 'still') this.cue('still')
    this.wasPlaying = input.playing

    // Convoy harmony: the three nearest vehicles carry parts, fading out between 30 and 300 m.
    // The game refreshes these every few frames, in arrays it reuses, and may leave them out in
    // between. So copy what arrives and hold it for half a second before treating it as gone.
    if (input.convoy) { this.convoy = input.convoy.slice(0, 3).map(v => ({ distance: v.distance, pan: v.pan, closing: v.closing ?? 0 })); this.convoyAt = now }
    else if (now - this.convoyAt > 0.5) this.convoy = []
    if (input.relief) { this.relief = input.relief.slice(0, 16); this.reliefAt = now }
    else if (now - this.reliefAt > 0.5) this.relief = null
    this.synth.convoy = scoreConvoy.value && input.playing ? this.convoy.map(v => ({ level: unit(1 - (v.distance - 30) / 270), pan: Math.max(-1, Math.min(1, v.pan)) * 0.8 })) : null
    this.composer.setContour(scoreTerrain.value && input.playing ? this.relief : null)
    this.synth.wind = follow(this.synth.wind, input.playing ? unit(input.wind ?? 0) : 0, 1, dt)
    this.weather(input, now)

    const level = levels(m)
    this.bpm = follow(this.bpm, level.bpm * scoreTempo.value, 4, dt)
    // The release arrives at once and fades over the section that follows it.
    this.release = follow(this.release, this.composer.role === 'release' && this.active ? 1 : 0, this.composer.role === 'release' ? 0.4 : 5, dt)
    this.synth.setLevels(level, m.depth, scoreReverb.value, { tension: this.composer.tension, release: this.release, lead: this.presence,
      lobby: this.lobby ? { glass: lobbyGlass.value, shimmer: lobbyShimmer.value, hall: lobbyHall.value, pad: lobbyPad.value, pluck: lobbyPluck.value } : undefined })
    if (!this.active) return
    // After a stall (a hidden tab, a long frame) start again from now; never play catch-up.
    if (this.nextTime < now - 0.05) { this.nextTime = now + 0.06; this.stalls++ }
    const duration = 15 / this.bpm
    while (this.nextTime < now + LOOKAHEAD) {
      const step = this.composer.step(m)
      // One tag beam per sixteenth, each a chord tone higher than the last: rapid beams become a rising run.
      const tag = this.tags.shift()
      if (tag !== undefined) {
        if (this.nextTime - this.lastTag > 2) this.tagIndex = 0
        this.lastTag = this.nextTime
        step.tag = { midi: this.composer.tone(this.tagIndex++, 72), velocity: unit(0.45 + tag * 1.4), steps: 1 }
      }
      this.synth.play(step, this.nextTime, duration)
      this.nextTime += duration
    }
  }

  dispose(): void { this.active = false; this.synth.dispose() }
}
