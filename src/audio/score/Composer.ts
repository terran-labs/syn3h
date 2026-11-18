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
/** `major` is never chosen by darkness. It is where a release arrives. */
export type ModeName = (typeof MODE_NAMES)[number] | 'major'
export const MODES: Record<ModeName, readonly number[]> = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  /** Harmonic minor: the raised seventh gives the major V chord of Russian romantic harmony. */
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
}
/** Chord roots as scale degrees. Each mode has a few progressions that show off its colour. */
const PROGRESSIONS: Record<ModeName, readonly (readonly number[])[]> = {
  dorian: [[0, 3, 0, 6], [0, 6, 3, 0], [0, 2, 3, 6]],
  aeolian: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 5, 3, 6]],
  // Only i, iv and V: the other chords of harmonic minor are augmented or diminished.
  harmonic: [[0, 3, 4, 0], [0, 3, 0, 4], [0, 4, 0, 4]],
  phrygian: [[0, 1, 0, 6], [0, 1, 5, 0], [0, 6, 1, 0]],
  // I V vi IV and its rotations: the progression a thousand anthems are built on.
  major: [[0, 4, 5, 3], [3, 0, 4, 5], [0, 5, 3, 4]],
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
 * Sections follow an arc, because a steady texture never raises a hair:
 *   theme      the world's theme is stated
 *   still      the melody rests; pads, drone and pulse only
 *   build      the bass holds the dominant under moving chords; strings enter on the beat
 *   climb      the strings double their pace, the theme's rising phrase repeats, a swell
 *              and a drum roll grow, then half a bar of near silence
 *   release    the harmony turns to the relative major, the full theme returns an octave
 *              up on brass and theremin, with organ, bell and the high choir
 *   afterglow  the major lingers; only the theme's closing phrase is heard
 * `cue('surge')` jumps to the last two bars of a climb, for a release a few seconds away.
 */
export const ROLES = ['theme', 'still', 'build', 'climb', 'release', 'afterglow'] as const
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
  /** A plucked string (koto, harp): doubles the sequencer an octave up, or picks out the chord alone when calm. */
  pluck?: Note
  /** A glass tone (the lobby's celestial voice): a slow swell and a long fall, mostly in the hall. */
  glass?: Note
  /** A struck bell on the home note: full at a release, soft at the start of a still section. */
  bell?: Note
  /** A short bowed chord from the string section: three notes, played together. */
  strings?: { midi: number[]; velocity: number }
  /** The theme on brass, under the theremin. Only in a release. */
  brass?: Note
  /** A tag beam turned into a note. Added by the conductor, not written by the composer. */
  tag?: Note
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

interface ThemeNote { at: number; offset: number; steps: number }

export class Composer {
  private readonly random: () => number
  /**
   * The theme of this seed: four two-bar phrases, one per chord, written as scale degrees
   * above each chord's root. It never changes, so a listener comes to know it, and its
   * return at a release is a recognition, not just a loud passage.
   */
  readonly theme: readonly (readonly ThemeNote[])[]
  private key: number
  private index = 0
  private position = STEPS_PER_SECTION
  private modeIndex = -1
  private bright = false
  private cycle = -1
  private jump: { role: Role; at: number } | null = null
  private progression: readonly number[] = PROGRESSIONS.dorian[0]
  private arp: readonly number[] = ARPS[0]
  private contour: readonly number[] | null = null
  private degree = 0
  private accents: readonly number[] = BASS_ACCENTS[0]
  private risen = false
  /**
   * Which sections may begin when the arc moves on. The conductor narrows this while the piece
   * builds (arc.ts): early on only `still` is open, so the music stays bare. A cue still jumps.
   */
  allow: (role: Role) => boolean = () => true

  constructor(seed: number) {
    this.random = seeded(seed)
    this.key = Math.floor(this.random() * 12)
    this.theme = this.writeTheme()
  }
  /** Pitch class of the home note. It lifts a minor third at every release. */
  get tonic(): number { return this.key }
  get mode(): ModeName { return this.bright ? 'major' : MODE_NAMES[Math.max(0, this.modeIndex)] }
  get role(): Role { return ROLES[Math.max(0, this.cycle) % ROLES.length] }
  /** 0..1: rises through the build and the climb, then falls away after the release. Drives filters, halo and shimmer. */
  get tension(): number {
    const t = Math.min(1, this.position / STEPS_PER_SECTION)
    switch (this.role) {
      case 'build': return 0.5 * t
      case 'climb': return 0.5 + 0.5 * t
      case 'release': return 1 - 0.4 * t
      case 'afterglow': return 0.4 * (1 - t)
      case 'theme': return 0.15
      default: return 0
    }
  }
  /**
   * Jump the arc. A role starts that section on the next sixteenth; `surge` starts the last
   * two bars of a climb, so a release lands a few seconds later. For big moments in play.
   */
  cue(role: Role | 'surge'): void { this.jump = role === 'surge' ? { role: 'climb', at: 6 * STEPS_PER_BAR } : { role, at: 0 } }

  /**
   * Terrain as melody. Give sixteen ground heights along the way ahead and the sequencer and
   * the plucked strings trace that skyline: low ground plays the bottom of the chord, a peak
   * the top. Flat ground, or null, gives the line back to the composer.
   */
  setContour(heights: readonly number[] | null): void {
    if (!heights || heights.length < 16) { this.contour = null; return }
    const low = Math.min(...heights), range = Math.max(...heights) - low
    this.contour = range < 1.5 ? null : heights.slice(0, 16).map(h => Math.round(5 * (h - low) / range))
  }
  /** The nth tone of the chord now sounding, counted upward from `low`. For notes play adds on top, such as tag beams. */
  tone(n: number, low: number): number {
    const base = fold(this.pitch(this.degree), low) - this.pitch(this.degree)
    return this.pitch(this.degree + ARP_TONES[((n % ARP_TONES.length) + ARP_TONES.length) % ARP_TONES.length]) + base
  }

  private pick<T>(list: readonly T[]): T { return list[Math.floor(this.random() * list.length)] }
  /** MIDI pitch of a scale degree in the current mode, counted up from the tonic at octave 0. */
  private pitch(degree: number): number {
    const scale = MODES[this.mode]
    return this.key + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7)
  }

  /**
   * Phrase one: a pickup, a leap up to a long held chord tone, a stepwise fall.
   * Phrase two: the same, ending a step lower. Phrase three: the same shape a third higher,
   * the top of the theme. Phrase four: a slow descent to the root, held.
   */
  private writeTheme(): ThemeNote[][] {
    const start = this.pick([0, 2, 4]), low = this.pick([0, 2]), peak = this.pick(low === 0 ? [4, 7] : [7, 9])
    const peakAt = start + this.pick([2, 4]), fallAt = peakAt + this.pick([8, 10, 12])
    const shape = [{ at: start, offset: low }, { at: peakAt, offset: peak }, { at: fallAt, offset: peak - 1 }]
    if (fallAt + 6 < STEPS_PER_CHORD && this.random() < 0.6) shape.push({ at: fallAt + this.pick([4, 6]), offset: peak - 2 })
    const timed = (notes: { at: number; offset: number }[]) => notes.map((note, i) => ({ ...note, steps: Math.min(16, (notes[i + 1]?.at ?? STEPS_PER_CHORD) - note.at) }))
    const last = shape.length - 1
    return [
      timed(shape),
      timed(shape.map((note, i) => i === last ? { ...note, offset: note.offset - 1 } : note)),
      timed(shape.map(note => ({ ...note, offset: note.offset + 2 }))),
      timed([{ at: 0, offset: 4 }, { at: 8, offset: 2 }, { at: 16, offset: 0 }]),
    ]
  }

  private newSection(modeIndex: number, role?: Role, arriving = true): void {
    this.modeIndex = modeIndex
    this.position = 0
    this.cycle = role === undefined ? this.cycle + 1 : this.cycle + 1 + ((ROLES.indexOf(role) - this.cycle - 1) % ROLES.length + ROLES.length) % ROLES.length
    // The lift: a release arrives a minor third above the build, and in the major when the mood
    // is not dark. From a natural minor key that is its relative major: the same notes, lit
    // from the other side. The next theme falls back into the minor of that new home.
    if (this.role === 'release' && arriving) this.key = (this.key + 3) % 12
    this.bright = (this.role === 'release' || this.role === 'afterglow') && modeIndex <= 1
    this.progression = this.pick(PROGRESSIONS[this.mode])
    // One arpeggio in four is a fresh random walk; the rest are shapes that are known to work.
    if (this.random() < 0.25) {
      const walk = [0]
      for (let i = 1; i < 16; i++) walk.push(Math.min(5, Math.max(0, walk[i - 1] + this.pick([-2, -1, 1, 1, 2]))))
      this.arp = walk
    } else this.arp = this.pick(ARPS)
    this.accents = this.pick(BASS_ACCENTS)
  }

  /** The next section in the arc that is open; `still` if none is. */
  private nextOpen(): Role {
    for (let k = 1; k <= ROLES.length; k++) { const role = ROLES[(((this.cycle + k) % ROLES.length) + ROLES.length) % ROLES.length]; if (this.allow(role)) return role }
    return 'still'
  }

  /** What plays on the next sixteenth. */
  step(mood: Mood): Step {
    const i = unit(mood.intensity), level = levels(mood)
    const out: Step = { index: this.index++ }
    let turnedDarker = false
    if (this.jump) {
      this.newSection(modeFor(mood.darkness, Math.max(0, this.modeIndex)), this.jump.role)
      // A release that is called for directly still lands with its drop.
      if (this.jump.role === 'release') this.risen = true
      this.position = this.jump.at; this.jump = null
    } else if (this.position % STEPS_PER_CHORD === 0) {
      const target = modeFor(mood.darkness, Math.max(0, this.modeIndex))
      if (this.position >= STEPS_PER_SECTION) this.newSection(target, this.nextOpen())
      else if (target !== this.modeIndex) {
        // The mood changed mid-section: turn the harmony now, but stay where we are in the arc.
        turnedDarker = this.modeIndex >= 0 && target > this.modeIndex
        const at = this.position
        this.cycle--; this.newSection(target, undefined, false); this.position = at
      }
    }
    const pos = this.position++, role = this.role
    const bar = Math.floor(pos / STEPS_PER_BAR), s = pos % STEPS_PER_BAR
    const chordIndex = Math.floor(pos / STEPS_PER_CHORD), inChord = pos % STEPS_PER_CHORD
    const degree = this.degree = this.progression[chordIndex], line = this.contour ?? this.arp
    const rising = role === 'build' || role === 'climb'
    // While the music rises the bass refuses to move: it holds the dominant as the chords change above it.
    const root = fold(this.pitch(rising ? 4 : degree), 31)
    // The half bar of near silence before the release.
    const breath = role === 'climb' && bar === 7 && s >= 8
    // A seventh, or a ninth in open air. Harmonic minor doubles the root instead: its sevenths grate.
    const colour = this.mode === 'harmonic' ? 7 : mood.lift > 0.5 || this.bright ? 8 : 6
    const voices = (third: number) => [0, third, 4, colour].map(offset => fold(this.pitch(degree + offset), 50))
    // Every second chord arrives with its third suspended a step high and resolves a bar later.
    const suspended = chordIndex % 2 === 1

    if (inChord === 0) {
      out.chord = { mode: this.mode, degree, pad: voices(suspended ? 3 : 2), root, tonic: this.key }
      if (pos === 0 && (this.risen || (turnedDarker && i >= 0.3))) out.impact = true
      if (pos === 0) this.risen = false
    }
    if (turnedDarker && i >= 0.3) out.impact = true
    if (suspended && inChord === STEPS_PER_BAR) out.resolve = voices(2)
    if (breath && s === 8) out.breath = true

    // The sequencer line: quarter notes when calm, eighths at a cruise, sixteenths only in a chase.
    const every = i < 0.3 ? 4 : i < 0.6 ? 2 : 1
    if (level.arp > 0 && s % every === 0 && !breath) {
      const base = fold(this.pitch(degree), 36) - this.pitch(degree)
      const midi = this.pitch(degree + ARP_TONES[line[s]]) + base + (mood.lift > 0.6 || role === 'release' ? 12 : 0)
      out.arp = { midi, velocity: s % 4 === 0 ? 1 : 0.7, steps: every }
      if (s % 2 === 0) out.pluck = { midi: midi + 12, velocity: out.arp.velocity * 0.8, steps: 8 }
    } else if (level.arp === 0 && !breath) {
      // Too calm for the sequencer (in practice, the lobby). A string picks out the chord, one
      // note to a beat; the synth leaves it out in the lobby unless audio.score.lobbyPluck asks.
      if (s % 4 === 0) {
        const base = fold(this.pitch(degree), 48) - this.pitch(degree)
        out.pluck = { midi: this.pitch(degree + ARP_TONES[line[s]]) + base, velocity: s === 0 ? 0.7 : 0.45, steps: 16 }
      }
      // A high glass tone swells in on each chord's fifth, and on every second chord a softer
      // third answers it. From the position, not the random stream, so play's music is unchanged.
      if (inChord === 0) out.glass = { midi: fold(this.pitch(degree + 4), 74), velocity: 0.55, steps: STEPS_PER_CHORD }
      else if (inChord === 20 && chordIndex % 2 === 1) out.glass = { midi: fold(this.pitch(degree + 2), 79), velocity: 0.4, steps: STEPS_PER_CHORD }
    }
    if (pos === 0 && (role === 'release' || role === 'still')) out.bell = { midi: fold(this.pitch(0), 48), velocity: role === 'release' ? 1 : 0.45, steps: 32 }

    // The string section: on the beat through the build, twice as fast in the climb, faster
    // again in its last two bars, driving eighths in the release. Also in any hard chase.
    const pace = role === 'build' ? 4 : role === 'climb' ? (bar >= 6 ? 1 : 2) : role === 'release' || i >= 0.7 ? 2 : 0
    if (pace && s % pace === 0 && !breath) {
      const swell = role === 'build' ? 0.35 + 0.25 * (pos / STEPS_PER_SECTION) : role === 'climb' ? 0.55 + 0.45 * (pos / STEPS_PER_SECTION) : role === 'release' ? 0.8 : 0.6
      out.strings = { midi: [0, 2, 4].map(offset => fold(this.pitch(degree + offset), 55)), velocity: swell * (s % 4 === 0 ? 1 : 0.75) }
    }

    if (level.bass > 0 && !breath) {
      if (i < 0.6) {
        if (s % 4 === 0) out.bass = { midi: root + (s === 12 && bar % 2 === 1 ? 12 : 0), velocity: 0.85, steps: 3 }
      } else {
        const span = i < 0.85 ? 2 : 1
        const walking = i >= 0.8 && bar % 2 === 1 && s >= 13 && !rising
        const midi = walking ? fold(this.pitch(degree + (s === 14 ? 6 : 4)), 43) : root + (this.accents[s] ? 12 : 0)
        if (s % span === 0) out.bass = { midi, velocity: s % 4 === 0 ? 1 : 0.72, steps: span }
      }
    }

    // Who sings the theme, and how much of it. The lead leaves long rests: a phrase, then two
    // bars of nothing, so it is heard as a voice in the distance rather than a constant wail.
    //   theme: phrases one and three.   climb: the rising third phrase over every other chord.
    //   release: all four, an octave up, with brass.   afterglow: only the closing phrase.
    const phrase = role === 'release' || (role === 'theme' && chordIndex % 2 === 0) ? this.theme[chordIndex]
      : role === 'climb' ? (chordIndex % 2 === 0 ? this.theme[2] : null)
      : role === 'afterglow' && chordIndex % 2 === 1 ? this.theme[3]
      : null
    const sings = role === 'release' ? 1 : role === 'climb' ? 0.6 : role === 'afterglow' ? 0.5 : Math.max(0.5, level.lead)
    if (phrase && !breath) for (const note of phrase) {
      if (note.at !== inChord) continue
      const base = fold(this.pitch(degree), 65) - this.pitch(degree) + (role === 'release' ? 12 : 0)
      out.lead = { midi: this.pitch(degree + note.offset) + base, velocity: sings, steps: note.steps }
      if (role === 'release') out.brass = { midi: out.lead.midi - 12, velocity: 1, steps: note.steps }
    }

    if (!breath) {
      const drums = level.drums > 0
      // A heartbeat once a bar, then twice, and four on the floor only in a full chase.
      // A release always has its heartbeat, however calm the play.
      if (drums && s % (i < 0.5 ? 16 : i < 0.75 ? 8 : 4) === 0) out.kick = 0.7 + 0.3 * i
      else if (drums && ((i >= 0.75 && bar % 2 === 1 && s === 14) || (i >= 0.9 && bar % 4 === 3 && s === 10))) out.kick = 0.6
      else if (role === 'release' && s % 16 === 0) out.kick = 0.8
      // `snare` is a low drum, a taiko more than a snare. Half time: one hit on beat three.
      // The climb ends in a roll that grows into the breath, at any intensity.
      if (role === 'climb' && bar === 7) out.snare = 0.3 + 0.07 * s
      else if (drums && !rising && bar === 7 && i >= 0.5 && s >= 12) out.snare = 0.4 + 0.15 * (s - 12)
      else if ((drums && i >= 0.55 || role === 'release') && s === 8) out.snare = 0.85
      else if (drums && i >= 0.8 && bar % 2 === 1 && (s === 11 || s === 14)) out.snare = 0.55
      if (drums && i >= 0.8 && s % 4 === 2) out.hat = 0.5
      if (drums && i >= 0.8 && bar % 2 === 1 && s === 14) out.openHat = 0.6
    }
    // Telemetry: four even beeps on the fifth of the key, far away, once per section.
    if (i < 0.35 && chordIndex === 2 && inChord < 16 && inChord % 4 === 0 && !rising) out.beep = fold(this.pitch(4), 79)
    // The swell into the release. It plays at any intensity: a quiet climb still needs to arrive somewhere.
    if (role === 'climb' && bar === 6 && s === 0) { out.riser = 24; this.risen = true }
    return out
  }
}
