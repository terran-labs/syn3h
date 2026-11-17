/**
 * Compare a generated buggy candidate with the loaded model, part by part.
 *
 *   npx tsx tools/buggy-fit/compare.ts <candidate module> [--part name] [--detail 0] [--out dir] [--no-images] [--samples n]
 *
 * Writes report.json, report.md and, per part and view, a PNG of reference, candidate and a
 * distance heat map to --out (default /tmp/buggy-fit/<candidate id>-d<detail>). See README.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { Bvh, faceNormal, mergeMeshes, sampleSurface, topology, triangleCount, volume } from './geometry'
import { Image, VIEWS, frame, heatColour, rasterise, shade, silhouetteIoU } from './raster'
import { PART_NAMES, bounds, loadReference, type Mesh, type PartName } from './reference'

/** Structural three.js BufferGeometry: only what the harness reads. */
interface GeometryLike {
  getAttribute(name: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } | undefined
  getIndex(): { count: number; getX(i: number): number } | null
}
export interface CandidatePart { part: PartName; role: string; geometry: GeometryLike }
export interface Candidate { id: string; build(detail: 0 | 1 | 2): CandidatePart[]; numbers?: number }

export interface Options { parts?: PartName[]; detail?: 0 | 1 | 2; out?: string; images?: boolean; samples?: number; runs?: number; source?: string }

const r2 = (v: number) => Number(v.toFixed(2)), r3 = (v: number) => Number(v.toFixed(3))
const percentile = (sorted: number[], q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN
const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI

/** A BufferGeometry as a plain mesh, every triangle labelled with the part's role. */
export function toMesh(g: GeometryLike, role: string): Mesh {
  const pos = g.getAttribute('position')
  if (!pos) throw new Error(`geometry for role ${role} has no position attribute`)
  const positions = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) { positions[i * 3] = pos.getX(i); positions[i * 3 + 1] = pos.getY(i); positions[i * 3 + 2] = pos.getZ(i) }
  const index = g.getIndex()
  const indices = index ? Uint32Array.from({ length: index.count }, (_, i) => index.getX(i)) : Uint32Array.from({ length: pos.count }, (_, i) => i)
  return { positions, indices, materials: new Array(indices.length / 3).fill(role) }
}

/** Distances (m) and normal deviations (degrees) from samples on `from` to the surface of `to`. */
function oneWay(from: Mesh, to: Bvh, count: number, seed: number) {
  const distances: number[] = [], normals: number[] = []
  for (const s of sampleSurface(from, count, seed)) {
    const hit = to.nearest(s.p)
    distances.push(hit.distance)
    normals.push(angle(s.n, faceNormal(to.mesh, hit.triangle).n))
  }
  return { distances, normals }
}

export interface PartReport {
  part: PartName
  triangles: { reference: number; candidate: number }
  /** Bounding box diagonal of the reference part (m). */
  diagonal: number
  /** Symmetric surface distance (mm), from samples on both surfaces. */
  distance: { mean: number; p95: number; max: number; meanPct: number; p95Pct: number; maxPct: number; referenceToCandidate: number; candidateToReference: number }
  /** Mean angle between a sample's face normal and the nearest face's normal (degrees). */
  normalDeviation: number
  iou: Record<string, number> & { mean: number; min: number }
  /** Candidate minus reference, per axis (mm): size and centre. */
  bounds: { size: number[]; centre: number[] }
  volume: { reference: number; candidate: number; deltaPct: number }
  candidateTopology: ReturnType<typeof topology>
  referenceTopology: ReturnType<typeof topology>
}

export interface Report {
  id: string; detail: number; numbers: number | null
  buildMs: { median: number; runs: number }
  code?: { minified: number; gzip: number; files: number; note: string }
  parts: PartReport[]
  missing: PartName[]
  overall: { distanceMean: number; distanceP95: number; distanceMax: number; normalDeviation: number; iouMean: number; triangles: { reference: number; candidate: number } }
}

/** Minified and gzipped size of the candidate's run-time source, three excluded. */
export async function codeCost(file: string): Promise<Report['code']> {
  const esbuild = await import('esbuild')
  const result = await esbuild.build({ entryPoints: [file], bundle: true, minify: true, format: 'esm', platform: 'neutral', write: false, metafile: true, external: ['three', 'three/*'], logLevel: 'silent' })
  const out = result.outputFiles[0].contents
  return { minified: out.length, gzip: gzipSync(out, { level: 9 }).length, files: Object.keys(result.metafile.inputs).length, note: 'esbuild bundle, minify, three external, gzip -9' }
}

/** Compare one part: metrics, and optionally its images written to `out`. */
export function comparePart(part: PartName, reference: Mesh, candidate: Mesh, samples: number, out?: string): PartReport {
  const refBvh = new Bvh(reference), candBvh = new Bvh(candidate)
  const a = oneWay(reference, candBvh, samples, 1), b = oneWay(candidate, refBvh, samples, 2)
  const all = [...a.distances, ...b.distances].sort((x, y) => x - y)
  const rb = bounds(reference.positions), cb = bounds(candidate.positions)
  const diagonal = Math.hypot(rb.max[0] - rb.min[0], rb.max[1] - rb.min[1], rb.max[2] - rb.min[2])
  const mean = all.reduce((s, v) => s + v, 0) / all.length
  const avg = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
  const iou: Record<string, number> = {}
  for (const view of VIEWS) {
    const cam = frame(view, [reference, candidate], 512, 512)
    iou[view.name] = r3(silhouetteIoU(rasterise(reference, cam), rasterise(candidate, cam)))
  }
  const ious = VIEWS.map(v => iou[v.name])
  const vr = volume(reference), vc = volume(candidate)
  if (out) writeImages(part, reference, candidate, refBvh, diagonal, out)
  const mm = (v: number) => r2(v * 1000), pct = (v: number) => r2(v / diagonal * 100)
  return {
    part,
    triangles: { reference: triangleCount(reference), candidate: triangleCount(candidate) },
    diagonal: r3(diagonal),
    distance: {
      mean: mm(mean), p95: mm(percentile(all, .95)), max: mm(all[all.length - 1]),
      meanPct: pct(mean), p95Pct: pct(percentile(all, .95)), maxPct: pct(all[all.length - 1]),
      referenceToCandidate: mm(avg(a.distances)), candidateToReference: mm(avg(b.distances)),
    },
    normalDeviation: r2(avg([...a.normals, ...b.normals])),
    iou: { ...iou, mean: r3(avg(ious)), min: Math.min(...ious) },
    bounds: {
      size: [0, 1, 2].map(k => mm((cb.max[k] - cb.min[k]) - (rb.max[k] - rb.min[k]))),
      centre: [0, 1, 2].map(k => mm((cb.max[k] + cb.min[k]) / 2 - (rb.max[k] + rb.min[k]) / 2)),
    },
    volume: { reference: Number(vr.toPrecision(6)), candidate: Number(vc.toPrecision(6)), deltaPct: vr ? r2((vc - vr) / Math.abs(vr) * 100) : NaN },
    candidateTopology: topology(candidate),
    referenceTopology: topology(reference),
  }
}

const PANEL_W = 800, PANEL_H = 600, LABEL = 36

/**
 * Per view: reference, candidate, and the candidate coloured by distance to the reference
 * (green on it, red at 2% of the reference diagonal or more), with the reference silhouette
 * outlined in cyan and reference area the candidate misses filled dark blue. Also one sheet per
 * part with every view stacked.
 */
function writeImages(part: PartName, reference: Mesh, candidate: Mesh, refBvh: Bvh, diagonal: number, out: string): void {
  const cap = diagonal * .02
  const sheet = new Image(PANEL_W * 3, (PANEL_H + LABEL) * VIEWS.length)
  VIEWS.forEach((view, row) => {
    const cam = frame(view, [reference, candidate], PANEL_W, PANEL_H)
    const rr = rasterise(reference, cam), cr = rasterise(candidate, cam)
    const ref = shade(rr, reference, cam, [150, 170, 205]), cand = shade(cr, candidate, cam, [205, 185, 150])
    const heat = shade(cr, candidate, cam)
    // One distance query per 3 by 3 pixel block (the first covered pixel in it): nine times
    // fewer queries, and the colour is smooth at this size anyway.
    const block = new Float32Array(Math.ceil(PANEL_W / 3) * Math.ceil(PANEL_H / 3)).fill(NaN), stride = Math.ceil(PANEL_W / 3)
    for (let i = 0; i < cr.tri.length; i++) {
      const x = i % PANEL_W, y = Math.floor(i / PANEL_W)
      if (cr.tri[i] >= 0) {
        const b = Math.floor(y / 3) * stride + Math.floor(x / 3)
        if (Number.isNaN(block[b])) block[b] = refBvh.nearest(cr.world.subarray(i * 3, i * 3 + 3)).distance
        const d = block[b]
        const lit = heat.data[i * 3 + 1] / 196, c = heatColour(d / cap)
        heat.set(x, y, c.map(v => Math.min(255, Math.round(v * (.45 + .55 * lit)))))
      } else if (rr.tri[i] >= 0) heat.set(x, y, [30, 45, 110])
      // Reference silhouette edge.
      const inside = (j: number) => rr.tri[j] >= 0
      if (inside(i) && ((x > 0 && !inside(i - 1)) || (x < PANEL_W - 1 && !inside(i + 1)) || (y > 0 && !inside(i - PANEL_W)) || (y < PANEL_H - 1 && !inside(i + PANEL_W))))
        heat.set(x, y, [80, 230, 255])
    }
    const strip = new Image(PANEL_W * 3, PANEL_H + LABEL)
    strip.blit(ref, 0, LABEL); strip.blit(cand, PANEL_W, LABEL); strip.blit(heat, PANEL_W * 2, LABEL)
    strip.rect(PANEL_W - 1, 0, 2, PANEL_H + LABEL, [70, 70, 80]); strip.rect(PANEL_W * 2 - 1, 0, 2, PANEL_H + LABEL, [70, 70, 80])
    strip.text(`${part} ${view.name}: reference`, 10, 10)
    strip.text(`candidate`, PANEL_W + 10, 10)
    strip.text(`distance 0`, PANEL_W * 2 + 10, 10)
    for (let k = 0; k < 160; k++) strip.rect(PANEL_W * 2 + 140 + k, 10, 1, 15, heatColour(k / 159))
    strip.text(`${r2(cap * 1000)} MM  CYAN = REF EDGE`, PANEL_W * 2 + 310, 10)
    writeFileSync(resolve(out, `${part}-${view.name.replace(/ /g, '-')}.png`), strip.png())
    sheet.blit(strip, 0, row * (PANEL_H + LABEL))
  })
  writeFileSync(resolve(out, `${part}-sheet.png`), sheet.png())
}

export async function compare(candidate: Candidate, options: Options = {}): Promise<Report> {
  const detail = options.detail ?? 0, samples = options.samples ?? 20000, runs = options.runs ?? 7
  const reference = loadReference()
  // Build time: two warm-up builds, then the median of `runs`.
  for (let i = 0; i < 2; i++) candidate.build(detail)
  const times: number[] = []
  let built: CandidatePart[] = []
  for (let i = 0; i < runs; i++) { const t = performance.now(); built = candidate.build(detail); times.push(performance.now() - t) }
  times.sort((a, b) => a - b)
  const byPart = new Map<PartName, Mesh[]>()
  for (const p of built) {
    if (!PART_NAMES.includes(p.part)) throw new Error(`unknown part ${p.part}`)
    byPart.set(p.part, [...byPart.get(p.part) ?? [], toMesh(p.geometry, p.role)])
  }
  const wanted = options.parts ?? PART_NAMES
  if (options.out && options.images !== false) mkdirSync(options.out, { recursive: true })
  const parts: PartReport[] = []
  for (const part of wanted) {
    const meshes = byPart.get(part)
    if (!meshes) continue
    parts.push(comparePart(part, reference[part], mergeMeshes(meshes), samples, options.images === false ? undefined : options.out))
  }
  const avg = (v: number[]) => v.length ? r2(v.reduce((s, x) => s + x, 0) / v.length) : NaN
  return {
    id: candidate.id, detail, numbers: candidate.numbers ?? null,
    buildMs: { median: r2(times[times.length >> 1]), runs },
    code: options.source ? await codeCost(options.source) : undefined,
    parts,
    missing: wanted.filter(p => !byPart.has(p)),
    overall: {
      // Each part weighs the same, whatever its size.
      distanceMean: avg(parts.map(p => p.distance.mean)), distanceP95: avg(parts.map(p => p.distance.p95)),
      distanceMax: Math.max(...parts.map(p => p.distance.max)), normalDeviation: avg(parts.map(p => p.normalDeviation)),
      iouMean: r3(parts.reduce((s, p) => s + p.iou.mean, 0) / Math.max(1, parts.length)),
      triangles: { reference: wanted.reduce((s, p) => s + triangleCount(reference[p]), 0), candidate: parts.reduce((s, p) => s + p.triangles.candidate, 0) },
    },
  }
}

export function markdown(r: Report): string {
  const yes = (b: boolean) => b ? 'yes' : 'no'
  const lines = [
    `# ${r.id}, detail ${r.detail}`,
    '',
    `Numbers in the design data: ${r.numbers ?? 'not declared'}. Build: ${r.buildMs.median} ms (median of ${r.buildMs.runs} after warm-up).`,
    r.code ? `Code: ${r.code.minified} bytes minified, ${r.code.gzip} bytes gzip from ${r.code.files} source files (${r.code.note}). Model files: buggy.glb 139,281 and buggy-boxarm.glb 148,408 bytes gzip.` : '',
    r.missing.length ? `Not provided: ${r.missing.join(', ')}.` : '',
    '',
    'Distances are symmetric surface distances in millimetres (percent of the reference part\'s bounding diagonal). IoU is silhouette intersection over union, mean and worst of eight views. Size and centre are candidate minus reference (x, y, z, mm).',
    '',
    '| part | triangles ref / cand | mean mm (%) | p95 mm (%) | max mm (%) | normal deg | IoU mean / min | size delta | centre delta | volume delta | closed | wound |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.parts.map(p => `| ${p.part} | ${p.triangles.reference} / ${p.triangles.candidate} | ${p.distance.mean} (${p.distance.meanPct}) | ${p.distance.p95} (${p.distance.p95Pct}) | ${p.distance.max} (${p.distance.maxPct}) | ${p.normalDeviation} | ${p.iou.mean} / ${p.iou.min} | ${p.bounds.size.join(', ')} | ${p.bounds.centre.join(', ')} | ${p.volume.deltaPct}% | ${yes(p.candidateTopology.closed)}${p.candidateTopology.closed ? '' : ` (${p.candidateTopology.boundaryEdges} open, ${p.candidateTopology.nonManifoldEdges} non-manifold)`} | ${yes(p.candidateTopology.consistent)}${p.candidateTopology.consistent ? '' : ` (${p.candidateTopology.flippedEdges} flipped)`} |`),
    `| overall | ${r.overall.triangles.reference} / ${r.overall.triangles.candidate} | ${r.overall.distanceMean} | ${r.overall.distanceP95} | ${r.overall.distanceMax} | ${r.overall.normalDeviation} | ${r.overall.iouMean} | | | | | |`,
    '',
  ]
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined }
  const part = flag('--part'), detail = Number(flag('--detail') ?? 0) as 0 | 1 | 2, outArg = flag('--out'), samples = flag('--samples')
  const noImages = args.includes('--no-images')
  const file = args.find(a => !a.startsWith('--'))
  if (!file) { console.error('usage: npx tsx tools/buggy-fit/compare.ts <candidate module> [--part name] [--detail 0] [--out dir] [--no-images] [--samples n]'); process.exit(2) }
  if (part && !PART_NAMES.includes(part as PartName)) { console.error(`unknown part ${part}; parts: ${PART_NAMES.join(', ')}`); process.exit(2) }
  const source = resolve(file)
  const candidate = (await import(pathToFileURL(source).href)).default as Candidate
  const out = resolve(outArg ?? `/tmp/buggy-fit/${candidate.id}-d${detail}`)
  mkdirSync(out, { recursive: true })
  const report = await compare(candidate, { parts: part ? [part as PartName] : undefined, detail, out, images: !noImages, samples: samples ? Number(samples) : undefined, source })
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(resolve(out, 'report.md'), markdown(report))
  console.log(markdown(report))
  console.log(`Wrote ${out}/report.json, report.md${noImages ? '' : ' and images'}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main()
