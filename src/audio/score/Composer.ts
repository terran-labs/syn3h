/**
 * The composer of the adaptive score: pure, seeded music theory with no Web Audio in it, so
 * it runs in unit tests and gives every client with the same seed the same themes.
 *
 * Time is a grid of sixteenth notes. A chord lasts two bars and a section is four chords.
 * Each call to `step` returns what every instrument plays on the next sixteenth, given the
 * current mood. The mood decides three things:
 *  - which layers play (intensity brings in arpeggio, then bass and kick, then hats and snare)
 *  - which mode the harmony is in (darkness walks dorian, aeolian, harmonic minor, phrygian)
 *  - how the melody and choir sit on top (lift and triumph)
 *
 * The palette is deep space, not arcade: slow tempos, low sequencer lines, long melody
 * notes and half-time drums. Nothing here should bounce.
 *
 * A mode change is taken at the next chord boundary, not the next section, so the harmony
 * turns within two bars of a fight starting.
 */

export interface Mood {
  /** 0 is ambient drift, 1 is full drive. Fed by speed and combat. */
  intensity: number
  /** 0 on the ground, 1 high in open air. Brings choir and brightness. */
  lift: number
  /** 0 bright, 1 dark. Fed by combat and nearby lava. Picks the mode. */
  darkness: number
  /** 0..1, winning or holding the hill. Brings the lead and choir forward. */
  triumph: number
}

export const MODE_NAMES = ['dorian', 'aeolian', 'harmonic', 'phrygian'] as const
export type ModeName = (typeof MODE_NAMES)[number]
export const MODES: Record<ModeName, readonly number[]> = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  /** Harmonic minor: the raised seventh gives the major V chord of Russian romantic harmony. */
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
}
/** Chord roots as scale degrees. Each mode has a few progressions that show off its colour. */
const PROGRESSIONS: Record<ModeName, readonly (readonly number[])[]> = {
  dorian: [[0, 3, 0, 6], [0, 6, 3, 0], [0, 2, 3, 6]],
  aeolian: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 5, 3, 6]],
  // Only i, iv and V: the other chords of harmonic minor are augmented or diminished.
  harmonic: [[0, 3, 4, 0], [0, 3, 0, 4], [0, 4, 0, 4]],
  phrygian: [[0, 1, 0, 6], [0, 1, 5, 0], [0, 6, 1, 0]],
}
const ARPS: readonly (readonly number[])[] = [
  [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 4, 2, 3, 2],
  [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 5, 3, 2, 1],
  [0, 2, 3, 0, 2, 3, 0, 2, 1, 2, 4, 1, 2, 4, 1, 2],
]
const BASS_ACCENTS: readonly (readonly number[])[] = [
  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1],
  [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0],
  [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
]
/** Stacked chord tones the arpeggio walks, as scale-degree offsets from the chord root. */
const ARP_TONES = [0, 2, 4, 7, 9, 11, 14]
const CHORD_TONES = [0, 2, 4, 7]

export const STEPS_PER_BAR = 16
export const STEPS_PER_CHORD = 32
export const STEPS_PER_SECTION = 128

export interface Note { midi: number; velocity: number; /** Gate length in sixteenths. */ steps: number }
/** `pad` is root, third (or a suspended fourth), fifth and a colour tone, in that order. `root` is the bass and drone note. */
export interface Chord { mode: ModeName; degree: number; pad: number[]; root: number; /** Pitch class of the key at this chord. */ tonic: number }
/**
 * Sections follow a four-part arc, because a steady texture never raises a hair:
 *   theme    the melody is stated
 *   still    the melody rests; pads, drone and pulse only
 *   build    the bass holds the dominant under moving chords, a swell grows, then a breath of near silence
 *   release  the key lifts a minor third, the theme returns an octave up, organ and high choir enter
 */
export const ROLES = ['theme', 'still', 'build', 'release'] as const
export type Role = (typeof ROLES)[number]
export interface Step {
  index: number
  /** Present on the step where the harmony changes. */
  chord?: Chord
  bass?: Note
  arp?: Note
  lead?: Note
  kick?: number
  snare?: number
  hat?: number
  openHat?: number
  /** A distant telemetry beep at this MIDI pitch. Only in quiet passages. */
  beep?: number
  /** A noise swell lasting this many sixteenths, leading into the release. */
  riser?: number
  /** The suspended fourth of this chord resolving to its third: new pad voices. */
  resolve?: number[]
  /** Everything but the hall falls away for the half bar before the release. */
  breath?: boolean
  /** A sub drop and crash on a section start or a turn to a darker mode. */
  impact?: boolean
}

export const unit = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
export const smooth = (a: number, b: number, v: number) => { const t = unit((v - a) / (b - a)); return t * t * (3 - 2 * t) }
export const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** Small seeded generator (mulberry32). The score must never use Math.random. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Continuous layer levels for a mood. The synthesiser smooths toward these every frame. */
export function levels(mood: Mood) {
  const i = unit(mood.intensity), lift = unit(mood.lift), dark = unit(mood.darkness), triumph = unit(mood.triumph)
  return {
    bpm: 60 + 40 * i,
    pad: 0.95 - 0.3 * i,
    drone: 0.9 - 0.35 * smooth(0.4, 1, i),
    arp: smooth(0.1, 0.3, i),
    bass: smooth(0.3, 0.45, i),
    drums: smooth(0.28, 0.45, i),
    /** Wind in the void and the telemetry beeps: strongest when little else is playing. */
    air: 1 - 0.7 * i,
    lead: unit(Math.max(1 - smooth(0.15, 0.45, i), lift * 0.9, triumph)),
    choir: unit(Math.max(lift, triumph * 0.8)),
    /** Filter openness of the pads and arpeggio. */
    brightness: unit(0.25 + 0.4 * i + 0.25 * lift + 0.1 * triumph - 0.1 * dark),
    /** Bass distortion: only a dark, intense mood growls. */
    drive: unit(dark * i * 1.5),
  }
}
export type Levels = ReturnType<typeof levels>

const MODE_EDGES = [0.22, 0.5, 0.75]
/** The mode for a darkness, with a margin so a mood hovering on an edge does not flap. */
export function modeFor(darkness: number, current: number): number {
  const d = unit(darkness)
  let index = current
  while (index < 3 && d > MODE_EDGES[index] + 0.04) index++
  while (index > 0 && d < MODE_EDGES[index - 1] - 0.04) index--
  return index
}

/** Move a pitch by octaves into [low, low + 12). */
const fold = (midi: number, low: number) => ((((midi - low) % 12) + 12) % 12) + low

interface MotifNote { at: number; offset: number; steps: number }

export class Composer {
  private readonly random: () => number
  private key: number
  private index = 0
  private position = STEPS_PER_SECTION
  private modeIndex = -1
  private cycle = -1
  private progression: readonly number[] = PROGRESSIONS.dorian[0]
  private arp: readonly number[] = ARPS[0]
  private accents: readonly number[] = BASS_ACCENTS[0]
  private motif: MotifNote[] = []
  private risen = false

  constructor(seed: number) {
    this.random = seeded(seed)
    this.key = Math.floor(this.random() * 12)
  }
  /** Pitch class of the home note. It lifts a minor third at every release. */
  get tonic(): number { return this.key }
  get mode(): ModeName { return MODE_NAMES[Math.max(0, this.modeIndex)] }
  get role(): Role { return ROLES[Math.max(0, this.cycle) % ROLES.length] }
  /** 0..1 through the build, then falling away across the release. Drives filters and the halo. */
  get tension(): number {
    const t = Math.min(1, this.position / STEPS_PER_SECTION)
    return this.role === 'build' ? t : this.role === 'release' ? 1 - 0.6 * t : this.role === 'theme' ? 0.15 : 0
  }

  /** Jump the arc so the next sixteenth starts a section of this role. For the lab and for big game moments. */
  cue(role: Role): void { this.cycle += ((ROLES.indexOf(role) - this.cycle - 1) % 4 + 4) % 4; this.position = STEPS_PER_SECTION }

  private pick<T>(list: readonly T[]): T { return list[Math.floor(this.random() * list.length)] }
  /** MIDI pitch of a scale degree in the current mode, counted up from the tonic at octave 0. */
  private pitch(degree: number): number {
    const scale = MODES[this.mode]
    return this.key + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7)
  }

  private newSection(modeIndex: number): void {
    this.modeIndex = modeIndex
    this.position = 0
    this.cycle++
    // The lift: the release arrives a minor third higher than the build that led to it.
    if (this.role === 'release') this.key = (this.key + 3) % 12
    this.progression = this.pick(PROGRESSIONS[this.mode])
    // One arpeggio in four is a fresh random walk; the rest are shapes that are known to work.
    if (this.random() < 0.25) {
      const walk = [0]
      for (let i = 1; i < 16; i++) walk.push(Math.min(5, Math.max(0, walk[i - 1] + this.pick([-2, -1, 1, 1, 2]))))
      this.arp = walk
    } else this.arp = this.pick(ARPS)
    this.accents = this.pick(BASS_ACCENTS)
    // The release restates the theme it was built toward; every other section writes a new one.
    if (this.role !== 'release' || !this.motif.length) this.motif = this.newMotif()
  }

  /**
   * A two-bar phrase with a shape: a pickup, a leap up to a long held chord tone, then a
   * stepwise fall. The leap and the held note are what a listener remembers.
   */
  private newMotif(): MotifNote[] {
    const start = this.pick([0, 2, 4]), low = this.pick([0, 2]), peak = this.pick(low === 0 ? [4, 7] : [7, 9])
    const peakAt = start + this.pick([2, 4]), fallAt = peakAt + this.pick([8, 10, 12])
    const notes = [{ at: start, offset: low }, { at: peakAt, offset: peak }, { at: fallAt, offset: peak - 1 }]
    if (fallAt + 6 < STEPS_PER_CHORD && this.random() < 0.6) notes.push({ at: fallAt + this.pick([4, 6]), offset: peak - 2 })
    return notes.map((note, i) => ({ ...note, steps: Math.min(16, (notes[i + 1]?.at ?? STEPS_PER_CHORD) - note.at) }))
  }

  /** What plays on the next sixteenth. */
  step(mood: Mood): Step {
    const i = unit(mood.intensity), level = levels(mood)
    const out: Step = { index: this.index++ }
    let turnedDarker = false
    if (this.position % STEPS_PER_CHORD === 0) {
      const target = modeFor(mood.darkness, Math.max(0, this.modeIndex))
      if (this.position >= STEPS_PER_SECTION || target !== this.modeIndex) {
        turnedDarker = this.modeIndex >= 0 && target > this.modeIndex
        this.newSection(target)
      }
    }
    const pos = this.position++, role = this.role
    const bar = Math.floor(pos / STEPS_PER_BAR), s = pos % STEPS_PER_BAR
    const chordIndex = Math.floor(pos / STEPS_PER_CHORD), inChord = pos % STEPS_PER_CHORD
    const degree = this.progression[chordIndex]
    // In the build the bass refuses to move: it holds the dominant while the chords change above it.
    const root = fold(this.pitch(role === 'build' ? 4 : degree), 31)
    // The half bar of near silence before the release.
    const breath = role === 'build' && bar === 7 && s >= 8
    // A seventh, or a ninth in open air. Harmonic minor doubles the root instead: its sevenths grate.
    const colour = this.mode === 'harmonic' ? 7 : mood.lift > 0.5 ? 8 : 6
    const voices = (third: number) => [0, third, 4, colour].map(offset => fold(this.pitch(degree + offset), 50))
    // Every second chord arrives with its third suspended a step high and resolves a bar later.
    const suspended = chordIndex % 2 === 1

    if (inChord === 0) {
      out.chord = { mode: this.mode, degree, pad: voices(suspended ? 3 : 2), root, tonic: this.key }
      if (pos === 0 && (this.risen || (turnedDarker && i >= 0.3))) out.impact = true
      if (pos === 0) this.risen = false
    }
    if (suspended && inChord === STEPS_PER_BAR) out.resolve = voices(2)
    if (breath && s === 8) out.breath = true

    // The sequencer line: quarter notes when calm, eighths at a cruise, sixteenths only in a chase.
    const every = i < 0.3 ? 4 : i < 0.6 ? 2 : 1
    if (level.arp > 0 && s % every === 0 && !breath) {
      const base = fold(this.pitch(degree), 36) - this.pitch(degree)
      const midi = this.pitch(degree + ARP_TONES[this.arp[s]]) + base + (mood.lift > 0.6 || role === 'release' ? 12 : 0)
      out.arp = { midi, velocity: s % 4 === 0 ? 1 : 0.7, steps: every }
    }

    if (level.bass > 0 && !breath) {
      if (i < 0.6) {
        if (s % 4 === 0) out.bass = { midi: root + (s === 12 && bar % 2 === 1 ? 12 : 0), velocity: 0.85, steps: 3 }
      } else {
        const span = i < 0.85 ? 2 : 1
        const walking = i >= 0.8 && bar % 2 === 1 && s >= 13 && role !== 'build'
        const midi = walking ? fold(this.pitch(degree + (s === 14 ? 6 : 4)), 43) : root + (this.accents[s] ? 12 : 0)
        if (s % span === 0) out.bass = { midi, velocity: s % 4 === 0 ? 1 : 0.72, steps: span }
      }
    }

    // The melody rests in the still section, and in the release it returns an octave up at full voice.
    const sings = role === 'release' ? 1 : role === 'still' ? 0 : role === 'theme' ? Math.max(0.5, level.lead) : level.lead
    if (sings > 0.05 && !breath) {
      const lastChord = chordIndex === this.progression.length - 1
      for (let n = 0; n < this.motif.length; n++) {
        const note = this.motif[n]
        if (note.at !== inChord) continue
        // The last chord answers the phrase by playing its notes in reverse order.
        const offset = lastChord ? this.motif[this.motif.length - 1 - n].offset : note.offset
        const base = fold(this.pitch(degree), 65) - this.pitch(degree) + (role === 'release' ? 12 : 0)
        out.lead = { midi: this.pitch(degree + offset) + base, velocity: sings, steps: note.steps }
      }
    }

    if (level.drums > 0 && !breath) {
      // A heartbeat once a bar, then twice, and four on the floor only in a full chase.
      if (s % (i < 0.5 ? 16 : i < 0.75 ? 8 : 4) === 0) out.kick = 0.7 + 0.3 * i
      else if ((i >= 0.75 && bar % 2 === 1 && s === 14) || (i >= 0.9 && bar % 4 === 3 && s === 10)) out.kick = 0.6
      // `snare` is a low drum, a taiko more than a snare. Half time: one hit on beat three.
      // The build ends in a roll that grows into the breath; other sections end in a short fill.
      const roll = role === 'build' && bar === 7 && i >= 0.5
      const fill = role !== 'build' && bar === 7 && i >= 0.5 && s >= 12
      if (roll) out.snare = 0.3 + 0.07 * s
      else if (fill) out.snare = 0.4 + 0.15 * (s - 12)
      else if (i >= 0.55 && s === 8) out.snare = 0.85
      else if (i >= 0.8 && bar % 2 === 1 && (s === 11 || s === 14)) out.snare = 0.55
      if (i >= 0.8 && s % 4 === 2) out.hat = 0.5
      if (i >= 0.8 && bar % 2 === 1 && s === 14) out.openHat = 0.6
    }
    // Telemetry: four even beeps on the fifth of the key, far away, once per section.
    if (i < 0.35 && chordIndex === 2 && inChord < 16 && inChord % 4 === 0) out.beep = fold(this.pitch(4), 79)
    // The swell into the release. It plays at any intensity: a quiet build still needs to arrive somewhere.
    if (role === 'build' && bar === 6 && s === 0) { out.riser = 24; this.risen = true }
    return out
  }
}
