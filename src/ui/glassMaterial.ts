import { params, surfaceCoverage } from '../../shared/params'
import { flashSwitches } from '../core/flashSwitches'
import { setFieldSwitch } from '../core/fieldSwitches'
import { qualityLevel } from '../core/quality'
import { glassStyle } from './inspector/params'

export const glassLabels = ['Liquid', 'Frost', 'Flat'] as const
/**
 * The parameter registry's groups that tune the Liquid style: the Glass group (frost width, tint
 * strength, face brightness, rim highlight, outer hairline, backdrop saturation, press growth,
 * press brightness; fx/post/regularSettings.ts) and the Clear lens group (thickness, bevel, index,
 * dispersion; fx/post/GlassPost.ts). Their rows show only while Liquid is the style, folded under
 * Style and Tint (the owner, 22 November 2026). One list for the lobby's Settings card and the
 * in-play panels, so the two cannot drift.
 */
export const LIQUID_TUNING_GROUPS: readonly string[] = ['Glass', 'Clear lens']
export const liquidQualityHint = 'Liquid glass needs Medium quality or higher'
export const liquidEligible = () => qualityLevel.value >= 2
export const liquidSelected = () => glassStyle.value === 0 && liquidEligible()

// An explicit Liquid selection currently wins over the system preference.
export const respectReducedTransparency = false
// Defaults come from the bright-patch audit, Frost and Flat raised to the worst case measured on
// 22 November 2026 (every rail label, icon and notice at 4.5:1 or better over Alpine noon, ice
// noon and Mire day at 1440 and 744, Chromium and WebKit): Frost 70, Flat 65. Liquid stays at the
// owner's 25. Player-selected values can cover the entire range.
const defaults = [25, 70, 65] as const
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
const key = 'mira.glassMaterial.v2'
/** `flat`: Flat glass for this visit only (?ui=flat), set before the listener that saves a choice. */
let visitOnly = 0
/** The player's style before a field switch made the glass Flat for the visit; null when none did. */
let visitStyle: number | null = null
/**
 * Flat interface glass for this visit only (?ui=flat as a field switch, core/fieldSwitches.ts), or
 * back to the style the player had. Neither is saved, and the tint is left alone; a style the
 * player then picks themselves is theirs and is saved as usual.
 */
export function setGlassForVisit(flat: boolean): void {
  const target = flat ? glassLabels.indexOf('Flat') : visitStyle
  if (flat && visitStyle === null) visitStyle = glassStyle.value
  if (!flat) visitStyle = null
  if (target === null || target === glassStyle.value) return
  visitOnly++
  try { params.set(glassStyle.def.id, target) } finally { visitOnly-- }
}
export function restoreGlassMaterial(shortcut: boolean, flat = false) {
  let saved: string | null = null, savedTint: number | undefined
  try {
    const coverage = localStorage.getItem('mira.surfaceCoverage')
    if (coverage !== null && /^\d{1,3}$/.test(coverage)) savedTint = Number(coverage)
    saved = localStorage.getItem(key)
    if (saved === null) {
      const legacy = localStorage.getItem('mira.glassMaterial.v1')
      if (legacy !== null && /^[0-3]$/.test(legacy)) {
        saved = ['Liquid', 'Frost', 'Frost', 'Flat'][Number(legacy)]
        localStorage.setItem(key, saved)
      }
    }
  } catch { /* Storage can be disabled. */ }
  const index = glassLabels.findIndex(name => name === saved)
  if (shortcut) params.set(glassStyle.def.id, 0)
  else if (index >= 0) params.set(glassStyle.def.id, index)
  if (flat) { visitStyle = glassStyle.value; params.set(glassStyle.def.id, glassLabels.indexOf('Flat')) }
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
    if (id === glassStyle.def.id && visitOnly) { /* A field switch's Flat (setGlassForVisit): not the player's choice, not saved. */ }
    else if (id === glassStyle.def.id) {
      // The player chose a style: the visit's Flat (?ui=flat) gives way to it.
      visitStyle = null
      if (flashSwitches.uiFlat && flashSwitches.post !== 'off') setFieldSwitch('uiFlat', false)
      params.set(surfaceCoverage.def.id, defaultTint())
      try { localStorage.setItem(key, glassLabels[glassStyle.value]) } catch { /* Session only. */ }
    } else if (id === surfaceCoverage.def.id) {
      easeTint()
      try { localStorage.setItem('mira.surfaceCoverage', String(surfaceCoverage.value)) } catch { /* Session only. */ }
    } else if (id !== qualityLevel.def.id) return
    paintStyle()
  })
  return () => { unsubscribe(); if (frame) cancelAnimationFrame(frame) }
}
