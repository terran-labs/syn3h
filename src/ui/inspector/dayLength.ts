/**
 * The World card's day length control. The setting (`sun.dayLength`) stores seconds, 0 for a
 * stopped clock and ORBIT_DEFAULT to follow the planet's orbit (src/world/sky/dayCycle.ts).
 * The slider is logarithmic, so twenty seconds and an hour are both a short drag apart: its
 * first sliver stops the clock, and the rest runs from DAY_SLIDER_MIN to DAY_SLIDER_MAX.
 * Released on the planet's own day, it goes back to following the orbit.
 *
 * The mapping is pure and tested; the row is plain DOM in the inspector's style.
 */
import { params } from '../../../shared/params'
import { ORBIT_DEFAULT, effectiveDayLength, planetDayLength } from '../../world/sky/dayCycle'
import { currentPlanet } from '../../world/planets'

export const DAY_SLIDER_MIN = 20, DAY_SLIDER_MAX = 3600
/** The share of the track before the log scale starts: "stopped". */
const STOP_BAND = 0.05
/** Tidy places the slider settles on, in seconds. The planet's own day is added to them. */
export const DAY_STOPS: readonly number[] = [20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480, 540, 600, 720, 900, 1200, 1800, 2700, 3600]

/** Slider position, 0 to 1, for a day length in seconds (0 or less: stopped). */
export function dayToPosition(seconds: number): number {
  if (!(seconds > 0)) return 0
  const at = Math.log(Math.max(DAY_SLIDER_MIN, seconds) / DAY_SLIDER_MIN) / Math.log(DAY_SLIDER_MAX / DAY_SLIDER_MIN)
  return Math.min(1, STOP_BAND + (1 - STOP_BAND) * at)
}
/**
 * The setting a slider position means: the nearest tidy stop, 0 in the first sliver, and
 * ORBIT_DEFAULT when the nearest stop is the planet's own day.
 */
export function positionToSetting(position: number, orbitDay: number): number {
  if (!(position >= STOP_BAND / 2)) return 0
  let best = DAY_STOPS[0], gap = Infinity
  for (const stop of [...DAY_STOPS, orbitDay]) {
    const d = Math.abs(dayToPosition(stop) - position)
    if (d < gap || (d === gap && stop === orbitDay)) { best = stop; gap = d }
  }
  return best === orbitDay ? ORBIT_DEFAULT : best
}
/** The next stop up or down from a setting, for the arrow keys. */
export function stepSetting(setting: number, orbitDay: number, direction: 1 | -1): number {
  const stops = [0, ...new Set([...DAY_STOPS, orbitDay])].sort((a, b) => a - b)
  const now = setting < 0 ? orbitDay : setting
  const next = direction > 0 ? stops.find(s => s > now + 1e-9) ?? stops.at(-1)! : [...stops].reverse().find(s => s < now - 1e-9) ?? 0
  return next === orbitDay ? ORBIT_DEFAULT : next
}
/** A day length as the card shows it: "5.0 min", "12 min", "45 s", "Off" (a stopped clock). */
export function showDay(seconds: number): string {
  if (!(seconds > 0)) return 'Off'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = seconds / 60
  return minutes < 10 ? `${minutes.toFixed(1)} min` : `${Math.round(minutes)} min`
}
/** What a person typed: "5" or "5 min" is minutes, "90 s" seconds, "1h" an hour, "stop" or 0 stops it, "orbit" the default. */
export function parseDay(text: string): number | null {
  const s = text.trim().toLowerCase().replace(',', '.')
  if (/^(orbit|default|auto)/.test(s)) return ORBIT_DEFAULT
  if (/^(stop|off|frozen|freeze|paused?)/.test(s)) return 0
  const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(h|hr|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)?$/.exec(s)
  if (!m) return null
  const n = Number(m[1]), unit = m[2]?.[0] ?? 'm'
  const seconds = unit === 'h' ? n * 3600 : unit === 's' ? n : n * 60
  return seconds === 0 ? 0 : Math.round(Math.min(DAY_SLIDER_MAX, Math.max(1, seconds)))
}

/** Fill an inspector row; returns the sync to call when the setting or the planet changes. */
export function fillDayLengthRow(row: HTMLElement, id: string): () => void {
  row.classList.add('wi-day')
  const label = document.createElement('span'); label.className = 'wi-label'; label.textContent = 'Day length'
  const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = 'any'
  input.setAttribute('aria-label', 'Day length')
  const number = document.createElement('button'); number.type = 'button'; number.className = 'wi-num'
  const note = document.createElement('small'); note.className = 'wi-day-note'
  const text = document.createElement('span')
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'wi-day-reset'
  note.append(text, reset)
  row.append(label, input, number, note)

  const setting = () => Number(params.get(id)?.value ?? ORBIT_DEFAULT)
  const orbitDay = () => planetDayLength(currentPlanet().id)
  const write = (value: number) => params.set(id, value, 'local')
  const sync = () => {
    const value = setting(), day = effectiveDayLength(value), orbit = orbitDay(), planet = currentPlanet().label
    if (document.activeElement !== input) input.value = String(dayToPosition(day))
    input.setAttribute('aria-valuetext', showDay(day))
    if (!number.hidden) { number.textContent = showDay(day); number.setAttribute('aria-label', `Day length: ${showDay(day)}, edit`) }
    const following = value < 0
    row.classList.toggle('is-orbit', following)
    text.textContent = following ? `Orbit default for ${planet}` : `Set by host · ${planet}'s orbit gives ${showDay(orbit)}`
    reset.textContent = 'Use orbit'; reset.hidden = following
  }
  input.addEventListener('input', () => write(positionToSetting(Number(input.value), orbitDay())))
  input.addEventListener('change', () => { input.blur(); sync() })
  input.addEventListener('keydown', event => {
    if (input.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? DAY_SLIDER_MAX : stepSetting(setting(), orbitDay(), event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1)
    write(next); input.value = String(dayToPosition(effectiveDayLength(next))); sync()
  })
  reset.addEventListener('click', () => { write(ORBIT_DEFAULT); sync() })
  // The number is a button: press it to type a length ("4.5", "90 s", "stop", "orbit").
  number.addEventListener('click', () => {
    if (number.disabled) return
    const field = document.createElement('input'); field.type = 'text'; field.className = 'wi-num-edit'; field.autocomplete = 'off'; field.spellcheck = false
    field.setAttribute('aria-label', 'Day length in minutes'); field.value = String(+(effectiveDayLength() / 60).toFixed(2))
    let done = false
    const finish = (commit: boolean) => {
      if (done) return; done = true
      const value = commit ? parseDay(field.value) : null
      if (value !== null) write(value)
      field.remove(); number.hidden = false; sync(); number.focus({ preventScroll: true })
    }
    field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(true) } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false) } })
    field.addEventListener('blur', () => finish(true))
    number.hidden = true; number.after(field); field.focus({ preventScroll: true }); field.select()
  })
  sync()
  return sync
}
