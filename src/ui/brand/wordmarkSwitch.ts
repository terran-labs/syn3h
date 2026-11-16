/**
 * A preview switch for the owner to compare the wordmark's placements live: ?wordmark=0 to 3
 * sets lobby.wordmark for this visit (clamped, never saved), and while that flag is in the
 * address a small four-way chip in the lobby's top left corner flips between them without a
 * reload. Without the flag nothing here runs and the chip does not exist.
 */
import { params } from '../../../shared/params'
import { wordmarkPlacement } from './wordmarkScene'

const NAMES = ['Flat', 'Behind', 'Front', 'Rays'] as const
let enabled = false

/** Reads ?wordmark= from a query string; returns whether the flag was there. Call once at startup. */
export function applyWordmarkQuery(search: string): boolean {
  const raw = new URLSearchParams(search).get('wordmark')
  if (raw === null) return false
  const value = Math.round(Math.min(3, Math.max(0, Number(raw) || 0)))
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
/** The chip, in `host`. Writes the choice back to the address so the flag always says what is shown. */
export function mountWordmarkSwitch(host: HTMLElement): WordmarkSwitch {
  const chip = document.createElement('div')
  chip.className = 'wordmark-switch'; chip.setAttribute('role', 'group'); chip.setAttribute('aria-label', 'Wordmark placement (preview)')
  chip.style.cssText = 'position:absolute;left:max(8px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));z-index:5;display:flex;gap:2px;padding:2px;border-radius:999px;background:rgb(10 12 18 / .62);border:1px solid rgb(255 255 255 / .16);font:500 10px/1 Barlow,system-ui,sans-serif;letter-spacing:.04em;pointer-events:auto;-webkit-text-size-adjust:none;text-size-adjust:none'
  const buttons = NAMES.map((name, value) => {
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = name; button.dataset.wordmark = String(value)
    button.style.cssText = 'border:0;border-radius:999px;padding:4px 7px;color:inherit;background:transparent;cursor:pointer;font:inherit'
    button.addEventListener('click', event => {
      event.stopPropagation()
      params.set(wordmarkPlacement.def.id, value, 'preset')
      const url = new URL(location.href); url.searchParams.set('wordmark', String(value)); history.replaceState(history.state, '', url)
      show()
    })
    chip.append(button); return button
  })
  const show = () => buttons.forEach((b, i) => {
    const on = i === Math.round(wordmarkPlacement.value)
    b.setAttribute('aria-pressed', String(on)); b.style.background = on ? 'rgb(255 238 215 / .9)' : 'transparent'; b.style.color = on ? '#02040a' : 'rgb(255 255 255 / .82)'
  })
  show(); host.append(chip)
  let top = ''
  return {
    element: chip,
    avoid(box) {
      const next = box.x < chip.offsetWidth + 16 ? `${Math.round(box.y + box.height * 1.1 + 10)}px` : ''
      if (next !== top) { chip.style.top = next || 'max(8px,env(safe-area-inset-top))'; top = next }
    },
  }
}
