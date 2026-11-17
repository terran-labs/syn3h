// Invariants of the vehicle voices' pitch and of the tyre scrub (src/audio/Engine.ts). Levels
// and spectra are reported by tests/audio/vehicle-voices.mjs; how often the scrub sounds in the
// physics by tests/audio/slip-runs.ts.
import { afterEach, describe, expect, it } from 'vitest'
import { params } from '../../shared/params'
import { SLIP_ALLOW, SLIP_ALLOW_PER_MS, motionMix, scrubGain, slipVoice, voiceProfile } from '../../src/audio/Engine'
import { engineIdle, engineRange, engineVolume, slipVolume } from '../../src/audio/params'

/** Highest fundamental (Hz) any vehicle voice may reach. The buggy's tops out at 415 Hz. */
const PITCH_CEILING = 500
/** Highest centre (Hz) of the scrub's noise band: below the 2 to 5 kHz region where hearing is most sensitive. */
const SCRUB_CEILING = 1500
/** Top speed with a margin: the buggy measures about 102 m/s. */
const TOP = 110
const KINDS = ['buggy-syn3h', 'buggy-classic', 'jet', 'hovercraft', 'tank'] as const
const reset = () => { for (const p of [engineVolume, slipVolume, engineIdle, engineRange]) params.set(p.def.id, p.def.default) }
afterEach(reset)

describe('vehicle voice pitch', () => {
  it('stays under the ceiling at every speed and throttle, at the pitch settings\' extremes too', () => {
    for (const [idle, range] of [[engineIdle.def.default, engineRange.def.default], [engineIdle.def.max!, engineRange.def.max!]]) {
      params.set(engineIdle.def.id, idle); params.set(engineRange.def.id, range)
      for (const kind of KINDS) for (let speed = 0; speed <= TOP; speed += 5) for (const throttle of [0, 0.5, 1, -1]) for (const wings of [false, true]) {
        const pitch = voiceProfile({ kind, speed, throttle, airborne: wings, wings }).pitch
        expect(Number.isFinite(pitch)).toBe(true)
        expect(pitch, `${kind} at ${speed} m/s`).toBeLessThanOrEqual(PITCH_CEILING)
        // A fundamental under 500 Hz means the voice's own oscillators (at most twice it) stay
        // below the sensitive band; only weak upper harmonics reach it.
        expect(motionMix({ kind, speed, throttle, airborne: false }).pitch).toBeLessThanOrEqual(PITCH_CEILING)
      }
    }
  })

  it('does not keep climbing past half of top speed', () => {
    // Faster should sound faster through rush and weight, not a pitch rising without limit.
    for (const kind of KINDS) {
      const at = (speed: number) => voiceProfile({ kind, speed, throttle: 1, airborne: false }).pitch
      expect(12 * Math.log2(at(TOP) / at(TOP / 2)), kind).toBeLessThanOrEqual(1)
    }
  })
})

describe('tyre scrub', () => {
  it('is silent below the slide threshold, and in the air', () => {
    for (let speed = 0; speed <= TOP; speed += 5) {
      const allowed = SLIP_ALLOW + SLIP_ALLOW_PER_MS * speed
      for (const slide of [0, allowed * 0.5, allowed]) expect(slipVoice({ speed, slide, airborne: false }).level).toBe(0)
      expect(slipVoice({ speed, slide: 50, airborne: true }).level).toBe(0)
      expect(slipVoice({ speed, slide: allowed + 30, airborne: false }).level).toBeGreaterThan(0.3)
    }
  })

  it('keeps its band low and its numbers finite on any input', () => {
    for (const speed of [0, 30, 60, 100, NaN, Infinity]) for (const slide of [0, 5, 20, 200, NaN, -5]) for (const surface of [undefined, 'sand', 'rock', 'ice', 'lava?']) {
      const v = slipVoice({ speed, slide, airborne: false, surface })
      for (const x of Object.values(v)) expect(Number.isFinite(x)).toBe(true)
      expect(v.centre).toBeLessThanOrEqual(SCRUB_CEILING)
      expect(v.level).toBeLessThanOrEqual(1)
    }
  })

  it('has its own slider: Engine volume at zero leaves it, and Tyre slip volume at zero leaves the engine', () => {
    const sliding = slipVoice({ speed: 40, slide: 20, airborne: false }).level
    params.set(engineVolume.def.id, 0)
    expect(scrubGain(sliding)).toBeGreaterThan(0)
    expect(motionMix({ speed: 40, throttle: 1, airborne: false }).engine).toBe(0)
    reset(); params.set(slipVolume.def.id, 0)
    expect(scrubGain(sliding)).toBe(0)
    expect(motionMix({ speed: 40, throttle: 1, airborne: false }).engine).toBeGreaterThan(0)
  })
})
