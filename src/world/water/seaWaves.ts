/**
 * The live sea state: the wave set for the current world and sliders, and its phases at the
 * current shared time. The physics (through `terrain.liquidHeightAt`) and the sea material
 * both read this one object, so what floats and what is drawn cannot drift apart.
 */
import { worldGravity } from '../../../shared/params'
import { buildWaves, shoalFactor, wavePhases, waveOffset, waveSlope, waveVerticalSpeed, type WaveSet } from '../../../shared/water/waves'
import { windX, windZ } from '../../fx/params'
import { waterWaveHeight, waterWaveLength, waterWaves, waterWaveTurn } from './params'

/** Sea grid lines per tile side; must match SEA_SEGMENTS in terrain/volcanics.ts. */
export const SEA_GRID = 192

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
  private set: WaveSet | null = null
  private key = ''
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

  /** The current wave set, rebuilt when a slider moves. */
  get waves(): WaveSet {
    const direction = Math.atan2(windZ.value, windX.value) + waterWaveTurn.value
    const key = `${this.tileSize}|${this.seed}|${waterWaveHeight.value}|${waterWaveLength.value}|${direction}|${worldGravity.value}`
    if (!this.set || key !== this.key) {
      this.key = key
      this.set = buildWaves({
        tileSize: this.tileSize,
        height: waterWaveHeight.value,
        length: waterWaveLength.value,
        direction,
        gravity: worldGravity.value,
        seed: this.seed,
        // Four sea grid spacings: the shortest wave the mesh can draw without aliasing.
        minGeometricLength: (4 * this.tileSize) / SEA_GRID,
      })
      this.phaseTime = Number.NaN
    }
    return this.set
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
