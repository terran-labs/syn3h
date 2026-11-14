/**
 * Spawn positions on the pads around the island.
 *
 * Players are dealt round the pads in turn, so the first eight each get their own pad and
 * start spread around the coast, all facing the volcano at the centre. Later players share
 * pads on a small Vogel (golden angle) spiral, which spreads any number without a table.
 */
import { SPAWN_FLAT_RADIUS } from './generate'
import type { HeightSampler } from './sampler'

const GOLDEN_ANGLE = 2.399963229728653
const SPACING = 7
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
  const L = sampler.data.layout
  const pad = L.spawns[i % L.spawns.length]
  // Position within the pad: the first player at its centre, later ones spiralling out.
  const k = Math.floor(i / L.spawns.length)
  const r = Math.min(SPAWN_FLAT_RADIUS - 6, SPACING * Math.sqrt(k))
  const a = k * GOLDEN_ANGLE
  const x = pad.x + Math.cos(a) * r
  const z = pad.z + Math.sin(a) * r
  const v = L.volcano
  // Heading 0 faces -Z; rotating by h about +Y faces (-sin h, -cos h).
  const heading = Math.atan2(-(v.x - x), -(v.z - z))
  return { x, y: sampler.heightAt(x, z) + SPAWN_CLEARANCE, z, heading }
}
