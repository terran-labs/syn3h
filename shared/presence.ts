import type { RecipeId } from './recipes'
/** Public aggregate only. Timestamps are Unix milliseconds, never room-clock seconds. */
export interface PresenceSnapshot {
  version: 1
  generatedAt: number
  ttlMs: 90000
  byRecipe: { recipeId: RecipeId | null; rooms: number; players: number; oldestReportAt: number }[]
}
