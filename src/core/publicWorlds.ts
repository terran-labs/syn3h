/**
 * One public world per planet (the owner, 25 November 2026: "two planets in each orbit, one
 * private to the user and one public and shared"; the private twin is net/parallel.ts).
 *
 * Tapping Alpine with no ?room= joins Alpine's public room, internally "public-alpine", never
 * the single room "lobby" that every planet used to share, which put everyone on whichever
 * planet it happened to be on. The name is internal: addresses and invites leave it out
 * (roomAddress.ts isDefaultRoom), as they always left out "lobby".
 *
 * Each public world starts as one canonical world, the same for every visitor and every
 * session: its seed and name seed are a pure function of the recipe id (an FNV-1a hash, so no
 * table to keep in step as planets are added). The lobby shows that world, and the first player
 * into an empty public room brings it. Players in the room may still reshape it; people joining
 * an occupied room get the room's world, as before, and the lobby cannot know about the change.
 *
 * Older frozen clients still join "lobby" and never meet these rooms, nor do these clients ever
 * join "lobby".
 */
import { isDefaultRoom } from './roomAddress'
import { linkSeed } from './resume'

export const PUBLIC_PREFIX = 'public-'

/** The internal name of `recipe`'s public room. */
export const publicRoomFor = (recipe: string): string => PUBLIC_PREFIX + recipe.toLowerCase().replace(/[^a-z0-9]+/g, '')
/** The recipe of a public room's internal name, or null. */
export function publicRecipeOf(room: string | null | undefined): string | null {
  const m = /^public-([a-z0-9]+)$/.exec((room ?? '').trim().toLowerCase())
  return m ? m[1] : null
}

/** FNV-1a, 32 bits. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
/** The public world's terrain seed for `recipe`: within randomSeed's range (1 to 999998). */
export const canonicalSeed = (recipe: string): number => 1 + (hash(`mira.public.seed:${recipe}`) % 999998)
/** The public world's name seed for `recipe`: within randomNameSeed's range (1 to 999999998). */
export const canonicalNameSeed = (recipe: string): number => 1 + (hash(`mira.public.name:${recipe}`) % 999999998)

/**
 * The room a join goes to. Any public request (no room, the old "lobby", or a public room's own
 * name typed into ?room=) goes to a planet's public room: the named planet's, else the current
 * one's. `recipe` is that planet, whose canonical world the join applies first; null for a
 * private room, which keeps whatever world the page has.
 */
/** The planet a world code names ("alpine.123~..."), or null. */
export const recipeOfWorld = (code: string | null | undefined): string | null => /^([a-z0-9]+)\./.exec((code ?? '').trim().toLowerCase())?.[1] ?? null

/**
 * A link that names a world by its seed (?seed=, ?world=) with no room, while the world in hand is
 * still that seed: links shared before planets had public worlds of their own named their seed
 * that way, so such a link opens its world in a fresh parallel universe (net/parallel.ts), never a
 * planet's canonical public world. A planet alone (?planet=alpine) is its public world.
 */
export function namesItsOwnWorld(query: URLSearchParams, currentSeed: number): boolean {
  const seed = linkSeed(query)
  return seed !== null && seed === currentSeed
}

export function joinRoom(asked: string, currentRecipe: string): { room: string; recipe: string | null } {
  if (!isDefaultRoom(asked)) return { room: asked, recipe: null }
  const recipe = publicRecipeOf(asked) ?? currentRecipe
  return { room: publicRoomFor(recipe), recipe }
}
