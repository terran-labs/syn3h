/**
 * Units for every speed, height and distance the game shows a player: metric (km/h, metres,
 * kilometres) or imperial (mph, feet, miles). One personal setting drives them all, so the
 * speed and altitude readouts can never disagree (owner, 17 November 2026: mph beside metres
 * was the inconsistency).
 *
 * The default follows the browser's region: imperial where the road signs are (the United
 * States, Liberia, Myanmar), metric everywhere else. A choice the player makes is kept on this
 * device and wins over the region from then on. The setting shows in the sidebar's Me card
 * (group Interface) and in the lobby's Settings, under Controls.
 *
 * The simulation stays in metres and metres per second; only what is shown converts.
 */
import { defineParam, params } from '../../shared/params'

/** Regions whose everyday units are imperial. */
const IMPERIAL_REGIONS: ReadonlySet<string> = new Set(['US', 'LR', 'MM'])

/** Imperial for a locale tag such as "en-US", or a bare "en" (which maximises to the US). */
export function imperialForLocale(tag: string | undefined): boolean {
  if (!tag) return false
  try {
    const locale = new Intl.Locale(tag)
    const region = locale.region ?? locale.maximize().region
    return !!region && IMPERIAL_REGIONS.has(region)
  } catch { return false }
}

const browserLocale = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : undefined

export const METRIC = 0, IMPERIAL = 1
export const displayUnits = defineParam<number>({
  id: 'hud.units', label: 'Units: 0 Metric, 1 Imperial', group: 'Interface', scope: 'client',
  default: imperialForLocale(browserLocale) ? IMPERIAL : METRIC, min: 0, max: 1, step: 1,
})

export const MPH_PER_MPS = 3600 / 1609.344
export const KMH_PER_MPS = 3.6
export const FEET_PER_METRE = 1 / 0.3048
const METRES_PER_MILE = 1609.344

const imperial = (system = displayUnits.value) => Math.round(system) === IMPERIAL

/** A speed in the chosen units, from metres per second; never negative. */
export function speedValue(metresPerSecond: number, system?: number): number {
  const speed = Math.abs(Number.isFinite(metresPerSecond) ? metresPerSecond : 0)
  return speed * (imperial(system) ? MPH_PER_MPS : KMH_PER_MPS)
}
export const speedUnit = (system?: number) => imperial(system) ? 'mph' : 'km/h'

/** A height in the chosen units, from metres. Keeps its sign: below sea level is negative. */
export function heightValue(metres: number, system?: number): number {
  const height = Number.isFinite(metres) ? metres : 0
  return imperial(system) ? height * FEET_PER_METRE : height
}
export const heightUnit = (system?: number) => imperial(system) ? 'ft' : 'm'

/** A whole number as a player reads it: a real minus sign, and never "-0". */
export function wholeNumber(value: number): string {
  const n = Math.round(Number.isFinite(value) ? value : 0)
  return n < 0 ? `−${-n}` : String(n === 0 ? 0 : n)
}

/** A distance to something, from metres: "350 m" or "1.2 km", "900 ft" or "0.4 mi". */
export function distanceText(metres: number, system?: number): string {
  const d = Math.max(0, Number.isFinite(metres) ? metres : 0)
  if (imperial(system)) {
    const feet = d * FEET_PER_METRE
    return feet < 1000 ? `${Math.round(feet)} ft` : `${(d / METRES_PER_MILE).toFixed(1)} mi`
  }
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`
}

const KEY = 'syn3h.units'
/** Restore the player's own choice, then keep it whenever it changes. */
function persist(): void {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'metric' || saved === 'imperial') params.set(displayUnits.def.id, saved === 'imperial' ? IMPERIAL : METRIC, 'preset')
  } catch { /* Storage is optional. */ }
  params.onChange(id => {
    if (id !== displayUnits.def.id) return
    try { localStorage.setItem(KEY, imperial() ? 'imperial' : 'metric') } catch { /* Storage is optional. */ }
  })
}
if (typeof localStorage !== 'undefined') persist()
