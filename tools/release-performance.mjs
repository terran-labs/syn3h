// Coordinator-owned boundary between measured evidence and release publication.
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { inspectFinalArtifact } from './final-worker-artifact.mjs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson, compareEvidence, renderChart, renderPerformance, sha256 } from './performance-release/index.mjs'

export const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex')

/** Only the final no-bundle directory can identify measured/deployed bytes. */
export async function frozenIdentity(root) {
  return (await inspectFinalArtifact(root)).identity
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

/** Approval is a separately reviewed coordinator artifact, never read from submitted evidence.
 * Build identities are additionally recomputed from the actual deployment directories. */
export async function loadApprovedPerformance({ version, candidateCommit, baselineCommit, baselineVersion,
  candidateRoot = process.env.SYN3H_PERFORMANCE_CANDIDATE,
  baselineRoot = process.env.SYN3H_PERFORMANCE_BASELINE,
  approvalPath = process.env.SYN3H_PERFORMANCE_APPROVAL,
  evidencePath = process.env.SYN3H_PERFORMANCE_EVIDENCE,
  assetBaseUrl }) {
  if (![candidateRoot, baselineRoot, approvalPath, evidencePath].every(Boolean)) throw new Error('Performance requires both frozen builds, reviewed approval and original evidence')
  const expected = JSON.parse(readFileSync(approvalPath, 'utf8'))
  const candidate = await frozenIdentity(candidateRoot), baseline = await frozenIdentity(baselineRoot)
  if (candidate.version !== version || candidate.commit !== candidateCommit ||
    baseline.version !== baselineVersion || baseline.commit !== baselineCommit) throw new Error('Performance frozen builds differ from release history or candidate')
  if (canonicalJson(expected.candidate) !== canonicalJson(candidate) || canonicalJson(expected.baseline) !== canonicalJson(baseline)) throw new Error('Approved artifact identity differs from frozen bytes')
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  // Historical v1 rendering remains supported by performanceBundle. It must never
  // serve as a downgrade path around required operational observation semantics.
  if (expected.requiredObservationSchema !== 2 || evidence.schemaVersion !== 2)
    throw new Error('Promotion requires trusted observation schema 2; historical v1 cannot qualify')
  // The comparator deliberately rejects v2 until semantic observation validation
  // is implemented and reviewed. Structural integrity alone is not acceptance.
  return performanceBundle(evidence, expected, version, assetBaseUrl)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, candidateRoot, candidateCommit, baselineVersion, baselineCommit] = process.argv.slice(2)
  try {
    const bundle = await loadApprovedPerformance({ version, candidateRoot, candidateCommit, baselineVersion, baselineCommit,
      assetBaseUrl: `https://github.com/terran-labs/syn3h/releases/download/${version}` })
    console.log(`PERFORMANCE GATE OK: ${bundle.report.status}, evidence ${bundle.report.evidenceSha256}`)
  } catch (error) { console.error(`PERFORMANCE GATE FAILED: ${error.message}`); process.exitCode = 1 }
}
