import { describe, expect, it } from 'vitest'
import { Composer, MODES, STEPS_PER_CHORD, STEPS_PER_SECTION, levels, modeFor, type Mood, type Step } from '../../src/audio/score/Composer'

const calm: Mood = { intensity: 0, lift: 0, darkness: 0.3, triumph: 0 }
const cruise: Mood = { intensity: 0.4, lift: 0, darkness: 0.34, triumph: 0 }
const fight: Mood = { intensity: 0.95, lift: 0, darkness: 0.9, triumph: 0 }
const run = (seed: number, mood: Mood, steps: number) => { const c = new Composer(seed); return { c, steps: Array.from({ length: steps }, () => c.step(mood)) } }
const count = (steps: Step[], key: keyof Step) => steps.filter(s => s[key] !== undefined).length

describe('adaptive score composer', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(run(7, fight, 256).steps).toEqual(run(7, fight, 256).steps)
    expect(run(7, fight, 256).steps).not.toEqual(run(8, fight, 256).steps)
  })

  it('keeps every pitched note inside the mode of its chord', () => {
    for (const seed of [1, 2, 3, 42, 999]) for (const mood of [calm, cruise, fight, { ...cruise, lift: 1 }]) {
      const { steps } = run(seed, mood, STEPS_PER_SECTION * 9)
      let scale = new Set<number>()
      for (const step of steps) {
        if (step.chord) scale = new Set(MODES[step.chord.mode].map(n => (n + step.chord!.tonic) % 12))
        const pitches = [...(step.chord?.pad ?? []), ...(step.resolve ?? []), ...(step.chord ? [step.chord.root] : []), step.arp?.midi, step.bass?.midi, step.lead?.midi, step.beep, step.pluck?.midi, step.bell?.midi, step.brass?.midi].filter((n): n is number => n !== undefined)
        for (const midi of pitches) expect(scale.has(((midi % 12) + 12) % 12), `seed ${seed} midi ${midi}`).toBe(true)
      }
    }
  })

  it('changes chord every two bars and voices the pad in a close register', () => {
    const { steps } = run(5, cruise, STEPS_PER_SECTION)
    steps.forEach((step, i) => expect(step.chord !== undefined).toBe(i % STEPS_PER_CHORD === 0))
    for (const step of steps) if (step.chord) {
      expect(step.chord.pad).toHaveLength(4)
      expect(Math.max(...step.chord.pad) - Math.min(...step.chord.pad)).toBeLessThan(12)
      expect(step.chord.root).toBeGreaterThanOrEqual(31); expect(step.chord.root).toBeLessThan(43)
    }
  })

  it('layers instruments in as intensity rises', () => {
    const quiet = run(3, calm, STEPS_PER_SECTION).steps, mid = run(3, cruise, STEPS_PER_SECTION).steps, loud = run(3, fight, STEPS_PER_SECTION).steps
    for (const key of ['kick', 'snare', 'hat', 'bass', 'arp', 'riser', 'impact'] as const) expect(count(quiet, key), key).toBe(0)
    expect(count(quiet, 'lead')).toBeGreaterThan(0)
    // With the sequencer silent a plucked string keeps the pulse, one note to a beat.
    expect(count(quiet, 'pluck')).toBe(STEPS_PER_SECTION / 4)
    expect(count(mid, 'arp')).toBe(STEPS_PER_SECTION / 2)
    expect(count(mid, 'kick')).toBe(STEPS_PER_SECTION / 16)
    expect(count(mid, 'hat')).toBe(0)
    expect(count(quiet, 'beep')).toBe(4)
    expect(count(mid, 'snare')).toBe(0)
    expect(count(loud, 'arp')).toBe(STEPS_PER_SECTION)
    expect(count(loud, 'bass')).toBe(STEPS_PER_SECTION)
    expect(count(loud, 'hat')).toBe(STEPS_PER_SECTION / 4)
    expect(count(loud, 'kick')).toBeGreaterThanOrEqual(STEPS_PER_SECTION / 4)
    expect(count(loud, 'snare')).toBeGreaterThanOrEqual(8)
    // Half time: the low drum never lands on beats two and four.
    expect(loud.filter((step, n) => step.snare && n < 112 && (n % 16 === 4 || n % 16 === 12))).toEqual([])
  })

  it('follows the arc: theme, still, build, climb, breath, then a release in the relative major', () => {
    const { steps } = run(11, cruise, STEPS_PER_SECTION * 6), home = steps[0].chord!.tonic
    const section = (n: number) => steps.slice(n * STEPS_PER_SECTION, (n + 1) * STEPS_PER_SECTION)
    const [theme, still, build, climb, release, afterglow] = [0, 1, 2, 3, 4, 5].map(section)
    // The theme states phrases one and three and rests through two and four.
    expect(count(theme, 'lead')).toBeGreaterThan(3)
    expect(count(theme.slice(32, 64), 'lead') + count(theme.slice(96), 'lead')).toBe(0)
    expect(count(still, 'lead')).toBe(0)
    expect(count(theme, 'strings')).toBe(0)
    // Build and climb: one held bass note, strings on the beat and then twice as fast.
    for (const part of [build, climb]) expect(new Set(part.filter(s => s.chord).map(s => s.chord!.root)).size).toBe(1)
    expect(count(build, 'strings')).toBe(STEPS_PER_SECTION / 4)
    expect(count(climb.slice(0, 96), 'strings')).toBe(48)
    expect(climb[96].riser).toBe(24)
    expect(count(climb.slice(112, 120), 'snare')).toBe(8)
    // The breath: nothing but the hall for the last half bar.
    expect(climb[120].breath).toBe(true)
    for (const key of ['arp', 'bass', 'kick', 'snare', 'lead', 'strings', 'pluck'] as const) expect(count(climb.slice(120), key), key).toBe(0)
    // The release: a minor third up, in the major, with everything.
    expect(release[0].impact).toBe(true)
    expect(release[0].chord!.tonic).toBe((home + 3) % 12)
    expect(release[0].chord!.mode).toBe('major')
    expect(release[0].bell?.velocity).toBe(1)
    expect(count(release, 'brass')).toBe(count(release, 'lead'))
    expect(count(release, 'kick')).toBe(8)
    expect(steps[0].impact).toBeUndefined()
    // The afterglow stays in the major; the next theme falls back to the minor of the new home.
    expect(afterglow[0].chord!.mode).toBe('major')
    expect(count(afterglow, 'lead')).toBe(6)
    const next = run(11, cruise, STEPS_PER_SECTION * 7).steps[6 * STEPS_PER_SECTION].chord!
    expect(next.mode).toBe('aeolian'); expect(next.tonic).toBe((home + 3) % 12)
  })

  it('plays the same theme every time it comes round, and an octave up in the release', () => {
    const { c, steps } = run(11, cruise, STEPS_PER_SECTION * 11)
    expect(c.theme).toHaveLength(4)
    const shape = (n: number) => steps.slice(n * STEPS_PER_SECTION, (n + 1) * STEPS_PER_SECTION).map((s, at) => s.lead ? `${at}:${s.lead.steps}` : '').filter(Boolean)
    // The release states all four phrases; the theme states the first and third of the same.
    const odd = (at: string) => Math.floor(Number(at.split(':')[0]) / STEPS_PER_CHORD) % 2 === 0
    expect(shape(4).filter(odd)).toEqual(shape(0))
    expect(shape(6)).toEqual(shape(0))
    expect(shape(10).filter(odd)).toEqual(shape(0))
    const lowest = (n: number) => Math.min(...steps.slice(n * STEPS_PER_SECTION, (n + 1) * STEPS_PER_SECTION).filter(s => s.lead).map(s => s.lead!.midi))
    expect(lowest(4)).toBeGreaterThanOrEqual(65 + 12)
    expect(lowest(0)).toBeLessThan(65 + 12)
    // The third phrase is the top of the theme.
    const top = (phrase: number) => Math.max(...c.theme[phrase].map(note => note.offset))
    expect(top(2)).toBe(top(0) + 2)
  })

  it('a dark mood keeps its release in the minor, and a surge reaches it in two bars', () => {
    const c = new Composer(3)
    for (let i = 0; i < 20; i++) c.step(fight)
    c.cue('surge')
    const steps = Array.from({ length: 33 }, () => c.step(fight))
    expect(c.role).toBe('release')
    expect(steps[0].riser).toBe(24); expect(steps[0].chord).toBeDefined()
    expect(steps[24].breath).toBe(true)
    expect(steps[32].impact).toBe(true)
    expect(steps[32].chord!.mode).toBe('phrygian')
    // A turn of mood during a release must not lift the key a second time.
    const key = steps[32].chord!.tonic
    const after = Array.from({ length: 64 }, () => c.step(cruise)).filter(s => s.chord)
    expect(after.every(s => s.chord!.tonic === key)).toBe(true)
    expect(c.role).toBe('release')
  })

  it('lets the terrain ahead draw the sequencer line', () => {
    const notes = (c: Composer) => Array.from({ length: 16 }, () => c.step(cruise)).filter(s => s.arp).map(s => s.arp!.midi)
    const plain = new Composer(9), climbing = new Composer(9), flat = new Composer(9)
    climbing.setContour(Array.from({ length: 16 }, (_, i) => i * 5))
    flat.setContour(Array(16).fill(20))
    const rising = notes(climbing)
    // A steady climb ahead is a line that never falls.
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThanOrEqual(rising[i - 1])
    expect(rising[rising.length - 1]).toBeGreaterThan(rising[0])
    // Flat ground gives the line back to the composer.
    expect(notes(flat)).toEqual(notes(plain))
    climbing.setContour(null)
    expect(climbing.tone(0, 72)).toBeGreaterThanOrEqual(72); expect(climbing.tone(0, 72)).toBeLessThan(84)
    expect(climbing.tone(3, 72)).toBe(climbing.tone(0, 72) + 12)
  })

  it('suspends the third of every second chord and resolves it a bar later', () => {
    const { steps } = run(5, cruise, STEPS_PER_SECTION)
    for (const at of [32, 96]) {
      const chord = steps[at].chord!, resolved = steps[at + 16].resolve!
      expect(resolved).toHaveLength(4)
      expect(resolved.filter((midi, voice) => midi !== chord.pad[voice])).toHaveLength(1)
      expect(Math.abs(resolved[1] - chord.pad[1]) % 12).toBeLessThanOrEqual(2)
    }
    expect(steps[16].resolve).toBeUndefined()
  })

  it('turns dark within one chord of a fight starting', () => {
    const c = new Composer(21)
    for (let i = 0; i < 40; i++) c.step(cruise)
    expect(c.mode).toBe('aeolian')
    const next = Array.from({ length: STEPS_PER_CHORD }, () => c.step(fight))
    const turn = next.find(step => step.chord)
    expect(turn?.chord?.mode).toBe('phrygian')
    expect(turn?.impact).toBe(true)
  })

  it('does not flap between modes on a boundary', () => {
    expect(modeFor(0.51, 1)).toBe(1)
    expect(modeFor(0.49, 2)).toBe(2)
    expect(modeFor(0.6, 1)).toBe(2)
    expect(modeFor(0.1, 3)).toBe(0)
    expect(modeFor(Number.NaN, 2)).toBe(0)
  })

  it('maps mood to bounded layer levels', () => {
    for (const mood of [calm, cruise, fight, { intensity: 9, lift: -2, darkness: Number.NaN, triumph: 4 }]) {
      const level = levels(mood)
      for (const [name, value] of Object.entries(level)) if (name !== 'bpm') { expect(value, name).toBeGreaterThanOrEqual(0); expect(value, name).toBeLessThanOrEqual(1) }
      expect(level.bpm).toBeGreaterThanOrEqual(60); expect(level.bpm).toBeLessThanOrEqual(100)
    }
    expect(levels(calm).drums).toBe(0)
    expect(levels(fight).drive).toBeGreaterThan(0.9)
    expect(levels({ ...calm, lift: 1 }).choir).toBe(1)
  })
})
