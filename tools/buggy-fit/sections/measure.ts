/**
 * Score a section candidate against the reference Body: surface distance both ways,
 * silhouette overlap in three views, role agreement, triangles, build time, gzip size of
 * generator plus data, and a picture sheet. Offline only; the shared harness (compare.ts on
 * rd/buggygen-harness) is the referee once it lands.
 *
 *   npx tsx tools/buggy-fit/sections/measure.ts src/vehicles/buggygen/sections/levelB.ts [tag]
 */
import { readMesh, triangles, REF } from './glb'
import { sheet, MAT_RGB, VIEWS, mask } from './render'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import type * as THREE from 'three'

type Piece = { part: string; role: string; geometry: THREE.BufferGeometry }
export const refRole = (n: string) => /Body/.test(n) ? 'paint' : /Accent/.test(n) ? 'accent' : /Chrome/.test(n) ? 'chrome' : /Head/.test(n) ? 'lamp' : /Tail/.test(n) ? 'lamp' : 'frame'

export function soupOf(pieces: Piece[]): { tri: Float32Array; role: string[] } {
  const tris: number[] = [], role: string[] = []
  for (const p of pieces) {
    const P = p.geometry.getAttribute('position'), I = p.geometry.getIndex()
    const n = I ? I.count : P.count
    for (let i = 0; i < n; i++) { const k = I ? I.getX(i) : i; tris.push(P.getX(k), P.getY(k), P.getZ(k)); if (i % 3 === 0) role.push(p.role) }
  }
  return { tri: new Float32Array(tris), role }
}

/** Area-weighted random points on a soup, with the triangle each came from. Seeded. */
function samples(tri: Float32Array, count: number): { pts: Float32Array; from: Uint32Array } {
  const n = tri.length / 9, cum = new Float64Array(n); let total = 0
  for (let t = 0; t < n; t++) {
    const o = t * 9, ux = tri[o + 3] - tri[o], uy = tri[o + 4] - tri[o + 1], uz = tri[o + 5] - tri[o + 2], vx = tri[o + 6] - tri[o], vy = tri[o + 7] - tri[o + 1], vz = tri[o + 8] - tri[o + 2]
    total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; cum[t] = total
  }
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const pts = new Float32Array(count * 3), from = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const r = rnd() * total; let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid }
    let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b }
    const o = lo * 9; from[i] = lo
    for (let c = 0; c < 3; c++) pts[i * 3 + c] = tri[o + c] + (tri[o + 3 + c] - tri[o + c]) * a + (tri[o + 6 + c] - tri[o + c]) * b
  }
  return { pts, from }
}

/** Squared distance from p to triangle (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTri(px: number, py: number, pz: number, T: Float32Array, o: number): number {
  const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8]
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz
  const q = (x: number, y: number, z: number) => (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2
  if (d1 <= 0 && d2 <= 0) return q(ax, ay, az)
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return q(bx, by, bz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return q(ax + abx * v, ay + aby * v, az + abz * v) }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return q(cx, cy, cz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return q(ax + acx * w, ay + acy * w, az + acz * w) }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return q(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w) }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den
  return q(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

/** Nearest triangle for each point, through a uniform grid of triangle boxes. */
function nearest(pts: Float32Array, tri: Float32Array): { d: Float32Array; t: Uint32Array } {
  const G = .08, n = tri.length / 9, cells = new Map<string, number[]>()
  for (let t = 0; t < n; t++) {
    const o = t * 9, lo = [0, 1, 2].map(c => Math.floor(Math.min(tri[o + c], tri[o + 3 + c], tri[o + 6 + c]) / G)), hi = [0, 1, 2].map(c => Math.floor(Math.max(tri[o + c], tri[o + 3 + c], tri[o + 6 + c]) / G))
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; const l = cells.get(k); if (l) l.push(t); else cells.set(k, [t]) }
  }
  const d = new Float32Array(pts.length / 3), tt = new Uint32Array(pts.length / 3)
  for (let i = 0; i < d.length; i++) {
    const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2], cx = Math.floor(px / G), cy = Math.floor(py / G), cz = Math.floor(pz / G)
    let best = Infinity, bt = 0
    for (let R = 0; R < 40; R++) {
      for (let x = cx - R; x <= cx + R; x++) for (let y = cy - R; y <= cy + R; y++) for (let z = cz - R; z <= cz + R; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== R) continue
        const l = cells.get(`${x},${y},${z}`); if (!l) continue
        for (const t of l) { const q = pointTri(px, py, pz, tri, t * 9); if (q < best) { best = q; bt = t } }
      }
      if (best < (R * G) ** 2) break
    }
    d[i] = Math.sqrt(best); tt[i] = bt
  }
  return { d, t: tt }
}

const stats = (d: Float32Array) => { const s = [...d].sort((a, b) => a - b); return { mean: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.floor(s.length * .95)], max: s[s.length - 1] } }

export interface Score { id: string; numbers?: number; tris: [number, number, number]; buildMs: number; gzip: number; refToCand: ReturnType<typeof stats>; candToRef: ReturnType<typeof stats>; iou: Record<string, number>; roleMatch: number }

export async function measure(file: string, tag: string, ref = triangles(readMesh(REF, 'Body'))): Promise<Score> {
  return score((await import(resolve(file))).default, tag, file, ref)
}

export function score(mod: { id: string; numbers?: number; build(d: 0 | 1 | 2): Piece[] }, tag: string, file: string, ref = triangles(readMesh(REF, 'Body'))): Score {
  mod.build(0)
  const t0 = performance.now(); let built: Piece[] = []; for (let i = 0; i < 5; i++) built = mod.build(0); const buildMs = (performance.now() - t0) / 5
  const cand = soupOf(built), tris = [0, 1, 2].map(d => soupOf(mod.build(d as 0)).role.length) as [number, number, number]
  const refRoles = Array.from(ref.mat, m => refRole(ref.names[m]))
  const rs = samples(ref.tri, 20000), cs = samples(cand.tri, 20000)
  const a = nearest(rs.pts, cand.tri), b = nearest(cs.pts, ref.tri)
  let match = 0; for (let i = 0; i < a.t.length; i++) if (cand.role[a.t[i]] === refRoles[rs.from[i]]) match++
  const iou: Record<string, number> = {}
  for (const v of VIEWS.slice(0, 3)) {
    const A = mask(ref.tri, v, 400), B = mask(cand.tri, v, 400); let I = 0, U = 0
    for (let i = 0; i < A.length; i++) { I += A[i] & B[i]; U += A[i] | B[i] }
    iou[v.name] = I / U
  }
  // gzip of generator plus data: bundle the module with three left out, minified.
  const js = execFileSync(resolve('node_modules/.bin/esbuild'), [file, '--bundle', '--minify', '--format=esm', '--external:three', '--log-level=error'])
  const gzip = gzipSync(js, { level: 9 }).length
  const rgb = (roles: string[]) => (t: number) => MAT_RGB[roles[t]] ?? [255, 0, 255]
  sheet(`/tmp/buggy-fit/sections/${tag}.png`, [{ tri: ref.tri, rgb: rgb(refRoles) }, { tri: cand.tri, rgb: rgb(cand.role) }])
  return { id: mod.id, numbers: mod.numbers, tris, buildMs, gzip, refToCand: stats(a.d), candToRef: stats(b.d), iou, roleMatch: match / a.t.length }
}

export function line(s: Score): string {
  const f = (x: number) => (x * 100).toFixed(1)
  return `${s.id.padEnd(22)} numbers ${String(s.numbers).padStart(5)}  tris ${s.tris.join('/')}  build ${s.buildMs.toFixed(1)} ms  gzip ${s.gzip} B  ref>cand mean ${f(s.refToCand.mean)} p95 ${f(s.refToCand.p95)} cm  cand>ref mean ${f(s.candToRef.mean)} p95 ${f(s.candToRef.p95)} cm  IoU side ${s.iou.side.toFixed(3)} top ${s.iou.top.toFixed(3)} front ${s.iou.front.toFixed(3)}  roles ${(s.roleMatch * 100).toFixed(0)}%`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await measure(process.argv[2], process.argv[3] ?? 'candidate')
  console.log(line(s))
}
