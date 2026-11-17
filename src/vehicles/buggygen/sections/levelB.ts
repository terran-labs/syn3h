import { polarSections, skin, byRole, DETAIL, type Candidate, type Tagger } from './loft'
import { B_ROWS } from './dataB'

/**
 * Level B: free sections. Each station's right half is a smooth polar curve of K radii about
 * a centre, fitted to the reference by least squares. No separate features.
 */
const rows = B_ROWS.map(r => r.map(v => v / 1000))
const tag: Tagger = (_x, _y, _z, n) => n[1] < -.7 ? 'chrome' : 'paint'
const levelB: Candidate = {
  id: 'sections-B',
  numbers: rows.length * rows[0].length,
  build: detail => byRole(skin(polarSections(rows), DETAIL[detail][0], DETAIL[detail][1], tag)),
}
export default levelB
