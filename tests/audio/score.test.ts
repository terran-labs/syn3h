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
      const { c, steps } = run(seed, mood, STEPS_PER_SECTION * 3)
      let scale = new Set<number>()
      for (const step of steps) {
        if (step.chord) scale = new Set(MODES[step.chord.mode].map(n => (n + c.tonic) % 12))
        const pitches = [...(step.chord?.pad ?? []), ...(step.chord ? [step.chord.root] : []), step.arp?.midi, step.bass?.midi, step.lead?.midi, step.beep].filter((n): n is number => n !== undefined)
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
    for (const key of ['kick', 'snare', 'hat', 'bass', 'arp', 'riser'] as const) expect(count(quiet, key), key).toBe(0)
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

  it('swells into a new section and lands it with an impact', () => {
    const { steps } = run(11, fight, STEPS_PER_SECTION + 1)
    expect(steps[STEPS_PER_SECTION - 16].riser).toBe(16)
    expect(steps[STEPS_PER_SECTION].impact).toBe(true)
    expect(steps[0].impact).toBeUndefined()
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
