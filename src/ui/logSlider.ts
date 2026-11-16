import { formatScaledValue, sliderStops, snapPosition, stepValue, valueToPosition, type ScaleDef } from '../../shared/paramScale'
/** Shared by the inspector and the legacy parameter panel; callers retain permission checks. */
export function logSlider(input: HTMLInputElement, def: ScaleDef, read: () => number, write: (value: number) => void, deferred = false): (value: number) => void {
  input.min = '0'; input.max = '1'; input.step = 'any'
  const sync = (value: number) => { input.value = String(valueToPosition(def, value)); input.setAttribute('aria-valuetext', formatScaledValue(def, value)) }
  input.addEventListener(deferred ? 'change' : 'input', () => { const value = snapPosition(def, Number(input.value)); write(value); sync(read()) })
  input.addEventListener('input', () => input.setAttribute('aria-valuetext', formatScaledValue(def, snapPosition(def, Number(input.value)))))
  input.addEventListener('keydown', event => {
    if (input.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const stops = sliderStops(def)
    const value = event.key === 'Home' ? stops[0] : event.key === 'End' ? stops.at(-1) : stepValue(def, read(), event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1)
    if (value !== undefined) { write(value); sync(read()) }
  })
  sync(read()); return sync
}
