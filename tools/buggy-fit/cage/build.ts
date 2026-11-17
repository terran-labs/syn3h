// Builds and scores the cage candidates.
//
//   npx tsx tools/buggy-fit/cage/build.ts [sizes...]     (default 60 120 250 500)
//
// For each size: decimate the half reference body to that many stored points, tag crisp edges,
// fit the cage so its subdivided surface lands on the reference, write
// src/vehicles/buggygen/cage/cage<N>.ts, score it, and draw /tmp/buggy-fit/cage/cage<N>.png.
import {writeFileSync, readFileSync, mkdirSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {readNode} from './glb'
import {weld, TriGrid, distance, roughness, type TriMesh} from './geom'
import {decimate} from './decimate'
import {clean, quality} from './clean'
import {fitCage} from './fit'
import {buildBody, fullCage, cornerNormals, type CageData, type Candidate} from '../../../src/vehicles/buggygen/cage/generator'
import {subdivide} from '../../../src/vehicles/buggygen/cage/subdivide'
import {sheet, VIEWS} from './render'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = '/tmp/buggy-fit/cage'
mkdirSync(OUT, {recursive: true})
const ROLE_OF: Record<string, string> = {'Body.002': 'paint', 'Accent.002': 'accent', 'Chrome.001': 'chrome', 'Headlights.001': 'lamp:head', TailLights: 'lamp:tail', Dark: 'frame'}

const raw = readNode(join(ROOT, 'tools/models/buggy-boxarm.glb'), 'Body.001')
const roles = raw.materials.map(m => ROLE_OF[m] ?? 'paint')
const ref = weld(raw.pos, raw.index, raw.group)
const grid = new TriGrid(ref)

// The half body: triangles entirely on x >= 0, mirror plane snapped to x = 0.
function half(m: TriMesh): TriMesh {
  const keep: number[] = [], tags: number[] = []
  for (let t = 0; t < m.tri.length / 3; t++) {
    const xs = [0, 1, 2].map(k => m.pos[m.tri[t * 3 + k] * 3])
    if (Math.min(...xs) > -1e-4) { keep.push(m.tri[t * 3], m.tri[t * 3 + 1], m.tri[t * 3 + 2]); tags.push(m.tag[t]) }
  }
  const used = new Map<number, number>(), pos: number[] = []
  const tri = keep.map(v => { let u = used.get(v); if (u === undefined) { u = used.size; used.set(v, u); pos.push(Math.abs(m.pos[v * 3]) < 1e-4 ? 0 : m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]) } return u })
  return {pos: Float64Array.from(pos), tri: Uint32Array.from(tri), tag: Uint8Array.from(tags)}
}

/** Same-role cage edges folded more than `degrees` become creases. */
function creases(m: TriMesh, degrees: number): number[] {
  const edges = new Map<string, number[]>()
  for (let f = 0; f < m.tri.length / 3; f++) for (let k = 0; k < 3; k++) { const a = m.tri[f * 3 + k], b = m.tri[f * 3 + (k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; (edges.get(key) ?? edges.set(key, []).get(key)!).push(f) }
  const n = (f: number) => { const [a, b, c] = [0, 1, 2].map(k => m.tri[f * 3 + k] * 3), p = m.pos; const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]; const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...x) || 1; return x.map(q => q / l) }
  const out: number[] = [], cos = Math.cos(degrees * Math.PI / 180)
  for (const [key, fs] of edges) {
    if (fs.length !== 2 || m.tag[fs[0]] !== m.tag[fs[1]]) continue
    const [a, b] = key.split(',').map(Number)
    if (m.pos[a * 3] === 0 && m.pos[b * 3] === 0) continue // a fold along the mirror plane would be a ridge; leave smooth
    const p = n(fs[0]), q = n(fs[1])
    if (p[0] * q[0] + p[1] * q[1] + p[2] * q[2] < cos) out.push(a, b)
  }
  return out
}

function asMesh(d: CageData, levels: number): TriMesh {
  const s = subdivide(fullCage(d), levels, !!d.limit)
  return {pos: s.positions, tri: s.faces, tag: s.tags}
}

const sizes = process.argv.slice(2).map(Number).filter(Boolean)
const h = half(ref)
console.log(`reference: ${ref.tri.length / 3} triangles, ${ref.pos.length / 3} vertices; half: ${h.pos.length / 3} vertices`)
const rows: string[] = [], extra: string[] = []
const code = ['generator.ts', 'subdivide.ts'].map(f => readFileSync(join(ROOT, 'src/vehicles/buggygen/cage', f), 'utf8')).join('\n')
for (const size of sizes.length ? sizes : [60, 120, 250, 500]) {
  const env = (k: string, d: number) => process.env[k] ? Number(process.env[k]) : d
  const raw = decimate(h, size, env('BORDER', 20), env('SHAPE', 0))
  const dec = env('CLEAN', 6) ? clean(raw, grid, env('CLEAN', 6)) : raw
  console.error(`${size}: cage triangle quality before ${JSON.stringify(quality(raw))}, after ${JSON.stringify(quality(dec))}`)
  const fullTris = dec.tri.length / 3 * 2
  const level0 = fullTris * 16 <= 9000 ? 2 : 1
  const base: CageData = {roles, v: Array.from(dec.pos, x => Math.round(x * 1000)), f: Array.from(dec.tri), t: Array.from(dec.tag), c: creases(dec, env('CREASE', 55)), levels: [level0, level0 - 1, 0], limit: !!env('LIMIT', 1)}
  const t0 = performance.now()
  const fitted = fitCage(base, ref, grid, {levels: level0, rounds: env('ROUNDS', 20), reverse: env('REVERSE', size <= 60 ? 1 : 0), smooth: env('SMOOTH', 1e-3), fair: env('FAIR', 0), bend: env('BEND', 0.3), log: !!process.env.LOG})
  const fitMs = performance.now() - t0
  const id = `cage${size}`
  // Detail 2 must stay near 400 triangles: cages too big for that borrow the 60 point cage.
  const far = fullTris > 500 && size !== 60
  if (process.env.DRY) { const fm = asMesh(fitted, level0), dd = distance(ref, fm, grid); console.log(id, JSON.stringify(dd), 'roughness', roughness(fm), 'reference', roughness(ref)); continue }
  const file = `// Generated by tools/buggy-fit/cage/build.ts: the buggy body as a ${fitted.v.length / 3} point half cage.\n` +
    `import {candidate, type CageData} from './generator'\n` + (far ? `import {data as far} from './cage60'\n` : '') +
    `\nexport const data: CageData = ${JSON.stringify(fitted)}\n\nexport default candidate('${id}', data${far ? ', far' : ''})\n`
  writeFileSync(join(ROOT, 'src/vehicles/buggygen/cage', `${id}.ts`), file)
  const numbers = fitted.v.length + fitted.f.length + fitted.t.length + fitted.c.length // this cage alone; the far cage adds its own
  const gz = gzipSync(code + file, {level: 9}).length, gzData = gzipSync(file, {level: 9}).length
  const times: number[] = []
  for (let i = 0; i < 25; i++) { const s = performance.now(); buildBody(fitted, level0); if (i >= 5) times.push(performance.now() - s) }
  times.sort((a, b) => a - b)
  const mod = (await import(join(ROOT, 'src/vehicles/buggygen/cage', `${id}.ts`))).default as Candidate
  const trisAt = (detail: 0 | 1 | 2) => mod.build(detail).reduce((s, p) => s + p.geometry.attributes.position.count / 3, 0)
  const min = buildSync({stdin: {contents: `import c from './${id}'\nexport default c`, resolveDir: join(ROOT, 'src/vehicles/buggygen/cage'), loader: 'ts'}, bundle: true, minify: true, format: 'esm', external: ['three'], write: false}).outputFiles[0].contents
  const gzMin = gzipSync(min, {level: 9}).length
  extra.push(`| ${id} | ${trisAt(0)} / ${trisAt(1)} / ${trisAt(2)} | ${times[0].toFixed(1)} / ${times[10].toFixed(1)} | ${gzMin} |`)
  const mesh = asMesh(fitted, level0)
  const dFit = distance(ref, mesh, grid), dRaw = distance(ref, asMesh(base, level0), grid), dCage = distance(ref, asMesh(fitted, 0), grid)
  const coarse = (step: number) => distance(ref, asMesh({...fitted, v: fitted.v.map((x, i) => i % 3 === 0 && x === 0 ? 0 : Math.round(x / step) * step)}, level0), grid, 8000).meanMm
  const line = `| ${id} | ${fitted.v.length / 3} | ${numbers} | ${gzData} | ${gz} | ${mesh.tri.length / 3} (L${level0}) | ${times[3].toFixed(1)} | ${dFit.meanMm} / ${dFit.rmsMm} / ${dFit.p95Mm} / ${dFit.maxMm} | ${dFit.roleMatch} | ${dRaw.meanMm} | ${dCage.meanMm} | ${coarse(2)} / ${coarse(5)} | ${fitted.c.length / 2} | ${(fitMs / 1000).toFixed(0)} s |`
  console.log(line); rows.push(line)
  sheet(`${OUT}/${id}.png`, [{mesh: ref}, {mesh: asMesh(fitted, 0), wire: true}, {mesh}])
  const smooth = (m: TriMesh) => ({mesh: m, normals: cornerNormals(Float32Array.from(m.pos), Uint32Array.from(m.tri), Uint8Array.from(m.tag))})
  const closeup = [VIEWS[3], VIEWS[4]]
  sheet(`${OUT}/${id}-smooth.png`, [smooth(ref), smooth(mesh)], closeup, 900)
}
console.log('\n| id | stored points | numbers | gzip data B | gzip code+data B | tris detail 0 | build ms | mean / rms / p95 / max mm | role match | mean mm unfitted | mean mm cage only | mean mm at 2 / 5 mm grid | creases | fit time |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) console.log(r)
console.log('\n| id | triangles at detail 0 / 1 / 2 | build ms detail 0, best / median | gzip minified bundle B |')
console.log('| --- | --- | --- | --- |')
for (const r of extra) console.log(r)
