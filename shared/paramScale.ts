/** Presentation mapping only. Registry, saved and network values stay in their original units. */
import type { ParamDef } from './params'
export type ScaleDef = Pick<ParamDef, 'min' | 'max' | 'step' | 'scale' | 'logMin' | 'stops' | 'unit' | 'zeroLabel'>
const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value))
function bounds(def: ScaleDef) {
  const lo = Math.min(def.min ?? 0, def.max ?? 1), hi = Math.max(def.min ?? 0, def.max ?? 1)
  const floor = lo > 0 ? lo : Math.min(hi, def.logMin ?? (def.step && def.step > 0 ? def.step : hi / 1000))
  return { lo, hi, floor, zero: lo === 0 ? 0.05 : 0, log: def.scale === 'log' && lo >= 0 && hi > floor && floor > 0 }
}
/** The first 5% reserves Off. Exact typed values below the log floor still have a position. */
export function valueToPosition(def: ScaleDef, value: number): number {
  const { lo, hi, floor, zero, log } = bounds(def)
  if (!log) return hi === lo ? 0 : clamp((value - lo) / (hi - lo))
  if (zero && value < floor) return zero * clamp(value / floor)
  return clamp(zero + (1 - zero) * Math.log(Math.max(floor, value) / floor) / Math.log(hi / floor))
}
/** Continuous inverse. Snapping is deliberately separate so exact stored values round-trip. */
export function positionToValue(def: ScaleDef, position: number): number {
  const { lo, hi, floor, zero, log } = bounds(def), at = clamp(position)
  if (!log) return lo + at * (hi - lo)
  if (zero && at < zero) return floor * at / zero
  return floor * (hi / floor) ** ((at - zero) / (1 - zero))
}
export function sliderStops(def: ScaleDef): number[] {
  const { lo, hi, floor, log } = bounds(def)
  if (!log) return []
  const values = def.stops ? [...def.stops] : []
  if (!def.stops) for (let power = Math.floor(Math.log10(floor)); power <= Math.ceil(Math.log10(hi)); power++) {
    for (const n of [1, 1.5, 2, 3, 5, 7.5]) values.push(n * 10 ** power)
  }
  return [...new Set([...(lo === 0 ? [0] : []), floor, ...values.filter(v => Number.isFinite(v) && v >= floor && v <= hi), hi])].sort((a, b) => a - b)
}
export function snapPosition(def: ScaleDef, position: number): number {
  const stops = sliderStops(def)
  if (!stops.length) return positionToValue(def, position)
  return stops.reduce((best, next) => Math.abs(valueToPosition(def, next) - position) < Math.abs(valueToPosition(def, best) - position) ? next : best)
}
export function stepValue(def: ScaleDef, value: number, direction: -1 | 1): number {
  const stops = sliderStops(def)
  return direction > 0 ? stops.find(stop => stop > value + 1e-9) ?? stops.at(-1) ?? value : [...stops].reverse().find(stop => stop < value - 1e-9) ?? stops[0] ?? value
}
export function formatScaledValue(def: ScaleDef, value: number): string {
  if (value === 0 && def.zeroLabel) return def.zeroLabel
  if (def.unit !== 'seconds') return String(value)
  const seconds = Math.round(value), minutes = Math.floor(seconds / 60), remainder = seconds % 60
  return [minutes ? `${minutes} min` : '', remainder || !minutes ? `${remainder} s` : ''].filter(Boolean).join(' ')
}
export function scaleCaption(def: ScaleDef): string {
  const { floor, hi, zero } = bounds(def)
  return `${zero ? `${def.zeroLabel ?? 'Off'}, then ` : ''}${formatScaledValue(def, floor)} to ${formatScaledValue(def, hi)}, log scale`
}
