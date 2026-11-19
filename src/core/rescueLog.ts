/**
 * The safety nets that move a player's vehicle for a broken state: it fell out of the world,
 * its position stopped being a number, or it tunnelled under the ground. The owner's rule of
 * 18 November 2026 (AGENTS.md): the game never moves a player for where they drove, so any
 * of these firing is a bug. Each is logged to the console and, through the network client,
 * to the room server's log (a cause, no names).
 */
export type RescueCause = 'fell' | 'outside' | 'nonfinite' | 'underground'

const listeners = new Set<(cause: RescueCause) => void>()

/** A net just moved the local player's vehicle. */
export function reportRescue(cause: RescueCause): void {
  console.error('[syn3h] bug: a safety net moved the vehicle:', cause)
  for (const listener of listeners) listener(cause)
}

/** Hear every rescue; returns the unsubscribe. */
export function onRescue(listener: (cause: RescueCause) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
