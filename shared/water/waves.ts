/**
 * Sea waves: one definition for the physics, the shader and every client.
 *
 * The sea surface is the sea level plus a short sum of sine swells:
 *
 *   h(x, z, t) = level + shoal(depth) * sum_i a_i sin(k_i . (x, z) + phase_i(t))
 *
 * Why sines and not Gerstner waves: a Gerstner wave moves the water sideways as well as up,
 * so the height at a fixed point needs an iterative solve, and a physics solve and a vertex
 * shader that disagree by a few centimetres make floating vehicles bob out of step with the
 * water you see. A sum of sines gives the height at a point directly, so the TypeScript here
 * and the TSL in the sea material are the same formula.
 *
 * Mathematically true, not tuned:
 *  - Every wave vector is 2 pi (m, n) / tileSize for whole numbers m and n, so each wave
 *    repeats exactly at the tile's width and the sea has no seam on a wrapping planet.
 *  - Each wave travels at the deep water dispersion speed, omega = sqrt(g |k|), with g the
 *    world's gravity: long swells outrun short chop, as on a real sea.
 *  - Waves shoal: they die away in the shallows over a depth of about a tenth of their
 *    wavelength (stylised; real shoaling steepens before it breaks).
 *
 * Phases are reduced modulo 2 pi here in double precision, so the shader never sees a large
 * time value (float32 would lose the phase within hours of server uptime).
 *
 * Pure: no browser, no registry. The server could compute the same sea.
 */

/** The most a crest can rise above sea level, in metres, at the wave height slider's maximum. */
export const WAVE_MAX_AMPLITUDE = 1.5
/** The wave height slider's maximum: crest to trough, metres. */
export const WAVE_MAX_HEIGHT = WAVE_MAX_AMPLITUDE * 2
/** Number of sine components. Fixed so the shader has a fixed shape. */
export const WAVE_COUNT = 5

/** Wavelength of each component as a fraction of the dominant wavelength. */
const LENGTH_RATIO = [1, 0.61, 0.43, 0.29, 0.19]
/** Direction of each component relative to the wind, radians. */
const ANGLE = [0, 0.42, -0.33, 0.78, -0.69]
/**
 * Relative amplitude of each component before normalising. Steepness (a k) is kept roughly
 * equal across components, the shape of a wind sea, so the short chop is low.
 */
const WEIGHT = LENGTH_RATIO.map((r) => r)

export interface WaveSettings {
  /** Tile width in metres; every wave repeats at it. */
  tileSize: number
  /** Crest to trough height of the largest possible sum, metres (0 = flat sea). */
  height: number
  /** Dominant wavelength, metres. */
  length: number
  /** Wind direction the waves travel toward, radians from +x toward +z. */
  direction: number
  /** Gravity, m/s^2. */
  gravity: number
  /** A seed for the starting phases, so two worlds' seas differ. */
  seed: number
  /**
   * Shortest wave the sea mesh can carry as geometry, metres (four grid spacings). Shorter
   * components only shade the surface: they are left out of the height so a floating
   * vehicle rides the same surface that is drawn. 0 keeps every component as geometry.
   */
  minGeometricLength?: number
}

export interface WaveComponent {
  kx: number
  kz: number
  amplitude: number
  /** Angular frequency, radians per second. */
  omega: number
  /** Phase at t = 0, radians. */
  phase0: number
  /** Actual wavelength after snapping to the tile, metres. */
  length: number
  /** True when the mesh is too coarse to carry this wave: it shades but does not lift. */
  lightOnly: boolean
}

export interface WaveSet {
  components: WaveComponent[]
  /** Sum of geometric amplitudes: the highest a crest can reach above the level in deep water. */
  amplitude: number
  /** The dominant wavelength asked for, metres; sets how far into the shallows waves reach. */
  dominantLength: number
}

const TAU = Math.PI * 2

/** A small integer hash to a phase in [0, 2 pi). */
function phaseFromSeed(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return (h / 0x100000000) * TAU
}

/**
 * Build the wave components. Each wanted wave vector is snapped to the nearest one that
 * fits the tile a whole number of times; two components never share a vector.
 */
export function buildWaves(s: WaveSettings): WaveSet {
  const components: WaveComponent[] = []
  const used = new Set<string>()
  const weightSum = WEIGHT.reduce((a, b) => a + b, 0)
  const height = Math.max(0, Math.min(WAVE_MAX_HEIGHT, s.height))
  for (let i = 0; i < WAVE_COUNT; i++) {
    const wanted = Math.max(1, s.length * LENGTH_RATIO[i])
    const angle = s.direction + ANGLE[i]
    let m = Math.round((s.tileSize / wanted) * Math.cos(angle))
    let n = Math.round((s.tileSize / wanted) * Math.sin(angle))
    if (m === 0 && n === 0) m = 1
    // Nudge off a duplicate so two components do not add into one doubled wave.
    while (used.has(`${m},${n}`)) Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) ? (m += Math.sign(m) || 1) : (n += Math.sign(n) || 1)
    used.add(`${m},${n}`)
    const kx = (TAU * m) / s.tileSize
    const kz = (TAU * n) / s.tileSize
    const k = Math.hypot(kx, kz)
    components.push({
      kx,
      kz,
      amplitude: (height / 2) * (WEIGHT[i] / weightSum),
      omega: Math.sqrt(Math.max(0, s.gravity) * k),
      phase0: phaseFromSeed(s.seed, i),
      length: TAU / k,
      lightOnly: TAU / k < (s.minGeometricLength ?? 0),
    })
  }
  return { components, amplitude: components.reduce((a, c) => a + (c.lightOnly ? 0 : c.amplitude), 0), dominantLength: Math.max(1, s.length) }
}

/**
 * Phase of each component at time t (seconds on the shared clock), reduced to [0, 2 pi).
 * Waves travel along +k: sin(k . x - omega t + phase0).
 */
export function wavePhases(set: WaveSet, t: number, out: number[] = []): number[] {
  for (let i = 0; i < set.components.length; i++) {
    const c = set.components[i]
    const p = (c.phase0 - c.omega * t) % TAU
    out[i] = p < 0 ? p + TAU : p
  }
  out.length = set.components.length
  return out
}

/**
 * How much of the wave survives at a given water depth: none on the shore, all of it once
 * the water is a tenth of the dominant wavelength deep. Smoothstep, as in the shader.
 */
export function shoalFactor(depth: number, dominantLength: number): number {
  const full = Math.max(0.5, dominantLength * 0.1)
  const x = Math.min(1, Math.max(0, depth / full))
  return x * x * (3 - 2 * x)
}

/**
 * Wave displacement above the level at (x, z) in deep water, given phases from `wavePhases`.
 * Geometric components only: this is the drawn surface.
 */
export function waveOffset(set: WaveSet, phases: readonly number[], x: number, z: number): number {
  let h = 0
  for (let i = 0; i < set.components.length; i++) {
    const c = set.components[i]
    if (c.lightOnly) continue
    h += c.amplitude * Math.sin(c.kx * x + c.kz * z + phases[i])
  }
  return h
}

/** Slope of the deep water displacement, dh/dx and dh/dz, all components (as the shading sees it). */
export function waveSlope(set: WaveSet, phases: readonly number[], x: number, z: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = 0
  out.z = 0
  for (let i = 0; i < set.components.length; i++) {
    const c = set.components[i]
    const d = c.amplitude * Math.cos(c.kx * x + c.kz * z + phases[i])
    out.x += d * c.kx
    out.z += d * c.kz
  }
  return out
}

/** Vertical velocity of the surface at (x, z): what a floating thing is pushed with. */
export function waveVerticalSpeed(set: WaveSet, phases: readonly number[], x: number, z: number): number {
  let v = 0
  for (let i = 0; i < set.components.length; i++) {
    const c = set.components[i]
    if (c.lightOnly) continue
    v -= c.amplitude * c.omega * Math.cos(c.kx * x + c.kz * z + phases[i])
  }
  return v
}
