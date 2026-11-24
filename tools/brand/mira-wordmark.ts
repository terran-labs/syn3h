/**
 * Generates the Mira wordmark and its icon into src/ui/brand/wordmarkPath.ts.
 *   npx tsx tools/brand/mira-wordmark.ts
 *
 * The wordmark is the design the owner approved on 23 November 2026 (round 21 of the logo lab:
 * variant 15's letters and curved underline with variant 16's star). It replaces the slab of
 * 22 November (round 8, variant 1). It is one block with the letters cut into it:
 *
 *   - Each outer side arches in from the top and flares out to a point at the foot. Between,
 *     it is halfway between standing upright and leaning like a nose cone's side (`lean`).
 *   - The M has a smooth dip in its top and two bowed cuts that widen toward the foot.
 *   - The I and the A are Gothic: the I a lancet, the A an arch that is its own outside moved
 *     in by the wall's thickness.
 *   - The R is fitted to the A's leading side, one gap away.
 *   - Mira, a four-pointed star, stands above the I.
 *   - The underline is a crescent: level on top, one curve underneath, from tip to tip.
 *
 * The icon is Mira as a bold star with two swept orbits (see ICON below), chosen the same day.
 *
 * Change a number in APPROVED and run the tool; do not edit the generated file. Everything is
 * straight segments, because the logo renderer reads only M, L and Z (wordmarkMesh.ts).
 */
import { writeFileSync } from 'node:fs'
import { type Contour, meet, offsetLine, type P, signedDistanceTo, sparkle, toPath } from '../../src/ui/brand/mira/geom'
import { type Cap, Field } from '../../src/ui/brand/mira/field'

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

const { PI } = Math

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

// ---- the wordmark ---------------------------------------------------------------------------
const rise = (y0: number, y1: number, x: (y: number) => number, n = 100): P[] => Array.from({ length: n + 1 }, (_, i) => { const y = y0 + (y1 - y0) * i / n; return [x(y), y] as P })
function bowed(a: P, b: P, bow: number, n = 48): P[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, c: P = [(a[0] + b[0]) / 2 - dy / l * 2 * bow, (a[1] + b[1]) / 2 + dx / l * 2 * bow]
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as P })
}

interface Star {
  /** Radius of the star, tip to centre. */
  r: number
  /** Height of its centre: negative is above the top edge of the block, 0 is on it. */
  y: number
  /**
   * How it meets the block. `above`: it stands clear. `counter`: centred on the edge, its upper
   * half is solid above the block and its lower half is cut out of it, so the star changes from
   * light to dark as it crosses the edge. `moat`: the whole star is solid, and an even gap is cut
   * round the part of it that lies inside the block.
   */
  mode: 'above' | 'counter' | 'moat'
}
interface Look {
  /** How far in the side has arched by the top, and the height at which the arch begins. */
  arch: number; archFrom: number
  /** How far the flare runs out past the foot, and how far above the baseline it begins. */
  reach: number; flareFrom: number
  /** 0: the sides stand upright through their middle (round 20). 1: they lean all the way down, as a nose cone's side (round 19). 0.5 is halfway. */
  lean: number
  /** The underline. `crescent`: flat on top, one curve underneath. `keel`: a bar of one thickness with a point at each TOP outer corner and the underside curving down from it. */
  under: 'crescent' | 'keel'
  bar: number
  /** The I's cut: a round-headed doorway or a pointed lancet. */
  i: 'door' | 'lancet'
  star?: Star
  /** The A's cut: a round-headed doorway, or a Gothic arch that follows the A's outside at an even distance. */
  a: 'door' | 'gothic'
}

function mark(f: Field, o: Look): void {
  // One outer side, as a distance in from the foot. Upper part: a blend of round 20's arch-then-upright and round 19's nose cone.
  const og = (o.arch * o.arch + CAP * CAP) / (2 * o.arch), flareTop = CAP - o.flareFrom
  const upright = (y: number) => y < o.archFrom ? o.arch * Math.pow(1 - y / o.archFrom, 2) : 0
  const cone = (y: number) => og - Math.sqrt(og * og - (CAP - y) ** 2)
  /** The side without its flare: also the A's leading edge, which the R is fitted to. */
  const lean = (y: number) => { const c = Math.min(CAP, Math.max(0, y)); return (1 - o.lean) * upright(c) + o.lean * cone(c) }
  const side = (y: number) => lean(y) - (y > flareTop ? o.reach * Math.pow((y - flareTop) / (CAP - flareTop), 3) : 0)

  const mc = o.arch + 40, mEnd = mc + 50 + 38, ix = mEnd + GAP, rx = ix + SLAB + GAP, ax = rx + 124, end = ax + 2 * o.arch, mid = ax + o.arch
  const d1 = mEnd + GAP / 2, d2 = ix + SLAB + GAP / 2, aSide = (y: number) => ax + lean(y)

  const body = f.blank()
  body.polygon([[...rise(CAP, 0, side), ...rise(0, CAP, y => end - side(y))]])
  const drop = (n: number) => Array.from({ length: n }, (_, i) => 5 + 11 * Math.pow(i / (n - 1), 0.8))
  const line = (points: P[], start: Cap = 'round', finish: Cap = 'butt') => body.cutStroke({ points, width: drop(points.length), start, end: finish })
  const crowned = (points: P[]) => body.cutStroke({ points, width: points.map((_, i) => 6 + 9 * Math.sin(PI * i / (points.length - 1))), start: 'butt', end: 'butt' })

  // M.
  const half = 44, depth = 36
  body.cut([mc - half, -4, mc + half, depth], (x, y) => y < depth * Math.cos((x - mc) / half * PI / 2) ** 2 ? -1 : 1)
  for (const s of [-1, 1]) line(bowed([mc + s * 50, 64], [mc + s * 6, CAP + 14], s * 8))

  // I. A star that reaches into the block pushes the doorway's crown down to clear it.
  const r = (d2 - d1) / 2, im = (d1 + d2) / 2, star = o.star
  const crown = star && star.mode !== 'above' ? star.y + star.r + 18 : 34
  if (o.i === 'door') crowned([[d1, CAP + 14], ...Array.from({ length: 41 }, (_, i): P => [im - r * Math.cos(PI * i / 40), crown + r - r * Math.sin(PI * i / 40)]), [d2, CAP + 14]])
  else {
    const shoulder = crown + 58, big = 2 * r, arcTo = (s: number) => Array.from({ length: 25 }, (_, k): P => { const a = Math.acos(1 - k / 24 * 0.5); return [im + s * (r - big * (1 - Math.cos(a))), shoulder - big * Math.sin(a)] })
    crowned([[d1, CAP + 14], ...arcTo(-1), ...arcTo(1).reverse().slice(1), [d2, CAP + 14]])
  }
  const starShape: Contour | null = star ? sparkle(im, star.y, star.r, 0.16) : null
  if (star && starShape && star.mode === 'counter') body.subtract(body.blank().polygon([starShape]))
  if (star && starShape && star.mode === 'moat') body.subtract(body.blank().polygon([starShape]), 7)

  // R.
  line([[rx + SLAB + 6, 52], [aSide(52) - GAP - SLAB, 52]], 'round', 'round')
  line(bowed([rx + 38, 102], [rx + 74, CAP + 14], 9))
  body.cutStroke({ points: rise(-14, CAP + 14, y => aSide(y) - GAP / 2), width: GAP, start: 'butt', end: 'butt' })

  // A.
  const wall = 38
  if (o.a === 'door') { const ar = o.arch - wall; crowned([[mid - ar, CAP + 14], ...Array.from({ length: 41 }, (_, i): P => [mid - ar * Math.cos(PI * i / 40), 78 + ar - ar * Math.sin(PI * i / 40)]), [mid + ar, CAP + 14]]) }
  else {
    // The A's own leading side, moved in by the wall's thickness along its normal at every point, until it reaches the middle.
    const left: P[] = []
    for (let k = 0; k <= 400; k++) {
      const y = CAP + 14 - (CAP + 14) * k / 400, dx = aSide(y - 0.5) - aSide(y + 0.5), l = Math.hypot(dx, 1), p: P = [aSide(y) + wall / l, y + wall * dx / l]
      if (p[0] >= mid) { const q = left[left.length - 1]; left.push([mid, q[1] + (p[1] - q[1]) * (mid - q[0]) / (p[0] - q[0])]); break }
      left.push(p)
    }
    crowned([...left, ...left.slice(0, -1).reverse().map(([x, y]): P => [2 * mid - x, y])])
  }

  body.cut([-1e4, -1e4, 1e4, 0], (_x, y) => y); body.cut([-1e4, CAP, 1e4, 1e4], (_x, y) => CAP - y)
  f.merge(body)
  if (star && starShape) {
    const s = f.blank().polygon([starShape])
    // Counterchange: only the half above the edge is solid; the half below was cut out of the block.
    if (star.mode === 'counter') s.cut([-1e4, 0, 1e4, 1e4], (_x, y) => -y)
    f.merge(s)
  }

  const y0 = CAP + GAP, t = o.bar, x0 = -o.reach, x1 = end + o.reach
  if (o.under === 'crescent') {
    const cx = end / 2, hw = (x1 - x0) / 2
    f.polygon([[[x0, y0], [x1, y0], ...Array.from({ length: 81 }, (_, i) => { const u = 1 - i / 40; return [cx + u * hw, y0 + (t + 2) * (1 - Math.pow(Math.abs(u), 2.4))] as P })]])
    return
  }
  // Keel. The TOP edge is level and runs the full width, from a point at (x0, y0) to a point at
  // (x1, y0): those points sit straight under the letters' points, one gap below them. The
  // UNDERSIDE leaves each point and curves DOWN and inward until it is level at the bar's full
  // thickness. This is the letters' flare mirrored top to bottom.
  const run = t * 2.4, down = (d: number) => y0 + t * (1 - Math.pow(1 - d / run, 3))
  const leftUnder = Array.from({ length: 61 }, (_, i): P => { const d = run * i / 60; return [x0 + d, down(d)] })
  f.polygon([[[x0, y0], [x1, y0], ...leftUnder.map(([x, y]): P => [end - x, y]), ...leftUnder.slice().reverse()]])
}


/** The approved wordmark's numbers. */
const APPROVED: Look = {
  arch: 70, archFrom: 96, reach: 44, flareFrom: 54, lean: 0.5,
  under: 'crescent', bar: 36, i: 'lancet', a: 'gothic',
  // The star's tip stands 4 units above the block's top edge.
  star: { r: 42, y: -46, mode: 'above' },
}

// ---- the icon ------------------------------------------------------------------------------
// The owner chose it on 23 November 2026 (the lab's icon 33, "Swept rings", in white and blue),
// and on 24 November asked that nothing be cropped by the edge and the inner ring meet the star cleanly:
// Mira as a bold four-pointed star, with three orbits tilted steeply across the square and a world
// on each. It is kept in three parts (rings, worlds, star) so each can take its own colour, and
// so a platform that restyles icons can be given the parts as layers.
const ICON = {
  /** The square the parts are drawn in, and the margin the icon shows round it. */
  size: 200, margin: 6,
  /** Tilt of the orbits: the system seen from above its own plane, turned a little anticlockwise. */
  tilt: -0.32,
  /** The star's radius and the rings' thickness. */
  star: 52, line: 4,
  /**
   * Each orbit: half its length, half its breadth, where on it its world sits (radians), and the
   * world's radius. Both orbits and their worlds lie wholly inside the square, so no edge cuts
   * them. Both are long enough to pass outside the tips of the star's left and right rays with
   * room to spare, so they are cut only where they pass behind its upright rays, which they
   * cross nearly square on. (An orbit that reached only as far as the side tips ran along those
   * rays and was cut back into ragged stubs.)
   */
  orbits: [[78, 30, 2.6, 8], [89, 37, -0.7, 9], [100, 44, 0.62, 11]] as [number, number, number, number][],
  /**
   * A small shift for each world, by eye. The inner world sits a little inside its orbit, up and
   * to the right, so it reads as belonging to the inner ring and not to the one outside it.
   */
  nudge: [[5, -1], [0, 0], [0, 0]] as [number, number][],
}
function iconParts(): { rings: Contour[]; worlds: Contour[]; star: Contour[] } {
  const c = ICON.size / 2, blank = () => new Field(-30, -30, ICON.size + 30, ICON.size + 30, 0.25)
  const on = (rx: number, ry: number, a: number): P => { const x = rx * Math.cos(a), y = ry * Math.sin(a); return [c + x * Math.cos(ICON.tilt) - y * Math.sin(ICON.tilt), c + x * Math.sin(ICON.tilt) + y * Math.cos(ICON.tilt)] }
  const star = blank().polygon([sparkle(c, c, ICON.star, 0.14)]), worlds = blank(), rings = blank()
  // What is cleared out of the rings round the star. Not the star grown evenly: that reached past
  // the tips of the left and right rays and bit square notches into rings that only pass beside
  // them. This is a fatter star that is taller than the real one, so a ring crossing an upright
  // ray is cut well clear of it, and narrower than the real one, so it stops short of the side
  // tips and the rings beside them are left whole.
  const clearing = blank().polygon([sparkle(c, c, ICON.star + 10, 0.3).map(([x, y]): P => [c + (x - c) * 0.7, y])])
  const at = ICON.orbits.map(([rx, ry, a], k): P => { const p = on(rx, ry, a), n = ICON.nudge[k] ?? [0, 0]; return [p[0] + n[0], p[1] + n[1]] })
  at.forEach(([x, y], k) => worlds.circle(x, y, ICON.orbits[k][3]))
  for (const [rx, ry] of ICON.orbits) {
    const g = blank().stroke({ points: Array.from({ length: 201 }, (_, i) => on(rx, ry, 2 * PI * i / 200)), width: ICON.line })
    g.subtract(clearing)
    // A world clears a ring only where the ring runs into it: its own ring, or a neighbour whose
    // line passes under its disc. A ring that merely passes close by is left whole. (Clearing
    // every ring within reach left a dent in the edge of a ring that only skirted the clearance.)
    const line = Array.from({ length: 401 }, (_, i) => on(rx, ry, 2 * PI * i / 400))
    at.forEach(([x, y], k) => { const r = ICON.orbits[k][3]; if (Math.min(...line.map(p => Math.hypot(p[0] - x, p[1] - y))) < r + ICON.line / 2 + 1) g.cutCircle(x, y, r + 5) })
    rings.merge(g)
  }
  return { rings: rings.trace(0.03), worlds: worlds.trace(0.03), star: star.trace(0.03) }
}
/** A path in the icon square's own coordinates (not moved to its ink box, so the parts stay registered). */
const inSquare = (cs: Contour[]): string => cs.map(k => 'M' + k.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join('L') + 'Z').join('')

const word = toPath(trace([-110, -170, 700, 260], f => mark(f, APPROVED))), parts = iconParts()
console.log(`wordmark ${word.width} by ${word.height}, ${word.d.length} characters; icon parts ${inSquare(parts.rings).length}, ${inSquare(parts.worlds).length} and ${inSquare(parts.star).length} characters`)
writeFileSync(new URL('../../src/ui/brand/wordmarkPath.ts', import.meta.url), `/**
 * The Mira wordmark and its icon, each as one vector path (fill-rule evenodd), generated by
 * tools/brand/mira-wordmark.ts. Generated: edit the tool, not this file.
 */
export const WORDMARK_WIDTH = ${word.width}
export const WORDMARK_HEIGHT = ${word.height}
export const WORDMARK_PATH = '${word.d}'
/**
 * The icon in three parts, in a ${ICON.size} square's coordinates: Mira as a star, two orbits and their
 * worlds. Shown with ICON_MARGIN of sky round the square; the outer orbit runs past the edge.
 */
export const ICON_SIZE = ${ICON.size}
export const ICON_MARGIN = ${ICON.margin}
export const ICON_RINGS = '${inSquare(parts.rings)}'
export const ICON_WORLDS = '${inSquare(parts.worlds)}'
export const ICON_STAR = '${inSquare(parts.star)}'
`)
