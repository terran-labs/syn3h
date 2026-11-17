import type * as THREE from 'three/webgpu'
import { buildStrut, buildShock, SUSPENSION_NUMBERS } from './suspension'
import { buildStator, STATOR_NUMBERS } from './stator'
import { buildWings, WINGS_NUMBERS } from './wings'
import { buildInterior, INTERIOR_NUMBERS } from './interior'
import { buildCanopy, CANOPY_NUMBERS } from './canopy'
import { Surface } from './surface'
import { buildSockets, SOCKETS_NUMBERS } from './sockets'

/**
 * The buggy's parts other than the body shell, generated at run time: suspension arm, shock,
 * hub stator, flight wings, canopy, cockpit tub and body fittings. Each piece is in the frame
 * LoadedBuggySkin gives the loaded part, so a generated skin can swap them in unchanged.
 */
export type PartName = 'sockets' | 'interior' | 'canopy' | 'strut' | 'shock' | 'stator' | 'wings'
export interface PartPiece { part: PartName; role: string; geometry: THREE.BufferGeometry }
export interface PartsCandidate { id: string; build(detail: 0 | 1 | 2): PartPiece[]; numbers?: number }

/**
 * Every part at one detail level. `body` is the body's geometry, if there is one: the body's
 * swellings conform to it, and the shock tops (where each shock is anchored in the body) are
 * found on it. Without it the shipped body's positions are used.
 */
export function buildParts(detail: 0 | 1 | 2, body?: THREE.BufferGeometry[]): { pieces: PartPiece[]; shockTops: [number, number, number][] } {
  const sockets = buildSockets(detail, body)
  const pieces: PartPiece[] = [...buildStrut(detail), ...buildShock(detail), ...buildStator(detail), ...buildWings(detail), ...buildInterior(detail), ...buildCanopy(detail, body?.length ? Surface.from(body) : undefined), ...sockets.pieces]
  return { pieces, shockTops: sockets.shockTops }
}

export const PARTS_NUMBERS = SUSPENSION_NUMBERS + STATOR_NUMBERS + WINGS_NUMBERS + INTERIOR_NUMBERS + CANOPY_NUMBERS + SOCKETS_NUMBERS

/** Candidate for the buggy-fit harness with no body: fittings fall back to stored positions. */
const candidate: PartsCandidate = { id: 'buggygen-parts', build: detail => buildParts(detail).pieces, numbers: PARTS_NUMBERS }
export default candidate
