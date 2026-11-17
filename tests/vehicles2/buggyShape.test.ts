import { expect, it } from 'vitest'
import { buggyBody } from '../../src/vehicles/buggygen/body'
import { buildParts } from '../../src/vehicles/buggygen/parts'
import { LINK } from '../../src/vehicles/buggygen/parts/sockets'
import { HANDLES, defaultShape, shapedBody, shapedSource, seedShape, encodeShape, decodeShape, rig, findFeatures, type Shape } from '../../src/vehicles/buggygen/shape'
import { data as cage } from '../../src/vehicles/buggygen/cage/cage250'

/**
 * Invariants of the buggy shape rig (src/vehicles/buggygen/shape). Ranges and looks are tuned
 * and reported by tools/buggy-fit/shape/check.ts, not pinned here.
 */
const positions = (parts: { geometry: { getAttribute(n: string): { array: ArrayLike<number> } } }[]) => parts.flatMap(p => Array.from(p.geometry.getAttribute('position').array))
const extremes: [string, Shape][] = HANDLES.flatMap(h => [h.min, h.max].map((v): [string, Shape] => { const s = defaultShape(); s[h.id] = v; return [`${h.id} ${v}`, s] }))
const shapes: [string, Shape][] = [...extremes, ...Array.from({ length: 100 }, (_, i): [string, Shape] => [`seed ${i + 1}`, seedShape(i + 1)])]
const shockTops = buildParts(0, buggyBody.build(0).map(p => p.geometry)).shockTops

// Players who never touch the editor must get the shipped buggy, bit for bit.
it('builds the shipped body and parts from the default shape', () => {
  for (const d of [0, 1] as const) expect(positions(shapedBody(defaultShape(), d))).toEqual(positions(buggyBody.build(d)))
  const source = shapedSource(defaultShape()), body = source.build(0).map(p => p.geometry)
  expect(positions(source.parts(0, body).pieces)).toEqual(positions(buildParts(0, body).pieces))
})

// A NaN or a body that no longer wraps the suspension would show as a broken or hollow buggy.
it('keeps every extreme and random shape finite and covering the sockets and shock tops', () => {
  const mounts = [LINK.mount, [LINK.mount[0], LINK.mount[1], -LINK.mount[2]]]
  for (const [name, s] of shapes) {
    const p = positions(shapedBody(s, 1))
    expect(p.every(Number.isFinite), name).toBe(true)
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p[i]); hi[i % 3] = Math.max(hi[i % 3], p[i]) }
    for (const q of [...shockTops, ...mounts]) for (let k = 0; k < 3; k++) {
      expect(q[k], `${name}: axis ${k}`).toBeGreaterThanOrEqual(lo[k])
      expect(q[k], `${name}: axis ${k}`).toBeLessThanOrEqual(hi[k])
    }
  }
})

// The owner's rule: sculpted features never distort. Every cage edge inside a feature keeps
// its length, or the one scale its size handle gives.
it('moves the sculpted features rigidly', () => {
  const features = findFeatures(cage)
  expect(features.every(f => f.points.length > 0)).toBe(true)
  const edges = features.map(f => {
    const inF = new Set(f.points), out: [number, number][] = []
    for (let t = 0; t < cage.f.length; t += 3) for (let k = 0; k < 3; k++) { const a = cage.f[t + k], b = cage.f[t + (k + 1) % 3]; if (inF.has(a) && inF.has(b)) out.push([a, b]) }
    return out
  })
  const len = (p: ArrayLike<number>, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2])
  for (const [name, s] of shapes) {
    const r = rig(s)
    features.forEach((f, k) => {
      const want = 1 + (f.size ? s[f.size] : 0)
      for (const [a, b] of edges[k]) expect(Math.abs(len(r.points, a, b) / (len(cage.v, a, b) / 1000) - want), `${name} ${f.id}`).toBeLessThan(.02)
    })
  }
})

// A shared code that opens a different buggy is a bug.
it('round trips share codes', () => {
  for (const [name, s] of shapes) expect(decodeShape(encodeShape(s)), name).toEqual(s)
  expect(decodeShape('not a code')).toEqual(defaultShape())
})
