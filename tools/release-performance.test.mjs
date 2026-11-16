import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frozenIdentity, performanceBundle, verifyPerformanceFiles, verifyPublishedPerformance, loadApprovedPerformance } from './release-performance.mjs'
import { sha256, hashRun } from './performance-release/index.mjs'
import { syntheticEvidence } from './performance-release/fixtures.mjs'

function directory() { return mkdtempSync(join(tmpdir(), 'release-performance-')) }
test('frozen identity binds deployed inputs and ignores maps, with no symlink traversal', () => {
  const root = directory()
  try {
    for (const name of ['dist', 'server', 'shared']) mkdirSync(join(root, name))
    writeFileSync(join(root, 'dist/build.json'), JSON.stringify({ version: 'v26.11.1519', commit: 'a'.repeat(40) }))
    writeFileSync(join(root, 'wrangler.toml'), 'name="fixture"')
    writeFileSync(join(root, 'dist/index.html'), '<html>fixture</html>')
    const before = frozenIdentity(root)
    writeFileSync(join(root, 'dist/source.map'), 'diagnostic')
    assert.deepEqual(frozenIdentity(root), before)
    writeFileSync(join(root, 'shared/protocol.ts'), 'changed deployed input')
    assert.notEqual(frozenIdentity(root).artifactSha256, before.artifactSha256)
    symlinkSync(join(root, 'wrangler.toml'), join(root, 'server/link'))
    assert.throws(() => frozenIdentity(root), /symlink/)
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

test('approval gate binds both frozen directories, history and reviewed evidence', () => {
  const root = directory()
  try {
    const { input, expected } = syntheticEvidence()
    for (const [side, version, digit] of [['baseline', 'v26.11.1518', 'a'], ['candidate', 'v26.11.1519', 'b']]) {
      const dir = join(root, side)
      for (const part of ['dist', 'server', 'shared']) mkdirSync(join(dir, part), { recursive: true })
      writeFileSync(join(dir, 'wrangler.toml'), 'name="synthetic"')
      writeFileSync(join(dir, 'dist/build.json'), JSON.stringify({ version, commit: digit.repeat(40) }))
      expected[side] = frozenIdentity(dir)
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
    assert.equal(loadApprovedPerformance(args).report.promotion, 'eligible')
    assert.throws(() => loadApprovedPerformance({ ...args, approvalPath: '' }), /requires both/)
    assert.throws(() => loadApprovedPerformance({ ...args, candidateCommit: 'c'.repeat(40) }), /release history/)
    writeFileSync(join(root, 'candidate/shared/changed.ts'), 'after measurement')
    assert.throws(() => loadApprovedPerformance(args), /frozen bytes/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
