/**
 * A preview switch for the owner to compare the wordmark's placements live: ?wordmark=0 to 8
 * sets lobby.wordmark for this visit (clamped, never saved), and while that flag is in the
 * address a small menu in the lobby's top left corner flips between them without a reload. Without the flag nothing here runs and the chip does not exist.
 */
import { params } from '../../../shared/params'
import { PLACEMENT_NAMES, wordmarkPlacement } from './wordmarkScene'

let enabled = false

/** Reads ?wordmark= from a query string; returns whether the flag was there. Call once at startup. */
export function applyWordmarkQuery(search: string): boolean {
  const raw = new URLSearchParams(search).get('wordmark')
  if (raw === null) return false
  const value = Math.round(Math.min(PLACEMENT_NAMES.length - 1, Math.max(0, Number(raw) || 0)))
  params.set(wordmarkPlacement.def.id, value, 'preset')
  enabled = true
  return true
}
export const wordmarkSwitchEnabled = () => enabled

export interface WordmarkSwitch {
  element: HTMLElement
  /** Keeps the chip clear of the logo: below it when the logo reaches into the corner (phones). */
  avoid(box: { x: number; y: number; width: number; height: number }): void
}
/** The chip, in `host`: a small menu of the placements. Writes the choice back to the address so the flag always says what is shown. */
export function mountWordmarkSwitch(host: HTMLElement): WordmarkSwitch {
  const chip = document.createElement('label')
  chip.className = 'wordmark-switch'
  chip.style.cssText = 'position:absolute;left:max(8px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));z-index:5;display:flex;align-items:center;gap:6px;padding:3px 4px 3px 10px;border-radius:999px;background:rgb(10 12 18 / .62);border:1px solid rgb(255 255 255 / .16);color:rgb(255 255 255 / .82);font:500 10px/1 Barlow,system-ui,sans-serif;letter-spacing:.04em;pointer-events:auto;-webkit-text-size-adjust:none;text-size-adjust:none'
  chip.append('Wordmark')
  const menu = document.createElement('select')
  menu.setAttribute('aria-label', 'Wordmark placement (preview)')
  menu.style.cssText = 'font:500 10px/1 Barlow,system-ui,sans-serif;-webkit-text-size-adjust:none;color:#02040a;background:rgb(255 238 215 / .92);border:0;border-radius:999px;padding:3px 6px'
  for (const [value, name] of PLACEMENT_NAMES.entries()) menu.add(new Option(name, String(value)))
  menu.value = String(Math.round(wordmarkPlacement.value))
  menu.addEventListener('change', () => {
    const value = Number(menu.value)
    params.set(wordmarkPlacement.def.id, value, 'preset')
    const url = new URL(location.href); url.searchParams.set('wordmark', String(value)); history.replaceState(history.state, '', url)
  })
  chip.append(menu)
  for (const type of ['click', 'pointerdown']) chip.addEventListener(type, event => event.stopPropagation())
  host.append(chip)
  let top = ''
  return {
    element: chip,
    avoid(box) {
      const next = box.x < chip.offsetWidth + 16 ? `${Math.round(box.y + box.height * 1.1 + 10)}px` : ''
      if (next !== top) { chip.style.top = next || 'max(8px,env(safe-area-inset-top))'; top = next }
    },
  }
}
