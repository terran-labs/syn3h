/**
 * Checks and measurements for the shape rig (src/vehicles/buggygen/shape): the default shape
 * equals the shipped body, landmarks match the cage, share codes round trip, the sculpted
 * features stay rigid, regeneration cost, bytes, and for each handle's ends, 100 random seeds
 * and the presets whether the surface or the mechanical layout breaks. Offline only.
 *
 *   npx tsx tools/buggy-fit/shape/check.ts
 */
import { loadReference } from '../reference'
import { HANDLES, LANDMARKS, defaultShape, type Shape } from '../../../src/vehicles/buggygen/shape/handles'
import { shapedBody } from '../../../src/vehicles/buggygen/shape/body'
import { shapedParts } from '../../../src/vehicles/buggygen/shape/parts'
import { rig, cageFeatures } from '../../../src/vehicles/buggygen/shape/rig'
import { encodeShape, decodeShape } from '../../../src/vehicles/buggygen/shape/code'
import { seedShape } from '../../../src/vehicles/buggygen/shape/seed'
import { buggyBody } from '../../../src/vehicles/buggygen/body'
import { data as cage } from '../../../src/vehicles/buggygen/cage/cage250'
import { PRESETS } from './presets'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const soup = (s: Shape) => { const all: number[] = []; for (const p of shapedBody(s, 0)) all.push(...(p.geometry.getAttribute('position').array as Float32Array)); return new Float32Array(all) }
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))] }

/** Distance from a point to a triangle soup's nearest vertex or edge midpoint (cheap). */
function nearest(tri: Float32Array, x: number, y: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < tri.length; i += 9) for (let k = 0; k < 3; k++) {
    const a = i + k * 3, b = i + ((k + 1) % 3) * 3
    for (const f of [0, .5]) { const px = tri[a] + (tri[b] - tri[a]) * f, py = tri[a + 1] + (tri[b + 1] - tri[a + 1]) * f, pz = tri[a + 2] + (tri[b + 2] - tri[a + 2]) * f; best = Math.min(best, (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2) }
  }
  return Math.sqrt(best)
}
/** Inside test: crossings of a ray toward +X (odd is inside). */
function inside(tri: Float32Array, x: number, y: number, z: number): boolean {
  let hits = 0
  for (let i = 0; i < tri.length; i += 9) {
    const ay = tri[i + 1] - y, az = tri[i + 2] - z, by = tri[i + 4] - y, bz = tri[i + 5] - z, cy = tri[i + 7] - y, cz = tri[i + 8] - z
    const d0 = ay * bz - az * by, d1 = by * cz - bz * cy, d2 = cy * az - cz * ay
    if (!((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0))) continue
    const s = d0 + d1 + d2, xh = (tri[i] * d1 + tri[i + 3] * d2 + tri[i + 6] * d0) / s
    if (xh > x) hits++
  }
  return hits % 2 === 1
}
const faceNormals = (t: Float32Array) => {
  const n = new Float32Array(t.length / 3)
  for (let i = 0, f = 0; i < t.length; i += 9, f += 3) {
    const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2], vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2]
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1
    n[f] = x / l; n[f + 1] = y / l; n[f + 2] = z / l
  }
  return n
}

const ref = loadReference(), shock = ref.shock.extras!.tops as number[]
const tops = [0, 1, 2, 3].map(i => shock.slice(i * 3, i * 3 + 3))
const sockets = ref.sockets.positions
/** Wheels at rest (Syn3hBuggySkin LAYOUT.rest) and the driver's eye (Syn3hBuggy RIDE_HEIGHT). */
const WHEELS = [[1.1, -.2, -1.3], [1.1, -.2, 1.3]], EYE = [0, .8, 0]
const base = soup(defaultShape()), baseN = faceNormals(base)

function judge(s: Shape) {
  const t = soup(s), n = faceNormals(t)
  let flipped = 0; for (let f = 0; f < n.length; f += 3) if (n[f] * baseN[f] + n[f + 1] * baseN[f + 1] + n[f + 2] * baseN[f + 2] < 0) flipped++
  const topsInside = tops.filter(p => inside(t, p[0], p[1], p[2])).length
  let socketsOut = 0; for (let i = 0; i < sockets.length; i += 15) if (!inside(t, sockets[i], sockets[i + 1], sockets[i + 2])) socketsOut++
  let wheel = 0
  for (const [, wy, wz] of WHEELS) for (let i = 0; i < t.length; i += 3) if (t[i] > .88 && t[i] < 1.32 && Math.hypot(t[i + 1] - wy, t[i + 2] - wz) < .45) wheel++
  return { flipped, topsInside, socketsOut, eye: nearest(t, EYE[0], EYE[1], EYE[2]), wheel }
}

// 1. Default equals the shipped body, and the landmarks match the cage.
for (const d of [0, 1] as const) {
  const a = buggyBody.build(d).flatMap(p => [...(p.geometry.getAttribute('position').array as Float32Array)])
  const b = shapedBody(defaultShape(), d).flatMap(p => [...(p.geometry.getAttribute('position').array as Float32Array)])
  let diff = a.length === b.length ? 0 : Infinity; a.forEach((v, i) => { diff = Math.max(diff, Math.abs(v - b[i])) })
  console.log(`default vs shipped body, detail ${d}: max difference ${diff} m over ${a.length / 9} triangles`)
}
{
  const v = cage.v, xs: number[] = [], ys: number[] = [], zs: number[] = []
  for (let i = 0; i < v.length; i += 3) { xs.push(v[i] / 1000); ys.push(v[i + 1] / 1000); zs.push(v[i + 2] / 1000) }
  console.log(`landmarks: nose ${LANDMARKS.NOSE} vs cage min z ${Math.min(...zs)}; tail ${LANDMARKS.TAIL} vs max z ${Math.max(...zs)}; floor ${LANDMARKS.FLOOR} vs min y ${Math.min(...ys)}; half width ${LANDMARKS.HALF_WIDTH} vs max x ${Math.max(...xs)}; axle z ${LANDMARKS.AXLE_Z} (Syn3hBuggySkin rest hub z 1.3, mount z 1.2)`)
  for (const f of cageFeatures()) console.log(`feature ${f.id.padEnd(10)} ${String(f.points.length).padStart(3)} points${f.centred ? ', on the mirror plane' : ''}${f.size ? `, sized by ${f.size}` : ''}`)
}

// 2. Codes and seeds.
let roundTrip = 0, inRange = 0
for (let seed = 0; seed < 500; seed++) {
  const s = seedShape(seed), back = decodeShape(encodeShape(s))
  if (HANDLES.every(h => Math.abs(back[h.id] - s[h.id]) < 1e-9)) roundTrip++
  if (HANDLES.every(h => s[h.id] >= h.min - 1e-9 && s[h.id] <= h.max + 1e-9)) inRange++
}
console.log(`share code: ${encodeShape(defaultShape())} (${encodeShape(defaultShape()).length} chars); round trips ${roundTrip}/500; seeds in range ${inRange}/500`)

// 3. Rigidity: every cage edge inside a feature keeps its length (or the feature's one scale).
const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1)
const extremes: [string, Shape][] = HANDLES.flatMap(h => [h.min, h.max].map((v): [string, Shape] => { const s = defaultShape(); s[h.id] = v; return [`${h.id} ${v}`, s] }))
const cases: [string, Shape][] = [...extremes, ...SEEDS.map((k): [string, Shape] => [`seed ${k}`, seedShape(k)]), ...Object.entries(PRESETS)]
const edges = cageFeatures().map(f => {
  const inF = new Set(f.points), list = new Set<string>()
  for (let t = 0; t < cage.f.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = cage.f[t + k], b = cage.f[t + (k + 1) % 3]
    if (inF.has(a) && inF.has(b)) list.add(a < b ? `${a},${b}` : `${b},${a}`)
  }
  return { f, edges: [...list].map(e => e.split(',').map(Number)) }
})
const len = (p: ArrayLike<number>, a: number, b: number, k = 1) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]) * k
for (const { f, edges: list } of edges) {
  let worst = 0, where = '', spread = 0
  for (const [name, s] of cases) {
    const r = rig(s), want = 1 + (f.size ? s[f.size] : 0)
    let lo = Infinity, hi = -Infinity
    for (const [a, b] of list) {
      const q = len(r.points, a, b) / len(cage.v, a, b, .001)
      lo = Math.min(lo, q); hi = Math.max(hi, q)
      const dev = Math.abs(q - want)
      if (dev > worst) { worst = dev; where = name }
    }
    spread = Math.max(spread, hi - lo)
  }
  console.log(`rigid ${f.id.padEnd(10)} ${list.length} edges over ${cases.length} shapes: worst |ratio - ${f.size ? 'scale' : '1'}| ${worst.toExponential(2)} (${where || 'none'}), widest spread within one shape ${spread.toExponential(2)}: ${worst <= .02 && spread <= .02 ? 'PASS' : 'FAIL'}`)
}

// 4. Regeneration time per edit (Node; the browser numbers come from browser-time.mjs).
{
  const rigT: number[] = [], body: number[] = [], parts: number[] = []
  for (let i = 0; i < 40; i++) {
    const s = seedShape(i + 1)
    let t0 = performance.now(); const r = rig(s); rigT.push(performance.now() - t0)
    t0 = performance.now(); const b = shapedBody(s, 0, r); body.push(performance.now() - t0)
    t0 = performance.now(); shapedParts(s, 0, b.map(p => p.geometry), r); parts.push(performance.now() - t0)
  }
  const tri = shapedBody(defaultShape(), 0).reduce((n, p) => n + p.geometry.getAttribute('position').count / 3, 0)
  console.log(`node regenerate: rig median ${pct(rigT, .5).toFixed(2)} ms; body median ${pct(body, .5).toFixed(2)} p95 ${pct(body, .95).toFixed(2)} ms; following parts median ${pct(parts, .5).toFixed(2)} p95 ${pct(parts, .95).toFixed(2)} ms; body triangles ${tri}`)
}

// 5. Bytes the shape modules add: the shape bundle minus the cage, parts and skin it builds on, gzip -9, three external.
const gz = (f: string) => gzipSync(execFileSync(resolve('node_modules/.bin/esbuild'), [f, '--bundle', '--minify', '--format=esm', '--external:three', '--log-level=error']), { level: 9 }).length
const all = gz('src/vehicles/buggygen/shape/index.ts'), under = gz('tools/buggy-fit/shape/under.ts')
console.log(`gzip: shape modules with what they import ${all} B; cage250 + cage60 + parts alone ${under} B; the shape modules add ${all - under} B`)

// 6. Extremes, seeds and presets against the mechanical layout.
const b0 = judge(defaultShape())
console.log(`default: flipped ${b0.flipped}, shock tops inside ${b0.topsInside}/4, socket samples outside ${b0.socketsOut}/${Math.ceil(sockets.length / 15)}, eye clearance ${b0.eye.toFixed(3)} m, body points in a tyre envelope ${b0.wheel}`)
const bad = (j: ReturnType<typeof judge>) => [j.flipped > 0 && `${j.flipped} flipped`, j.topsInside < b0.topsInside && `shock tops inside ${j.topsInside}`, j.socketsOut > b0.socketsOut * 1.05 + 2 && `sockets out ${j.socketsOut}`, j.eye < .25 && `eye ${j.eye.toFixed(3)}`, j.wheel > b0.wheel && `${j.wheel} points in a tyre`].filter(Boolean)
for (const [name, s] of [...extremes, ...Object.entries(PRESETS).slice(1)]) {
  const j = judge(s), b = bad(j)
  console.log(`${name.padEnd(22)}: ${b.length ? 'BREAKS ' + b.join(', ') : 'ok'}  (flipped ${j.flipped}, tops ${j.topsInside}, sockets out ${j.socketsOut}, eye ${j.eye.toFixed(2)}, tyre ${j.wheel})`)
}
let fails = 0; const why = new Map<string, number>()
for (const k of SEEDS) { const b = bad(judge(seedShape(k))); if (b.length) { fails++; for (const x of b) { const key = String(x).replace(/[\d.]+/g, 'n'); why.set(key, (why.get(key) ?? 0) + 1) } } }
console.log(`random seeds 1 to 100: ${100 - fails} pass; failures by kind: ${[...why].map(([k, n]) => `${k} x${n}`).join(', ') || 'none'}`)
