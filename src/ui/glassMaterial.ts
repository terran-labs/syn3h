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
    // Fit the endpoints of a translucent CSS fill to the Regular transfer.
    // Black determines the lift. White determines the minimum backing a CSS
    // surface needs without sampling the game or adding a filter to Flat.
    const tint = Math.min(1, amount * 4)
    const opacity = Math.max(0, (amount - .25) / .75) * .97
    const black = (32 / 255) * tint * (1 - opacity) + opacity * 22 / 255
    const white = (1 + (.6 + 32 / 255 - 1) * tint) * (1 - opacity) + opacity * 22 / 255
    const paintFill = (cap: number, transmission: number) => {
      const maxWhite = Math.min(cap, white)
      const alpha = 1 - (maxWhite - black) / transmission
      const grey = Math.round(255 * black / alpha)
      return `rgb(${grey} ${grey} ${grey} / ${alpha})`
    }
    const root = document.documentElement
    root.style.setProperty('--interface-tint', paintFill(.452, 1))
    // Frost's backdrop has already passed through brightness(.84), and its
    // broadest highlight mixes another four percent white over the fill.
    root.style.setProperty('--interface-frost-tint', paintFill((.452 - .04) / .96, .84))
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
