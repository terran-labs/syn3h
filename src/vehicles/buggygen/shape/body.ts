import { buildBody, type BodyPart, type CageData, type Candidate } from '../cage/generator'
import { data as cage } from '../cage/cage250'
import { deform, defaultShape, type Shape } from './handles'

/**
 * The cage buggy body with shape handles applied. The cage's points move, then the cage lane's
 * own subdivision builds the surface, so creases, roles and normals behave exactly as in the
 * fitted body.
 */

const frameRole = cage.roles.indexOf('frame')
/** Points that belong to any frame face (the scoops and socket wells). */
const FRAME = (() => {
  const m = new Uint8Array(cage.v.length / 3)
  for (let f = 0; f < cage.t.length; f++) if (cage.t[f] === frameRole) for (let k = 0; k < 3; k++) m[cage.f[f * 3 + k]] = 1
  return m
})()

/** The cage with the shape applied, in the cage lane's integer millimetre format (unrounded). */
export function shapedCage(s: Shape, base: CageData = cage): CageData {
  const p = Float64Array.from(base.v, x => x / 1000)
  deform(p, base === cage ? FRAME : new Uint8Array(p.length / 3), s)
  return { ...base, v: Array.from(p, x => x * 1000) }
}

export function shapedBody(s: Shape, detail: 0 | 1 | 2 = 0): BodyPart[] {
  return buildBody(shapedCage(s), cage.levels[detail])
}

/** For the buggy-fit harness: the default shape, which must equal cage250. */
const shaped: Candidate = { id: 'shape-default', build: d => shapedBody(defaultShape(), d), numbers: 0 }
export default shaped
