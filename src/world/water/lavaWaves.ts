/**
 * Lava's slow, heavy swell as a WaveField, until the liquid-feel field lands.
 *
 * The same numbers and formula as phys/liquid-feel's liquidWaves({ liquid: 'lava' })
 * (src/world/water/liquidWaves.ts there: LAVA, RATIO, ANGLE, hash, tile-snapped vectors, time
 * at 0.3x), so the drawn swell does not change when that lands; only this file goes. Replace
 * `lavaWaveSource` with `() => liquidWaves({ kind, liquid: 'lava', frozen: false })` then.
 */
import { worldGravity } from '../../../shared/params'
import { seaWaves, waterTime, waveScale } from './seaWaves'
import type { WaveField, WaveSource } from './surface'

const LAVA = { height: 0.7, length: 16, timeScale: 0.3 }
const RATIO = [1, 0.71, 0.53, 0.38]
const ANGLE = [0, 0.9, -0.7, 2.1]
const TAU = Math.PI * 2
const hash = (i: number) => {
  let h = Math.imul(i + 7, 0x9e3779b1) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000
}

let tileSize = 2048
/** Wave vectors repeat across the tile: set when a world is built. */
export function configureLavaWaves(size: number): void { tileSize = size }

const field: WaveField & { components: { kx: number; kz: number; amplitude: number; phase: number; active: boolean }[] } = { components: [], shoalDepth: 1.6, shoalFloor: 0.35, shoalLip: 0.3 }
let at = Number.NaN

export const lavaWaveSource: WaveSource = () => {
  if (!seaWaves.enabled) return null
  const t = waterTime()
  if (t === at) return field
  at = t
  const sum = RATIO.reduce((a, r) => a + r, 0)
  const k = waveScale()
  for (let i = 0; i < RATIO.length; i++) {
    const c = (field.components[i] ??= { kx: 0, kz: 0, amplitude: 0, phase: 0, active: true })
    const wanted = LAVA.length * RATIO[i]
    const m = Math.round((tileSize / wanted) * Math.cos(ANGLE[i])), n = Math.round((tileSize / wanted) * Math.sin(ANGLE[i]))
    c.kx = (TAU * m) / tileSize
    c.kz = (TAU * n) / tileSize
    c.amplitude = (LAVA.height / 2) * (RATIO[i] / sum) * k
    const omega = Math.sqrt(worldGravity.value * Math.hypot(c.kx, c.kz)) * LAVA.timeScale
    const p = (TAU * hash(i + 11) - omega * t) % TAU
    c.phase = p < 0 ? p + TAU : p
  }
  field.shoalDepth = Math.max(0.5, LAVA.length * 0.1)
  return field
}
