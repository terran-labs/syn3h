/**
 * Generates the Mira wordmark and its icon into src/ui/brand/wordmarkPath.ts.
 *   npx tsx tools/brand/mira-wordmark.ts
 *
 * This is the design the owner approved on 22 November 2026 (round 8, variant 1 of the logo
 * lab; the rounds that led to it are in tools/brand/mira-round4.ts and mira.html). It is one
 * slab with the letters cut into it as slits, standing on a plate:
 *
 *   - The slab's outer edges, the slit between R and A and the A's chevron all rise two up for
 *     one across (SLOPE).
 *   - Every gap is the same GAP: the slits, the cuts between letters, and slab to plate.
 *   - The M's V notch sets the slope of the three corner cuts (down the M's upper right, up
 *     the I's left, down the R's upper right), so with the slit between them the M's and I's
 *     cuts repeat the M's notch.
 *   - The icon is the M alone, the same slope on both sides, on a plate of its own width.
 *
 * Change a number here and run the tool; do not edit the generated file. Everything is
 * straight segments, because the logo renderer reads only M, L and Z (wordmarkMesh.ts).
 */
import { writeFileSync } from 'node:fs'
import { type Contour, meet, offsetLine, type P, signedDistanceTo, toPath } from '../../src/ui/brand/mira/geom'
import { Field } from '../../src/ui/brand/mira/field'

/** Path units. The cap height matches the Syn3h wordmark's, so the lobby's sizing carries over. */
const CAP = 178
/** Thickness of a letter's stroke where one shows: the I, the R's stem, the A's legs. */
const SLAB = 46
/** Every gap in the mark, measured across it. */
const GAP = 12
/** Sideways run per unit of height for the outer edges, the R to A slit and the A's chevron. */
const SLOPE = 0.5
/** The M's V notch: half its width at the top, and its depth. Its slope is the corner cuts' slope. */
const NOTCH_HALF = 37, NOTCH_DEPTH = 42
/** Depth of the three corner cuts. At 36 the M and I cuts, with the slit between, make the M's notch again. */
const CUT_DEPTH = 36
/** Flat top either side of the M's notch. */
const SHOULDER = 30
/** Width of the R at the baseline. */
const R_WIDTH = 88
/** Flat top of the A. */
const A_FLAT = 30
/** Height of the plate, and how far its ends lean in at the bottom. */
const PLATE = 34
/** The icon M's flat-topped core, between its two sloped sides. */
const ICON_CORE = 150
/** Grid step of the distance field the shapes are cut in, and how closely the outline is simplified. */
const CELL = 0.3, TOLERANCE = 0.04

// ---- kit --------------------------------------------------------------------------------
const rect = (x0: number, y0: number, x1: number, y1: number): Contour => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
/** A band of width w along a path, with sharp mitred corners and square ends. */
function band(pts: P[], w: number): Contour {
  const side = (by: number): P[] => pts.map((p, i) => {
    if (i === 0) return offsetLine(pts[0], pts[1], by)[0]
    if (i === pts.length - 1) return offsetLine(pts[i - 1], p, by)[1]
    const [a1, a2] = offsetLine(pts[i - 1], p, by), [b1, b2] = offsetLine(p, pts[i + 1], by)
    return meet(a1, a2, b1, b2)
  })
  return [...side(w / 2), ...side(-w / 2).reverse()]
}
const add = (f: Field, c: Contour): void => { f.polygon([c]) }
function cut(f: Field, c: Contour): void {
  const xs = c.map(p => p[0]), ys = c.map(p => p[1])
  f.cut([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (x, y) => signedDistanceTo([x, y], [c]))
}
/** Trims everything above the cap line and below the baseline, so cuts that overshoot end square. */
function clip(f: Field): void {
  f.cut([-1e4, -1e4, 1e4, 0], (_x, y) => y); f.cut([-1e4, CAP, 1e4, 1e4], (_x, y) => CAP - y)
}
const plate = (x0: number, x1: number): Contour => [[x0, CAP + GAP], [x1, CAP + GAP], [x1 - PLATE, CAP + GAP + PLATE], [x0 + PLATE, CAP + GAP + PLATE]]
function trace(extent: [number, number, number, number], build: (f: Field) => void): Contour[] {
  const f = new Field(...extent, CELL)
  build(f)
  return f.trace(TOLERANCE)
}

/** The M's cuts about its centre line: the notch from the top and the V of slits under it. */
function cutM(f: Field, cx: number): void {
  cut(f, [[cx - NOTCH_HALF, -1], [cx, NOTCH_DEPTH], [cx + NOTCH_HALF, -1]])
  cut(f, band([[cx - 55, 62], [cx - 5, CAP + 14]], GAP)); cut(f, band([[cx + 55, 62], [cx + 5, CAP + 14]], GAP))
}

function wordmark(f: Field): void {
  const run = SLOPE * CAP, across = GAP * Math.hypot(1, SLOPE), notch = NOTCH_HALF / (NOTCH_DEPTH + 1), b = CUT_DEPTH * notch
  // Left to right along the baseline: M, I, R, the slit, A.
  const mCentre = run + SHOULDER + NOTCH_HALF, mRight = mCentre + NOTCH_HALF + SHOULDER + b
  const iLeft = mRight + GAP, iRight = iLeft + SLAB, rLeft = iRight + GAP, rFoot = rLeft + R_WIDTH
  const aLeft = rFoot + across, aTop = aLeft + run, end = aTop + A_FLAT + run
  add(f, [[0, CAP], [run, 0], [aTop + A_FLAT, 0], [end, CAP]])

  cutM(f, mCentre)
  cut(f, [[mRight - b - 2 * notch, -2], [mRight + 2, -2], [mRight + 2, CUT_DEPTH + 2 / notch]])
  cut(f, rect(mRight, -1, iLeft, CAP + 1))
  cut(f, [[iLeft + b + 2 * notch, -2], [iLeft - 2, -2], [iLeft - 2, CUT_DEPTH + 2 / notch]])
  cut(f, rect(iRight, -1, rLeft, CAP + 1))

  // R: its trailing edge leans over the A at the slab's slope.
  const edge = (y: number) => rFoot + SLOPE * (CAP - y), at52 = edge(52)
  cut(f, [[rLeft + SLAB, 46], [at52 - 52, 46], [at52 - 46, 52], [at52 - 52, 58], [rLeft + SLAB, 58]])
  // The gap under the bowl runs at the slope of the M's slits, to reach the baseline in so narrow a letter.
  cut(f, band([[rLeft + 40, 104], [rLeft + 40 + 86 * 50 / 130, CAP + 12]], GAP))
  const mid = (y: number) => edge(y) + across / 2
  cut(f, band([[mid(-14), -14], [mid(CAP + 14), CAP + 14]], GAP))
  cut(f, [[edge(CUT_DEPTH) - (CUT_DEPTH + 2) * notch, -2], [edge(CUT_DEPTH), CUT_DEPTH], [edge(-2) + 1, -2]])

  // A: a chevron slit, each arm one slab in from its edge.
  const ax = aTop + A_FLAT / 2, inset = (SLAB + GAP / 2) * Math.hypot(1, SLOPE), foot = aLeft + inset - 14 * SLOPE
  cut(f, band([[foot, CAP + 14], [ax, (inset - A_FLAT / 2) / SLOPE], [2 * ax - foot, CAP + 14]], GAP))

  clip(f)
  add(f, plate(0, end))
}
function icon(f: Field): void {
  const run = SLOPE * CAP, width = 2 * run + ICON_CORE
  add(f, [[0, CAP], [run, 0], [run + ICON_CORE, 0], [width, CAP]])
  cutM(f, width / 2)
  clip(f)
  add(f, plate(0, width))
}

const word = toPath(trace([-20, -20, 700, 250], wordmark)), mark = toPath(trace([-20, -20, 360, 250], icon))
console.log(`wordmark ${word.width} by ${word.height}, ${word.d.length} characters; icon ${mark.width} by ${mark.height}, ${mark.d.length} characters`)
writeFileSync(new URL('../../src/ui/brand/wordmarkPath.ts', import.meta.url), `/**
 * The Mira wordmark and its icon, each as one vector path (fill-rule evenodd), generated by
 * tools/brand/mira-wordmark.ts. Generated: edit the tool, not this file.
 */
export const WORDMARK_WIDTH = ${word.width}
export const WORDMARK_HEIGHT = ${word.height}
export const WORDMARK_PATH = '${word.d}'
/** The M on its plate: app icons and the favicon. */
export const ICON_WIDTH = ${mark.width}
export const ICON_HEIGHT = ${mark.height}
export const ICON_PATH = '${mark.d}'
`)
