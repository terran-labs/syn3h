/**
 * The storage getters themselves can throw: with storage blocked (some private modes, embedded
 * views, a clean profile that refuses site data) reading window.sessionStorage or
 * window.localStorage raises a SecurityError before any getItem. Every read on the start-up
 * path goes through these, so blocked storage costs the visit its memory, never its start.
 */
export function sessionStore(): Storage | null {
  try { return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null } catch { return null }
}
export function localStore(): Storage | null {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null } catch { return null }
}
/** Nothing kept, and saying so on write: for features that cannot work without storage. */
export const NO_STORAGE: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => null,
  setItem: () => { throw new Error('Storage is unavailable.') },
  removeItem: () => {},
}
