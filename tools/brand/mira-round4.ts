/**
 * Generates the round 4 Mira candidates into src/ui/brand/mira/round4.ts.
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
function bladeR(f: Field, x: number): number {
  letter(f, g => {
    add(g, rect(x, 0, x + S, CAP), thick([[x + 92, 70], [x + 217, 195]], S))
    // The bowl is an arrowhead; its counter is a pointed slit.
    add(g, [[x + 20, 0], [x + 137.5, 0], [x + 190.5, 53], [x + 137.5, 106], [x + 20, 106]])
    cutP(g, [[x + S, 46], [x + 131, 46], [x + 138, 53], [x + 131, 60], [x + S, 60]])
    capClip(g); cutTL(g, x, 0, 34)
  })
  return 233
}
function bladeA(f: Field, x: number): number {
  letter(f, g => { add(g, thick([[x + 23, 200], [x + 23, 104.5], [x + 103, 24.5], [x + 183, 104.5], [x + 183, 200]], S)); capClip(g) })
  return 206
}
const spikeL = (x: number): Contour => [[x + 1, CAP], [x - 44, CAP], [x + 1, CAP - 45]]
const spikeR = (x: number): Contour => [[x - 1, CAP], [x + 44, CAP], [x - 1, CAP - 45]]
const plate = (x0: number, x1: number): Contour => [[x0, CAP + 14], [x1, CAP + 14], [x1 - 34, CAP + 48], [x0 + 34, CAP + 48]]

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
