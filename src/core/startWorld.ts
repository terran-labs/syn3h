/**
 * Which world this tab starts on. Read once at boot, before the terrain is built.
 *
 * In order: a link (?world=, ?planet=, ?seed=) opens what it names; otherwise a fresh random
 * seed, so a room that starts empty gets a new planet; then a resumed session in this tab
 * (a reload) puts back the world it was on, unless a link named a different one. A saved
 * world is applied later, from the lobby.
 *
 * None of this can replace an occupied room's world: the server keeps the world of the
 * first player into an empty room and sends it to everyone after (server/room.ts hello).
 * So the fresh seed only matters when this tab is first in.
 */
import { params, worldSeed } from '../../shared/params'
import { applyPlanet, decodeWorld, randomSeed } from '../world/planets'
import { prepareResume, type ResumeSnapshot } from './resume'
import { sessionStore } from './safeStorage'
import { canonicalNameSeed, canonicalSeed, publicRecipeOf } from './publicWorlds'

export type StartSource = 'link' | 'resume' | 'fresh'

export function applyStartWorld(
  query: URLSearchParams, storage: Pick<Storage, 'getItem'> | null = sessionStore(), random: () => number = randomSeed,
): { saved: ResumeSnapshot | null; source: StartSource } {
  let source: StartSource = 'link'
  // ?world=... opens a shared world exactly; ?planet=alpine picks a kind (with ?seed= or a
  // fresh seed). Both go through the parameter registry, so the room shares them.
  const shared = query.get('world')
  if (shared && decodeWorld(shared)) { /* applied */ }
  else if (query.has('planet')) applyPlanet(query.get('planet')!, query.has('seed') ? Number(query.get('seed')) : random(), { source: 'preset' })
  else if (query.has('seed')) params.set(worldSeed.def.id, query.get('seed'), 'preset')
  else {
    source = 'fresh'
    params.set(worldSeed.def.id, random(), 'preset')
    // Planet names as their own setting (world.nameSeed, from the lobby planets work): a fresh
    // planet draws a fresh name too. Skipped while that setting does not exist.
    if (params.get('world.nameSeed')) params.set('world.nameSeed', random(), 'preset')
  }
  // A reload keeps the world it was on: the session in this tab outranks the fresh draw.
  const saved = prepareResume(query, storage)
  if (saved) source = 'resume'
  // A reload in a planet's public room: the clean address names no planet, the saved room does
  // (core/publicWorlds.ts). Its canonical world; the room's own world still comes with welcome.
  const recipe = publicRecipeOf(saved?.room)
  if (recipe) applyPlanet(recipe, canonicalSeed(recipe), { nameSeed: canonicalNameSeed(recipe), source: 'preset' })
  return { saved, source }
}
