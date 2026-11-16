/**
 * Waves on every liquid body: the one description the physics and the renderer both read.
 *
 * A liquid body is the sea, or an inland lake, pool or river, filled with water or lava. Its
 * surface is its rest height plus a short sum of travelling sines:
 *
 *   h(x, z, t) = rest + shoal(depth) * sum_i a_i sin(kx_i x + kz_i z + phase_i(t))
 *
 * `liquidWaves(body)` returns that list of components, with phases taken at the shared
 * `waterTime()`, and the shoaling numbers. `liquidWaveOffset` and `liquidWaveSpeed` evaluate it
 * on the CPU for buoyancy; the renderer fills its uniforms from the same list, so what floats and
 * what is drawn agree everywhere, on every planet size, for every client on the room clock.
 *
 * Which bodies get which waves:
 *  - a water sea: the wind-driven sea swell from `seaWaves` (two crossfading fans of five
 *    components, 36 m dominant), every component lifting, not only those the old sea grid drew.
 *  - a lava sea and any inland lava: slow, low, heavy swells (`LAVA`), no wind.
 *  - inland water (lakes, pools, rivers): a short wind chop (`INLAND`) scaled by the wind.
 *  - a frozen body has no waves and is not liquid at all (see `LiquidBody.frozen`).
 */
import { worldGravity } from '../../../shared/params'
import { seaWaves, waterTime, waveScale } from './seaWaves'
import { prevailingWindStrength } from '../weather'

export type LiquidBodyKind = 'sea' | 'inland'

/** What fills a place and how it behaves. */
export interface LiquidBody {
  kind: LiquidBodyKind
  liquid: 'water' | 'lava'
  /**
   * Frozen solid: ground, not liquid. Buoyancy, waves, splashes and submersion ignore it, and
   * the terrain reports no liquid there (`liquidKindAt` null, `liquidHeightAt` -Infinity). The
   * body that freezes must supply its own collider at the ice surface.
   */
  frozen: boolean
}

export interface LiquidWaveComponent {
  kx: number
  kz: number
  /** Metres. */
  amplitude: number
  /** Radians per second of the shared clock. */
  omega: number
  /** Phase now, radians in [0, 2 pi): sin(kx x + kz z + phase). */
  phase: number
}

export interface LiquidWaveField {
  components: LiquidWaveComponent[]
  /** Water depth (m) at which the waves are whole. */
  shoalDepth: number
  /** Share of the waves left in very shallow water, so the shallows still lap. */
  shoalFloor: number
  /** Depth (m) over which the waves fade to nothing at the waterline itself. */
  shoalLip: number
}

/** Every component lifts. Kept as one function so it can follow what the renderer can draw. */
export const isActiveWaveComponent = (_c: LiquidWaveComponent): boolean => true

/** A body's own swell: crest to trough of the whole sum, dominant length and time scale. */
interface BodyWaves { height: number; length: number; timeScale: number; wind: boolean }
/** Lava: slow, heavy swells. A 16 m swell at 0.3 of water's speed rolls past every 7 s or so. */
export const LAVA: BodyWaves = { height: 0.7, length: 16, timeScale: 0.3, wind: false }
/** Inland water: a short chop that rocks a buggy, from calm to whitecaps with the wind. */
export const INLAND: BodyWaves = { height: 0.6, length: 9, timeScale: 1, wind: true }
const COUNT = 4
const RATIO = [1, 0.71, 0.53, 0.38]
const ANGLE = [0, 0.9, -0.7, 2.1]
/** Calm air keeps this share of wind-driven waves. Matches the sea's calm floor. */
export const CALM_WAVES = 0.6

const TAU = Math.PI * 2
const hash = (i: number) => {
  let h = Math.imul(i + 7, 0x9e3779b1) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000
}

/** Tile width, for wave vectors that repeat across the wrap. Set when a world is built. */
let tileSize = 2048
export function configureLiquidWaves(size: number): void { tileSize = size }

function bodyField(b: BodyWaves, out: LiquidWaveField, t: number): void {
  const sum = RATIO.reduce((a, r) => a + r, 0)
  const wind = b.wind ? CALM_WAVES + (1 - CALM_WAVES) * prevailingWindStrength() : 1
  const g = worldGravity.value
  for (let i = 0; i < COUNT; i++) {
    const c = (out.components[i] ??= { kx: 0, kz: 0, amplitude: 0, omega: 0, phase: 0 })
    const wanted = b.length * RATIO[i]
    // Snap the wave vector to the tile so the surface has no seam on a wrapping planet.
    const m = Math.round((tileSize / wanted) * Math.cos(ANGLE[i])), n = Math.round((tileSize / wanted) * Math.sin(ANGLE[i]))
    c.kx = (TAU * m) / tileSize
    c.kz = (TAU * n) / tileSize
    c.amplitude = (b.height / 2) * (RATIO[i] / sum) * wind
    c.omega = Math.sqrt(g * Math.hypot(c.kx, c.kz)) * b.timeScale
    const p = (TAU * hash(i + (b === LAVA ? 11 : 0)) - c.omega * t) % TAU
    c.phase = p < 0 ? p + TAU : p
  }
  out.components.length = COUNT
  out.shoalDepth = Math.max(0.5, b.length * 0.1)
  out.shoalFloor = 0.35
  out.shoalLip = 0.3
}

const fields = { sea: newField(), lava: newField(), inland: newField() }
const at = { sea: Number.NaN, lava: Number.NaN, inland: Number.NaN }
function newField(): LiquidWaveField { return { components: [], shoalDepth: 3.6, shoalFloor: 0.35, shoalLip: 0.3 } }

/**
 * The waves on a body now: components with their phases at `waterTime()`, amplitudes already
 * scaled by the wind and the clock-change fade, and the shoaling numbers. Recomputed once per
 * distinct time; the returned object is reused, so copy what you keep.
 */
export function liquidWaves(body: LiquidBody): LiquidWaveField {
  const which = body.frozen ? null : body.liquid === 'lava' ? 'lava' : body.kind === 'sea' ? 'sea' : 'inland'
  if (!which || !seaWaves.enabled) return EMPTY
  const t = waterTime()
  if (at[which] === t) return fields[which]
  at[which] = t
  const out = fields[which]
  if (which === 'sea') {
    const set = seaWaves.waves, phases = seaWaves.phasesNow(), k = waveScale()
    for (let i = 0; i < set.components.length; i++) {
      const s = set.components[i], c = (out.components[i] ??= { kx: 0, kz: 0, amplitude: 0, omega: 0, phase: 0 })
      c.kx = s.kx; c.kz = s.kz; c.amplitude = s.amplitude * k; c.omega = s.omega; c.phase = phases[i]
    }
    out.components.length = set.components.length
    out.shoalDepth = Math.max(0.5, set.dominantLength * 0.1)
    out.shoalFloor = 0.35
    out.shoalLip = 0.3
  } else {
    bodyField(which === 'lava' ? LAVA : INLAND, out, t)
    const k = waveScale()
    for (const c of out.components) c.amplitude *= k
  }
  return out
}
const EMPTY: LiquidWaveField = { components: [], shoalDepth: 1, shoalFloor: 0, shoalLip: 0.3 }

/** Smoothstep. */
const smooth = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u) }

/** Share of the waves at water `depth`: nothing at the waterline, a lapping floor, whole when deep. */
export function liquidShoal(f: LiquidWaveField, depth: number): number {
  if (!(depth > 0)) return 0
  return smooth(0, f.shoalLip, depth) * (f.shoalFloor + (1 - f.shoalFloor) * smooth(0, f.shoalDepth, depth))
}

/** Wave height above the body's rest height at (x, z) where the water is `depth` deep at rest. */
export function liquidWaveOffset(body: LiquidBody, x: number, z: number, depth: number): number {
  const f = liquidWaves(body)
  const s = liquidShoal(f, depth)
  if (s <= 0) return 0
  let h = 0
  for (const c of f.components) if (isActiveWaveComponent(c)) h += c.amplitude * Math.sin(c.kx * x + c.kz * z + c.phase)
  return s * h
}

/** Vertical speed of the surface (m/s) at (x, z), shoaled like the height. */
export function liquidWaveSpeed(body: LiquidBody, x: number, z: number, depth: number): number {
  const f = liquidWaves(body)
  const s = liquidShoal(f, depth)
  if (s <= 0) return 0
  let v = 0
  for (const c of f.components) if (isActiveWaveComponent(c)) v -= c.amplitude * c.omega * Math.cos(c.kx * x + c.kz * z + c.phase)
  return s * v
}
