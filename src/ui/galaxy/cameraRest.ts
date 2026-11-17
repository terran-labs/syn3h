/**
 * The lobby camera at rest (the owner, 16 November 2026): a closer default view, and when the
 * player lets go, a very slow, smooth return of both the tilt and the zoom to that view, in one
 * motion, starting only after a few seconds without input and yielding at once to any new drag,
 * pinch or wheel. The heading the player dragged to is kept: only the existing slow drift turns it.
 *
 * The return is a critically damped spring (Galaxy.ts springStep): it starts from rest and lands
 * without overshoot, so it has no visible start or stop. Its time is the time to settle within
 * 1% of the way: for a critically damped spring that is about 6.6 / omega.
 */
import { defineParam } from '../../../shared/params'

const P = { group: 'Graphics', scope: 'client' } as const
/** The default view's distance as a share of the fitted one: below 1 is closer. Desktop and landscape. */
export const lobbyZoom = defineParam({ ...P, id: 'lobby.zoom', label: 'Lobby default zoom (share of the whole-system distance)', default: 0.8, min: 0.4, max: 1.5, step: 0.01 })
/** The same on a phone held upright, where the wordmark and the inner planets must stay on screen. */
export const lobbyZoomPortrait = defineParam({ ...P, id: 'lobby.zoomPortrait', label: 'Lobby default zoom on a portrait phone', default: 0.8, min: 0.4, max: 1.5, step: 0.01 })
/** Seconds without input before the view starts back to its default. */
export const returnDelay = defineParam({ ...P, id: 'lobby.returnDelay', label: 'Lobby view: seconds before it returns to rest', default: 4, min: 0, max: 60, step: 0.5 })
/** Seconds the return takes to settle (within 1%). */
export const returnTime = defineParam({ ...P, id: 'lobby.returnTime', label: 'Lobby view: seconds to return to rest', default: 25, min: 1, max: 90, step: 1 })

/** The spring's rate for a settle time: critically damped, 1% left after about 6.6 / omega. */
export const returnOmega = (seconds: number) => 6.64 / Math.max(0.1, seconds)
