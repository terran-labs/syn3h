/** Prepared synthetic adversarial cases. Do not execute without allocation. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { syntheticEvidence } from './fixtures.mjs'
import { sha256, hashRun, compareEvidence, renderPerformance } from './index.mjs'
import { OBSERVATION_KINDS, validateV2Envelope } from './observation-v2.mjs'

function fixture() {
  const { input, expected } = syntheticEvidence()
  input.schemaVersion = 2
  input.observationPolicy = { schemaVersion: 1, frameSource: 'game.last-and-quality.frame',
    allowedFrozenInventorySha256: 'd'.repeat(64), requiredFetchedResources: ['index.html'], methods: {} }
  input.runtimePolicy = { schemaVersion: 1, collectorManifestSha256: expected.collectorSha256,
    baselineDeploymentManifestSha256: 'e'.repeat(64), candidateDeploymentManifestSha256: 'f'.repeat(64), executablesAndConfiguration: {} }
  input.observationArtifacts = {}
  for (const run of [...input.calibration.runs, ...input.runs]) {
    run.observations = {}
    for (const kind of OBSERVATION_KINDS) {
      const artifact = { schemaVersion: 1, kind, payload: { runId: run.id, records: {} }, references: [], blobs: [] }
      const hash = sha256(artifact); input.observationArtifacts[hash] = artifact
      run.observations[kind] = { sha256: hash, kind }
    }
  }
  expected.observationPolicySha256 = sha256(input.observationPolicy)
  expected.runtimePolicySha256 = sha256(input.runtimePolicy)
  seal(input, expected)
  return { input, expected, verifiedBlobs: {} }
}
function seal(input, expected) {
  for (const run of [...input.calibration.runs, ...input.runs]) run.rawSha256 = hashRun(run)
  expected.calibrationSha256 = sha256(input.calibration)
  input.policy.calibrationSha256 = expected.calibrationSha256
  expected.reviewedPolicySha256 = sha256(input.policy)
}
function replaceArtifact(input, run, kind, edit) {
  const oldHash = run.observations[kind].sha256
  const artifact = structuredClone(input.observationArtifacts[oldHash]); edit(artifact)
  delete input.observationArtifacts[oldHash]
  const hash = sha256(artifact); input.observationArtifacts[hash] = artifact
  run.observations[kind] = { sha256: hash, kind }
}
function has(result, code) { assert.ok(result.issues.some(i => i.code === code), JSON.stringify(result)) }

test('all eight kinds form valid structure but can never qualify a measurement', () => {
  const { input, expected, verifiedBlobs } = fixture()
  const result = validateV2Envelope(input, expected, verifiedBlobs)
  assert.equal(result.structureValid, true, JSON.stringify(result.issues))
  assert.equal(result.qualified, false); assert.equal(result.promotion, 'blocked')
  assert.equal(result.status, 'unsupported/not-qualified')
  assert.deepEqual(result.unsupported, ['semantic-observation-validation'])
  const report = compareEvidence(input, expected)
  assert.equal(report.status, 'not measured'); assert.equal(report.promotion, 'blocked')
  has(report, 'unsupported-observations')
})
test('missing required kinds and malformed slot references fail', () => {
  for (const kind of OBSERVATION_KINDS) {
    const { input, expected } = fixture(); delete input.runs[0].observations[kind]; seal(input, expected)
    has(validateV2Envelope(input, expected, {}), 'required-kinds')
  }
  const { input, expected } = fixture(); input.runs[0].observations.runtime.kind = 'frames'; seal(input, expected)
  has(validateV2Envelope(input, expected, {}), 'reference')
})
test('missing artifact, tampered digest and mismatched artifact kind fail', () => {
  for (const mutation of ['missing', 'tamper', 'kind']) {
    const { input, expected } = fixture(), ref = input.runs[0].observations.runtime
    if (mutation === 'missing') delete input.observationArtifacts[ref.sha256]
    if (mutation === 'tamper') input.observationArtifacts[ref.sha256].payload.records.changed = true
    if (mutation === 'kind') replaceArtifact(input, input.runs[0], 'runtime', a => { a.kind = 'frames' })
    seal(input, expected)
    has(validateV2Envelope(input, expected, {}), { missing: 'missing-reference', tamper: 'artifact-hash', kind: 'kind' }[mutation])
  }
})
test('verified blobs are separate trusted input with exact size', () => {
  const { input, expected, verifiedBlobs } = fixture(), digest = '1'.repeat(64)
  replaceArtifact(input, input.runs[0], 'requests', a => { a.blobs = [{ sha256: digest, size: 42 }] })
  seal(input, expected)
  has(validateV2Envelope(input, expected, verifiedBlobs), 'missing-blob')
  verifiedBlobs[digest] = { size: 41 }
  has(validateV2Envelope(input, expected, verifiedBlobs), 'missing-blob')
  verifiedBlobs[digest] = { size: 42 }
  assert.equal(validateV2Envelope(input, expected, verifiedBlobs).structureValid, true)
  input.verifiedBlobs = verifiedBlobs
  has(validateV2Envelope(input, expected, {}), 'missing-blob')
})
test('duplicate run IDs include collisions between calibration and candidate runs', () => {
  const { input, expected } = fixture(); input.runs[0].id = input.calibration.runs[0].id; seal(input, expected)
  has(validateV2Envelope(input, expected, {}), 'duplicate-run')
})
test('cross-run roots and nested references fail, valid same-run edges resolve', () => {
  for (const nested of [false, true]) {
    const { input, expected } = fixture()
    if (nested) replaceArtifact(input, input.runs[0], 'runtime', a => { a.references.push(input.runs[1].observations.frames) })
    else input.runs[0].observations.frames = input.runs[1].observations.frames
    seal(input, expected)
    has(validateV2Envelope(input, expected, {}), 'cross-run-reference')
  }
  const { input, expected } = fixture()
  replaceArtifact(input, input.runs[0], 'runtime', a => { a.references.push(input.runs[0].observations.frames) })
  seal(input, expected)
  assert.equal(validateV2Envelope(input, expected, {}).structureValid, true)
})
test('cycles are rejected even when digest tampering also makes the graph invalid', () => {
  const { input, expected } = fixture(), ref = input.runs[0].observations.runtime
  // A content-hash self-cycle cannot be honestly sealed; retain the hostile graph to test safe rejection.
  input.observationArtifacts[ref.sha256].references.push(ref)
  const result = validateV2Envelope(input, expected, {})
  has(result, 'artifact-hash'); has(result, 'cycle')
})
test('unreachable artifacts and missing nested edges fail', () => {
  const { input, expected } = fixture()
  const orphan = { schemaVersion: 1, kind: 'frames', payload: { runId: input.runs[0].id, records: { orphan: true } }, references: [], blobs: [] }
  input.observationArtifacts[sha256(orphan)] = orphan
  has(validateV2Envelope(input, expected, {}), 'orphan-artifact')
  replaceArtifact(input, input.runs[0], 'runtime', a => { a.references.push({ sha256: '0'.repeat(64), kind: 'frames' }) })
  seal(input, expected)
  has(validateV2Envelope(input, expected, {}), 'missing-reference')
})
test('all policy content is bound to independent Expectations and raw run hashes cover refs', () => {
  for (const key of ['observationPolicy', 'runtimePolicy', 'policy']) {
    const { input, expected } = fixture(); input[key].tampered = true
    has(validateV2Envelope(input, expected, {}), 'hash-binding')
  }
  const { input, expected } = fixture()
  input.runs[0].observations.runtime = input.runs[1].observations.runtime
  has(validateV2Envelope(input, expected, {}), 'run-hash')
})
test('allowed inventory is not assumed to be wholly fetched during startup', () => {
  const { input, expected } = fixture()
  assert.equal(input.observationPolicy.requiredFetchedResources.length, 1)
  assert.equal(validateV2Envelope(input, expected, {}).structureValid, true)
  // Membership and observed fetch semantics are explicitly deferred, not inferred here.
  assert.equal(validateV2Envelope(input, expected, {}).qualified, false)
})
test('malformed and cyclic JSON fails without throwing', () => {
  const { expected } = fixture(), cycle = {}; cycle.self = cycle
  for (const input of [null, {}, cycle, { schemaVersion: 2, runs: [Infinity] }]) {
    assert.equal(validateV2Envelope(input, expected, {}).structureValid, false)
  }
})
test('historical v1 report rendering remains unchanged', () => {
  const { input, expected } = syntheticEvidence()
  const report = compareEvidence(input, expected)
  assert.equal(report.status, 'unchanged')
  assert.ok(renderPerformance(report, { version: expected.candidate.version, assetBaseUrl: 'https://example.invalid/immutable' }).startsWith('### Performance\n'))
})
