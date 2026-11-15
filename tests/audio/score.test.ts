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
        const pitches = [...(step.chord?.pad ?? []), ...(step.resolve ?? []), ...(step.chord ? [step.chord.root] : []), step.arp?.midi, step.bass?.midi, step.lead?.midi, step.beep].filter((n): n is number => n !== undefined)
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

  it('follows the arc: theme, still, build, breath, then a release a minor third up', () => {
    const { c, steps } = run(11, fight, STEPS_PER_SECTION * 4), home = steps[0].chord!.tonic
    const section = (n: number) => steps.slice(n * STEPS_PER_SECTION, (n + 1) * STEPS_PER_SECTION)
    expect(count(section(0), 'lead')).toBeGreaterThan(0)
    expect(count(section(1), 'lead')).toBe(0)
    // The build: a held bass note, one swell, then nothing but the hall for the last half bar.
    const build = section(2), roots = new Set(build.filter(s => s.chord).map(s => s.chord!.root))
    expect(roots.size).toBe(1)
    expect(build[96].riser).toBe(24)
    expect(build[120].breath).toBe(true)
    for (const key of ['arp', 'bass', 'kick', 'snare', 'lead'] as const) expect(count(build.slice(120), key), key).toBe(0)
    // The release.
    const release = section(3)
    expect(release[0].impact).toBe(true)
    expect(release[0].chord!.tonic).toBe((home + 3) % 12)
    expect(steps[0].impact).toBeUndefined()
    expect(Math.min(...release.filter(s => s.lead).map(s => s.lead!.midi))).toBeGreaterThanOrEqual(65 + 12)
    expect(c.role).toBe('release')
    // A quiet mood still gets its swell and its arrival.
    const quiet = run(11, calm, STEPS_PER_SECTION * 3 + 1).steps
    expect(quiet[2 * STEPS_PER_SECTION + 96].riser).toBe(24)
    expect(quiet[3 * STEPS_PER_SECTION].impact).toBe(true)
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
