/**
 * Silent developer overrides for the lobby's name and opening, read once from the address at
 * startup: ?wordmark= (a placement, src/ui/brand/wordmarkScene.ts; 0 is the flat fallback)
 * and ?intro= (0 the old veil and fade, 1 pull back, 2 push in: src/ui/galaxy/opening.ts).
 * Clamped, never saved, and with no control in the page: the lobby is Along an orbit with the
 * push-in opening. tests/ui/lobby-logo.mjs uses ?wordmark=0&intro=0 to check the fallback.
 */
import { params } from '../../../shared/params'
import { placementOf, wordmarkPlacement } from './wordmarkScene'
import { introMode, OPENING_NAMES } from '../galaxy/opening'

/** Applies ?wordmark= and ?intro= from a query string; returns whether either was there. */
export function applyWordmarkQuery(search: string): boolean {
  const query = new URLSearchParams(search), raw = query.get('wordmark'), intro = query.get('intro')
  const clamp = (value: string, most: number) => Math.round(Math.min(most, Math.max(0, Number(value) || 0)))
  if (raw !== null) params.set(wordmarkPlacement.def.id, placementOf(clamp(raw, 7)), 'preset')
  if (intro !== null) params.set(introMode.def.id, clamp(intro, OPENING_NAMES.length - 1), 'preset')
  return raw !== null || intro !== null
}
