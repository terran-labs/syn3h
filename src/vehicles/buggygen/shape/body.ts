import { buildBody, type BodyPart, type CageData, type Candidate } from '../cage/generator'
import { data as cage } from '../cage/cage250'
import { defaultShape, isDefaultShape, type Shape } from './handles'
import { rig, type Rig } from './rig'

/**
 * The cage buggy body with shape handles applied. The cage's points move (rig.ts), then the
 * cage lane's own subdivision builds the surface, so creases, roles and normals behave exactly
 * as in the fitted body. The default shape returns the shipped cage itself, so it builds the
 * shipped body bit for bit.
 */

/** The cage with the shape applied, in the cage lane's integer millimetre format (unrounded). */
export function shapedCage(s: Shape, r?: Rig): CageData {
  if (isDefaultShape(s)) return cage
  return { ...cage, v: Array.from((r ?? rig(s)).points, x => x * 1000) }
}

export function shapedBody(s: Shape, detail: 0 | 1 | 2 = 0, r?: Rig): BodyPart[] {
  return buildBody(shapedCage(s, r), cage.levels[detail])
}

/** For the buggy-fit harness: the default shape, which must equal cage250. */
const shaped: Candidate = { id: 'shape-default', build: d => shapedBody(defaultShape(), d), numbers: 0 }
export default shaped
