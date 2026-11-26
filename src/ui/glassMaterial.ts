import { GLASS_FLAT, GLASS_LIQUID, glassStyle, params, surfaceCoverage } from '../../shared/params'
import { flashSwitches } from '../core/flashSwitches'
import { setFieldSwitch } from '../core/fieldSwitches'
import { qualityLevel } from '../core/quality'
export const glassStyles = [{ value: GLASS_LIQUID, label: 'Liquid' }, { value: GLASS_FLAT, label: 'Flat' }] as const
export const glassStyleChoice = (value: number) => glassStyles[value === GLASS_LIQUID ? 0 : 1]
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
export const liquidSelected = () => glassStyle.value === GLASS_LIQUID && liquidEligible()

// An explicit Liquid selection currently wins over the system preference.
export const respectReducedTransparency = false
// Flat's default comes from the bright-patch contrast audit. Liquid keeps the owner's 25%.
export const defaultTint = (style = glassStyle.value) => style === GLASS_LIQUID ? 25 : surfaceCoverage.def.default
// A small contrast margin over the native Flat default on bright low-tier scenes.
export const liquidFallbackTintFloor = () => Math.min(surfaceCoverage.def.max ?? 100, defaultTint(GLASS_FLAT) + 3)
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
  const target = flat ? GLASS_FLAT : visitStyle
  if (flat && visitStyle === null) visitStyle = glassStyle.value
  if (!flat) visitStyle = null
  if (target === null || target === glassStyle.value) return
  visitOnly++
  try { params.set(glassStyle.def.id, target) } finally { visitOnly-- }
}
export function restoreGlassMaterial(shortcut: boolean, flat = false) {
  let savedStyle: number | undefined, savedTint: number | undefined
  try {
    const coverage = localStorage.getItem('mira.surfaceCoverage')
    if (coverage !== null && /^\d{1,3}$/.test(coverage)) savedTint = Number(coverage)
    const saved = localStorage.getItem(key)
    if (saved === 'Liquid') savedStyle = GLASS_LIQUID
    else if (saved === 'Flat' || saved === 'Frost') savedStyle = GLASS_FLAT
    else if (saved === null) {
      const legacy = localStorage.getItem('mira.glassMaterial.v1')
      if (legacy !== null && /^[0-3]$/.test(legacy)) savedStyle = legacy === '0' ? GLASS_LIQUID : GLASS_FLAT
    }
    if (savedStyle !== undefined && saved !== glassStyleChoice(savedStyle).label) {
      localStorage.setItem(key, glassStyleChoice(savedStyle).label)
    }
  } catch { /* Storage can be disabled. */ }
  params.set(glassStyle.def.id, shortcut ? GLASS_LIQUID : savedStyle ?? glassStyle.def.default)
  visitStyle = flat ? glassStyle.value : null
  if (flat) params.set(glassStyle.def.id, GLASS_FLAT)
  params.set(surfaceCoverage.def.id, savedTint !== undefined && (!shortcut || savedStyle === GLASS_LIQUID) ? savedTint : defaultTint())
  let previousStyle = glassStyleChoice(glassStyle.value).value
  paintedTint = surfaceCoverage.value
  let frame = 0
  function paintFlatFill() {
    // Low tiers render a selected Liquid style with Flat's CSS face. Keep the
    // contrast floor in the paint path so the slider and saved tint stay put.
    const tint = glassStyle.value === GLASS_LIQUID && !liquidEligible()
      ? Math.max(paintedTint, liquidFallbackTintFloor())
      : paintedTint
    document.documentElement.style.setProperty('--interface-tint', fill(flatFill, tint))
  }
  function paintTint() {
    const root = document.documentElement
    paintFlatFill()
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
    document.documentElement.dataset.glassMaterial = liquidSelected() ? 'liquid' : 'flat'
  }
  paintTint(); paintStyle()
  const unsubscribe = params.onChange(id => {
    if (id === glassStyle.def.id) {
      const style = glassStyleChoice(glassStyle.value), changed = style.value !== previousStyle
      previousStyle = style.value
      if (!visitOnly) {
        // A player's choice ends the visit override. Frost and Flat share one effective style.
        visitStyle = null
        if (flashSwitches.uiFlat && flashSwitches.post !== 'off') setFieldSwitch('uiFlat', false)
        if (changed) params.set(surfaceCoverage.def.id, defaultTint(style.value))
        try { localStorage.setItem(key, style.label) } catch { /* Session only. */ }
      }
    } else if (id === surfaceCoverage.def.id) {
      easeTint()
      try { localStorage.setItem('mira.surfaceCoverage', String(surfaceCoverage.value)) } catch { /* Session only. */ }
      return
    } else if (id !== qualityLevel.def.id) return
    paintStyle()
    paintFlatFill()
  })
  return () => { unsubscribe(); if (frame) cancelAnimationFrame(frame) }
}
