/** Stable recipe names by terrain look. No renderer or global parameter imports. */
export const RECIPE_IDS = ['volcanic', 'desert', 'alpine', 'archipelago', 'ice', 'obsidian', 'badlands', 'moon', 'swamp'] as const
export type RecipeId = typeof RECIPE_IDS[number]
export function recipeIdForLook(look: unknown): RecipeId | null {
  return typeof look === 'number' && Number.isInteger(look) ? RECIPE_IDS[look] ?? null : null
}
export function cleanRecipeId(id: unknown): RecipeId | null {
  return RECIPE_IDS.includes(id as RecipeId) ? id as RecipeId : null
}
/**
 * What players call each biome (`terrain.look`), by its stored number. The one list for
 * every place a biome is named: the World card's choice buttons, the lobby, the About page.
 * Renaming here renames it everywhere; the numbers and recipe ids above never change.
 * Owner's names: 8, formerly "swamp" and "Methane swamp", is the Mire, a warm wetland.
 */
export const BIOME_NAMES = ['Volcanic', 'Desert', 'Alpine', 'Archipelago', 'Ice moon', 'Obsidian', 'Badlands', 'Moon', 'Mire'] as const satisfies readonly string[] & { length: typeof RECIPE_IDS.length }
export function biomeName(look: unknown): string | null {
  return typeof look === 'number' && Number.isInteger(look) ? BIOME_NAMES[look] ?? null : null
}
