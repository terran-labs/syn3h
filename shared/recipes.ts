/** Stable recipe names by terrain look. No renderer or global parameter imports. */
export const RECIPE_IDS = ['volcanic', 'desert', 'alpine', 'archipelago', 'ice', 'obsidian', 'badlands', 'moon', 'swamp'] as const
export type RecipeId = typeof RECIPE_IDS[number]
export function recipeIdForLook(look: unknown): RecipeId | null {
  return typeof look === 'number' && Number.isInteger(look) ? RECIPE_IDS[look] ?? null : null
}
export function cleanRecipeId(id: unknown): RecipeId | null {
  return RECIPE_IDS.includes(id as RecipeId) ? id as RecipeId : null
}
