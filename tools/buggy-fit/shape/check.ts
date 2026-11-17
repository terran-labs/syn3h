/**
 * Checks and measurements for the shape handles (src/vehicles/buggygen/shape):
 * the default shape equals cage250, share codes round trip, seeds stay in range, regeneration
 * time per edit, and for each handle's extremes and for random seeds whether the surface or
 * the mechanical layout breaks. Offline only.
 *
 *   npx tsx tools/buggy-fit/shape/check.ts
 */
import { loadReference } from '../reference'
import { HANDLES, defaultShape, type Shape } from '../../../src/vehicles/buggygen/shape/handles'
import { shapedBody } from '../../../src/vehicles/buggygen/shape/body'
import { encodeShape, decodeShape } from '../../../src/vehicles/buggygen/shape/code'
import { seedShape } from '../../../src/vehicles/buggygen/shape/seed'
import { buildBody } from '../../../src/vehicles/buggygen/cage/generator'
import { data as cage } from '../../../src/vehicles/buggygen/cage/cage250'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const soup = (s: Shape) => { const parts = shapedBody(s, 0); const all: number[] = []; for (const p of parts) all.push(...(p.geometry.getAttribute('position').array as Float32Array)); return new Float32Array(all) }

/** Squared distance from a point to a triangle soup's nearest vertex-sampled point (cheap: vertices and edge midpoints). */
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
    // Project onto the YZ plane and test the point in the triangle, then the crossing is ahead.
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
/** Wheels at rest (LoadedBuggySkin LAYOUT.rest) and the driver's eye (Syn3hBuggy RIDE_HEIGHT). */
const WHEELS = [[1.1, -.2, -1.3], [1.1, -.2, 1.3]], EYE = [0, .8, 0]
const base = soup(defaultShape()), baseN = faceNormals(base)

function judge(s: Shape) {
  const t = soup(s), n = faceNormals(t)
  let flipped = 0; for (let f = 0; f < n.length; f += 3) if (n[f] * baseN[f] + n[f + 1] * baseN[f + 1] + n[f + 2] * baseN[f + 2] < 0) flipped++
  const topsInside = tops.filter(p => inside(t, p[0], p[1], p[2])).length
  let socketsOut = 0; for (let i = 0; i < sockets.length; i += 15) if (!inside(t, sockets[i], sockets[i + 1], sockets[i + 2])) socketsOut++
  // Body points inside a tyre envelope: a cylinder about each rest hub, radius 0.45, x 0.88 to 1.32.
  let wheel = 0
  for (const [, wy, wz] of WHEELS) for (const sz of [1]) for (let i = 0; i < t.length; i += 3) if (t[i] > .88 && t[i] < 1.32 && Math.hypot(t[i + 1] - wy, t[i + 2] - wz * sz) < .45) wheel++
  return { flipped, topsInside, socketsOut, eye: nearest(t, EYE[0], EYE[1], EYE[2]), wheel }
}

// 1. Default equals cage250.
const plain = buildBody(cage, cage.levels[0]).flatMap(p => [...(p.geometry.getAttribute('position').array as Float32Array)])
let diff = 0; plain.forEach((v, i) => { diff = Math.max(diff, Math.abs(v - base[i])) })
console.log(`default vs cage250: max difference ${(diff * 1000).toFixed(4)} mm over ${base.length / 9} triangles`)

// 2. Codes and seeds.
let roundTrip = 0, inRange = 0
for (let seed = 0; seed < 500; seed++) {
  const s = seedShape(seed), back = decodeShape(encodeShape(s))
  if (HANDLES.every(h => Math.abs(back[h.id] - s[h.id]) < 1e-9)) roundTrip++
  if (HANDLES.every(h => s[h.id] >= h.min - 1e-9 && s[h.id] <= h.max + 1e-9)) inRange++
}
console.log(`share code: ${encodeShape(defaultShape())} (${encodeShape(defaultShape()).length} chars); round trips ${roundTrip}/500; seeds in range ${inRange}/500; seed 7 = ${encodeShape(seedShape(7))}`)

// 3. Regeneration time per edit at each detail.
for (const d of [0, 1, 2] as const) {
  const times: number[] = []
  for (let i = 0; i < 40; i++) { const s = seedShape(i), t0 = performance.now(); shapedBody(s, d); times.push(performance.now() - t0) }
  times.sort((a, b) => a - b)
  console.log(`regenerate detail ${d}: median ${times[20].toFixed(2)} ms, p95 ${times[37].toFixed(2)} ms, triangles ${soupCount(d)}`)
}
function soupCount(d: 0 | 1 | 2) { return shapedBody(defaultShape(), d).reduce((n, p) => n + p.geometry.getAttribute('position').count / 3, 0) }

// 4. Bytes the layer adds: shape bundle minus the cage bundle, both gzip -9, three external.
const gz = (f: string) => gzipSync(execFileSync(resolve('node_modules/.bin/esbuild'), [f, '--bundle', '--minify', '--format=esm', '--external:three', '--log-level=error']), { level: 9 }).length
const all = gz('src/vehicles/buggygen/shape/index.ts'), cageOnly = gz('src/vehicles/buggygen/cage/cage250.ts')
console.log(`gzip: shape layer with cage250 ${all} B, cage250 alone ${cageOnly} B, layer adds ${all - cageOnly} B`)

// 5. Extremes and random seeds.
const b0 = judge(defaultShape())
console.log(`default: flipped ${b0.flipped}, shock tops inside ${b0.topsInside}/4, socket samples outside ${b0.socketsOut}/${Math.ceil(sockets.length / 15)}, eye clearance ${b0.eye.toFixed(3)} m, body points in a tyre envelope ${b0.wheel}`)
const bad = (j: ReturnType<typeof judge>) => [j.flipped > 0 && `${j.flipped} flipped`, j.topsInside < b0.topsInside && `shock tops inside ${j.topsInside}`, j.socketsOut > b0.socketsOut * 1.05 + 2 && `sockets out ${j.socketsOut}`, j.eye < .25 && `eye ${j.eye.toFixed(3)}`, j.wheel > b0.wheel && `${j.wheel} points in a tyre`].filter(Boolean)
for (const h of HANDLES) for (const v of [h.min, h.max]) {
  const s = defaultShape(); s[h.id] = v; const j = judge(s), b = bad(j)
  console.log(`${h.id.padEnd(14)} ${String(v).padStart(6)}: ${b.length ? 'BREAKS ' + b.join(', ') : 'ok'}  (flipped ${j.flipped}, tops ${j.topsInside}, sockets out ${j.socketsOut}, eye ${j.eye.toFixed(2)}, tyre ${j.wheel})`)
}
let fails = 0; for (let seed = 1; seed <= 60; seed++) { const b = bad(judge(seedShape(seed))); if (b.length) { fails++; if (fails <= 5) console.log(`seed ${seed}: ${b.join(', ')}`) } }
const corners = [0, 1].map(k => { const s = defaultShape(); for (const h of HANDLES) s[h.id] = k ? h.max : h.min; return bad(judge(s)) })
console.log(`random seeds 1 to 60: ${60 - fails} pass; all handles at min: ${corners[0].join(', ') || 'ok'}; all at max: ${corners[1].join(', ') || 'ok'}`)

// 6. Headroom: how far past each end of its range a handle goes before the first check fails.
for (const h of HANDLES) {
  const span = h.max - h.min, found: string[] = []
  for (const [end, dir] of [[h.min, -1], [h.max, 1]] as const) {
    let v = end, why = ''
    for (let k = 1; k <= 12 && !why; k++) { v = end + dir * span * .25 * k; const s = defaultShape(); s[h.id] = v; why = bad(judge(s)).join(', ') }
    found.push(why ? `${+v.toFixed(3)} (${why})` : `beyond ${+v.toFixed(3)}`)
  }
  console.log(`headroom ${h.id.padEnd(14)} low end breaks at ${found[0]}; high end breaks at ${found[1]}`)
}
