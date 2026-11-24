/**
 * Silent developer overrides for the lobby's name and opening, read once from the address at
 * startup: ?wordmark= (a placement, src/ui/brand/wordmarkScene.ts; 0 is the flat fallback)
 * and ?intro= (0 the old veil and fade, 1 pull back, 2 push in: src/ui/galaxy/opening.ts).
 * Clamped, never saved, and with no control in the page: the lobby is Along an orbit with the
 * push-in opening. tests/ui/lobby-logo.mjs uses ?wordmark=0&intro=0 to check the fallback.
 */
import { params } from '../../../shared/params'
import { placementOf, wordmarkPlacement, wordmarkSolid } from './wordmarkScene'
import { introMode, OPENING_NAMES } from '../galaxy/opening'

/** Applies ?wordmark= and ?intro= (and the metal face's switches) from a query string; returns whether ?wordmark= or ?intro= was there. */
export function applyWordmarkQuery(search: string): boolean {
  const query = new URLSearchParams(search), raw = query.get('wordmark'), intro = query.get('intro')
  const clamp = (value: string, most: number) => Math.round(Math.min(most, Math.max(0, Number(value) || 0)))
  if (raw !== null) params.set(wordmarkPlacement.def.id, placementOf(clamp(raw, 7)), 'preset')
  // Switches for the name's metal face, kept in production for looking at a build in the field:
  // ?solid=0 draws the earlier veil instead; ?white=1 starts it white; ?tune=1 shows sliders for
  // every setting in the "Lobby logo" group (src/ui/brand/mira/logoTuner.ts, loaded only then).
  const solid = query.get('solid')
  if (solid !== null) params.set(wordmarkSolid.def.id, solid === '1', 'preset')
  if (query.get('white') === '1') { params.set('lobby.logo.white', 1, 'preset'); params.set('lobby.logo.colour', 0.6, 'preset') }
  if (query.get('tune') === '1') void import('./mira/logoTuner').then(m => { if (document.readyState === 'complete') m.showLogoTuner(); else addEventListener('load', () => m.showLogoTuner(), { once: true }) })
  if (intro !== null) params.set(introMode.def.id, clamp(intro, OPENING_NAMES.length - 1), 'preset')
  return raw !== null || intro !== null
}
