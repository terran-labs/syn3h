/**
 * The live sea state: the wave set for the current world and sliders, and its phases at the
 * current shared time. The physics (through `terrain.liquidHeightAt`) and the sea material
 * both read this one object, so what floats and what is drawn cannot drift apart.
 */
import { worldGravity } from '../../../shared/params'
import { WAVE_COUNT, buildWaves, shoalFactor, wavePhases, waveOffset, waveSlope, waveVerticalSpeed, type WaveComponent, type WaveSet } from '../../../shared/water/waves'
import { prevailingWindHeading, prevailingWindStrength, weatherTime } from '../weather'
import { waterWaveHeight, waterWaveLength, waterWaves, waterWaveTurn } from './params'

/**
 * Sea grid lines per tile side; terrain/volcanics.ts builds the sea mesh from it.
 *
 * It decides which swells are real. A wave needs four grid spacings to be drawn, and only
 * drawn waves lift vehicles (see `minGeometricLength`). At 192 a two kilometre tile had a
 * vertex every 10.7 m, so of the five components only the 60 m swell moved the surface:
 * 40 per cent of the wave height, the rest was lighting. At 384 (5.3 m) the 37 m and 26 m
 * waves are geometry too, 80 per cent, and the sea visibly rolls under the hull. Cost: 148
 * thousand sea vertices a tile instead of 37 thousand, culled by chunk.
 */
export const SEA_GRID = 384

/**
 * The sea follows the room's prevailing wind, which turns slowly. Wave vectors must fit the
 * tile, so they cannot turn smoothly themselves; instead the sea is two fans of waves, each
 * built for the wind's heading at a whole multiple of FAN_SECONDS of weather time, and the
 * sea crossfades from one to the next over that interval. The mix is a pure function of the
 * shared clocks, so every client and the physics see the same sea, and nothing ever steps.
 */
export const FAN_SECONDS = 20
/** Components the sea material evaluates: both fans. */
export const SEA_COMPONENTS = WAVE_COUNT * 2
/**
 * Swell remains without local wind (it comes from distant storms), so calm air keeps 60 per
 * cent of the slider's height; a full gale gives all of it. At 35 per cent a calm sea was too
 * flat to see or feel.
 */
const CALM_SWELL = 0.6

/**
 * Seconds on the clock every client shares. Defaults to the game's simulated time, which is
 * right in single player. Networking replaces it with the server clock so every client's sea
 * shows the same crest at the same moment (`setWaterClock`).
 */
let clock: () => number = () => 0
let previous: (() => number) | null = null
let switchedAt = -Infinity
/** Seconds to calm the sea before a clock change and to raise it after: half each. */
export const CLOCK_SWITCH_SECONDS = 1.2
const wall = () => (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000

/**
 * Change the clock the sea follows. The two clocks disagree by however long this client has
 * been running, so switching outright would jump every crest at once and jolt anything afloat.
 * Instead the swell calms to nothing on the old clock, the clock changes while the sea is
 * flat, and the swell rises again on the new one (`waveScale`).
 */
export function setWaterClock(fn: () => number): void {
  previous = clock
  clock = fn
  switchedAt = wall()
}
export function waterTime(): number {
  const since = wall() - switchedAt
  return previous && since < CLOCK_SWITCH_SECONDS / 2 ? previous() : clock()
}
/** 1 normally; eases to 0 and back to 1 across a clock change. Smoothstep each way. */
export function waveScale(): number {
  const x = Math.min(1, Math.abs(wall() - switchedAt - CLOCK_SWITCH_SECONDS / 2) / (CLOCK_SWITCH_SECONDS / 2))
  return x * x * (3 - 2 * x)
}

class SeaWaves {
  private key = ''
  private readonly fans = new Map<number, WaveSet>()
  private readonly merged: WaveSet = { components: [], amplitude: 0, dominantLength: 60 }
  private mergedAt = Number.NaN
  private phases: number[] = []
  private phaseTime = Number.NaN
  private tileSize = 2048
  private seed = 0

  /** Called when a world is built: the tile width and seed fix the wave vectors and phases. */
  configure(tileSize: number, seed: number): void {
    this.tileSize = tileSize
    this.seed = seed
    this.key = ''
  }

  /** True when the new sea is on. */
  get enabled(): boolean {
    return waterWaves.value
  }

  /** The fan built for the wind heading at weather time k * FAN_SECONDS. */
  private fan(k: number): WaveSet {
    let set = this.fans.get(k)
    if (!set) {
      set = buildWaves({
        tileSize: this.tileSize,
        height: waterWaveHeight.value,
        length: waterWaveLength.value,
        direction: prevailingWindHeading(k * FAN_SECONDS) + waterWaveTurn.value,
        gravity: worldGravity.value,
        seed: this.seed,
        // Every component lifts on every planet: the sea is drawn with a camera-following
        // mesh fine enough for each of them (see liquidWaves.ts, isActiveWaveComponent).
        minGeometricLength: 0,
      })
      this.fans.set(k, set)
      // Keep only the fans in use and the next one.
      for (const old of this.fans.keys()) if (old < k - 1) this.fans.delete(old)
    }
    return set
  }

  /**
   * The current sea: both fans with their crossfade weights and the wind's strength folded
   * into the amplitudes, as one list of SEA_COMPONENTS components.
   */
  get waves(): WaveSet {
    const key = `${this.tileSize}|${this.seed}|${waterWaveHeight.value}|${waterWaveLength.value}|${waterWaveTurn.value}|${worldGravity.value}`
    if (key !== this.key) {
      this.key = key
      this.fans.clear()
      this.mergedAt = Number.NaN
      this.phaseTime = Number.NaN
    }
    const tw = weatherTime()
    if (tw === this.mergedAt) return this.merged
    this.mergedAt = tw
    const k = Math.floor(tw / FAN_SECONDS)
    const f = tw / FAN_SECONDS - k
    const s = f * f * (3 - 2 * f)
    const wind = CALM_SWELL + (1 - CALM_SWELL) * prevailingWindStrength()
    const a = this.fan(k)
    const b = this.fan(k + 1)
    const out = this.merged.components
    let total = 0
    for (let i = 0; i < SEA_COMPONENTS; i++) {
      const from: WaveComponent = i < WAVE_COUNT ? a.components[i] : b.components[i - WAVE_COUNT]
      const weight = (i < WAVE_COUNT ? 1 - s : s) * wind
      const c = (out[i] ??= { ...from })
      Object.assign(c, from)
      c.amplitude = from.amplitude * weight
      if (!c.lightOnly) total += c.amplitude
    }
    this.merged.amplitude = total
    this.merged.dominantLength = a.dominantLength
    // Fans change their phases' frequencies: recompute phases for this sea.
    this.phaseTime = Number.NaN
    return this.merged
  }

  /** Phases at the shared time now. Recomputed once per distinct time. */
  phasesNow(): readonly number[] {
    const set = this.waves
    const t = waterTime()
    if (t !== this.phaseTime) {
      wavePhases(set, t, this.phases)
      this.phaseTime = t
    }
    return this.phases
  }

  /**
   * Height of the sea surface above `level` at (x, z), given the ground height there: the
   * deep water displacement scaled down in the shallows. 0 when the waves are off.
   */
  offsetAt(x: number, z: number, ground: number, level: number): number {
    if (!waterWaves.value) return 0
    const set = this.waves
    if (set.amplitude <= 0) return 0
    return waveScale() * shoalFactor(level - ground, set.dominantLength) * waveOffset(set, this.phasesNow(), x, z)
  }

  /** Vertical speed of the surface at (x, z), m/s, shoaled like the height. */
  verticalSpeedAt(x: number, z: number, ground: number, level: number): number {
    if (!waterWaves.value) return 0
    const set = this.waves
    return waveScale() * shoalFactor(level - ground, set.dominantLength) * waveVerticalSpeed(set, this.phasesNow(), x, z)
  }

  /** Surface slope in deep water (dh/dx, dh/dz), every component. */
  slopeAt(x: number, z: number, out = { x: 0, z: 0 }): { x: number; z: number } {
    if (!waterWaves.value) {
      out.x = 0
      out.z = 0
      return out
    }
    waveSlope(this.waves, this.phasesNow(), x, z, out)
    const k = waveScale()
    out.x *= k
    out.z *= k
    return out
  }
}

/** The one sea state. */
export const seaWaves = new SeaWaves()
