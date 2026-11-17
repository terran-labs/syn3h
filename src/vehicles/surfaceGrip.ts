/**
 * Tyre grip by what the wheel is on: a multiplier on each tyre's friction limit, read at the
 * contact from `terrain.surfaceAt` (the same classification that draws tyre marks), so ice
 * slides, a wet shallow is a little slicker than the dry beach, and everything else is as tuned.
 */
import { defineParam, type Param } from '../../shared/params'
import { SURFACE_KINDS, type SurfaceKind } from '../world/terrain/surface'
import type { Terrain } from '../world/Terrain'

const P = { group: 'Surfaces', scope: 'world' as const, min: 0.05, max: 1.5, step: 0.05 }
/**
 * Ice is a frozen lake, not a skating rink: about a third of the grip, so it slides and
 * drifts wide but still answers the wheel. Every other surface is 1 until someone tunes it.
 */
const DEFAULTS: Partial<Record<SurfaceKind, number>> = { ice: 0.35 }
export const surfaceGrip = Object.fromEntries(SURFACE_KINDS.map((kind) => [kind, defineParam({
  ...P, id: `surface.grip.${kind}`, label: `Tyre grip on ${kind}`, default: DEFAULTS[kind] ?? 1,
})])) as Record<SurfaceKind, Param<number>>
/** Under shallow water the same ground grips this much less. */
export const wetGrip = defineParam({ ...P, id: 'surface.grip.wet', label: 'Tyre grip when wet', default: 0.85 })

/** The grip multiplier for a tyre touching the ground at (x, z). 1 where nothing is known. */
export function gripAt(terrain: Terrain, x: number, z: number): number {
  const kind = terrain.surfaceAt?.(x, z)
  let g = kind ? surfaceGrip[kind].value : 1
  if (terrain.liquidKindAt?.(x, z) === 'water') g *= wetGrip.value
  return g
}
