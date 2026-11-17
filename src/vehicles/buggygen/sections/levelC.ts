import type { Candidate } from './loft'
import { buildLoft } from './design'
import { HULL } from './dataHull'
import { FEATURES, FEATURE_NUMBERS } from './dataFeatures'

/**
 * Level C: the fitted loft design (dataHull.ts and dataFeatures.ts) built by design.ts. The
 * lab's Skins group loads this module as the loft body (design=generated-loft).
 */
const hullNumbers = HULL.z.length * 10 + (HULL.arches ? Object.keys(HULL.arches).length : 0)
const levelC: Candidate = {
  id: 'sections-C',
  numbers: hullNumbers + FEATURE_NUMBERS,
  build: detail => buildLoft({ hull: HULL, features: FEATURES }, detail),
}
export default levelC
