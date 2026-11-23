/**
 * Generates the round 3 Mira candidates into src/ui/brand/mira/round3.ts.
 *   npx tsx tools/brand/mira-round3.ts
 *
 * Round 2 varied one letter. Round 3 starts from sources instead: space agency marks (the
 * NASA worm, mission patches), Soviet space hardware (hull lettering, Sputnik, Elektronika
 * panels, constructivist posters) and alien signals (fragments, a dot-matrix message, a
 * variable star's light curve). Each candidate is one idea. Strokes and shapes merge in a
 * distance field (src/ui/brand/mira/field.ts) and are traced back to one even-odd path.
 */
import { writeFileSync } from 'node:fs'
import { arc, type Contour, type P, sparkle, toPath } from '../../src/ui/brand/mira/geom'
import { type Cap, chain, Field } from '../../src/ui/brand/mira/field'

const CELL = 0.3, CAP = 178
const { PI } = Math

// ---- construction kit -------------------------------------------------------------------

/** A path corner: x, y, a round radius, and optionally the y its rounded tip must reach. */
type RP = [number, number, number?, number?]
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const len = (a: P) => Math.hypot(a[0], a[1])
const unit = (a: P): P => { const l = len(a) || 1; return [a[0] / l, a[1] / l] }
const line = (a: P, b: P, n = 12): P[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n] as P)
/** The point `by` past `to` on the line from `from`. */
const beyond = (from: P, to: P, by: number): P => { const d = unit(sub(to, from)); return [to[0] + d[0] * by, to[1] + d[1] * by] }

function cornerArc(a: P, p: P, b: P, r: number): P[] {
  const u1 = unit(sub(a, p)), u2 = unit(sub(b, p))
  const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
  if (th > PI - 1e-3 || th < 1e-3) return [p]
  let d = r / Math.tan(th / 2)
  const lim = Math.min(len(sub(a, p)), len(sub(b, p))) * 0.5
  if (d > lim) { d = lim; r = d * Math.tan(th / 2) }
  const bis = unit([u1[0] + u2[0], u1[1] + u2[1]]), k = r / Math.sin(th / 2)
  const c: P = [p[0] + bis[0] * k, p[1] + bis[1] * k]
  const t1: P = [p[0] + u1[0] * d, p[1] + u1[1] * d], t2: P = [p[0] + u2[0] * d, p[1] + u2[1] * d]
  const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0])
  let sweep = Math.atan2(t2[1] - c[1], t2[0] - c[0]) - a0
  while (sweep > PI) sweep -= 2 * PI
  while (sweep < -PI) sweep += 2 * PI
  const n = Math.max(6, Math.ceil(Math.abs(sweep) / (2 * PI) * 90))
  return Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + sweep * i / n), c[1] + r * Math.sin(a0 + sweep * i / n)] as P)
}
/**
 * An open path with rounded corners. A corner given a fit height is moved up or down until
 * the tip of its curve lands on that height, so rounded peaks still reach the cap line.
 */
function fillet(input: RP[]): P[] {
  const pts = input.map(p => [...p] as RP)
  const at = (i: number): P => [pts[i][0], pts[i][1]]
  for (let pass = 0; pass < 10; pass++) for (let i = 1; i < pts.length - 1; i++) {
    const fit = pts[i][3]; if (fit === undefined) continue
    const ys = cornerArc(at(i - 1), at(i), at(i + 1), pts[i][2] ?? 0).map(p => p[1])
    const peak = pts[i - 1][1] > pts[i][1] && pts[i + 1][1] > pts[i][1]
    pts[i][1] += fit - (peak ? Math.min(...ys) : Math.max(...ys))
  }
  const out: P[][] = []
  for (let i = 0; i < pts.length; i++) out.push(i === 0 || i === pts.length - 1 || !pts[i][2] ? [at(i)] : cornerArc(at(i - 1), at(i), at(i + 1), pts[i][2]!))
  return chain(...out)
}
/** Flat cuts: everything below `y`, or above it, is removed (feet and tops cut square). */
const cutBelow = (f: Field, y: number): Field => f.cut([-1e4, y, 1e4, y + 400], (_x, py) => y - py)
const cutAbove = (f: Field, y: number): Field => f.cut([-1e4, y - 400, 1e4, y], (_x, py) => py - y)
const star5 = (cx: number, cy: number, R: number, rot = -PI / 2): Contour => Array.from({ length: 10 }, (_, i) => { const a = rot + i * PI / 5, r = i % 2 ? R * 0.382 : R; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P })

type Pen = (points: P[], width: number | number[], start?: Cap, end?: Cap) => void
const pen = (f: Field, grow = 0, map: (p: P) => P = p => p): Pen => (points, width, start = 'butt', end = 'butt') => { f.stroke({ points: points.map(map), width, start, end }, grow) }

function trace(extent: [number, number, number, number], build: (f: Field) => void): Contour[] {
  const f = new Field(...extent, CELL)
  build(f)
  return f.trace(0.05)
}

// ---- the worm letters, reused by the patch ----------------------------------------------

interface WormOpts { x: number; base: number; cap: number; w: number; grow?: number; /** Draw the M as round 2's ribbon: two arches joined by a hairpin. */ ribbon?: boolean }
const wormWidths = (cap: number, w: number) => { const k = cap / 178; return { M: 214 * k, I: w, R: 150 * k, A: 198 * k, gap: 18 * k } }
function wormWidth(cap: number, w: number, text: string): number {
  const W = wormWidths(cap, w); return [...text].reduce((s, ch) => s + W[ch as 'M'], 0) + W.gap * (text.length - 1)
}
/**
 * Letters as one bent tube of even weight, in the manner of the 1975 NASA logotype: every
 * turn is round, the A has no crossbar, feet and tops are cut flat.
 */
function worm(f: Field, o: WormOpts, text = 'MIRA'): void {
  const k = o.cap / 178, w = o.w, h = w / 2, top = o.base - o.cap, T = top + h, ext = o.base + 40 * k, fr = 15 * k
  const g = f.blank(), S = pen(g, o.grow ?? 0), W = wormWidths(o.cap, w)
  let x = o.x
  for (const ch of text) {
    if (ch === 'M' && o.ribbon) {
      const u = w * 0.85, r = (W.M - w - 2 * u) / 4, cy = T + r, yU = o.base - o.cap * 0.3, x1 = x + h + 2 * r, x2 = x1 + 2 * u
      S(chain(line([x + h, ext], [x + h, cy]), arc(x + h + r, cy, r, r, PI, 2 * PI, 0, 40), line([x1, cy], [x1, yU]), arc(x1 + u, yU, u, u, PI, 0, 0, 24), line([x2, yU], [x2, cy]), arc(x2 + r, cy, r, r, PI, 2 * PI, 0, 40), line([x2 + 2 * r, cy], [x2 + 2 * r, ext])), w)
    } else if (ch === 'M') S(fillet([[x + h, ext], [x + h, T, fr, T], [x + W.M / 2, o.base - h, fr, o.base - h], [x + W.M - h, T, fr, T], [x + W.M - h, ext]]), w)
    if (ch === 'I') S([[x + h, ext], [x + h, top - 10]], w)
    if (ch === 'R') {
      const rb = 40 * k, mid = T + 2 * rb
      S([[x + h, ext], [x + h, top - 10]], w)
      S(fillet([[x + h, T], [x + W.R - h, T, rb], [x + W.R - h, mid, rb], [x + h, mid]]), w)
      const knee: P = [x + h + (W.R - w) * 0.36, mid], foot: P = [x + W.R - h + 3 * k, o.base]
      S([knee, beyond(knee, foot, 40 * k)], w, 'round')
    }
    if (ch === 'A') {
      const apex: P = [x + W.A / 2, T - 30 * k], l: P = [x + h + 4 * k, o.base], r: P = [x + W.A - h - 4 * k, o.base]
      S(fillet([beyond(apex, l, 40 * k), [apex[0], apex[1], fr, T], beyond(apex, r, 40 * k)]), w)
    }
    x += W[ch as 'M'] + W.gap
  }
  cutBelow(g, o.base); cutAbove(g, top)
  f.merge(g)
}

interface Built { id: number; family: string; name: string; note: string; word: Contour[]; mono: Contour[] }
const out: Built[] = []

// 1. Worm.
{
  const w = 28
  out.push({ id: 1, family: 'Space agency', name: 'Worm', note: 'The word as one bent tube of even weight, after the 1975 NASA logotype: every turn round, the A with no crossbar, feet cut flat.',
    word: trace([-20, -20, wormWidth(CAP, w, 'MIRA') + 20, 200], f => worm(f, { x: 0, base: CAP, cap: CAP, w })),
    mono: trace([-20, -20, 240, 200], f => worm(f, { x: 0, base: CAP, cap: CAP, w }, 'M')) })
}

// 2. Patch: a mission patch. A dark world, the word knocked out of it, an orbit and a star.
{
  const patch = (f: Field, cx: number, cy: number, R: number, text: string, cap: number, w: number) => {
    f.circle(cx, cy, R)
    const x = cx - wormWidth(cap, w, text) / 2, base = cy + cap / 2
    const letters = f.blank(), near = f.blank()
    worm(letters, { x, base, cap, w }, text); worm(near, { x, base, cap, w, grow: R * 0.045 }, text)
    f.subtract(letters)
    const rot = -0.34, rx = R * 1.42, ry = R * 0.44, ow = R * 0.05
    // The near half of the orbit crosses the world's face (knocked out, stopping short of the
    // letters); the far half shows only where it clears the limb.
    f.subtract(f.blank().stroke({ points: arc(cx, cy, rx, ry, 0, PI, rot, 120), width: ow }).subtract(near))
    f.merge(f.blank().stroke({ points: arc(cx, cy, rx, ry, 0, 2 * PI, rot, 240), width: ow }).cutCircle(cx, cy, R + ow * 1.3))
    const a = -0.42, ex = rx * Math.cos(a), ey = ry * Math.sin(a)
    const sx = cx + ex * Math.cos(rot) - ey * Math.sin(rot), sy = cy + ex * Math.sin(rot) + ey * Math.cos(rot)
    f.polygon([sparkle(sx, sy, R * 0.2, 0.16)])
    // A few stars in the world's sky.
    for (const [dx, dy, r] of [[-0.5, -0.52, 0.03], [-0.16, -0.72, 0.022], [0.3, -0.58, 0.035], [0.56, 0.5, 0.025], [-0.6, 0.36, 0.022], [0.02, 0.74, 0.03]]) f.cutCircle(cx + dx * R, cy + dy * R, r * R)
  }
  out.push({ id: 2, family: 'Space agency', name: 'Patch', note: 'A mission patch in one colour: a dark world with the word knocked out of it, an orbit crossing its face and a star riding the orbit. In the lobby the disc reads as an eclipse.',
    word: trace([-90, -40, 420, 340], f => patch(f, 160, 150, 150, 'MIRA', 62, 11.5)),
    mono: trace([-90, -40, 420, 340], f => patch(f, 160, 150, 150, 'M', 120, 21)) })
}

// 3. Мир: the name in Cyrillic, as hull lettering.
{
  const w = 21, h = w / 2, k = 0.2, ext = CAP + 30
  const build = (f: Field, text: string) => {
    const g = f.blank(), S = pen(g, 0, p => [p[0] + (CAP - p[1]) * k, p[1]])
    let x = 0
    for (const ch of text) {
      let W = 0
      if (ch === 'М') { W = 184; S([[x + h, ext], [x + h, h], [x + W / 2, CAP - h], [x + W - h, h], [x + W - h, ext]], w) }
      if (ch === 'И') { W = 152; S([[x + h, -30], [x + h, CAP - h], [x + W - h, h], [x + W - h, ext]], w) }
      if (ch === 'Р') { W = 132; const rb = 46; S([[x + h, ext], [x + h, -30]], w); S(fillet([[x + h, h], [x + W - h, h, rb], [x + W - h, h + 2 * rb, rb], [x + h, h + 2 * rb]]), w) }
      if (ch === 'А') {
        W = 176; const apex: P = [x + W / 2, h], l: P = [x + h, CAP], r: P = [x + W - h, CAP], yb = 122, t = (yb - h) / (CAP - h)
        S([beyond(apex, l, 30), apex, beyond(apex, r, 30)], w)
        S([[apex[0] + (l[0] - apex[0]) * t, yb], [apex[0] + (r[0] - apex[0]) * t, yb]], w * 0.86)
      }
      x += W + 22
    }
    cutBelow(g, CAP); cutAbove(g, 0); f.merge(g)
    return x - 22
  }
  out.push({ id: 3, family: 'Cosmonaut', name: 'Мир', note: 'The name in Cyrillic, slanted like the lettering on the Mir station and Buran, with a five-pointed star. МИРА is Russian for “of peace” and “of the world”. It reads as Mira to a Russian speaker and as a puzzle to everyone else: a secondary mark, or an easter egg.',
    word: trace([-20, -30, 900, 200], f => { const end = build(f, 'МИРА'); f.polygon([star5(end + 62, 34, 32)]) }),
    mono: trace([-20, -30, 320, 200], f => { const end = build(f, 'М'); f.polygon([star5(end + 54, 34, 32)]) }) })
}

// 4. Sputnik: round 2's candidate 6 pushed to Soviet panel lettering, Sputnik dotting the i.
{
  const XH = 120, B = CAP, XT = B - XH, w = 20, h = w / 2, T = XT + h, R = 25
  const sputnik = (f: Field, cx: number, cy: number, r: number, back: number, reach: number) => {
    f.circle(cx, cy, r)
    for (const [da, L] of [[-0.52, 0.86], [-0.18, 1], [0.16, 1], [0.5, 0.86]]) {
      const a = back + da, c = Math.cos(a), s = Math.sin(a)
      const pts = line([cx + c * r * 0.6, cy + s * r * 0.6], [cx + c * (r + reach * L), cy + s * (r + reach * L)], 12)
      f.stroke({ points: pts, width: pts.map((_, i) => r * (0.34 - 0.16 * i / 12)), start: 'round', end: 'round' })
    }
  }
  const m = (S: Pen, x: number, W: number) => { S([[x + h, B], [x + h, XT]], w); S(fillet([[x, T], [x + W - h, T, R], [x + W - h, B]]), w); S([[x + W / 2, T], [x + W / 2, B]], w) }
  out.push({ id: 4, family: 'Cosmonaut', name: 'Sputnik', note: 'Round 2’s candidate 6 taken further: square-shouldered lowercase like the lettering on Soviet instrument panels, one even weight, and Sputnik with its four antennae as the dot of the i.',
    word: trace([-20, -110, 640, 200], f => {
      const S = pen(f); m(S, 0, 196)
      const ix = 196 + 24 + h; S([[ix, B], [ix, XT]], w)
      const rx = ix + h + 24; S([[rx + h, B], [rx + h, XT]], w); S(fillet([[rx, T], [rx + 88 - h, T, R], [rx + 88 - h, T + 32]]), w)
      const ax = rx + 88 + 22, AW = 132, mid = T + 50
      S(fillet([[ax + 10, T], [ax + AW - h, T, R], [ax + AW - h, B]]), w)
      S(fillet([[ax + AW - h, mid], [ax + h, mid, 24], [ax + h, B - h, 24], [ax + AW - h, B - h]]), w)
      sputnik(f, ix, 18, 15, -0.42, 92)
    }),
    mono: trace([-20, -110, 360, 200], f => { m(pen(f), 0, 196); sputnik(f, 196 - 40, 8, 18, -0.6, 72) }) })
}

// 5. Monolith: constructivist solids.
{
  const tri = (a: P, b: P, c: P): Contour => [a, b, c]
  const M: Contour = [[0, CAP], [0, 0], [88, 106], [176, 0], [176, CAP]]
  const word = (): Contour[] => {
    const cs: Contour[] = [M]
    let x = 176 + 20
    cs.push([[x, 0], [x + 46, 0], [x + 46, CAP], [x, CAP]]); x += 46 + 20
    cs.push([[x, 0], [x + 46, 0], [x + 46, CAP], [x, CAP]])
    const bx = x + 46 + 9, rb = 52
    cs.push([[bx, 0], ...arc(bx, rb, rb, rb, -PI / 2, PI / 2, 0, 48), [bx, 2 * rb]])
    cs.push(tri([bx, 2 * rb + 9], [bx + rb + 6, CAP], [bx, CAP])); x = bx + rb + 6 + 14
    cs.push([[x, CAP], [x + 92, 0], [x + 184, CAP], [x + 118, CAP], [x + 92, CAP - 50], [x + 66, CAP]])
    return cs
  }
  out.push({ id: 5, family: 'Cosmonaut', name: 'Monolith', note: 'Constructivist poster shapes: a wedge-cut block, a bar, a half disc and two triangles, no strokes at all. In the lobby these are dark slabs with lit edges. The heaviest of the round, on purpose.', word: word(), mono: [M] })
}

// 6. Xeno: the letters in pieces.
{
  const w = 9, h = w / 2, gap = 13, track = 62
  const m = (S: Pen, x: number, W: number) => {
    S([[x + h, -20], [x + h, CAP + 20]], w); S([[x + W - h, -20], [x + W - h, CAP + 20]], w)
    const v: P = [x + W / 2 - gap * 0.42, 116], t: P = [x + w + gap + 2, 0]
    S([beyond(v, t, 20), v], w); S([beyond([2 * x + W - v[0], v[1]], [2 * x + W - t[0], 0], 20), [2 * x + W - v[0], v[1]]], w)
  }
  out.push({ id: 6, family: 'Alien', name: 'Xeno', note: 'Hairline letters in pieces that never touch, set wide apart, the way the 1979 Alien title assembles itself. Cold and cinematic; the thin lines carry the lobby glow well but vanish at favicon size, so the icon is the M alone.',
    word: trace([-20, -30, 900, 210], f => {
      const g = f.blank(), S = pen(g)
      m(S, 0, 150)
      let x = 150 + track
      S([[x + h, -20], [x + h, 34]], w); S([[x + h, 34 + gap], [x + h, CAP + 20]], w); x += w + track
      const RW = 118, mid = 96, rb = (mid - h) / 2
      S([[x + h, -20], [x + h, CAP + 20]], w)
      S(fillet([[x + w + gap, h], [x + RW - h, h, rb], [x + RW - h, mid, rb], [x + w + gap, mid]]), w)
      const k: P = [x + w + gap + 20, mid + gap + h]; S([k, beyond(k, [x + RW - h, CAP], 20)], w); x += RW + track
      const AW = 156, apex: P = [x + AW / 2, -8]
      S([beyond(apex, [x + h, CAP], 20), apex, beyond(apex, [x + AW - h, CAP], 20)], w)
      S([[x + AW / 2 - 18, 124], [x + AW / 2 + 18, 124]], w)
      cutBelow(g, CAP); cutAbove(g, 0); f.merge(g)
    }),
    mono: trace([-20, -30, 200, 210], f => { const g = f.blank(); m(pen(g), 0, 150); cutBelow(g, CAP); cutAbove(g, 0); f.merge(g) }) })
}

// 7. Message: the word as a dot-matrix transmission.
{
  const glyphs: Record<string, string[]> = {
    M: ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
    I: ['X', 'X', 'X', 'X', 'X', 'X', 'X'],
    R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
    A: ['..X..', '.X.X.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X'],
  }
  const pitch = 26.5, r = 9.5
  const dots = (text: string): Contour[] => {
    const cs: Contour[] = []
    let x = r
    for (const ch of text) {
      const rows = glyphs[ch]
      rows.forEach((row, j) => [...row].forEach((c, i) => { if (c === 'X') cs.push(arc(x + i * pitch, r + j * pitch, r, r, 0, 2 * PI, 0, 40).slice(0, -1)) }))
      x += rows[0].length * pitch + pitch * 1.25
    }
    return cs
  }
  out.push({ id: 7, family: 'Alien', name: 'Message', note: 'The word sent as a grid of dots, like the 1974 Arecibo message or a Soviet indicator panel. Every dot takes the lobby glow, so the name reads as a field of lit points.', word: dots('MIRA'), mono: dots('M') })
}

// 8. Pulse: the M is Mira's own light curve.
{
  const w = 14, h = w / 2, L = CAP - h, T = h, period = 98, x0 = 40
  const pulses = (endX: number): P[] => fillet([[h, L], [x0, L, 9], [x0 + 0.38 * period, T, 5, T], [x0 + period, L, 8, L], [x0 + 1.38 * period, T, 5, T], [x0 + 2 * period, L, 12], [endX, L]])
  const b2 = CAP - w - 22
  out.push({ id: 8, family: 'Alien', name: 'Pulse', note: 'Mira was the first variable star ever recorded: it brightens quickly and fades slowly, every 332 days. The M is two of those pulses, drawn to the real proportions (38 percent rise, 62 percent fall), and the trace runs on as Syn3h’s underline.',
    word: trace([-20, -20, 720, 210], f => {
      const g = f.blank(), S = pen(g)
      let x = x0 + 2 * period + 34
      S([[x + h, b2 + 20], [x + h, -20]], w); x += w + 26
      const RW = 106, rb = 36, mid = T + 2 * rb
      S([[x + h, b2 + 20], [x + h, -20]], w); S(fillet([[x + h, T], [x + RW - h, T, rb], [x + RW - h, mid, rb], [x + h, mid]]), w)
      const k: P = [x + h + 34, mid]; S([k, beyond(k, [x + RW - h + 2, b2], 20)], w, 'round'); x += RW + 20
      const AW = 132, apex: P = [x + AW / 2, T - 10]
      S(fillet([beyond(apex, [x + h, b2], 20), [apex[0], apex[1], 6, T], beyond(apex, [x + AW - h, b2], 20)]), w); x += AW
      cutBelow(g, b2); cutAbove(g, 0); f.merge(g)
      f.stroke({ points: pulses(x + 26), width: w, start: 'round', end: 'round' }); f.circle(x + 26, L, 12)
    }),
    mono: trace([-20, -20, 300, 210], f => { const end = x0 + 2 * period + 30; f.stroke({ points: pulses(end), width: w, start: 'round', end: 'round' }); f.circle(end, L, 12) }) })
}

// 9. Tube: round 2's candidate 9 as a set of one-stroke letters.
{
  const XH = 120, B = CAP, w = 17, h = w / 2, top = B - XH + h, u = w * 0.85, r = XH * 0.27
  const m = (S: Pen, x: number): number => {
    const cy = top + r, yU = B - XH * 0.3, x1 = x + h + 2 * r, x2 = x1 + 2 * u
    S(chain(line([x + h, B], [x + h, cy]), arc(x + h + r, cy, r, r, PI, 2 * PI, 0, 40), line([x1, cy], [x1, yU]), arc(x1 + u, yU, u, u, PI, 0, 0, 24), line([x2, yU], [x2, cy]), arc(x2 + r, cy, r, r, PI, 2 * PI, 0, 40), line([x2 + 2 * r, cy], [x2 + 2 * r, B])), w)
    return x2 + 2 * r + h - x
  }
  out.push({ id: 9, family: 'From round 2', name: 'Tube', note: 'Round 2’s candidate 9 kept and firmed up: the ribbon m with its hairpin, a little heavier, an r bent from one tube like a cane, and Mira’s star over the i.',
    word: trace([-20, -40, 640, 200], f => {
      const S = pen(f), gap = 24
      let x = m(S, 0) + gap
      S([[x + h, B], [x + h, B - XH]], w); f.polygon([sparkle(x + h, B - XH - 36, 27, 0.16)]); x += w + gap
      const ra = 31; S(chain(line([x + h, B], [x + h, top + ra]), arc(x + h + ra, top + ra, ra, ra, PI, 2 * PI - 0.55, 0, 40)), w, 'butt', 'round'); x += h + ra * 1.86 + gap * 0.7
      const Ra = XH / 2 - h, cx = x + h + Ra
      f.add([x, B - XH, x + 2 * Ra + w, B], (px, py) => Math.abs(Math.hypot(px - cx, py - (B - XH / 2)) - Ra) - h)
      S([[cx + Ra, B], [cx + Ra, B - XH + h * 0.2]], w)
    }),
    mono: trace([-20, -60, 300, 200], f => { const W = m(pen(f), 0); f.polygon([sparkle(W + 8, B - XH - 14, 26, 0.16)]) }) })
}

// 10. Ribbon worm: candidate 9's m, as a capital, inside the worm.
{
  const w = 26
  out.push({ id: 10, family: 'From round 2', name: 'Ribbon worm', note: 'Candidate 1 with round 2’s ribbon M in place of its pointed one: two arches joined by a hairpin, so the whole word is bent tube and the M is the letter you remember.',
    word: trace([-20, -20, wormWidth(CAP, w, 'MIRA') + 20, 200], f => worm(f, { x: 0, base: CAP, cap: CAP, w, ribbon: true })),
    mono: trace([-20, -20, 240, 200], f => worm(f, { x: 0, base: CAP, cap: CAP, w, ribbon: true }, 'M')) })
}

const data = out.map(c => ({ id: c.id, family: c.family, name: c.name, note: c.note, word: toPath(c.word), mono: toPath(c.mono) }))
for (const c of data) console.log(c.id, c.name, c.word.width, c.word.height, c.word.d.length)
writeFileSync(new URL('../../src/ui/brand/mira/round3.ts', import.meta.url), `/**
 * Round 3 Mira candidates, generated by tools/brand/mira-round3.ts.
 * Generated: edit the tool, not this file.
 */
import type { MarkPath } from './candidates'

export interface Round3Candidate { id: number; family: string; name: string; note: string; word: MarkPath; mono: MarkPath }
export const ROUND3: Round3Candidate[] = ${JSON.stringify(data)}
`)
