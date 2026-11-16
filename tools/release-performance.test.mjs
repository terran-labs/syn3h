import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frozenIdentity, performanceBundle, verifyPerformanceFiles, verifyPublishedPerformance, loadApprovedPerformance } from './release-performance.mjs'
import { sha256, hashRun } from './performance-release/index.mjs'
import { FINAL_CONFIG } from './final-worker-artifact.mjs'
import { syntheticEvidence } from './performance-release/fixtures.mjs'

function directory() { return mkdtempSync(join(tmpdir(), 'release-performance-')) }
function finalDirectory(root, version, commit) {
  for (const part of ['dist', 'worker']) mkdirSync(join(root, part), { recursive: true })
  writeFileSync(join(root, 'wrangler.json'), JSON.stringify(FINAL_CONFIG))
  writeFileSync(join(root, 'provenance.json'), '{}')
  writeFileSync(join(root, 'worker/worker.js'), 'export default {}')
  writeFileSync(join(root, 'dist/.assetsignore'), '*.map\n')
  writeFileSync(join(root, 'dist/build.json'), JSON.stringify({version, commit}))
}
test('final identity binds Worker bytes and rejects the old source snapshot format', async () => {
  const root = directory()
  try {
    finalDirectory(root, 'v26.11.1519', 'a'.repeat(40))
    const before = await frozenIdentity(root)
    writeFileSync(join(root, 'dist/source.map'), 'diagnostic')
    assert.deepEqual(await frozenIdentity(root), before)
    writeFileSync(join(root, 'worker/worker.js'), 'export default { changed: true }')
    assert.notEqual((await frozenIdentity(root)).artifactSha256, before.artifactSha256)
    mkdirSync(join(root, 'src'))
    await assert.rejects(frozenIdentity(root), /Unexpected final artifact root entries/)
    rmSync(join(root, 'src'), { recursive: true })
    symlinkSync(join(root, 'wrangler.json'), join(root, 'dist/link'))
    await assert.rejects(frozenIdentity(root), /symlink/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('publication bundle recomputes evidence and refuses altered artifacts', async () => {
  const { input, expected } = syntheticEvidence()
  const bundle = performanceBundle(input, expected, expected.candidate.version, 'https://example.test/releases/frozen')
  const root = directory()
  try {
    for (const [name, bytes] of bundle.files) writeFileSync(join(root, name), bytes)
    verifyPerformanceFiles(root, bundle)
    await verifyPublishedPerformance('https://example.test/releases/frozen', bundle, async url => {
      return new Response(bundle.files.get(url.split('/').at(-1)), { status: 200 })
    })
    writeFileSync(join(root, bundle.report.assets.chart), '<svg>tampered</svg>')
    assert.throws(() => verifyPerformanceFiles(root, bundle), /bytes differ/)
    await assert.rejects(verifyPublishedPerformance('https://example.test/releases/frozen', bundle,
      async () => new Response('tampered', { status: 200 })), /bytes differ/)
    input.runs[0].qualityStable = false
    assert.throws(() => performanceBundle(input, expected, expected.candidate.version, 'https://example.test/releases/frozen'), /blocks promotion/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('approval gate binds both frozen directories, history and reviewed evidence', async () => {
  const root = directory()
  try {
    const { input, expected } = syntheticEvidence()
    for (const [side, version, digit] of [['baseline', 'v26.11.1518', 'a'], ['candidate', 'v26.11.1519', 'b']]) {
      const dir = join(root, side)
      finalDirectory(dir, version, digit.repeat(40))
      expected[side] = await frozenIdentity(dir)
      input.builds[side] = expected[side]
    }
    input.calibration.build = expected.baseline
    for (const run of input.calibration.runs) {
      run.observedBuild = expected.baseline
      run.transfer.manifestSha256 = expected.baseline.artifactSha256
      run.rawSha256 = hashRun(run)
    }
    for (const run of input.runs) {
      run.observedBuild = expected[run.side]
      run.transfer.manifestSha256 = expected[run.side].artifactSha256
      run.rawSha256 = hashRun(run)
    }
    expected.calibrationSha256 = input.policy.calibrationSha256 = sha256(input.calibration)
    expected.reviewedPolicySha256 = sha256(input.policy)
    const approvalPath = join(root, 'approval.json'), evidencePath = join(root, 'evidence.json')
    writeFileSync(approvalPath, JSON.stringify(expected))
    writeFileSync(evidencePath, JSON.stringify(input))
    const args = { version: expected.candidate.version, candidateCommit: expected.candidate.commit,
      baselineVersion: expected.baseline.version, baselineCommit: expected.baseline.commit,
      baselineRoot: join(root, 'baseline'), candidateRoot: join(root, 'candidate'), approvalPath, evidencePath,
      assetBaseUrl: 'https://example.test/frozen' }
    assert.equal((await loadApprovedPerformance(args)).report.promotion, 'eligible')
    await assert.rejects(loadApprovedPerformance({ ...args, approvalPath: '' }), /requires both/)
    await assert.rejects(loadApprovedPerformance({ ...args, candidateCommit: 'c'.repeat(40) }), /release history/)
    writeFileSync(join(root, 'candidate/worker/worker.js'), 'export default { changed: true }')
    await assert.rejects(loadApprovedPerformance(args), /frozen bytes/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
