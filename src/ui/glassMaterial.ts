import { params } from '../../shared/params'
import { qualityLevel } from '../core/quality'
import { glassStyle } from './inspector/params'

export const glassLabels = ['Liquid', 'Glass', 'Frost', 'Flat'] as const
export const liquidQualityHint = 'Liquid glass needs Medium quality or higher'
export const liquidEligible = () => qualityLevel.value >= 2
export const liquidSelected = () => glassStyle.value === 0 && liquidEligible()

// An explicit Liquid selection currently wins over the system preference.
export const respectReducedTransparency = false
const key = 'syn3h.glassMaterial.v1'
export function restoreGlassMaterial(shortcut: boolean) {
  let saved: string | null = null
  try { saved = localStorage.getItem(key) } catch { /* Storage can be disabled. */ }
  if (shortcut) params.set(glassStyle.def.id, 0)
  else if (saved && /^[0-3]$/.test(saved)) params.set(glassStyle.def.id, Number(saved))
  const paint = () => {
    const stop = glassStyle.value === 0 && !liquidEligible() ? 1 : glassStyle.value
    document.documentElement.dataset.glassMaterial = glassLabels[Math.round(stop)].toLowerCase()
  }
  paint()
  return params.onChange(id => {
    if (id === glassStyle.def.id) {
      try { localStorage.setItem(key, String(glassStyle.value)) } catch { /* Session only. */ }
    } else if (id !== qualityLevel.def.id) return
    paint()
  })
}
