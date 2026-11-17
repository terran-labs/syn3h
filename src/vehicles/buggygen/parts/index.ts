import type * as THREE from 'three'
import { buildStrut, buildShock, SUSPENSION_NUMBERS } from './suspension'
import { buildStator, STATOR_NUMBERS } from './stator'
import { buildWings, WINGS_NUMBERS } from './wings'
import { buildInterior, INTERIOR_NUMBERS } from './interior'
import { buildCanopy, CANOPY_NUMBERS } from './canopy'
import { buildSockets, SOCKETS_NUMBERS } from './sockets'

/**
 * The buggy's parts other than the body shell, generated at run time: suspension arm, shock,
 * hub stator, flight wings, canopy, cockpit tub and body fittings. Each piece is in the frame
 * LoadedBuggySkin gives the loaded part, so a generated skin can swap them in unchanged.
 */
export type PartName = 'sockets' | 'interior' | 'canopy' | 'strut' | 'shock' | 'stator' | 'wings'
export interface PartPiece { part: PartName; role: string; geometry: THREE.BufferGeometry }
export interface PartsCandidate { id: string; build(detail: 0 | 1 | 2): PartPiece[]; numbers?: number }

const candidate: PartsCandidate = {
  id: 'buggygen-parts',
  build(detail) {
    return [...buildStrut(detail), ...buildShock(detail), ...buildStator(detail), ...buildWings(detail), ...buildInterior(detail), ...buildCanopy(detail), ...buildSockets(detail)]
  },
  numbers: SUSPENSION_NUMBERS + STATOR_NUMBERS + WINGS_NUMBERS + INTERIOR_NUMBERS + CANOPY_NUMBERS + SOCKETS_NUMBERS,
}
export default candidate
