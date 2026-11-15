/**
 * The Daydream slider for the main settings panel: how long the controls may sit untouched
 * before the vehicle starts driving itself.
 *
 * Far left is 10 seconds, the last stop before the far right is 5 minutes, and the far right
 * is off. The travel in between is logarithmic, so the short times people actually pick
 * (10 s, 30 s, a minute) get most of the slider. The value lives in the `daydream.seconds`
 * parameter (0 is off), so the advanced panel and this slider always agree.
 *
 * Usage, from whoever owns the panel: `panel.append(createDaydreamControl())`.
 */
import { params } from '../../shared/params'
import { daydreamSeconds } from './params'

export const DAYDREAM_MIN_SECONDS = 10
export const DAYDREAM_MAX_SECONDS = 300
/** Slider positions 0..OFF_POSITION. The last one is off. */
export const DAYDREAM_OFF_POSITION = 100

/** Seconds for a slider position. 0 means off. */
export function daydreamSecondsAt(position: number): number {
  const p = Math.max(0, Math.min(DAYDREAM_OFF_POSITION, Math.round(position)))
  if (p >= DAYDREAM_OFF_POSITION) return 0
  const seconds = DAYDREAM_MIN_SECONDS * (DAYDREAM_MAX_SECONDS / DAYDREAM_MIN_SECONDS) ** (p / (DAYDREAM_OFF_POSITION - 1))
  // Whole seconds under a minute, then steps of five, so the label reads as a round time.
  return seconds < 60 ? Math.round(seconds) : Math.min(DAYDREAM_MAX_SECONDS, Math.round(seconds / 5) * 5)
}

/** The slider position that shows a number of seconds. 0 or less is the off position. */
export function daydreamPositionFor(seconds: number): number {
  if (!(seconds > 0)) return DAYDREAM_OFF_POSITION
  const s = Math.max(DAYDREAM_MIN_SECONDS, Math.min(DAYDREAM_MAX_SECONDS, seconds))
  return Math.round(Math.log(s / DAYDREAM_MIN_SECONDS) / Math.log(DAYDREAM_MAX_SECONDS / DAYDREAM_MIN_SECONDS) * (DAYDREAM_OFF_POSITION - 1))
}

/** "after 30 seconds", "after 2 minutes", "after 1 min 35 s", "off". */
export function daydreamLabel(seconds: number): string {
  if (!(seconds > 0)) return 'off'
  if (seconds < 60) return `after ${seconds} seconds`
  const minutes = Math.floor(seconds / 60), rest = Math.round(seconds % 60)
  return rest ? `after ${minutes} min ${rest} s` : `after ${minutes} minute${minutes === 1 ? '' : 's'}`
}

/** A labelled range input bound both ways to `daydream.seconds`. Call `dispose` on teardown. */
export function createDaydreamControl(): HTMLLabelElement & { dispose(): void } {
  const label = document.createElement('label') as HTMLLabelElement & { dispose(): void }
  label.className = 'daydream-control'
  label.title = 'Leave the controls alone this long and your vehicle goes exploring by itself. Touch anything to take it back.'
  const output = document.createElement('output'), slider = document.createElement('input')
  slider.type = 'range'; slider.min = '0'; slider.max = String(DAYDREAM_OFF_POSITION); slider.step = '1'
  slider.setAttribute('aria-label', 'Daydream: idle time before your vehicle drives itself')
  label.append('Daydream ', output, slider)
  const show = () => {
    const seconds = daydreamSeconds.value
    if (document.activeElement !== slider) slider.value = String(daydreamPositionFor(seconds))
    output.textContent = daydreamLabel(seconds); slider.setAttribute('aria-valuetext', output.textContent)
  }
  slider.addEventListener('input', () => { params.set(daydreamSeconds.def.id, daydreamSecondsAt(Number(slider.value))); show() })
  const unsubscribe = params.onChange(id => { if (id === daydreamSeconds.def.id) show() })
  label.dispose = () => { unsubscribe(); label.remove() }
  show()
  return label
}
