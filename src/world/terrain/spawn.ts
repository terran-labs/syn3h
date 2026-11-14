/**
 * Spawn positions on the flat pad at the origin.
 *
 * A Vogel (golden angle) spiral spreads any number of players evenly without a table, and
 * consecutive indices land far apart, so the first 8 players are at least 12 m from each
 * other. Everyone faces the volcano, which also makes a good first view.
 */
import { SPAWN_FLAT_RADIUS } from './generate'
import type { HeightSampler } from './sampler'

const GOLDEN_ANGLE = 2.399963229728653
const SPACING = 8.5
/** Spawn this far above the ground so wheels settle instead of starting interpenetrated. */
export const SPAWN_CLEARANCE = 2

export interface SpawnSpot {
  x: number
  y: number
  z: number
  heading: number
}

export function spawnPointAt(sampler: HeightSampler, index: number): SpawnSpot {
  const i = Math.max(0, Math.floor(index))
  const r = Math.min(SPAWN_FLAT_RADIUS - 6, SPACING * Math.sqrt(i + 0.5))
  const a = i * GOLDEN_ANGLE
  const x = Math.cos(a) * r
  const z = Math.sin(a) * r
  const v = sampler.data.layout.volcano
  // Heading 0 faces -Z; rotating by h about +Y faces (-sin h, -cos h).
  const heading = Math.atan2(-(v.x - x), -(v.z - z))
  return { x, y: sampler.heightAt(x, z) + SPAWN_CLEARANCE, z, heading }
}
