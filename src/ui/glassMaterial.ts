import { params, surfaceCoverage } from '../../shared/params'
import { qualityLevel } from '../core/quality'
import { glassStyle } from './inspector/params'

export const glassLabels = ['Liquid', 'Frost', 'Flat'] as const
export const liquidQualityHint = 'Liquid glass needs Medium quality or higher'
export const liquidEligible = () => qualityLevel.value >= 2
export const liquidSelected = () => glassStyle.value === 0 && liquidEligible()

// An explicit Liquid selection currently wins over the system preference.
export const respectReducedTransparency = false
const key = 'syn3h.glassMaterial.v2'
export function restoreGlassMaterial(shortcut: boolean) {
  let saved: string | null = null
  try {
    const coverage = localStorage.getItem('syn3h.surfaceCoverage')
    if (coverage !== null && /^\d{1,3}$/.test(coverage)) params.set(surfaceCoverage.def.id, Number(coverage))
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
  const paint = () => {
    const stop = glassStyle.value === 0 && !liquidEligible() ? glassStyle.def.default : glassStyle.value
    const amount = surfaceCoverage.value / 100
    // At the reference setting the neutral face lifts black and attenuates
    // daylight. The opaque end returns to the older smoky Flat fill.
    const blend = Math.max(0, (amount - .25) / .75)
    const alpha = amount < .25 ? amount * 1.6 : .4 + .58 * blend
    const grey = Math.round(80 - 58 * blend)
    const root = document.documentElement
    root.style.setProperty('--interface-tint', `rgb(${grey} ${grey} ${grey} / ${alpha})`)
    document.documentElement.dataset.glassMaterial = glassLabels[Math.round(stop)].toLowerCase()
  }
  paint()
  return params.onChange(id => {
    if (id === glassStyle.def.id) {
      try { localStorage.setItem(key, glassLabels[glassStyle.value]) } catch { /* Session only. */ }
    } else if (id === surfaceCoverage.def.id) {
      try { localStorage.setItem('syn3h.surfaceCoverage', String(surfaceCoverage.value)) } catch { /* Session only. */ }
    } else if (id !== qualityLevel.def.id) return
    paint()
  })
}
