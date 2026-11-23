/**
 * Generates the round 2 Mira candidates into src/ui/brand/mira/round2.ts.
 *   npx tsx tools/brand/mira-round2.ts
 *
 * One library of sleek M's (each a set of strokes, drawn at any height and weight) is tried in
 * two families: Syn3h lineage capitals (light cut-corner IRA, the bar, tail or ringed emblem)
 * and the lowercase planet-dot family that grew from round 1's candidate 9. Strokes and shapes
 * merge in a distance field (src/ui/brand/mira/field.ts) and are traced back to one even-odd
 * path per mark.
 */
import { writeFileSync } from 'node:fs'
import { arc, type Contour, type P, sparkle, toPath, bounds, move } from '../../src/ui/brand/mira/geom'
import { chain, cubic, Field, type Stroke } from '../../src/ui/brand/mira/field'
import { aLambda, iCap, mLow, iLow, rLow, aLow, rCap, set } from '../../src/ui/brand/mira/letters'

const CELL = 0.3

/** Evenly spaced points along a straight run, so tapers vary smoothly. */
const line = (a: P, b: P, n = 12): P[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n] as P)

interface MOpts { H: number; w: number; base: number; taper?: [number, number] }
interface MShape { strokes: Stroke[]; width: number; /** Where a run-on stroke leaves, if the M has one. */ exit?: P; exitStroke?: (to: P[]) => Stroke }

/** Width per point for a taper: `top` at the top of the letter, `foot` at the baseline. */
function tapered(points: P[], o: MOpts): number[] | number {
  if (!o.taper) return o.w
  const [top, foot] = o.taper, y0 = o.base - o.H
  return points.map(([, y]) => { const t = Math.max(0, Math.min(1, (y - y0) / o.H)); return top + (foot - top) * Math.pow(t, 1.4) })
}

/** The M library. Each takes the letter height, weight and baseline; x starts at 0. */
const M: Record<string, { name: string; note: string; draw: (o: MOpts) => MShape }> = {
  A: { name: 'Fine apex', note: 'Upright stems, fine strokes, one deep V to the baseline.', draw: o => {
    const h = o.w / 2, W = o.H * 1.12, top = o.base - o.H + h
    const pts = chain([[h, o.base], [h, top]], [[W / 2, o.base - h * 1.2]], [[W - h, top], [W - h, o.base]])
    return { width: W, strokes: [{ points: pts, width: o.w, start: 'butt', end: 'butt' }] }
  } },
  B: { name: 'Splayed', note: 'Legs leaning out, two sharp peaks and a shallow V: the M as a mountain range.', draw: o => {
    const h = o.w / 2, W = o.H * 1.3, top = o.base - o.H + h
    const pts: P[] = [[h, o.base], [W * 0.24, top], [W / 2, o.base - o.H * 0.42], [W * 0.76, top], [W - h, o.base]]
    return { width: W, strokes: [{ points: pts, width: o.w, start: 'butt', end: 'butt' }] }
  } },
  C: { name: 'Arches', note: 'Candidate 9’s round arches, now as clean strokes of even weight.', draw: o => arches(o, false) },
  D: { name: 'Ribbon', note: 'One unbroken stroke: up, over, down into a hairpin, up and over again.', draw: o => {
    const h = o.w / 2, r = o.H * 0.27, u = o.w * 0.85, top = o.base - o.H + h, cy = top + r, yU = o.base - o.H * 0.3
    const x1 = h + 2 * r, x2 = x1 + 2 * u
    const pts = chain(line([h, o.base], [h, cy]), arc(h + r, cy, r, r, Math.PI, 2 * Math.PI, 0, 40), line([x1, cy], [x1, yU]),
      arc(x1 + u, yU, u, u, Math.PI, 0, 0, 24), line([x2, yU], [x2, cy]), arc(x2 + r, cy, r, r, Math.PI, 2 * Math.PI, 0, 40), line([x2 + 2 * r, cy], [x2 + 2 * r, o.base]))
    return { width: x2 + 2 * r + h, strokes: [{ points: pts, width: tapered(pts, o), start: 'butt', end: 'butt' }] }
  } },
  E: { name: 'Tapered arches', note: 'The arches carry the weight at the top and taper to fine points at the baseline.', draw: o => arches({ ...o, taper: [o.w * 1.25, o.w * 0.3] }, false) },
  F: { name: 'Waveform', note: 'Two tall arcs and no straight lines, meeting at the baseline like a wave.', draw: o => {
    const h = o.w / 2, r = o.H * 0.33, ry = o.H - h
    const a1 = arc(h + r, o.base, r, ry, Math.PI, 2 * Math.PI, 0, 60), a2 = arc(h + 3 * r, o.base, r, ry, Math.PI, 2 * Math.PI, 0, 60)
    return { width: 4 * r + o.w, strokes: [{ points: a1, width: tapered(a1, o), start: 'butt', end: 'butt' }, { points: a2, width: tapered(a2, o), start: 'butt', end: 'butt' }] }
  } },
  G: { name: 'Run-on', note: 'Arches whose last leg does not stop: it bends at the baseline and runs on, into the bar, the tail or an orbit.', draw: o => arches(o, true) },
}

/** Round arches; with `runOn` the last leg leaves its end open for a stroke to continue. */
function arches(o: MOpts, runOn: boolean): MShape {
  const h = o.w / 2, r = o.H * 0.27, top = o.base - o.H + (o.taper ? o.taper[0] / 2 : h), cy = top + r
  const first = chain(line([h, o.base], [h, cy]), arc(h + r, cy, r, r, Math.PI, 2 * Math.PI, 0, 40), line([h + 2 * r, cy], [h + 2 * r, o.base]))
  const xr = h + 4 * r
  const second = chain(arc(h + 3 * r, cy, r, r, Math.PI, 2 * Math.PI, 0, 40), line([xr, cy], [xr, o.base]))
  const strokes: Stroke[] = [{ points: first, width: tapered(first, o), start: 'butt', end: 'butt' }]
  if (!runOn) { strokes.push({ points: second, width: tapered(second, o), start: 'round', end: 'butt' }); return { width: xr + h, strokes } }
  return { width: xr + h, strokes, exit: [xr, o.base], exitStroke: rest => ({ points: chain(second, rest), width: o.w, start: 'round', end: 'round' }) }
}

/** Adds an M to a field at x offset `dx`; returns its shape (moved). */
function placeM(f: Field, key: string, o: MOpts, dx: number, runOn?: (exit: P) => { points: P[]; widths?: number[] }): MShape {
  const shape = M[key].draw(o)
  const shift = (s: Stroke): Stroke => ({ ...s, points: s.points.map(([x, y]): P => [x + dx, y]) })
  for (const s of shape.strokes) f.stroke(shift(s))
  if (shape.exitStroke && shape.exit) {
    const exit: P = [shape.exit[0] + dx, shape.exit[1]]
    const tail = runOn ? runOn(exit) : { points: [] }
    const st = shift(shape.exitStroke([]))
    const pts = chain(st.points, tail.points)
    const widths = tail.widths ? [...st.points.map(() => o.w), ...tail.widths].slice(0, pts.length) : o.w
    while (Array.isArray(widths) && widths.length < pts.length) widths.push(widths[widths.length - 1])
    f.stroke({ points: pts, width: widths, start: 'round', end: tail.points.length ? 'round' : 'butt' })
  }
  return shape
}

/** A planet with a tilted ring crossing in front of it, the ring cut clear of the planet behind. */
function ringedPlanet(f: Field, cx: number, cy: number, r: number, tilt = -0.36, ringW = r * 0.24): void {
  const rx = r * 2.05, ry = r * 0.6, gap = r * 0.16
  const front = arc(cx, cy, rx, ry, 0, Math.PI, tilt, 60), back = arc(cx, cy, rx, ry, Math.PI, 2 * Math.PI, tilt, 60)
  const planet = f.blank().circle(cx, cy, r).cutStroke({ points: front, width: ringW }, gap)
  const behind = f.blank().stroke({ points: back, width: ringW }).cutCircle(cx, cy, r + gap)
  f.merge(planet).merge(behind).stroke({ points: front, width: ringW })
}

/** A tail from a point at x0 thickening to a round star at hx. */
function comet(f: Field, x0: number, hx: number, y: number, thick: number, r: number): void {
  const pts = line([x0, y], [hx, y], 60)
  f.stroke({ points: pts, width: pts.map((_, i) => Math.max(0.6, thick * Math.pow(i / 60, 1.5))), start: 'round', end: 'round' })
  f.circle(hx, y, r)
}

function trace(build: (f: Field) => void, extent: [number, number, number, number]): Contour[] {
  const f = new Field(...extent, CELL)
  build(f)
  return f.trace(0.05)
}

interface Built { id: number; family: 'Lineage' | 'Planet'; m: string; name: string; note: string; word: Contour[]; mono: Contour[] }
const out: Built[] = []
const CAP = 178

// Lineage capitals: the round 1 IRA at about half the weight, small cut corners.
const lw = { s: 18, k: -8 }
function ira(dx: number, world = false) {
  const g = set([iCap(lw), rCap(lw, 168), aLambda(lw, 186)], 24)
  const contours = move(g.contours, dx)
  return { contours, width: g.width, aCentre: dx + g.starts[2] + 93 , world }
}
const capM = (w: number): MOpts => ({ H: CAP, w, base: CAP })

// L1. Fine apex over a fine bar.
{
  const o = capM(18)
  const word = trace(f => {
    const m = placeM(f, 'A', o, 0), r = ira(m.width + 24)
    f.polygon(r.contours)
    const x1 = m.width + 24 + r.width
    f.polygon([[[-4, CAP + 18], [x1 + 4, CAP + 18], [x1 - 10, CAP + 30], [10, CAP + 30]]])
  }, [-20, -20, 820, 240])
  const mono = trace(f => { placeM(f, 'A', o, 0) }, [-20, -20, 260, 200])
  out.push({ id: 1, family: 'Lineage', m: 'A', name: 'Fine apex and bar', note: 'Syn3h’s underline bar and cut-corner capitals at half the weight, with a fine-stroked M whose V runs to the baseline.', word, mono })
}
// L2. Arches with the comet tail.
{
  const o = capM(18)
  const word = trace(f => {
    const m = placeM(f, 'C', o, 0), r = ira(m.width + 24)
    f.polygon(r.contours)
    comet(f, -2, m.width + 24 + r.width + 26, CAP + 26, 12, 15)
  }, [-20, -20, 860, 260])
  const mono = trace(f => { const m = placeM(f, 'C', o, 0); comet(f, -2, m.width + 18, CAP + 26, 12, 15) }, [-20, -20, 300, 260])
  out.push({ id: 2, family: 'Lineage', m: 'C', name: 'Arches and comet', note: 'Round arches for the M, the light cut-corner IRA, and the round 1 comet tail ending in a star.', word, mono })
}
// L3. Run-on: the M's last leg becomes the tail.
{
  const o = capM(18)
  let end = 0
  const word = trace(f => {
    const shape = M.G.draw(o), rr = ira(shape.width + 24)
    end = shape.width + 24 + rr.width + 30
    placeM(f, 'G', o, 0, exit => {
      const q = 22, y = CAP + 22
      const bend = arc(exit[0] + q, exit[1], q, q, Math.PI, Math.PI / 2, 0, 16)
      const run = line([exit[0] + q, y], [end, y], 60)
      return { points: chain(bend, run), widths: [...bend.map(() => o.w), ...run.map((_, i) => o.w * (1 - 0.55 * i / 60))] }
    })
    f.polygon(rr.contours)
    f.circle(end, CAP + 22, 13)
  }, [-20, -20, 880, 260])
  // The run-on bend alone reads as "mL", so the icon keeps the arches and the star.
  const mono = trace(f => { const m = placeM(f, 'C', o, 0); comet(f, -2, m.width + 18, CAP + 26, 12, 15) }, [-20, -20, 300, 260])
  out.push({ id: 3, family: 'Lineage', m: 'G', name: 'Run-on tail', note: 'The M’s last leg never stops: it bends at the baseline and becomes the underline, thinning as it runs under IRA to the star.', word, mono })
}
// L4. Splayed M, the A holding a world, no bar.
{
  const o = capM(18)
  const word = trace(f => {
    const m = placeM(f, 'B', o, 0), r = ira(m.width + 20)
    f.polygon(r.contours)
    f.circle(r.aCentre, CAP - 40, 13)
  }, [-20, -20, 860, 200])
  const mono = trace(f => { placeM(f, 'B', o, 0) }, [-20, -20, 260, 200])
  out.push({ id: 4, family: 'Lineage', m: 'B', name: 'Peaks and world', note: 'A splayed M like a mountain range, and the round 1 idea of the A holding a small world in place of its crossbar.', word, mono })
}
// L5. Ringed emblem with the waveform M.
{
  const R = CAP / 2, t = 11
  const emblem = (f: Field) => {
    f.add([0, 0, 2 * R, 2 * R], (x, y) => Math.abs(Math.hypot(x - R, y - R) - (R - t / 2)) - t / 2)
    const o: MOpts = { H: 82, w: 12, base: R + 41 }
    const shape = M.F.draw(o)
    placeM(f, 'F', o, R - shape.width / 2)
  }
  const word = trace(f => { emblem(f); f.polygon(ira(2 * R + 22).contours) }, [-20, -20, 760, 200])
  const mono = trace(emblem, [-20, -20, 200, 200])
  out.push({ id: 5, family: 'Lineage', m: 'F', name: 'Ringed wave', note: 'Syn3h held its H in a ring. Here the ring holds a waveform M, and the emblem doubles as the app icon.', word, mono })
}

// The planet family: lowercase, x-height 120 on the same baseline.
const XH = 120, B = CAP
const lowM = (w: number, taper?: [number, number]): MOpts => ({ H: XH, w, base: B, taper })
/** Lowercase i, r and a as strokes of weight w, from x = 0; returns the i's centre too. */
function ira2(f: Field, x: number, w: number, gap: number): { iX: number; end: number } {
  const h = w / 2, top = B - XH
  const iX = x + h
  f.stroke({ points: [[iX, B], [iX, top]], width: w, start: 'butt', end: 'butt' })
  const rx = iX + h + gap + h, rr = XH * 0.3
  f.stroke({ points: chain(line([rx, B], [rx, top + h + rr]), arc(rx + rr, top + h + rr, rr, rr, Math.PI, 1.5 * Math.PI, 0, 24), [[rx + rr * 1.45, top + h]]), width: w, start: 'butt', end: 'butt' })
  const ax = rx + rr * 1.45 + gap * 0.9, R = XH / 2 - h
  f.add([ax, top, ax + 2 * R + w, B], (px, py) => Math.abs(Math.hypot(px - (ax + h + R), py - (top + XH / 2)) - R) - h)
  f.stroke({ points: [[ax + w + 2 * R, top + h * 0.2], [ax + w + 2 * R, B]], width: w, start: 'butt', end: 'butt' })
  return { iX, end: ax + 2 * R + 1.5 * w }
}
const planetFamily = (id: number, m: string, name: string, note: string, w: number, dot: 'ring' | 'star' | 'planet', taper?: [number, number]) => {
  const o = lowM(w, taper)
  const word = trace(f => {
    const shape = placeM(f, m, o, 0)
    const { iX } = ira2(f, shape.width + 22, w, 22)
    if (dot === 'ring') ringedPlanet(f, iX, B - XH - 36, 15)
    else if (dot === 'star') f.polygon([sparkle(iX, B - XH - 36, 26, 0.16)])
    else f.circle(iX, B - XH - 30, 13)
  }, [-20, -20, 720, 200])
  const mono = trace(f => {
    const shape = placeM(f, m, o, 0)
    const x = shape.width + 4
    if (dot === 'ring') ringedPlanet(f, x, B - XH - 22, 17)
    else if (dot === 'star') f.polygon([sparkle(x, B - XH - 18, 24, 0.16)])
    else f.circle(x, B - XH - 16, 13)
  }, [-40, -40, 320, 200])
  out.push({ id, family: 'Planet', m, name, note, word, mono })
}

// N1. Candidate 9 itself at a lighter weight: its m, i, r and a, kept as drawn.
{
  const low = { s: 26, r: 52 }
  const g = set([mLow(low, 220), iLow(low), rLow(low, 112), aLow(low, 150)], 24)
  const iX = g.starts[1] + low.s / 2
  const word = trace(f => { f.polygon(g.contours); ringedPlanet(f, iX, 58 - 38, 17) }, [-20, -40, 640, 200])
  const mono = trace(f => { f.polygon(mLow(low, 220).contours); ringedPlanet(f, 226, 58 - 24, 19) }, [-40, -40, 320, 200])
  out.push({ id: 6, family: 'Planet', m: '9', name: 'Nine, lighter', note: 'Candidate 9 as you saw it, its letterforms untouched, at about two thirds of the weight and with more air between the letters.', word, mono })
}
planetFamily(7, 'C', 'Arches', 'Candidate 9’s arches redrawn as one even weight of stroke, every corner round, with the ringed planet over the i.', 17, 'ring')
planetFamily(8, 'E', 'Tapered', 'The arches thick at the top and tapering to fine points at the baseline, as though drawn with one sweep of a pen.', 16, 'ring', [22, 6])
planetFamily(9, 'D', 'Ribbon', 'A bolder departure: the m as one unbroken ribbon folding through a hairpin, with Mira’s star over the i.', 14, 'star')
planetFamily(10, 'F', 'Wave', 'A bolder departure: the m as two arcs like a waveform, no straight lines in it, a plain planet over the i.', 14, 'planet')
// N5. Orbit run-on: the m's last stroke becomes an orbit carrying the i's planet.
{
  const w = 14, o = lowM(w)
  const build = (f: Field, rightEnd: number | null) => {
    const shape = M.G.draw(o)
    const q = 22 + w, gap = 22
    const iXguess = shape.width + gap + w / 2
    let iX = iXguess
    placeM(f, 'G', o, 0, exit => {
      const cx = exit[0] + q, top = B - XH - 46, bottom = B + q, ry = (bottom - top) / 2, cy = top + ry
      const right = rightEnd ?? cx + 60
      const rx = Math.max(40, right - cx + 70)
      const bend = arc(cx, B, q, q, Math.PI, Math.PI / 2, 0, 20)
      // A superellipse: flatter along the bottom and top than an ellipse, so it clears the letters.
      const loop: P[] = Array.from({ length: 161 }, (_, i) => {
        const a = Math.PI / 2 + (-Math.PI + 0.16) * i / 160, c = Math.cos(a), s = Math.sin(a), e = 2 / 2.8
        return [cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e), cy + ry * Math.sign(s) * Math.pow(Math.abs(s), e)] as P
      })
      iX = cx
      return { points: chain(bend, loop), widths: [...bend.map(() => w), ...loop.map((_, i) => w * (1 - 0.6 * i / 160))] }
    })
    return { shape, iX }
  }
  const word = trace(f => {
    const shape = M.G.draw(o)
    const g = f.blank(); const r = ira2(g, shape.width + 22, w, 22)
    f.merge(g)
    const { iX } = build(f, r.end)
    void iX
    const cx = shape.width - w / 2 + 22 + w
    f.circle(cx, B - XH - 46, 14)
  }, [-20, -110, 760, 240])
  const mono = trace(f => {
    const shape = placeM(f, 'C', o, 0)
    f.circle(shape.width + 6, B - XH - 14, 13)
  }, [-20, -110, 320, 240])
  out.push({ id: 11, family: 'Planet', m: 'G', name: 'Orbit', note: 'The boldest: the m’s last leg runs on into an orbit round the whole word, carrying the planet that dots the i.', word, mono })
}

// The M library on its own, uppercase, for the gallery.
const gallery = Object.entries(M).map(([key, def]) => {
  const o = capM(16)
  const contours = trace(f => { placeM(f, key, o, 0, key === 'G' ? exit => ({ points: chain(arc(exit[0] + 22, exit[1], 22, 22, Math.PI, Math.PI / 2, 0, 16), line([exit[0] + 22, CAP + 22], [exit[0] + 70, CAP + 22], 8)) }) : undefined) }, [-20, -20, 320, 230])
  return { key, name: def.name, note: def.note, path: toPath(contours) }
})

const data = {
  gallery,
  candidates: out.map(c => ({ id: c.id, family: c.family, m: c.m, name: c.name, note: c.note, word: toPath(c.word), mono: toPath(c.mono) })),
}
for (const c of data.candidates) console.log(c.id, c.name, c.word.width, c.word.height, c.word.d.length)
void bounds
writeFileSync(new URL('../../src/ui/brand/mira/round2.ts', import.meta.url), `/**
 * Round 2 Mira candidates and the M library, generated by tools/brand/mira-round2.ts.
 * Generated: edit the tool, not this file.
 */
import type { MarkPath } from './candidates'

export interface Round2Candidate { id: number; family: 'Lineage' | 'Planet'; m: string; name: string; note: string; word: MarkPath; mono: MarkPath }
export interface MSample { key: string; name: string; note: string; path: MarkPath }
export const M_LIBRARY: MSample[] = ${JSON.stringify(data.gallery)}
export const ROUND2: Round2Candidate[] = ${JSON.stringify(data.candidates)}
`)
