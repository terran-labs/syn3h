/**
 * Generates the round 4 to 8 Mira candidates into src/ui/brand/mira/round4.ts to round8.ts.
 *   npx tsx tools/brand/mira-round4.ts
 *
 * Round 4 is drawn in the Syn3h wordmark's own grammar, read off its path: slabs about a
 * quarter of the cap height thick, every diagonal at 45 degrees, terminals that end in blade
 * points along the baseline, counters narrowed to slits, a plate under the word and a ringed
 * emblem. Shapes are sharp polygons joined and cut in a distance field (mira/field.ts).
 */
import { writeFileSync } from 'node:fs'
import { type Contour, meet, offsetLine, type P, signedDistanceTo, sparkle, toPath } from '../../src/ui/brand/mira/geom'
import { Field } from '../../src/ui/brand/mira/field'

const CELL = 0.3, CAP = 178

// ---- kit ----------------------------------------------------------------------------------
const rect = (x0: number, y0: number, x1: number, y1: number): Contour => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
/** A band of width w along a path, with sharp mitred corners and square ends. */
function thick(pts: P[], w: number): Contour {
  const side = (by: number): P[] => pts.map((p, i) => {
    if (i === 0) return offsetLine(pts[0], pts[1], by)[0]
    if (i === pts.length - 1) return offsetLine(pts[i - 1], p, by)[1]
    const [a1, a2] = offsetLine(pts[i - 1], p, by), [b1, b2] = offsetLine(p, pts[i + 1], by)
    return meet(a1, a2, b1, b2)
  })
  return [...side(w / 2), ...side(-w / 2).reverse()]
}
const add = (f: Field, ...cs: Contour[]): void => { for (const c of cs) f.polygon([c]) }
function cutP(f: Field, c: Contour): void {
  const xs = c.map(p => p[0]), ys = c.map(p => p[1])
  f.cut([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (x, y) => signedDistanceTo([x, y], [c]))
}
/** Removes everything on the side of point p that normal n points to. */
const cutHalf = (f: Field, p: P, n: P): Field => { const l = Math.hypot(n[0], n[1]); return f.cut([-1e4, -1e4, 1e4, 1e4], (x, y) => -((x - p[0]) * n[0] + (y - p[1]) * n[1]) / l) }
/** 45 degree cuts across a top-left or top-right corner at (x, y), `c` along each edge. */
const cutTL = (f: Field, x: number, y: number, c: number) => cutHalf(f, [x + c, y], [-1, -1])
const cutTR = (f: Field, x: number, y: number, c: number) => cutHalf(f, [x - c, y], [1, -1])
const capClip = (f: Field): void => { cutHalf(f, [0, 0], [0, -1]); cutHalf(f, [0, CAP], [0, 1]) }
const ring = (f: Field, cx: number, cy: number, r: number, t: number) => f.add([cx - r, cy - r, cx + r, cy + r], (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - (r - t / 2)) - t / 2)

function trace(extent: [number, number, number, number], build: (f: Field) => void): Contour[] {
  const f = new Field(...extent, CELL)
  build(f)
  return f.trace(0.04)
}
const shear = (cs: Contour[], k: number): Contour[] => cs.map(c => c.map(([x, y]): P => [x + (CAP - y) * k, y]))

// ---- Blade letters: slab 46, 45 degree diagonals -------------------------------------------
const S = 46
/** Each letter is built in its own field at x, clipped to the cap band, and merged. Returns its width. */
function letter(f: Field, build: (g: Field) => void): void { const g = f.blank(); build(g); f.merge(g) }

function bladeM(f: Field, x: number, W = 270): number {
  letter(f, g => {
    add(g, rect(x, 0, x + S, CAP), rect(x + W - S, 0, x + W, CAP), thick([[x + 28, -4], [x + W / 2, W / 2 - 32], [x + W - 28, -4]], S))
    capClip(g); cutTL(g, x, 0, 34); cutTR(g, x + W, 0, 34)
  })
  return W
}
function bladeI(f: Field, x: number): number {
  letter(f, g => { add(g, rect(x, 0, x + S, CAP)); cutTL(g, x, 0, S) })
  return S
}
function bladeR(f: Field, x: number, trimAt?: number): number {
  letter(f, g => {
    add(g, rect(x, 0, x + S, CAP), thick([[x + 92, 70], [x + 217, 195]], S))
    // The bowl is an arrowhead; its counter is a pointed slit.
    add(g, [[x + 20, 0], [x + 137.5, 0], [x + 190.5, 53], [x + 137.5, 106], [x + 20, 106]])
    cutP(g, [[x + S, 46], [x + 131, 46], [x + 138, 53], [x + 131, 60], [x + S, 60]])
    capClip(g); cutTL(g, x, 0, 34)
    if (trimAt !== undefined) cutHalf(g, [trimAt, 0], [1, 0])
  })
  return 233
}
function bladeA(f: Field, x: number): number {
  letter(f, g => { add(g, thick([[x + 23, 200], [x + 23, 104.5], [x + 103, 24.5], [x + 183, 104.5], [x + 183, 200]], S)); capClip(g) })
  return 206
}
const spikeL = (x: number): Contour => [[x + 1, CAP], [x - 44, CAP], [x + 1, CAP - 45]]
const spikeR = (x: number): Contour => [[x - 1, CAP], [x + 44, CAP], [x - 1, CAP - 45]]
const plate = (x0: number, x1: number, gap = 14): Contour => [[x0, CAP + gap], [x1, CAP + gap], [x1 - 34, CAP + gap + 34], [x0 + 34, CAP + gap + 34]]

function blade(f: Field, o: { plate?: boolean; emblem?: boolean } = {}): number {
  let x = 0
  x += bladeM(f, x) + 12
  x += bladeI(f, x) + 12
  x += bladeR(f, x) + 12
  const ax = x
  x += bladeA(f, x)
  add(f, spikeL(0), spikeR(x))
  if (o.plate) add(f, plate(-44, x + 44))
  if (o.emblem) {
    // Syn3h's ringed emblem: a ring in the pocket between R and A, fused to the A's shoulder, Mira's star inside.
    const cx = ax + 4, cy = 45
    ring(f, cx, cy, 41, 12); f.polygon([sparkle(cx, cy, 19, 0.2)])
  }
  return x
}
const bladeMono = (f: Field): void => { const W = bladeM(f, 0); add(f, spikeL(0), spikeR(W)) }

// ---- Temple letters: pillars 44, slits 16, gabled tops -------------------------------------
const T = 44
function temple(f: Field, withPlate: boolean): number {
  const house = (x: number, span: number): Contour => { const rise = (span - T) / 2; return thick([[x + T / 2, 200], [x + T / 2, 31 + rise], [x + span / 2, 31], [x + span - T / 2, 31 + rise], [x + span - T / 2, 200]], T) }
  let x = 0
  letter(f, g => { add(g, house(x, 104), house(x + 60, 104)); capClip(g) }); x += 164 + 14
  letter(f, g => { add(g, rect(x, 0, x + T, CAP)); cutTL(g, x, 0, T / 2); cutTR(g, x + T, 0, T / 2) }); x += T + 14
  letter(f, g => {
    add(g, rect(x, 0, x + T, CAP), [[x + 20, 0], [x + 101, 0], [x + 153, 52], [x + 101, 104], [x + 20, 104]], thick([[x + 70, 70], [x + 195, 195]], T))
    cutP(g, [[x + T, 44], [x + 95, 44], [x + 103, 52], [x + 95, 60], [x + T, 60]])
    capClip(g); cutTL(g, x, 0, T / 2)
  }); x += 209 + 12
  letter(f, g => { add(g, house(x, 136)); capClip(g) }); x += 136
  if (withPlate) add(f, plate(-30, x + 30))
  return x
}

// ---- Monoplate: one slab, the letters cut into it as slits ---------------------------------
function monoplate(f: Field): void {
  const t = 12, Wb = 662
  add(f, [[0, CAP], [40, 0], [Wb - 89, 0], [Wb, CAP]])
  // M: a V notch from the top and a V of slits under it.
  cutP(f, [[78, -1], [115, 42], [152, -1]])
  cutP(f, thick([[60, 62], [110, 192]], t)); cutP(f, thick([[170, 62], [120, 192]], t))
  cutP(f, rect(190, -1, 190 + t, CAP + 1))
  // I: left whole.
  cutP(f, rect(248, -1, 248 + t, CAP + 1))
  // R: the bowl's counter and the gap under it, along the leg.
  cutP(f, [[306, 46], [398, 46], [410, 52], [398, 58], [306, 58]])
  cutP(f, thick([[308, 104], [394, 190]], t))
  cutP(f, thick([[420 + t / 2 - 6, 190], [420 + t / 2 + 89 + 6, -12]], t))
  // A: a chevron slit.
  cutP(f, thick([[488, 190], [547, 72], [606, 190]], t))
  capClip(f)
}

interface Built { id: number; name: string; note: string; word: Contour[]; mono: Contour[] }
const out: Built[] = []
const bladeMonoC = trace([-70, -20, 340, 200], bladeMono)

out.push({ id: 1, name: 'Blade', note: 'Syn3h’s construction applied to MIRA: slabs a quarter of the cap height thick, every diagonal at 45 degrees, blade points along the baseline at both ends like the S’s, the I cut to a chisel, the R’s bowl an arrowhead, the A a gable with no crossbar, and the plate underneath.',
  word: trace([-70, -20, 880, 250], f => { blade(f, { plate: true }) }), mono: bladeMonoC })
out.push({ id: 2, name: 'Blade and emblem', note: 'Blade with Syn3h’s ringed emblem: a ring fused to the A’s shoulder in the pocket beside the R, holding Mira’s star where Syn3h’s held its H. No plate, so the blades carry the baseline.',
  word: trace([-70, -20, 880, 250], f => { blade(f, { emblem: true }) }),
  mono: trace([-20, -20, 120, 120], f => { ring(f, 45, 45, 45, 13); f.polygon([sparkle(45, 45, 22, 0.2)]) }) })
out.push({ id: 3, name: 'Blade, slanted', note: 'Blade leaning forward 12 degrees with its plate: the same mass, moving.',
  word: shear(trace([-70, -20, 880, 250], f => { blade(f, { plate: true }) }), 0.22), mono: shear(bladeMonoC, 0.22) })
out.push({ id: 4, name: 'Temple', note: 'The most alien: pillars and gables. Every letter is built from the same slab with a pointed top, the counters are slits, the M is three pillars under two peaks and the A is the same gable opened up. Compact and very heavy.',
  word: trace([-50, -20, 660, 250], f => { temple(f, true) }),
  mono: trace([-20, -20, 200, 200], f => { letter(f, g => { const house = (x: number): Contour => thick([[x + T / 2, 200], [x + T / 2, 61], [x + 52, 31], [x + 104 - T / 2, 61], [x + 104 - T / 2, 200]], T); add(g, house(0), house(60)); capClip(g) }) }) })
out.push({ id: 5, name: 'Monoplate', note: 'The far end of the idea: one slab, and the letters are only the slits cut into it. The heaviest thing possible, and the hardest to read.',
  word: trace([-20, -20, 700, 200], monoplate),
  mono: trace([-20, -20, 220, 200], f => { add(f, [[0, CAP], [40, 0], [190, 0], [190, CAP]]); cutP(f, [[78, -1], [115, 42], [152, -1]]); cutP(f, thick([[60, 62], [110, 192]], 12)); cutP(f, thick([[170, 62], [120, 192]], 12)); capClip(f) }) })

const data = out.map(c => ({ id: c.id, family: 'Syn3h grammar', name: c.name, note: c.note, word: toPath(c.word), mono: toPath(c.mono) }))
for (const c of data) console.log(c.id, c.name, c.word.width, c.word.height, c.word.d.length)
writeFileSync(new URL('../../src/ui/brand/mira/round4.ts', import.meta.url), `/**
 * Round 4 Mira candidates, generated by tools/brand/mira-round4.ts.
 * Generated: edit the tool, not this file.
 */
import type { Round3Candidate } from './round3'

export const ROUND4: Round3Candidate[] = ${JSON.stringify(data)}
`)

// ---- Round 5: the R and A nested ----------------------------------------------------------
// The owner picked Blade and Monoplate from round 4 and asked for the R and A closer: the R's
// 45 degree trailing edge and the A's upper left edge parallel, a slit apart, the slit as wide
// as the gap between I and R (12, measured across the slit).
const GAP = 12, DIAG = GAP * Math.SQRT2

/** R whose trailing edge is one 45 degree line down to the A's eave, then upright: it fits the A's left side all the way down. */
function wingR(f: Field, x: number, slit: boolean): void {
  letter(f, g => {
    add(g, slit ? [[x, 0], [x + 293, 0], [x + 203, 90], [x + 203, CAP], [x, CAP]] : [[x, 0], [x + 293, 0], [x + 203, 90], [x + 203, CAP], [x + 118, CAP], [x + S, 106], [x + S, CAP], [x, CAP]])
    cutP(g, [[x + S, 46], [x + 190, 46], [x + 197, 53], [x + 190, 60], [x + S, 60]])
    if (slit) cutP(g, thick([[x + 56, 104], [x + 142, 190]], GAP))
    cutTL(g, x, 0, 34)
  })
}
/** M and A with their counters closed to slits, as in Monoplate, but as separate bladed letters. */
function slitM(f: Field, x: number, W = 250): number {
  letter(f, g => {
    add(g, rect(x, 0, x + W, CAP)); cutP(g, [[x + W / 2 - 46, -1], [x + W / 2, 45], [x + W / 2 + 46, -1]])
    cutP(g, thick([[x + 68, 62], [x + W / 2 - 7, 192]], GAP)); cutP(g, thick([[x + W - 68, 62], [x + W / 2 + 7, 192]], GAP))
    capClip(g); cutTL(g, x, 0, 34); cutTR(g, x + W, 0, 34)
  })
  return W
}
function slitA(f: Field, x: number): number {
  letter(f, g => {
    add(g, [[x, CAP], [x, 95], [x + 95, 0], [x + 111, 0], [x + 206, 95], [x + 206, CAP]])
    cutP(g, thick([[x + 52, 192], [x + 52, 124], [x + 103, 73], [x + 154, 124], [x + 154, 192]], GAP)); capClip(g)
  })
  return 206
}
interface Nest { style: 'tucked' | 'winged' | 'slits'; plate?: boolean }
function nested(f: Field, o: Nest): number {
  let x = 0
  x += (o.style === 'slits' ? slitM(f, x) : bladeM(f, x)) + GAP
  x += bladeI(f, x) + GAP
  let ax: number
  if (o.style === 'tucked') {
    // The A slides under the arrowhead until its roof is one slit from the bowl's lower edge; the R's leg runs into the A's left pillar.
    ax = x + 190.5 + 53 + DIAG - 95
    bladeR(f, x, ax + S)
  } else { ax = x + 215; wingR(f, x, o.style === 'slits') }
  x = ax + (o.style === 'slits' ? slitA(f, ax) : bladeA(f, ax))
  add(f, spikeL(0), spikeR(x))
  if (o.plate) add(f, plate(-44, x + 44))
  return x
}

/** Monoplate with the R and A divided by a 45 degree slit, and the A a 45 degree chevron. */
function monoplate45(f: Field, o: { blades?: boolean } = {}): void {
  const t = GAP, rEdge = 585, aEdge = rEdge + DIAG, flat = 30, end = aEdge + flat + CAP
  add(f, [[0, CAP], [40, 0], [aEdge + flat, 0], [end, CAP]])
  cutP(f, [[78, -1], [115, 42], [152, -1]])
  cutP(f, thick([[60, 62], [110, 192]], t)); cutP(f, thick([[170, 62], [120, 192]], t))
  cutP(f, rect(190, -1, 190 + t, CAP + 1)); cutP(f, rect(248, -1, 248 + t, CAP + 1))
  cutP(f, [[306, 46], [462, 46], [469, 52], [462, 58], [306, 58]])
  cutP(f, thick([[308, 104], [394, 190]], t))
  const mid = (rEdge + aEdge) / 2
  cutP(f, thick([[mid + 14, -14], [mid - 192, 192]], t))
  // The A's chevron slit, each arm one slab in from its edge.
  const cx = aEdge + flat / 2, inset = (S + t / 2) * Math.SQRT2, apexY = aEdge + inset - cx
  cutP(f, thick([[cx - (192 - apexY), 192], [cx, apexY], [cx + (192 - apexY), 192]], t))
  capClip(f)
  if (o.blades) add(f, [[-42, CAP], [20, CAP], [20, CAP - 62]], plate(-44, end + 10))
}

const r5: Built[] = []
const slitMonoC = trace([-70, -20, 320, 200], f => { const W = slitM(f, 0); add(f, spikeL(0), spikeR(W)) })
const plateMonoC = out[4].mono
r5.push({ id: 1, name: 'Blade, tucked', note: 'What you asked for, read literally: the A slides under the R’s arrowhead until its roof sits one slit from the arrowhead’s lower edge, the same 12 units that separate I and R. The R’s leg now runs into the A’s left pillar, so R and A are one fused form, as Syn3h’s 3 and H are.',
  word: trace([-70, -20, 800, 250], f => { nested(f, { style: 'tucked', plate: true }) }), mono: bladeMonoC })
r5.push({ id: 2, name: 'Blade, tucked, no plate', note: 'The same without the plate, so the two blades carry the baseline alone.',
  word: trace([-70, -20, 800, 250], f => { nested(f, { style: 'tucked' }) }), mono: bladeMonoC })
r5.push({ id: 3, name: 'Blade, winged', note: 'Monoplate’s answer brought into Blade: the R’s whole trailing edge is one 45 degree line, so the slit runs the full length of the A’s roof and on down its pillar. The letters stay separate and the R gains a wing.',
  word: trace([-70, -20, 860, 250], f => { nested(f, { style: 'winged', plate: true }) }), mono: bladeMonoC })
r5.push({ id: 4, name: 'Blade, slit counters', note: 'Halfway between your two picks: Blade’s separate letters, blades and plate, with Monoplate’s mass. Every counter is closed to a slit, and the R and A fit along the 45 degree slit.',
  word: trace([-70, -20, 860, 250], f => { nested(f, { style: 'slits', plate: true }) }), mono: slitMonoC })
r5.push({ id: 5, name: 'Monoplate, nested', note: 'Monoplate with the slit between R and A at 45 degrees, 12 units across, and the A redrawn as a 45 degree chevron to match. The slab now ends in a blade point.',
  word: trace([-20, -20, 860, 200], f => monoplate45(f)), mono: plateMonoC })
r5.push({ id: 6, name: 'Monoplate, nested, on its plate', note: 'The same with a blade at the M’s foot and Syn3h’s plate underneath.',
  word: trace([-70, -20, 880, 250], f => monoplate45(f, { blades: true })), mono: plateMonoC })

const data5 = r5.map(c => ({ id: c.id, family: 'R and A nested', name: c.name, note: c.note, word: toPath(c.word), mono: toPath(c.mono) }))
for (const c of data5) console.log('r5', c.id, c.name, c.word.width, c.word.height, c.word.d.length)
writeFileSync(new URL('../../src/ui/brand/mira/round5.ts', import.meta.url), `/**
 * Round 5 Mira candidates, generated by tools/brand/mira-round4.ts.
 * Generated: edit the tool, not this file.
 */
import type { Round3Candidate } from './round3'

export const ROUND5: Round3Candidate[] = ${JSON.stringify(data5)}
`)

// ---- Round 6 ------------------------------------------------------------------------------
// The owner's notes on round 5. Blade with slit counters: the R was much too wide, so it is
// narrowed, its counter shortened to match, the A moved in, and the plate raised so that every
// gap (letter to letter, letters to plate) is the same 12. Monoplate, from variant 5: a
// narrower R, the M's and A's outer slopes made equal, and a symmetrical M for the icon.

/** The winged R at a chosen body width; the wing overhangs by the height of the A's eave. */
function wingR2(f: Field, x: number, body: number, slitFrom: P): void {
  letter(f, g => {
    add(g, [[x, 0], [x + body + 90, 0], [x + body, 90], [x + body, CAP], [x, CAP]])
    cutP(g, [[x + S, 46], [x + body - 14, 46], [x + body - 8, 52], [x + body - 14, 58], [x + S, 58]])
    cutP(g, thick([[x + slitFrom[0], slitFrom[1]], [x + slitFrom[0] + 192 - slitFrom[1], 192]], GAP))
    cutTL(g, x, 0, 34)
  })
}
function bladeSlits(f: Field, body: number, slitFrom: P): void {
  let x = 0
  x += slitM(f, x) + GAP
  x += bladeI(f, x) + GAP
  wingR2(f, x, body, slitFrom)
  x += body + GAP
  x += slitA(f, x)
  add(f, spikeL(0), spikeR(x), plate(-44, x + 44, GAP))
}

interface Mono { /** Outer slope of the M and the A, and of the slit between R and A: sideways run per unit of height. */ k: number; arrow: boolean; /** Width of the R at the baseline (150 unless given). */ rw?: number; /** Syn3h's plate underneath, one gap below. */ plate?: boolean }
const MCORE = 150
/** The M's cuts, for a core starting at x: the notch from the top and the V of slits under it. */
function monoMCuts(f: Field, x: number): void {
  cutP(f, [[x + 38, -1], [x + 75, 42], [x + 112, -1]])
  cutP(f, thick([[x + 20, 62], [x + 70, 192]], GAP)); cutP(f, thick([[x + 130, 62], [x + 80, 192]], GAP))
}
function mono6(f: Field, o: Mono): void {
  const { k } = o, t = GAP, run = k * CAP, across = t * Math.hypot(1, k)
  const rw = o.rw ?? 150
  const xm = run, xr = xm + MCORE + t + S + t, foot = xr + rw, xa = foot + across
  const flat = 30, aTop = xa + run, end = aTop + flat + run
  add(f, [[0, CAP], [run, 0], [aTop + flat, 0], [end, CAP]])
  monoMCuts(f, xm)
  cutP(f, rect(xm + MCORE, -1, xm + MCORE + t, CAP + 1)); cutP(f, rect(xr - t, -1, xr, CAP + 1))
  // R: its trailing edge rises from the foot at the same slope as the A; with `arrow` it turns back at half height, an arrowhead.
  const ya = 89, edge = (y: number) => foot + k * (CAP - y), apex = edge(ya)
  const widthAt52 = o.arrow ? apex - k * (ya - 52) : edge(52)
  cutP(f, [[xr + S, 46], [widthAt52 - 52, 46], [widthAt52 - 46, 52], [widthAt52 - 52, 58], [xr + S, 58]])
  // The gap under the bowl. At full width it runs at 45 degrees; a narrower R takes the slope of the M's slits instead, so it still reaches the baseline.
  const sx = Math.max(40, Math.min(58, rw - 58))
  cutP(f, thick(rw >= 150 ? [[xr + 48, 104], [xr + 134, 190]] : [[xr + sx, 104], [xr + sx + 86 * 50 / 130, 190]], t))
  const mid = (y: number) => edge(y) + across / 2
  cutP(f, thick([[mid(-14), -14], [mid(192), 192]], t))
  if (o.arrow) cutP(f, [[apex - k * (ya + 2), -2], [apex, ya], [edge(-2) + 1, -2]])
  // A: a chevron slit, each arm one slab in from its edge.
  const cx = aTop + flat / 2, inset = (S + t / 2) * Math.hypot(1, k), apexY = (inset - flat / 2) / k
  cutP(f, thick([[xa + inset - 14 * k, 192], [cx, apexY], [2 * cx - (xa + inset - 14 * k), 192]], t))
  capClip(f)
  if (o.plate) add(f, plate(-34, end + 34, t))
}
/** The M on its own for the icon: the same slope on both sides. */
function monoM(f: Field, k: number): void {
  const run = k * CAP
  add(f, [[0, CAP], [run, 0], [run + MCORE, 0], [2 * run + MCORE, CAP]])
  monoMCuts(f, run); capClip(f)
}

const r6: Built[] = []
r6.push({ id: 1, name: 'Blade, slit counters, tightened', note: 'Your notes applied. The R’s body is 150 wide, down from 203, its counter is shorter to match and as thin as the other slits, and the A has moved in with it. The plate is raised: every gap, letter to letter and letters to plate, is now the same 12. The M is untouched.',
  word: trace([-70, -20, 800, 250], f => bladeSlits(f, 150, [40, 100])), mono: slitMonoC })
r6.push({ id: 2, name: 'Blade, slit counters, narrowest R', note: 'The same with the R narrower again, 136 wide, about as far as it goes before its foot becomes a sliver.',
  word: trace([-70, -20, 800, 250], f => bladeSlits(f, 136, [32, 96])), mono: slitMonoC })
const monos: { name: string; note: string; o: Mono }[] = [
  { name: 'Monoplate, 45 degrees, arrowhead R', o: { k: 1, arrow: true }, note: 'From variant 5. The M’s outer edge now slopes at 45 degrees like the A’s, so the slab is symmetrical. The R is narrowed by turning its trailing edge back at half height into an arrowhead, which leaves a V notch between R and A that answers the M’s.' },
  { name: 'Monoplate, steeper, plain R', o: { k: 0.5, arrow: false }, note: 'From variant 5, with every slope steepened to two up for one across: the M’s edge, the A’s edge and the slit between R and A. That alone narrows the R by a quarter and makes the whole slab more compact.' },
  { name: 'Monoplate, steeper, arrowhead R', o: { k: 0.5, arrow: true }, note: 'The steeper slopes and the arrowhead together: the narrowest R of the three.' },
]
monos.forEach(({ name, note, o }, i) => {
  const run = o.k * CAP
  r6.push({ id: 3 + i, name, note, word: trace([-20, -20, 1000, 200], f => mono6(f, o)), mono: trace([-20, -20, 2 * run + MCORE + 20, 200], f => monoM(f, o.k)) })
})

const data6 = r6.map(c => ({ id: c.id, family: c.id < 3 ? 'Blade, slit counters' : 'Monoplate', name: c.name, note: c.note, word: toPath(c.word), mono: toPath(c.mono) }))
for (const c of data6) console.log('r6', c.id, c.name, c.word.width, c.word.height, c.word.d.length)
writeFileSync(new URL('../../src/ui/brand/mira/round6.ts', import.meta.url), `/**
 * Round 6 Mira candidates, generated by tools/brand/mira-round4.ts.
 * Generated: edit the tool, not this file.
 */
import type { Round3Candidate } from './round3'

export const ROUND6: Round3Candidate[] = ${JSON.stringify(data6)}
`)

// ---- Round 7 ------------------------------------------------------------------------------
// The owner picked round 6's variant 4 (Monoplate, steeper, plain R) and asked for round 6
// variant 1's underline plate under it and a much narrower R, at several widths.
const r7: Built[] = []
const monoM7 = trace([-20, -20, CAP + MCORE + 20, 200], f => monoM(f, 0.5))
;[[130, 'a little narrower'], [115, 'narrower'], [100, 'much narrower'], [88, 'as narrow as it goes']].forEach(([rw, word], i) => {
  r7.push({ id: i + 1, name: `Monoplate on its plate, R ${rw}`, note: `Round 6’s variant 4 with the plate from variant 1 underneath, one 12 unit gap below the slab. The R is ${rw} wide at the baseline, down from 150: ${word}.${rw === 88 ? ' Below this its foot disappears.' : ''}`,
    word: trace([-60, -20, 760, 250], f => mono6(f, { k: 0.5, arrow: false, rw: rw as number, plate: true })), mono: monoM7 })
})
const data7 = r7.map(c => ({ id: c.id, family: 'Monoplate', name: c.name, note: c.note, word: toPath(c.word), mono: toPath(c.mono) }))
for (const c of data7) console.log('r7', c.id, c.name, c.word.width, c.word.height, c.word.d.length)
writeFileSync(new URL('../../src/ui/brand/mira/round7.ts', import.meta.url), `/**
 * Round 7 Mira candidates, generated by tools/brand/mira-round4.ts.
 * Generated: edit the tool, not this file.
 */
import type { Round3Candidate } from './round3'

export const ROUND7: Round3Candidate[] = ${JSON.stringify(data7)}
`)

// ---- Round 8 ------------------------------------------------------------------------------
// The owner's notes on round 7's variant 4 (R 88): the plate exactly as wide as the slab; the M
// a little narrower on the left and wider on the right, with a notch down on its upper right;
// a notch up on the I's left; a notch down on the R's right at the same slope; and the plate
// under the icon's M as well. The notch slope is the slope of the M's own V notch, so with the
// 12 unit slit between them the M's and I's cuts make the same V as the one in the M.
const NOTCH = 37 / 43
function mono8(f: Field, d: number): void {
  const k = 0.5, t = GAP, run = k * CAP, across = t * Math.hypot(1, k), b = d * NOTCH
  const shoulder = 30, half = 37, xm = run, cx = xm + shoulder + half
  const mR = cx + half + shoulder + b, iL = mR + t, iR = iL + S, xr = iR + t, rw = 88, foot = xr + rw, xa = foot + across
  const flat = 30, aTop = xa + run, end = aTop + flat + run
  add(f, [[0, CAP], [run, 0], [aTop + flat, 0], [end, CAP]])
  // M: its V notch, the V of slits under it, and the new cut down its upper right corner.
  cutP(f, [[cx - half, -1], [cx, 42], [cx + half, -1]])
  cutP(f, thick([[cx - 55, 62], [cx - 5, 192]], t)); cutP(f, thick([[cx + 55, 62], [cx + 5, 192]], t))
  cutP(f, [[mR - b - 2 * NOTCH, -2], [mR + 2, -2], [mR + 2, d + 2 / NOTCH]])
  cutP(f, rect(mR, -1, iL, CAP + 1))
  // I: the mirrored cut, rising from its left edge.
  cutP(f, [[iL + b + 2 * NOTCH, -2], [iL - 2, -2], [iL - 2, d + 2 / NOTCH]])
  cutP(f, rect(iR, -1, xr, CAP + 1))
  // R: counter, the gap under the bowl, the slit to the A, and the cut down its upper right corner.
  const edge = (y: number) => foot + k * (CAP - y), w52 = edge(52)
  cutP(f, [[xr + S, 46], [w52 - 52, 46], [w52 - 46, 52], [w52 - 52, 58], [xr + S, 58]])
  cutP(f, thick([[xr + 40, 104], [xr + 40 + 86 * 50 / 130, 190]], t))
  const mid = (y: number) => edge(y) + across / 2
  cutP(f, thick([[mid(-14), -14], [mid(192), 192]], t))
  cutP(f, [[edge(d) - (d + 2) * NOTCH, -2], [edge(d), d], [edge(-2) + 1, -2]])
  // A.
  const ax = aTop + flat / 2, inset = (S + t / 2) * Math.hypot(1, k), apexY = (inset - flat / 2) / k
  cutP(f, thick([[xa + inset - 14 * k, 192], [ax, apexY], [2 * ax - (xa + inset - 14 * k), 192]], t))
  capClip(f)
  add(f, plate(0, end, t))
}
const monoM8 = trace([-20, -20, CAP + MCORE + 20, 250], f => { monoM(f, 0.5); add(f, plate(0, CAP + MCORE, GAP)) })
const r8: Built[] = [
  { id: 1, name: 'Monoplate, notched', note: 'Round 7’s variant 4 with your notes applied. The plate is exactly as wide as the slab. The M is 8 narrower on the left and 23 wider on the right, with a cut down its upper right corner; the I has the mirrored cut rising from its left edge; the R has a cut down its upper right at the same slope. The cuts are 36 deep, so the notch between M and I is the same V as the one in the M.',
    word: trace([-20, -20, 740, 250], f => mono8(f, 36)), mono: monoM8 },
  { id: 2, name: 'Monoplate, shallower notches', note: 'The same with the three cuts 24 deep instead of 36, for comparison: the notches read as accents and the M stays closer to its round 7 width.',
    word: trace([-20, -20, 740, 250], f => mono8(f, 24)), mono: monoM8 },
]
const data8 = r8.map(c => ({ id: c.id, family: 'Monoplate', name: c.name, note: c.note, word: toPath(c.word), mono: toPath(c.mono) }))
for (const c of data8) console.log('r8', c.id, c.name, c.word.width, c.word.height, c.word.d.length)
writeFileSync(new URL('../../src/ui/brand/mira/round8.ts', import.meta.url), `/**
 * Round 8 Mira candidates, generated by tools/brand/mira-round4.ts.
 * Generated: edit the tool, not this file.
 */
import type { Round3Candidate } from './round3'

export const ROUND8: Round3Candidate[] = ${JSON.stringify(data8)}
`)
