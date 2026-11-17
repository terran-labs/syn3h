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
import {characterLines} from './lines'
import {snapLines} from './linesnap'
import {fitCage} from './fit'
import {buildBody, fullCage, cornerNormals, type CageData, type Candidate} from '../../../src/vehicles/buggygen/cage/generator'
import {subdivide} from '../../../src/vehicles/buggygen/cage/subdivide'
import {sheet, VIEWS} from './render'

const env0 = (k: string, d: number) => process.env[k] ? Number(process.env[k]) : d
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
/** Sharp edges of the reference inside one role, as segments: folds of more than `degrees`. */
function sharpEdges(m: TriMesh, degrees: number): number[][] {
  const out: number[][] = [], edges = new Map<string, number[]>(), p = m.pos
  for (let f = 0; f < m.tri.length / 3; f++) for (let k = 0; k < 3; k++) { const a = m.tri[f * 3 + k], b = m.tri[f * 3 + (k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; (edges.get(key) ?? edges.set(key, []).get(key)!).push(f) }
  const n = (f: number) => { const [a, b, c] = [0, 1, 2].map(k => m.tri[f * 3 + k] * 3); const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]; const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...x) || 1; return x.map(q => q / l) }
  const cos = Math.cos(degrees * Math.PI / 180)
  for (const [key, fs] of edges) {
    if (fs.length !== 2 || m.tag[fs[0]] !== m.tag[fs[1]]) continue
    const a = n(fs[0]), b = n(fs[1])
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] >= cos) continue
    const [i, j] = key.split(',').map(Number)
    out.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p[j * 3], p[j * 3 + 1], p[j * 3 + 2]])
  }
  return out
}

/** Distance from point q to segment s (six numbers). */
function toSegment(q: number[], s: number[]): number {
  const d = [s[3] - s[0], s[4] - s[1], s[5] - s[2]], w = [q[0] - s[0], q[1] - s[1], q[2] - s[2]]
  const t = Math.max(0, Math.min(1, (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / ((d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1)))
  return Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2])
}

/**
 * Cage edges that lie along a sharp edge of the reference (each quarter point within `tol`
 * metres of one) become creases, so folds such as the hood scoop's inner wall stay crisp.
 */
function referenceCreases(m: TriMesh, sharp: number[][], tol: number): number[] {
  const out: number[] = [], seen = new Set<string>(), p = m.pos
  for (let f = 0; f < m.tri.length / 3; f++) for (let k = 0; k < 3; k++) {
    const a = m.tri[f * 3 + k], b = m.tri[f * 3 + (k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`
    if (seen.has(key)) continue; seen.add(key)
    if (p[a * 3] === 0 && p[b * 3] === 0) continue
    const ok = [.1, .35, .65, .9].every(t => { const q = [0, 1, 2].map(i => p[a * 3 + i] + t * (p[b * 3 + i] - p[a * 3 + i])); return sharp.some(s => toSegment(q, s) < tol) })
    if (ok) out.push(a, b)
  }
  return out
}

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

// A size is a module name and, optionally, a different point budget: `250:290` writes
// cage250.ts from a 290 point cage. The shipped body keeps the cage250 name.
const SHARP = sharpEdges(ref, env0('REFDEG', 35))
/** Hard creases plus line edges with their semi-sharpness; hard ones are stored as 99. */
function lineCreases(hard: number[], line: number[], sharpness: number): { c: number[]; s?: number[] } {
  if (!line.length) return {c: hard}
  const k = (a: number, b: number) => Math.min(a, b) + ',' + Math.max(a, b), onLine = new Set<string>()
  for (let i = 0; i < line.length; i += 2) onLine.add(k(line[i], line[i + 1]))
  const c: number[] = [], s: number[] = []
  for (let i = 0; i < hard.length; i += 2) if (!onLine.has(k(hard[i], hard[i + 1]))) { c.push(hard[i], hard[i + 1]); s.push(99) }
  for (let i = 0; i < line.length; i += 2) { c.push(line[i], line[i + 1]); s.push(sharpness) }
  return {c, s}
}
function mergeCreases(a: number[], b: number[]): number[] {
  const out = [...a], have = new Set<string>()
  for (let i = 0; i < a.length; i += 2) have.add(Math.min(a[i], a[i + 1]) + ',' + Math.max(a[i], a[i + 1]))
  for (let i = 0; i < b.length; i += 2) { const k = Math.min(b[i], b[i + 1]) + ',' + Math.max(b[i], b[i + 1]); if (!have.has(k)) { have.add(k); out.push(b[i], b[i + 1]) } }
  return out
}
const sizes = process.argv.slice(2).filter(a => /^\d+(:\d+)?$/.test(a))
const POINTS: Record<number, number> = {250: 320}
/** The rear flank, whose character lines keep their points with FOLDLOCK. */
const FLANK = {tag: roles.indexOf('paint'), min: [.45, .15, .3], max: [1, .75, 1.75]}
/** The hood scoop's chrome lip, half body, metres. */
const SCOOP = {tag: roles.indexOf('chrome'), min: [-.01, .4, -1.55], max: [.4, .62, -1]}
const h = half(ref)
console.log(`reference: ${ref.tri.length / 3} triangles, ${ref.pos.length / 3} vertices; half: ${h.pos.length / 3} vertices`)
const rows: string[] = [], extra: string[] = []
const code = ['generator.ts', 'subdivide.ts'].map(f => readFileSync(join(ROOT, 'src/vehicles/buggygen/cage', f), 'utf8')).join('\n')
for (const spec of sizes.length ? sizes : ['60', '120', '250', '500']) {
  const [size, points = POINTS[size] ?? size] = spec.split(':').map(Number)
  const env = (k: string, d: number) => process.env[k] ? Number(process.env[k]) : d
  // Character lines of the rear half, drawn as chains of cage edges (see lines.ts).
  const lines = size >= 200 && env('LINES', 0) ? characterLines(h, {degrees: env('LINEDEG', 40), minLength: env('LINEMIN', .3), min: [0, -1, -.1], max: [2, 2, 3], turn: 50}).map(l => l.verts) : []
  const raw = decimate(h, points, env('BORDER', 20), env('SHAPE', 0), size >= 200 && env('PROTECT', 1) ? [roles.indexOf('lamp:tail')] : [], size >= 200 ? env('CORNER', 0) : 0, process.env.CTAGS ? process.env.CTAGS.split(',').map(r => roles.indexOf(r)) : [], size >= 200 && env('SCOOP', 1) ? [SCOOP, ...(env('SCOOP', 1) > 1 ? [{...SCOOP, tag: roles.indexOf('paint')}, {...SCOOP, tag: roles.indexOf('accent')}] : [])] : [], size >= 200 ? env('FOLDLOCK', 0) : 0, FLANK, lines)
  const dec = env('CLEAN', 6) ? clean(raw, grid, env('CLEAN', 6), 35, raw.lineEdges) : raw
  console.error(`${size}: cage triangle quality before ${JSON.stringify(quality(raw))}, after ${JSON.stringify(quality(dec))}`)
  const fullTris = dec.tri.length / 3 * 2
  const level0 = fullTris * 16 <= 9000 ? 2 : 1
  const base: CageData = {roles, v: Array.from(dec.pos, x => Math.round(x * 1000)), f: Array.from(dec.tri), t: Array.from(dec.tag), ...lineCreases(mergeCreases(creases(dec, env('CREASE', 55)), env('REFCREASE', 1) ? referenceCreases(dec, SHARP, env('REFTOL', .008)) : []), raw.lineEdges, env('LINESHARP', 1.5)), levels: [level0, level0 - 1, 0], limit: !!env('LIMIT', 1)}
  const t0 = performance.now()
  const fitted = fitCage(base, ref, grid, {levels: level0, rounds: env('ROUNDS', 20), reverse: env('REVERSE', size <= 60 ? 1 : 0), smooth: env('SMOOTH', 1e-3), fair: env('FAIR', 0), bend: env('BEND', 0.3), log: !!process.env.LOG})
  // Character lines drawn into the fitted cage (rear half only), then the rear refitted
  // with every point ahead of the lines frozen. See linesnap.ts.
  if (size >= 200 && env('SNAP', 1)) {
    const found = characterLines(h, {degrees: env('LINEDEG', 40), minLength: env('LINEMIN', .3), min: [0, -1, -.1], max: [2, 2, 3], turn: 50})
      .filter(l => ['paint', 'accent', 'frame'].includes(roles[l.tag]))
    const chains = found.map(l => l.verts.map(v => [h.pos[v * 3], h.pos[v * 3 + 1], h.pos[v * 3 + 2]]))
    const minZ = env('SNAPZ', 0)
    const snapped = snapLines(fitted, chains, {spacing: env('SPACING', .12), reach: env('REACH', .07), sharpness: env('LINESHARP', 2), minZ, insert: !!env('INSERT', 1)}, found.map(l => l.tag))
    console.error(`snap: ${snapped.added} added, ${snapped.moved.size} points onto ${chains.length} lines; ` + snapped.report.map(r => `${r.points}p/${r.joined}j`).join(' '))
    const z = (j: number) => snapped.cage.v[j * 3 + 2] / 1000
    const refit = fitCage(snapped.cage, ref, grid, {levels: level0, rounds: env('ROUNDS', 20), reverse: 0, smooth: env('SMOOTH', 1e-3), bend: env('BEND', 0.3), frozen: j => z(j) < minZ - .05})
    Object.assign(fitted, refit)
    // Pay for the lines: collapse plain rear points of the cage itself down to TRIM points,
    // with the front, the lines, the tail lamps and the scoop lip locked, then refit the rear.
    const trim = env('TRIM', 0)
    if (trim && fitted.v.length / 3 > trim) {
      const cm: TriMesh = {pos: Float64Array.from(fitted.v, x => x / 1000), tri: Uint32Array.from(fitted.f), tag: Uint8Array.from(fitted.t)}
      const lineChains: number[][] = [], hard: number[] = []
      for (let i = 0; i < fitted.c.length; i += 2) (fitted.s?.[i / 2] ?? 99) < 99 ? lineChains.push([fitted.c[i], fitted.c[i + 1]]) : hard.push(fitted.c[i], fitted.c[i + 1])
      const lock = Uint8Array.from({length: cm.pos.length / 3}, (_, j) => cm.pos[j * 3 + 2] < minZ + env('TRIMGAP', .1) ? 1 : 0)
      const t = decimate(cm, trim, env('BORDER', 20), 0, [roles.indexOf('lamp:tail')], 0, [], [SCOOP], 0, undefined, lineChains, lock)
      const keepHard: number[] = []
      for (let i = 0; i < hard.length; i += 2) { const a = t.remap[hard[i]], b = t.remap[hard[i + 1]]; if (a >= 0 && b >= 0 && a !== b) keepHard.push(a, b) }
      const lc = lineCreases(mergeCreases(keepHard, referenceCreases(t, SHARP, env('REFTOL', .008))), t.lineEdges, env('LINESHARP', 2))
      const trimmed: CageData = {...fitted, v: Array.from(t.pos, (x, i) => i % 3 === 0 && Math.abs(x) < 1e-6 ? 0 : Math.round(x * 1000)), f: Array.from(t.tri), t: Array.from(t.tag), ...lc}
      const tz = (j: number) => trimmed.v[j * 3 + 2] / 1000
      Object.assign(fitted, fitCage(trimmed, ref, grid, {levels: level0, rounds: env('ROUNDS', 20), reverse: 0, smooth: env('SMOOTH', 1e-3), bend: env('BEND', 0.3), frozen: j => tz(j) < minZ - .05}))
      console.error(`trim: ${cm.pos.length / 3} to ${trimmed.v.length / 3} points`)
    }
  }
  const fitMs = performance.now() - t0
  const id = `cage${size}${process.env.SUFFIX ?? ""}`
  // Detail 2 must stay near 400 triangles: cages too big for that borrow the 60 point cage.
  const far = fullTris > 500 && size !== 60
  if (process.env.DRY) { const fm = asMesh(fitted, level0), dd = distance(ref, fm, grid); console.log(id, JSON.stringify(dd), 'roughness', roughness(fm), 'reference', roughness(ref)); continue }
  const file = `// Generated by tools/buggy-fit/cage/build.ts: the buggy body as a ${fitted.v.length / 3} point half cage.\n` +
    `import {candidate, type CageData} from './generator'\n` + (far ? `import {data as far} from './cage60'\n` : '') +
    `\nexport const data: CageData = ${JSON.stringify(fitted)}\n\nexport default candidate('${id}', data${far ? ', far' : ''})\n`
  writeFileSync(join(ROOT, 'src/vehicles/buggygen/cage', `${id}.ts`), file)
  const numbers = fitted.v.length + fitted.f.length + fitted.t.length + fitted.c.length + (fitted.s?.length ?? 0) // this cage alone; the far cage adds its own
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
  // Feature close ups: the tail lamps from behind, the cockpit rim from above and behind,
  // the hood scoop from the front three quarter. Reference on the left, cage on the right.
  for (const [name, view, centre, zoom] of [['tail', VIEWS[1], [.45, .5, 1.85], 4], ['rim', VIEWS[4], [0, .75, .6], 3], ['scoop', VIEWS[3], [.15, .5, -1.3], 3.5]] as const)
    sheet(`${OUT}/${id}-${name}.png`, [smooth(ref), smooth(mesh)].map(r => ({...r, wire: false})), [view], 700, zoom, [...centre])
}
console.log('\n| id | stored points | numbers | gzip data B | gzip code+data B | tris detail 0 | build ms | mean / rms / p95 / max mm | role match | mean mm unfitted | mean mm cage only | mean mm at 2 / 5 mm grid | creases | fit time |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) console.log(r)
console.log('\n| id | triangles at detail 0 / 1 / 2 | build ms detail 0, best / median | gzip minified bundle B |')
console.log('| --- | --- | --- | --- |')
for (const r of extra) console.log(r)
