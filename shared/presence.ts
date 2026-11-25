import type { RecipeId } from './recipes'
/** Public aggregate only. Timestamps are Unix milliseconds, never room-clock seconds. */
export interface PresenceSnapshot {
  version: 1
  generatedAt: number
  ttlMs: 90000
  /**
   * `players`: connected in that planet's rooms. `active`: of those, not paused (the pause
   * screen or a hidden page), what the lobby shows. `active` was added later: older lobbies
   * ignore it (they read only the fields above it), and a lobby reading an older server
   * falls back to `players`.
   */
  byRecipe: { recipeId: RecipeId | null; rooms: number; players: number; active?: number; oldestReportAt: number }[]
}
