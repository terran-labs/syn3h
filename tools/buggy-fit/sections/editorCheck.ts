/**
 * Bounds check for the loft editor's handles (src/vehicles/buggygen/sections/editor.ts):
 * every handle at each end of its range, all at their minimum and maximum, the presets and
 * random seeds must each build a sane body that keeps clear of the buggy's mechanical layout.
 * Also: share codes round trip, and build time per edit.
 *
 *   npx tsx tools/buggy-fit/sections/editorCheck.ts
 */
import { EDITOR_HANDLES, defaultHandles, applyHandles, encodeHandles, decodeHandles, seedHandles, clampHandles, PRESETS, type Handles } from '../../../src/vehicles/buggygen/sections/editor'
import { buildLoft } from '../../../src/vehicles/buggygen/sections/design'
import { HullQuery, outline, paramsAt } from '../../../src/vehicles/buggygen/sections/hull'
import { DUCT_LAMP } from '../../../src/vehicles/buggygen/parts/sockets'

const TOPS = [[.7302, .4919, -1.2375], [.7271, .488, 1.2364]], EYE = [0, .8, 0], HUBS = [[1.1, -.2, -1.3], [1.1, -.2, 1.3]], TYRE = .52

/** Problems with one setting; empty when the body is sane. */
export function problems(h: Handles): string[] {
  const out: string[] = [], d = applyHandles(h), q = new HullQuery(d.hull)
  const pieces = buildLoft(d, 0)
  let tris = 0, eye = Infinity, tyre = 0, bad = 0
  for (const p of pieces) {
    const a = p.geometry.getAttribute('position').array as Float32Array
    tris += (p.geometry.getIndex()?.count ?? a.length / 3) / 3
    for (let i = 0; i < a.length; i += 3) {
      if (!Number.isFinite(a[i] + a[i + 1] + a[i + 2])) bad++
      eye = Math.min(eye, Math.hypot(a[i] - EYE[0], a[i + 1] - EYE[1], a[i + 2] - EYE[2]))
      for (const [hx, hy, hz] of HUBS) if (Math.abs(a[i]) > hx - .2 && Math.abs(a[i]) < hx + .2 && Math.hypot(a[i + 1] - hy, a[i + 2] - hz) < TYRE) tyre++
    }
  }
  if (bad) out.push(`${bad} non-finite`)
  if (!tris) out.push('no triangles')
  if (eye < .25) out.push(`eye ${eye.toFixed(3)} m`)
  if (tyre) out.push(`${tyre} points in a tyre`)
  for (const [x, y, z] of TOPS) if (!q.contains(x, y, z)) out.push(`shock top ${z > 0 ? 'rear' : 'front'} outside`)
  // The driver sees out ahead (PATTERN.md rule 3): the deck in front of the cockpit, within the
  // view's width, stays at least 6.5 cm below the eye. The fitted buggy clears it by about 7.5 cm.
  let deckAhead = -Infinity
  for (let z = d.features.cockpit.z - d.features.cockpit.halfLength - .05; z > -1.3; z -= .05) for (const x of [0, .15, .3]) deckAhead = Math.max(deckAhead, q.top(x, z))
  if (deckAhead > EYE[1] - .065) out.push(`deck ahead ${deckAhead.toFixed(2)} m blocks the view`)
  // The parts' duct lens must find the nose surface along its axis.
  // ...and the nose must meet the lens flush: every rim point finds the surface within the
  // range the parts move the lens (0.2 m ahead to 0.1 m behind its centre), and the rim lies
  // within 2.5 cm of a plane, so the bezel sits on the body instead of standing off it.
  const L = DUCT_LAMP, n = L.axis, mj = L.major, md = mj[0] * n[0] + mj[1] * n[1] + mj[2] * n[2]
  const u0 = [mj[0] - md * n[0], mj[1] - md * n[1], mj[2] - md * n[2]], ul = Math.hypot(...u0), u = u0.map(x => x / ul)
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]], sc = d.features.head.scale
  const offs: number[] = [], cs: number[] = [], sn: number[] = []
  for (let i = 0; i < 14; i++) {
    const t = i / 14 * Math.PI * 2, p: [number, number, number] = [0, 1, 2].map(k => L.centre[k] + (u[k] * L.a * Math.cos(t) + w[k] * L.b * Math.sin(t)) * sc) as [number, number, number]
    const hit = q.surface(p, n as [number, number, number], .3)
    if (!hit) { out.push('duct rim off the nose'); break }
    offs.push((hit[0] - p[0]) * n[0] + (hit[1] - p[1]) * n[1] + (hit[2] - p[2]) * n[2]); cs.push(Math.cos(t)); sn.push(Math.sin(t))
  }
  if (offs.length === 14) {
    const mean = offs.reduce((a, b) => a + b, 0) / 14
    const tc = offs.reduce((a, o, i) => a + (o - mean) * cs[i], 0) / cs.reduce((a, c) => a + c * c, 0), ts = offs.reduce((a, o, i) => a + (o - mean) * sn[i], 0) / sn.reduce((a, c) => a + c * c, 0)
    const gap = Math.max(...offs.map((o, i) => Math.abs(o - mean - tc * cs[i] - ts * sn[i])))
    if (gap > .025) out.push(`duct bezel ${(gap * 100).toFixed(1)} cm off the nose`)
    if (mean < -.1 || mean > .2) out.push(`nose ${mean.toFixed(2)} m from the lens`)
  }
  // Every section outline is simple (no fold).
  for (let z = d.hull.z[0] + .02; z < d.hull.z[d.hull.z.length - 1]; z += .1) {
    const f = outline(paramsAt(d.hull, z)), p = Array.from({ length: 41 }, (_, i) => f(i / 40))
    let fold = false
    for (let i = 0; i < 40 && !fold; i++) for (let j = i + 2; j < 40; j++) {
      const [a, b] = [p[i], p[i + 1]], [c, e] = [p[j], p[j + 1]]
      const o = (P: number[], Q: number[], R: number[]) => Math.sign((Q[0] - P[0]) * (R[1] - P[1]) - (Q[1] - P[1]) * (R[0] - P[0]))
      if (o(a, b, c) * o(a, b, e) < 0 && o(c, e, a) * o(c, e, b) < 0) { fold = true; break }
    }
    if (fold) { out.push(`outline folds at z ${z.toFixed(2)}`); break }
    if (p.some(([x]) => x < -1e-6)) { out.push(`outline crosses the centre at z ${z.toFixed(2)}`); break }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = (name: string, h: Handles) => { const p = problems(h); if (p.length) console.log(`${name}: ${p.join(', ')}`); return p.length === 0 }
  let ok = 0, all = 0
  for (const h of EDITOR_HANDLES) for (const v of [h.min, h.max]) { all++; const s = defaultHandles(); s[h.id] = v; if (report(`${h.id} ${v}`, s)) ok++ }
  for (const k of [0, 1]) { all++; const s = defaultHandles(); for (const h of EDITOR_HANDLES) s[h.id] = k ? h.max : h.min; if (report(k ? 'all max' : 'all min', s)) ok++ }
  for (const [id, p] of Object.entries(PRESETS)) { all++; if (report(`preset ${id}`, clampHandles(p.handles))) ok++ }
  let seeds = 0; for (let i = 1; i <= 100; i++) if (problems(seedHandles(i)).length === 0) seeds++
  console.log(`range ends, extremes and presets: ${ok}/${all} sane; random seeds 1 to 100: ${seeds}/100 sane`)
  let rt = 0; for (let i = 0; i < 200; i++) { const s = seedHandles(i), b = decodeHandles(encodeHandles(s)); if (EDITOR_HANDLES.every(h => Math.abs(b[h.id] - s[h.id]) < 1e-9)) rt++ }
  console.log(`share code ${encodeHandles(defaultHandles())} (${encodeHandles(defaultHandles()).length} characters), round trips ${rt}/200`)
  const t: number[] = []; for (let i = 0; i < 30; i++) { const s = seedHandles(i), t0 = performance.now(); buildLoft(applyHandles(s), 0); t.push(performance.now() - t0) }
  t.sort((a, b) => a - b); console.log(`regenerate per edit (Node, detail 0): median ${t[15].toFixed(1)} ms, p95 ${t[28].toFixed(1)} ms`)
  for (const [id, p] of Object.entries(PRESETS)) console.log(`preset ${id}: ${encodeHandles(clampHandles(p.handles))}`)
}
