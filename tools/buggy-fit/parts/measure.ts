/**
 * Measure the generated buggy parts against the reference and draw them side by side.
 *
 *     npx tsx tools/buggy-fit/parts/measure.ts [part ...]
 *
 * Prints, per part: triangles (generated and reference), surface distance both ways (mean,
 * 95th percentile and maximum, in millimetres), silhouette overlap in three orthographic
 * views, build time in Node and gzip size of the bundled generator. Pictures go to
 * /tmp/buggy-fit/parts/<part>.png: reference on the top row, generated below, in front, side
 * and top views. Developer tooling only; nothing here ships.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync, gzipSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReference, bounds, type Mesh } from '../reference'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = '/tmp/buggy-fit/parts'
type V = [number, number, number]

// ---- sampling and distance ---------------------------------------------------------------

function tri(m: Mesh, t: number): [V, V, V] {
  const g = (k: number): V => { const i = m.indices[t * 3 + k] * 3; return [m.positions[i], m.positions[i + 1], m.positions[i + 2]] }
  return [g(0), g(1), g(2)]
}
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Area weighted, deterministic surface samples. */
function samples(m: Mesh, count: number): V[] {
  const n = m.indices.length / 3, areas: number[] = []
  let total = 0
  for (let t = 0; t < n; t++) { const [a, b, c] = tri(m, t); const x = cross(sub(b, a), sub(c, a)); total += Math.hypot(...x) / 2; areas.push(total) }
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const out: V[] = []
  for (let s = 0; s < count; s++) {
    const r = (s + rnd()) / count * total
    let lo = 0, hi = n - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < r) lo = mid + 1; else hi = mid }
    const [a, b, c] = tri(m, lo)
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v }
    out.push([a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v, a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v])
  }
  return out
}

/** Squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTri(p: V, a: V, b: V, c: V): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
  const d1 = dot(ab, ap), d2 = dot(ac, ap)
  const at = (q: V) => { const d = sub(p, q); return dot(d, d) }
  if (d1 <= 0 && d2 <= 0) return at(a)
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return at(b)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]) }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return at(c)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]) }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]) }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w])
}

function distances(from: V[], to: Mesh): number[] {
  const n = to.indices.length / 3, tris = Array.from({ length: n }, (_, t) => tri(to, t))
  return from.map(p => { let best = Infinity; for (const [a, b, c] of tris) { const d = pointTri(p, a, b, c); if (d < best) best = d } return Math.sqrt(best) }).sort((a, b) => a - b)
}
const stats = (d: number[]) => ({ mean: d.reduce((s, x) => s + x, 0) / d.length * 1000, p95: d[Math.floor(d.length * .95)] * 1000, max: d[d.length - 1] * 1000 })

// ---- software renderer -------------------------------------------------------------------

const S = 220
/** Views: screen x axis, screen y axis, depth axis (toward the viewer). */
const VIEWS: { name: string; x: V; y: V; z: V }[] = [
  { name: 'front', x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] },
  { name: 'side', x: [0, 0, -1], y: [0, 1, 0], z: [-1, 0, 0] },
  { name: 'top', x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
]

function render(m: Mesh, view: typeof VIEWS[0], centre: V, scale: number, tintOf: (t: number) => V): { rgb: Uint8Array; mask: Uint8Array } {
  const rgb = new Uint8Array(S * S * 3).fill(28), mask = new Uint8Array(S * S), depth = new Float32Array(S * S).fill(-Infinity)
  const light: V = [.4, .7, .6]
  const n = m.indices.length / 3
  for (let t = 0; t < n; t++) {
    const w = tri(m, t)
    const nrm = cross(sub(w[1], w[0]), sub(w[2], w[0])), l = Math.hypot(...nrm) || 1
    const vn: V = [dot(nrm, view.x) / l, dot(nrm, view.y) / l, dot(nrm, view.z) / l]
    const shade = .25 + .75 * Math.abs(dot(vn, light) / Math.hypot(...light))
    const facing = vn[2] >= 0 ? 1 : .55 // back faces darker, so wrong winding shows
    const s = w.map(p => { const q = sub(p, centre); return [S / 2 + dot(q, view.x) * scale, S / 2 - dot(q, view.y) * scale, dot(q, view.z)] })
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(S - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])))
    const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(S - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])))
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1])
    if (Math.abs(area) < 1e-9) continue
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + .5, py = y + .5
      const a = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area
      const b = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area
      const c = 1 - a - b
      if (a < 0 || b < 0 || c < 0) continue
      const z = a * s[0][2] + b * s[1][2] + c * s[2][2], k = y * S + x
      mask[k] = 1
      if (z <= depth[k]) continue
      depth[k] = z
      const tint = tintOf(t)
      for (let ch = 0; ch < 3; ch++) rgb[k * 3 + ch] = Math.min(255, tint[ch] * shade * facing)
    }
  }
  return { rgb, mask }
}

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- candidate -----------------------------------------------------------------------------

const TINTS: Record<string, V> = { paint: [80, 140, 230], accent: [90, 230, 255], chrome: [220, 225, 235], frame: [150, 150, 160], lamp: [255, 240, 170], trim: [140, 120, 100], canopy: [120, 200, 255], glow: [255, 120, 255] }

async function main(): Promise<void> {
  const { default: candidate } = await import('../../../src/vehicles/buggygen/parts/index')
  const want = process.argv.slice(2)
  const t0 = performance.now(); let pieces = candidate.build(0); const buildMs = performance.now() - t0
  // Warm timing: the first call pays for module start up.
  const t1 = performance.now(); pieces = candidate.build(0); const warmMs = performance.now() - t1
  const esbuild = await import('esbuild')
  const bundle = await esbuild.build({ entryPoints: [resolve(ROOT, 'src/vehicles/buggygen/parts/index.ts')], bundle: true, minify: true, write: false, format: 'esm', external: ['three'] })
  const gz = gzipSync(bundle.outputFiles[0].contents).length
  console.log(`build(0) ${buildMs.toFixed(1)} ms first, ${warmMs.toFixed(1)} ms warm; bundle ${bundle.outputFiles[0].contents.length} B, gzip ${gz} B; numbers ${candidate.numbers ?? '?'}`)
  for (const d of [1, 2] as const) {
    const tris: Record<string, number> = {}
    for (const p of candidate.build(d)) tris[p.part] = (tris[p.part] ?? 0) + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3
    console.log(`detail ${d}: ${Object.entries(tris).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  const ref = loadReference()
  mkdirSync(OUT, { recursive: true })
  const parts = [...new Set(pieces.map(p => p.part))].filter(p => !want.length || want.includes(p))
  for (const part of parts) {
    const own = pieces.filter(p => p.part === part)
    const pos: number[] = [], idx: number[] = [], roles: string[] = []
    for (const p of own) {
      const g = p.geometry, base = pos.length / 3, a = g.attributes.position
      for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i))
      const ix = g.index ? Array.from(g.index.array) : Array.from({ length: a.count }, (_, i) => i)
      for (let k = 0; k < ix.length; k++) idx.push(ix[k] + base)
      for (let k = 0; k < ix.length / 3; k++) roles.push(p.role)
    }
    const gen: Mesh = { positions: new Float32Array(pos), indices: new Uint32Array(idx), materials: roles }
    const r = ref[part as keyof typeof ref]
    const ab = stats(distances(samples(gen, 2500), r)), ba = stats(distances(samples(r, 2500), gen))
    const rb = bounds(r.positions), gb = bounds(gen.positions)
    const centre: V = [0, 1, 2].map(k => (rb.min[k] + rb.max[k]) / 2) as V
    const scale = S * .9 / Math.max(...[0, 1, 2].map(k => rb.max[k] - rb.min[k]))
    const img = new Uint8Array(S * 3 * S * 2 * 3)
    const ious: string[] = []
    VIEWS.forEach((v, col) => {
      const tintOf = (m: Mesh) => (t: number): V => {
        const name = m.materials[t] ?? ''
        for (const [k, c] of Object.entries(TINTS)) if (name === k) return c
        return /chrome/i.test(name) ? TINTS.chrome : /glow/i.test(name) ? TINTS.glow : /accent/i.test(name) ? TINTS.accent : /light/i.test(name) ? TINTS.lamp : /interior/i.test(name) ? TINTS.trim : /glass/i.test(name) ? TINTS.canopy : /dark|metal/i.test(name) ? TINTS.frame : TINTS.paint
      }
      const a = render(r, v, centre, scale, tintOf(r)), b = render(gen, v, centre, scale, tintOf(gen))
      let inter = 0, uni = 0
      for (let k = 0; k < S * S; k++) { if (a.mask[k] && b.mask[k]) inter++; if (a.mask[k] || b.mask[k]) uni++ }
      ious.push(`${v.name} ${(inter / Math.max(1, uni)).toFixed(3)}`)
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let ch = 0; ch < 3; ch++) {
        img[(y * S * 3 + col * S + x) * 3 + ch] = a.rgb[(y * S + x) * 3 + ch]
        img[((y + S) * S * 3 + col * S + x) * 3 + ch] = b.rgb[(y * S + x) * 3 + ch]
      }
    })
    writeFileSync(`${OUT}/${part}.png`, png(S * 3, S * 2, img))
    const f = (s: { mean: number; p95: number; max: number }) => `${s.mean.toFixed(1)}/${s.p95.toFixed(1)}/${s.max.toFixed(1)}`
    console.log(`${part.padEnd(9)} tris ${gen.indices.length / 3} vs ${r.indices.length / 3}; gen->ref mm ${f(ab)}; ref->gen mm ${f(ba)}; IoU ${ious.join(' ')}`)
    console.log(`          bounds gen ${gb.min.map(v => v.toFixed(3))} .. ${gb.max.map(v => v.toFixed(3))}; ref ${rb.min.map(v => v.toFixed(3))} .. ${rb.max.map(v => v.toFixed(3))}`)
  }
}
main()
