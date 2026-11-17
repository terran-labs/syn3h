import { superSections, skin, byRole, DETAIL, type Candidate, type Tagger } from './loft'
import { A_ROWS } from './dataA'

/**
 * Level A: the buggy body as nine superellipse stations, the form a player could edit with
 * sliders (length, width, deck and floor heights, squareness). No wing, scoops or openings.
 */
const rows = A_ROWS.map(r => r.map(v => v / 1000))
const tag: Tagger = (_x, _y, _z, ny) => ny < -.7 ? 'chrome' : 'paint'
const levelA: Candidate = {
  id: 'sections-A',
  numbers: rows.length * rows[0].length,
  build: detail => byRole(skin(superSections(rows), DETAIL[detail][0], DETAIL[detail][1], tag)),
}
export default levelA
