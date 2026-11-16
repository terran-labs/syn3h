import { canonicalJson, sha256, hashRun } from './index.mjs'

export const OBSERVATION_KINDS = Object.freeze(['runtime', 'requests', 'clocks', 'frames', 'pacing', 'startup', 'conditions', 'closure'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k))
const refShape = ref => exactKeys(ref, ['sha256', 'kind']) && digest(ref.sha256) && OBSERVATION_KINDS.includes(ref.kind)
const nonempty = value => typeof value === 'string' && value.length > 0

/** Structural integrity only. Even a perfect graph cannot qualify a measurement here. */
export function validateV2Envelope(input, expected, verifiedBlobs) {
  const issues = []
  const check = (condition, code, path, message) => {
    if (!condition) issues.push({ code, path, message })
    return !!condition
  }
  const result = () => ({ schemaVersion: 2, structureValid: issues.length === 0,
    qualified: false, status: 'unsupported/not-qualified', promotion: 'blocked', issues,
    unsupported: ['semantic-observation-validation'] })
  try {
    // Reject cycles in submitted JS objects and non-JSON values before hashing.
    canonicalJson(input); canonicalJson(expected); canonicalJson(verifiedBlobs)
    if (!check(object(input) && input.schemaVersion === 2 && object(expected) && object(verifiedBlobs),
      'schema', '$', 'V2 evidence, trusted expectations and separate verified blobs are required')) return result()
    for (const [key, expectedKey] of [
      ['policy', 'reviewedPolicySha256'], ['observationPolicy', 'observationPolicySha256'],
      ['runtimePolicy', 'runtimePolicySha256'], ['fixture', 'fixtureSha256'], ['calibration', 'calibrationSha256'],
    ]) check(object(input[key]) && digest(expected[expectedKey]) && sha256(input[key]) === expected[expectedKey],
      'hash-binding', key, 'Content must match the independently reviewed expectation digest')
    check(input.policy?.calibrationSha256 === expected.calibrationSha256, 'hash-binding', 'policy.calibrationSha256', 'Policy must bind the calibration')
    const observationPolicy = input.observationPolicy, runtimePolicy = input.runtimePolicy
    check(object(observationPolicy) && observationPolicy.schemaVersion === 1 && observationPolicy.frameSource === 'game.last-and-quality.frame' &&
      digest(observationPolicy.allowedFrozenInventorySha256) && Array.isArray(observationPolicy.requiredFetchedResources) &&
      observationPolicy.requiredFetchedResources.every(nonempty) && new Set(observationPolicy.requiredFetchedResources).size === observationPolicy.requiredFetchedResources.length && object(observationPolicy.methods),
    'policy-shape', 'observationPolicy', 'Declare allowed frozen inventory separately from required fetched resources')
    check(object(runtimePolicy) && runtimePolicy.schemaVersion === 1 &&
      ['collectorManifestSha256', 'baselineDeploymentManifestSha256', 'candidateDeploymentManifestSha256'].every(k => digest(runtimePolicy[k])) && object(runtimePolicy.executablesAndConfiguration),
    'policy-shape', 'runtimePolicy', 'Runtime policy requires opaque independently reviewed deployment identities')
    check(digest(expected.collectorSha256) && runtimePolicy?.collectorManifestSha256 === expected.collectorSha256,
      'hash-binding', 'runtimePolicy.collectorManifestSha256', 'Collector identity must match trusted expectations')
    for (const [hash, blob] of Object.entries(verifiedBlobs)) check(digest(hash) && exactKeys(blob, ['size']) && Number.isSafeInteger(blob.size) && blob.size >= 0,
      'verified-blob', `verifiedBlobs.${hash}`, 'Verified blob manifest requires digest and byte size')
    if (!check(object(input.observationArtifacts) && Array.isArray(input.runs) && object(input.calibration) && Array.isArray(input.calibration.runs),
      'schema', '$', 'Artifact map and both run lists are required')) return result()
    const artifacts = input.observationArtifacts, runs = [...input.calibration.runs, ...input.runs]
    check(input.runs.length > 0 && input.calibration.runs.length > 0, 'missing-runs', 'runs', 'Both calibration and comparison runs must be present')
    const owners = new Set(), roots = []
    for (const [i, run] of runs.entries()) {
      const path = `runs[${i}]`
      if (!check(object(run) && nonempty(run.id), 'run', path, 'Run needs an explicit ID')) continue
      check(!owners.has(run.id), 'duplicate-run', path, 'Run IDs must be unique across calibration and comparison'); owners.add(run.id)
      check(digest(run.rawSha256) && hashRun(run) === run.rawSha256, 'run-hash', path, 'Run hash must include its observation references')
      if (!check(exactKeys(run.observations, OBSERVATION_KINDS), 'required-kinds', `${path}.observations`, 'Exactly all eight observation kinds are required')) continue
      for (const kind of OBSERVATION_KINDS) {
        const ref = run.observations[kind]
        if (check(refShape(ref) && ref.kind === kind, 'reference', `${path}.${kind}`, 'Reference digest and kind must match the required slot')) roots.push({ ref, owner: run.id })
      }
    }
    const validArtifacts = new Map()
    for (const [hash, artifact] of Object.entries(artifacts)) {
      const path = `observationArtifacts.${hash}`
      const shape = exactKeys(artifact, ['schemaVersion', 'kind', 'payload', 'references', 'blobs']) && artifact.schemaVersion === 1 &&
        OBSERVATION_KINDS.includes(artifact.kind) && exactKeys(artifact.payload, ['runId', 'records']) &&
        nonempty(artifact.payload.runId) && object(artifact.payload.records) && Array.isArray(artifact.references) && Array.isArray(artifact.blobs)
      if (!check(shape, 'artifact-shape', path, 'Artifact requires explicit owner, records, references and blobs')) continue
      check(digest(hash) && sha256(artifact) === hash, 'artifact-hash', path, 'Artifact key must hash its complete canonical envelope')
      check(owners.has(artifact.payload.runId), 'owner', path, 'Artifact owner must be a declared run')
      const seenRefs = new Set(), seenBlobs = new Set()
      for (const ref of artifact.references) {
        check(refShape(ref), 'reference', path, 'Nested edges must be typed observation references')
        if (refShape(ref)) { check(!seenRefs.has(ref.sha256), 'duplicate-reference', path, 'Duplicate graph edge'); seenRefs.add(ref.sha256) }
      }
      for (const blob of artifact.blobs) {
        if (!check(exactKeys(blob, ['sha256', 'size']) && digest(blob.sha256) && Number.isSafeInteger(blob.size) && blob.size >= 0,
          'blob-reference', path, 'Blob reference requires a digest and exact byte size')) continue
        check(!seenBlobs.has(blob.sha256), 'duplicate-blob', path, 'Duplicate blob reference'); seenBlobs.add(blob.sha256)
        check(Object.hasOwn(verifiedBlobs, blob.sha256) && verifiedBlobs[blob.sha256]?.size === blob.size,
          'missing-blob', path, 'Blob must be independently verified with matching size')
      }
      validArtifacts.set(hash, artifact)
    }
    const reached = new Set(), active = new Set(), completed = new Set()
    function visit(ref, owner) {
      if (!refShape(ref)) return
      const path = `observationArtifacts.${ref.sha256}`, artifact = validArtifacts.get(ref.sha256)
      if (!check(!!artifact, 'missing-reference', path, 'Referenced observation artifact is missing or malformed')) return
      check(artifact.kind === ref.kind, 'kind', path, 'Referenced artifact kind differs from reference')
      check(artifact.payload.runId === owner, 'cross-run-reference', path, 'Observation references must stay within their run')
      reached.add(ref.sha256)
      if (!check(!active.has(ref.sha256), 'cycle', path, 'Observation graph must be acyclic')) return
      // Ownership is checked before memoization, including references from other runs.
      if (completed.has(ref.sha256)) return
      active.add(ref.sha256)
      for (const child of artifact.references) visit(child, owner)
      active.delete(ref.sha256); completed.add(ref.sha256)
    }
    for (const { ref, owner } of roots) visit(ref, owner)
    // Reject orphan records rather than silently leaving unvalidated evidence in the archive.
    for (const [hash, artifact] of validArtifacts) {
      check(reached.has(hash), 'orphan-artifact', `observationArtifacts.${hash}`, 'Every artifact must be reachable from its owning run')
      if (!completed.has(hash)) visit({ sha256: hash, kind: artifact.kind }, artifact.payload.runId)
    }
  } catch (error) { issues.push({ code: 'schema', path: '$', message: String(error.message) }) }
  return result()
}
