import { params, surfaceCoverage } from '../../shared/params'
import { qualityLevel } from '../core/quality'
import { glassStyle } from './inspector/params'

export const glassLabels = ['Liquid', 'Frost', 'Flat'] as const
export const liquidQualityHint = 'Liquid glass needs Medium quality or higher'
export const liquidEligible = () => qualityLevel.value >= 2
export const liquidSelected = () => glassStyle.value === 0 && liquidEligible()

// An explicit Liquid selection currently wins over the system preference.
export const respectReducedTransparency = false
// Defaults come from the bright-patch audit. Player-selected values can cover the entire range.
const defaults = [25, 55, 55] as const
export const defaultTint = (style = glassStyle.value) => defaults[Math.round(style)] ?? defaults[1]
let paintedTint = defaultTint() as number
export const currentTint = () => paintedTint
const tintListeners = new Set<() => void>()
export function onPaintedTint(listener: () => void) {
  tintListeners.add(listener)
  return () => tintListeners.delete(listener)
}

// Fitted to Liquid's mean linear luminance in 32-pixel patches across five scenes.
// Each entry is the opacity and neutral fill at the next quarter of the slider.
const frostFill = [[0, 0], [.57, .265], [.58, .235], [.73, .13], [.975, .089]]
const flatFill = [[0, 0], [.64, .237], [.65, .207], [.78, .124], [.98, .089]]
function fill(values: number[][], percent: number) {
  const t = percent / 25, i = Math.min(3, Math.floor(t)), fraction = t - i
  const [a, grey] = values[i], [b, nextGrey] = values[i + 1]
  const opacity = a + (b - a) * fraction
  const channel = Math.round(255 * (grey + (nextGrey - grey) * fraction))
  return `rgb(${channel} ${channel} ${channel} / ${opacity})`
}
const key = 'syn3h.glassMaterial.v2'
export function restoreGlassMaterial(shortcut: boolean) {
  let saved: string | null = null, savedTint: number | undefined
  try {
    const coverage = localStorage.getItem('syn3h.surfaceCoverage')
    if (coverage !== null && /^\d{1,3}$/.test(coverage)) savedTint = Number(coverage)
    saved = localStorage.getItem(key)
    if (saved === null) {
      const legacy = localStorage.getItem('syn3h.glassMaterial.v1')
      if (legacy !== null && /^[0-3]$/.test(legacy)) {
        saved = ['Liquid', 'Frost', 'Frost', 'Flat'][Number(legacy)]
        localStorage.setItem(key, saved)
      }
    }
  } catch { /* Storage can be disabled. */ }
  const index = glassLabels.findIndex(name => name === saved)
  if (shortcut) params.set(glassStyle.def.id, 0)
  else if (index >= 0) params.set(glassStyle.def.id, index)
  params.set(surfaceCoverage.def.id, savedTint !== undefined && (!shortcut || index === 0) ? savedTint : defaultTint())
  paintedTint = surfaceCoverage.value
  let frame = 0
  function paintTint() {
    const root = document.documentElement
    root.style.setProperty('--interface-tint', fill(flatFill, paintedTint))
    root.style.setProperty('--interface-frost-tint', fill(frostFill, paintedTint))
    for (const notify of tintListeners) notify()
  }
  function easeTint() {
    if (frame) cancelAnimationFrame(frame)
    if (typeof requestAnimationFrame === 'undefined') { paintedTint = surfaceCoverage.value; paintTint(); return }
    const from = paintedTint, start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / 240)
      paintedTint = from + (surfaceCoverage.value - from) * t * t * (3 - 2 * t)
      paintTint()
      // Range inputs track a direct drag themselves. On a style change or
      // Default action the thumb and readout follow the material together.
      for (const input of document.querySelectorAll<HTMLInputElement>('.tint-row input[type=range]')) {
        if (document.activeElement === input) continue
        const shown = Math.round(paintedTint)
        input.value = String(shown)
        input.setAttribute('aria-valuetext', shown + '%')
        const output = input.parentElement?.querySelector('output')
        if (output) output.value = shown + '%'
      }
      frame = t < 1 ? requestAnimationFrame(tick) : 0
    }
    frame = requestAnimationFrame(tick)
  }
  function paintStyle() {
    const stop = glassStyle.value === 0 && !liquidEligible() ? glassStyle.def.default : glassStyle.value
    document.documentElement.dataset.glassMaterial = glassLabels[Math.round(stop)].toLowerCase()
  }
  paintTint(); paintStyle()
  const unsubscribe = params.onChange(id => {
    if (id === glassStyle.def.id) {
      params.set(surfaceCoverage.def.id, defaultTint())
      try { localStorage.setItem(key, glassLabels[glassStyle.value]) } catch { /* Session only. */ }
    } else if (id === surfaceCoverage.def.id) {
      easeTint()
      try { localStorage.setItem('syn3h.surfaceCoverage', String(surfaceCoverage.value)) } catch { /* Session only. */ }
    } else if (id !== qualityLevel.def.id) return
    paintStyle()
  })
  return () => { unsubscribe(); if (frame) cancelAnimationFrame(frame) }
}
