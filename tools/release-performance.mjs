// Coordinator-owned boundary between measured evidence and release publication.
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, compareEvidence, renderChart, renderPerformance, sha256 } from './performance-release/index.mjs'

export const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex')

/** Fingerprint deployed inputs, not node_modules, source maps or mutable checkout state. */
export function frozenIdentity(root) {
  const files = []
  function visit(relative) {
    const path = join(root, relative), stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Frozen input is a symlink: ${relative}`)
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`)
    } else if (stat.isFile()) {
      if (relative.startsWith('dist/') && (relative.endsWith('.map') || relative === 'dist/.assetsignore')) return
      const bytes = readFileSync(path)
      files.push({ path: relative, sha256: digestBytes(bytes), size: bytes.length })
    } else throw new Error(`Unsupported frozen input: ${relative}`)
  }
  for (const name of ['dist', 'server', 'shared', 'wrangler.toml']) visit(name)
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const build = JSON.parse(readFileSync(join(root, 'dist/build.json'), 'utf8'))
  if (!/^v\d{2}\.\d+\.\d+$/.test(build.version) || !/^[a-f0-9]{40}$/.test(build.commit)) throw new Error('Frozen build identity is incomplete')
  return { version: build.version, commit: build.commit, artifactSha256: sha256(files) }
}

/** Expectations must come from reviewed coordinator policy and inspected frozen builds. */
export function performanceBundle(evidence, expected, version, assetBaseUrl) {
  const report = compareEvidence(evidence, expected)
  if (report.promotion !== 'eligible') throw new Error(`Performance blocks promotion: ${report.status}; ${report.issues.map(i => i.message).join('; ')}`)
  const files = new Map()
  const add = (name, bytes) => {
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === '.' || name === '..') throw new Error('Unsafe evidence filename')
    const value = Buffer.from(bytes)
    if (files.has(name) && !files.get(name).equals(value)) throw new Error('Conflicting evidence artifact')
    files.set(name, value)
  }
  add(`evidence-${report.evidenceSha256}.json`, canonicalJson(evidence))
  add(report.assets.report, canonicalJson(report))
  add(report.assets.chart, renderChart(report))
  add(report.assets.fixture, canonicalJson(evidence.fixture))
  add(report.assets.calibration, canonicalJson(evidence.calibration))
  for (const run of [...evidence.calibration.runs, ...evidence.runs]) {
    const { rawSha256, ...payload } = run
    add(`raw-${rawSha256}.json`, canonicalJson(payload))
  }
  const block = renderPerformance(report, { version, assetBaseUrl })
  const markdown = `${block}\nFull evidence: [JSON](${assetBaseUrl.replace(/\/$/, '')}/evidence-${report.evidenceSha256}.json).\n`
  return { report, markdown, files, digests: Object.fromEntries([...files].map(([name, bytes]) => [name, digestBytes(bytes)])) }
}

/** Report-derived names identify the report; verify actual uploaded bytes independently. */
export function verifyPerformanceFiles(directory, bundle) {
  for (const [name, expected] of bundle.files) {
    const path = join(directory, name)
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Evidence must be a regular file: ${name}`)
    if (!readFileSync(path).equals(expected)) throw new Error(`Evidence bytes differ: ${name}`)
  }
}

export async function verifyPublishedPerformance(baseUrl, bundle, fetcher = fetch) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Expected immutable HTTPS evidence directory')
  for (const [name, expected] of bundle.files) {
    const response = await fetcher(`${base.href.replace(/\/$/, '')}/${name}`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Evidence download failed: ${name} (${response.status})`)
    const actual = Buffer.from(await response.arrayBuffer())
    if (!actual.equals(expected)) throw new Error(`Published evidence bytes differ: ${name}`)
  }
}
