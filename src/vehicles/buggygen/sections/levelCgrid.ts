import { polarSections, superSections, skin, byRole, featureTagger, featureWarp, DETAIL, type Candidate, type Tagger, type BodyPiece } from './loft'
import { B_ROWS } from './dataB'
import { FEATURES, WING, PLATE, PLATE_X } from './dataC'

/**
 * Level C: the Level B hull plus features. Each feature is an ellipse drawn on the loft grid
 * (dataC.ts): it tags cells with a role or skips them to cut the cockpit, and pulls nearby
 * grid vertices onto its edge so the edge is smooth. The rear wing and its end plates are
 * small superellipse lofts of their own.
 */
const rows = B_ROWS.map(r => r.map(v => v / 1000))
const plain: Tagger = (_x, _y, _z, n) => n[1] < -.7 ? 'chrome' : 'paint'
const hullTag = featureTagger(FEATURES, plain)
const wingTag = featureTagger(FEATURES.filter(f => f.role === 'accent'), plain)

/** A small superellipse loft, shifted sideways. */
function part(r: number[][], along: number, half: number, x: number, tag: Tagger): BodyPiece[] {
  const pieces = skin(superSections(r), along, half, (px, py, pz, n) => tag(px + x, py, pz, n))
  if (x) for (const p of pieces) p.geometry.translate(x, 0, 0)
  return pieces
}

const levelC: Candidate = {
  id: 'sections-C-grid',
  numbers: rows.length * rows[0].length + FEATURES.length * 9 + WING.flat().length + PLATE.flat().length + 1,
  build: detail => {
    const [along, half] = DETAIL[detail], small = Math.max(2, Math.round(half / 3))
    // The distant build is silhouette only: no cuts or painted features, which its cells are too coarse to draw.
    const pieces = detail < 2 ? skin(polarSections(rows), along, half, hullTag, { warp: featureWarp(FEATURES) }) : skin(polarSections(rows), along, half, plain)
    pieces.push(...part(WING, Math.max(3, Math.round(along / 12)), small * 2, 0, wingTag))
    for (const s of [1, -1]) pieces.push(...part(PLATE, Math.max(3, Math.round(along / 10)), small, s * PLATE_X, () => 'paint'))
    return byRole(pieces)
  },
}
export default levelC
