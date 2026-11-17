import { skin, byRole, type Candidate, type Tagger } from './loft'
import { hullSections, columns, rings, CREASES } from './hull'
import { HULL } from './dataHull'

/**
 * Level C: the designed hull (hull.ts) with its features. The lab's Skins group loads this
 * module as the loft body (design=generated-loft).
 */
const plain: Tagger = (_x, _y, _z, n) => n[1] < -.7 ? 'chrome' : 'paint'
const ALONG: Record<0 | 1 | 2, number> = { 0: 66, 1: 26, 2: 12 }

const levelC: Candidate = {
  id: 'sections-C',
  numbers: HULL.z.length * 10,
  build: detail => byRole(skin(hullSections(HULL), 0, 0, plain, { us: rings(ALONG[detail]), vs: columns(detail), creases: CREASES })),
}
export default levelC
