/**
 * Round 1 Mira wordmark candidates, each generated from the letters and parameters below.
 * Every candidate gives a wordmark and a monogram for small sizes, both as one even-odd
 * path in the Syn3h wordmark's format (M, L, Z only).
 */
import { arc, circle, type Contour, crossings, move, orbit, type P, scale, shape, sparkle, toPath, bounds } from './geom'
import { aLambda, aLow, CAP, iCap, iLow, mFlat, mLow, mPointed, rCap, rLow, set, XT } from './letters'

export interface MarkPath { d: string; width: number; height: number }
export interface Candidate { id: number; name: string; note: string; word: MarkPath; mono: MarkPath; problems: string[] }

const GAP = 26
const caps = { s: 44, k: -30 }

/** The Syn3h underline: a bar under the word with its ends cut inward. */
function slab(x0: number, x1: number, y = CAP + 16, h = 32, cut = 26, k = 0): Contour {
  return shape([[x0, y, k], [x1, y, k], [x1 - cut, y + h, k], [x0 + cut, y + h, k]])
}

/** A tail that thickens from a point at x0 to a round head at hx. */
function comet(x0: number, hx: number, cy: number, half: number, r: number, power = 1.6): Contour {
  const join = hx - Math.sqrt(r * r - half * half), top: P[] = [], bottom: P[] = []
  for (let i = 0; i <= 80; i++) { const t = i / 80, x = x0 + (join - x0) * t, w = half * Math.pow(t, power); top.push([x, cy - w]); bottom.push([x, cy + w]) }
  const a0 = Math.atan2(-half, join - hx), a1 = Math.atan2(half, join - hx)
  const head: P[] = []
  for (let i = 1; i < 96; i++) { const a = a0 + (a1 - a0) * i / 96; head.push([hx + r * Math.cos(a), cy + r * Math.sin(a)]) }
  // Top edge out to the head, round the head clockwise (y down), bottom edge back.
  return [...top, ...head, ...bottom.reverse()].filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 0.01)
}

function ring(cx: number, cy: number, r: number, t: number): Contour[] { return [circle(cx, cy, r), circle(cx, cy, r - t)] }

/**
 * A ringed planet, Saturn fashion: the ring crosses in front of the planet's lower half,
 * cutting it with a clear gap, and passes behind it above. Built untilted, then turned.
 */
function ringedPlanet(cx: number, cy: number, r: number, tilt = -0.36): Contour[] {
  const rx = r * 2.05, ry = r * 0.62, t = r * 0.3, gap = r * 0.16, H = t / 2 + gap
  const front = (x: number) => ry * Math.sqrt(Math.max(0, 1 - (x * x) / (rx * rx)))
  const turn = (c: P[]): Contour => c.map(([x, y]) => [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)])
  // The planet above the ring: its arc over the top, closed along the ring's upper edge.
  const arcPts: P[] = []
  for (let i = 0; i <= 240; i++) { const a = Math.PI + Math.PI * i / 240, p: P = [r * Math.cos(a), r * Math.sin(a)]; if (p[1] < front(p[0]) - H) arcPts.push(p) }
  const xs = arcPts.map(p => p[0]), xl = Math.min(...xs), xr = Math.max(...xs)
  const edge: P[] = []
  for (let i = 1; i < 40; i++) { const x = xr - (xr - xl) * i / 40; edge.push([x, front(x) - H]) }
  const top = [...arcPts, ...edge]
  // The planet below the ring, if any shows.
  const below: P[] = []
  for (let i = 0; i <= 240; i++) { const a = Math.PI * i / 240, p: P = [r * Math.cos(a), r * Math.sin(a)]; if (p[1] > front(p[0]) + H) below.push(p) }
  const parts: Contour[] = [turn(top)]
  if (below.length > 6) {
    const bx = below.map(p => p[0]), bl = Math.min(...bx), br = Math.max(...bx), e2: P[] = []
    for (let i = 1; i < 30; i++) { const x = bl + (br - bl) * i / 30; e2.push([x, front(x) + H]) }
    parts.push(turn([...below, ...e2]))
  }
  // The ring: whole in front, broken behind the planet.
  const disc = [circle(0, 0, r)]
  const ringParts = orbit(disc, { cx: 0, cy: 0, rx, ry, thickness: t, gap, from: Math.PI, to: 2 * Math.PI, minPiece: 2 })
  const frontRing: P[] = [...arc(0, 0, rx + t / 2, ry + t / 2, 0, Math.PI), ...arc(0, 0, rx - t / 2, ry - t / 2, Math.PI, 0)]
  // Join the front half to the back pieces that touch its ends, so the ring has no seams.
  const backLeft = ringParts.find(c => c.some(([x]) => x < -rx + t)), backRight = ringParts.find(c => c.some(([x]) => x > rx - t))
  const rest = ringParts.filter(c => c !== backLeft && c !== backRight)
  const whole: P[] = []
  const lo = Math.PI, hi = 2 * Math.PI
  const leftEnd = backLeft ? Math.max(...ringAngles(backLeft, rx, ry)) : lo
  const rightStart = backRight ? Math.min(...ringAngles(backRight, rx, ry)) : hi
  whole.push(...arc(0, 0, rx + t / 2, ry + t / 2, rightStart - 2 * Math.PI, leftEnd), ...arc(0, 0, rx - t / 2, ry - t / 2, leftEnd, rightStart - 2 * Math.PI))
  void frontRing
  return [...parts, turn(whole), ...rest.map(turn)]
}
/** The ellipse angles (from π to 2π) a ring piece spans. */
function ringAngles(c: Contour, rx: number, ry: number): number[] {
  return c.map(([x, y]) => { let a = Math.atan2(y / ry, x / rx); if (a < 0) a += 2 * Math.PI; return a < Math.PI / 2 ? a + 2 * Math.PI : a })
}

function build(id: number, name: string, note: string, word: Contour[], mono: Contour[]): Candidate {
  return { id, name, note, word: toPath(word), mono: toPath(mono), problems: [...crossings(word).map(c => 'word ' + c), ...crossings(mono).map(c => 'mono ' + c)] }
}

function candidates(): Candidate[] {
  const out: Candidate[] = []
  const flat = set([mFlat(caps), iCap(caps), rCap(caps), aLambda(caps)], GAP)

  // 1. Slab: the direct heir. Flat-topped M, open A, the Syn3h underline.
  out.push(build(1, 'Slab', 'The direct heir: Syn3h’s cut corners and underline bar, MIRA in the same heavy extended caps. The A has no crossbar.',
    [...flat.contours, slab(-6, flat.width + 6)], mFlat(caps).contours))

  // 2. Comet: the underline becomes Mira’s tail, streaming behind a star that leads the word.
  {
    const hx = flat.width + 30
    const tail = comet(-4, hx, CAP + 30, 13, 24)
    out.push(build(2, 'Comet', 'Mira the star trails a tail thirteen light years long. Here Syn3h’s underline becomes that tail, thickening into the star at the end of the word.',
      [...flat.contours, tail], [...mFlat(caps).contours, comet(-4, 232 + 10, CAP + 30, 13, 24)]))
  }

  // 3. Orbit: a thin orbit tilted round the word, passing behind the letters, one world on it.
  {
    const w = flat.width, cx = w / 2, cy = CAP / 2, rx = w / 2 + 70, ry = 128, rot = -0.13, pa = -0.62
    const planetAt: P = [cx + rx * Math.cos(pa) * Math.cos(rot) - ry * Math.sin(pa) * Math.sin(rot), cy + rx * Math.cos(pa) * Math.sin(rot) + ry * Math.sin(pa) * Math.cos(rot)]
    const planet = circle(planetAt[0], planetAt[1], 17)
    const ink = [...flat.contours, planet]
    const path = orbit(ink, { cx, cy, rx, ry, rot, thickness: 8, gap: 10, minPiece: 10 })
    const m = mFlat(caps).contours, mrx = 168, mry = 122, mrot = -0.32, mpa = -1.25
    const mp: P = [116 + mrx * Math.cos(mpa) * Math.cos(mrot) - mry * Math.sin(mpa) * Math.sin(mrot), 89 + mrx * Math.cos(mpa) * Math.sin(mrot) + mry * Math.sin(mpa) * Math.cos(mrot)]
    const mworld = circle(mp[0], mp[1], 22)
    const mono = [...m, mworld, ...orbit([...m, mworld], { cx: 116, cy: 89, rx: mrx, ry: mry, rot: mrot, thickness: 15, gap: 14, minPiece: 10 })]
    out.push(build(3, 'Orbit', 'The lobby’s idea in the mark: an orbit tilted round the word, passing behind the letters, one world riding it.', [...ink, ...path], mono))
  }

  // 4. Star: lowercase, the dot of the i a four-pointed star.
  const low = { s: 42, r: 60 }
  const lowSet = set([mLow(low), iLow(low), rLow(low), aLow(low)], GAP - 4)
  const iX = lowSet.starts[1] + low.s / 2
  out.push(build(4, 'Star', 'Lowercase and rounder, friendlier for an exploration game. The dot of the i is Mira itself, a four-pointed star.',
    [...lowSet.contours, sparkle(iX, XT - 40, 34, 0.17)], [...move(mLow(low).contours, 0, 0), sparkle(236 + 30, XT - 30, 26, 0.17)]))

  // 5. Planet: lowercase, the dot of the i a ringed world.
  out.push(build(5, 'Ringed i', 'Lowercase, the dot of the i a small ringed planet: the game is visiting worlds.',
    [...lowSet.contours, ...ringedPlanet(iX, XT - 40, 22)], ringedPlanet(100, 100, 60)))

  // 6. Pointed: a V-cut M rhyming with the open A, a small world held in the A.
  {
    const pc = { s: 44, k: -22 }
    const p = set([mPointed(pc), iCap(pc), rCap(pc), aLambda(pc)], GAP)
    const a = p.starts[3] + 111
    out.push(build(6, 'Peaks', 'Sharper: the M cut to a V so it rhymes with the open A, and a small world held where the A’s crossbar would be.',
      [...p.contours, circle(a, 140, 17)], mPointed(pc).contours))
  }

  // 8. Ring: the M held in a ring, as Syn3h held its H.
  {
    const R = CAP / 2, t = 17, m = scale(mFlat({ s: 30, k: -18 }, 150).contours, 0.54, 0, 0)
    const mb = bounds(m), inside = move(m, R - (mb.x1 - mb.x0) / 2, R - (mb.y1 - mb.y0) / 2)
    const emblem = [...ring(R, R, R, t), ...inside]
    const rest = set([iCap(caps), rCap(caps), aLambda(caps)], GAP)
    out.push(build(8, 'Ringed M', 'Syn3h held a small H inside a ring. Mira holds its M the same way, so the emblem is the app icon too.',
      [...emblem, ...move(rest.contours, 2 * R + GAP)], emblem))
  }

  // 9. Flare: the I is a tall star flare, like the lobby's lens flare standing up.
  {
    const m = mFlat(caps), r = rCap(caps), a = aLambda(caps)
    const flareW = 84
    const flare = sparkle(0, CAP / 2, CAP / 2 + 24, 0.2).map(([x, y]): P => [x * 0.36 + flareW / 2, y])
    const word = set([m, { width: flareW, contours: [flare] }, r, a], GAP - 6)
    out.push(build(9, 'Flare', 'The I becomes a tall star flare, Mira shining between M and RA, like the lobby’s lens flare standing upright.',
      word.contours, [sparkle(100, 100, 100, 0.1)]))
  }

  // Peaks and Comet together: the V-cut M and open A over Mira's tail.
  {
    const pc = { s: 44, k: -22 }
    const p = set([mPointed(pc), iCap(pc), rCap(pc), aLambda(pc)], GAP)
    const tail = comet(-4, p.width + 30, CAP + 30, 13, 24)
    out.push(build(11, 'Peaks and tail', 'The two strongest ideas together: the sharp Peaks letters with Syn3h’s underline turned into Mira’s tail and star.',
      [...p.contours, tail], [...mPointed(pc).contours, comet(-4, 250 + 10, CAP + 30, 13, 24)]))
  }
  // Shown capitals first, then lowercase, numbered in that order.
  const order = ['Slab', 'Comet', 'Peaks', 'Peaks and tail', 'Orbit', 'Flare', 'Ringed M', 'Star', 'Ringed i']
  return order.map((name, i) => ({ ...out.find(c => c.name === name)!, id: i + 1 }))
}

let built: Candidate[] | null = null
/** Built on first use, so a page that never asks pays nothing. */
export function allCandidates(): Candidate[] { return built ??= candidates() }
export const candidateById = (id: number): Candidate | undefined => allCandidates().find(c => c.id === id)
