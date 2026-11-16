import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, sha256, hashRun, validateEvidence, compareEvidence, classifyPairs, renderChart, renderPerformance } from './index.mjs'
import { syntheticEvidence, phase, reseal, control } from './fixtures.mjs'

function invalid(edit, code, seal = true) {
  const { input, expected } = syntheticEvidence(); edit(input, expected)
  if (seal) reseal(input)
  const validation = validateEvidence(input, expected)
  assert.equal(validation.valid, false)
  assert.ok(validation.issues.some(i => i.code === code), JSON.stringify(validation.issues))
  const report = compareEvidence(input, expected)
  assert.equal(report.promotion, 'blocked'); assert.equal(report.status, 'not measured')
  assert.equal(report.comparisons.length, 0)
}
test('synthetic qualified equivalence permits unchanged without a speedup claim', () => {
  const { input, expected } = syntheticEvidence()
  for (const r of input.runs.filter(r => r.side === 'candidate')) r.startup.coldMs += .2
  reseal(input)
  assert.deepEqual(validateEvidence(input, expected), { valid: true, issues: [] })
  const report = compareEvidence(input, expected)
  assert.equal(report.status, 'unchanged'); assert.equal(report.promotion, 'eligible')
  assert.equal(report.comparisons.find(c => c.metric === 'medianMs').baseline, 20)
})
test('invalid pacing before or after invalidates all comparison claims', () => {
  for (const key of ['pacingBefore', 'pacingAfter']) invalid(i => { i.runs[0][key].gaps = Array(45).fill(67) }, 'pacing')
})
test('wrong source, artifact and untrusted baseline are rejected', () => {
  invalid(i => { i.runs[0].observedBuild = { ...i.runs[0].observedBuild, commit: 'd'.repeat(40) } }, 'build')
  invalid(i => { i.runs[0].observedBuild = { ...i.runs[0].observedBuild, artifactSha256: 'd'.repeat(64) } }, 'build')
  invalid(i => { i.builds = { ...i.builds, baseline: { ...i.builds.baseline, version: 'made-up' } } }, 'build')
})
test('nonfinite, hidden and truncated frames are nonpassing, never filtered into improvements', () => {
  invalid(i => { i.runs[0].phases[1].frames[0].frameMs = Infinity }, 'json', false)
  invalid(i => { i.runs[0].phases[1].frames[0].hidden = true }, 'frames')
  invalid(i => { i.runs[0].phases[1].frames.splice(500) }, 'truncated')
  invalid(i => { i.runs[0].phases[1].complete = false }, 'truncated')
})
test('quality drift, errors, missing runs and alternating order fail', () => {
  invalid(i => { i.runs[0].qualityStable = false }, 'qualification')
  invalid(i => { i.runs[0].conditions.quality.level = 2 }, 'conditions')
  invalid(i => { i.runs[0].errors = ['renderer error'] }, 'qualification')
  invalid(i => { i.runs.pop() }, 'pairs')
  invalid(i => { i.runs[2].position = 1 }, 'order')
})
test('tampered raw hash, calibration, fixture and late/unreviewed policy fail', () => {
  invalid(i => { i.runs[0].startup.coldMs++ }, 'hash', false)
  invalid(i => { i.calibration.runs[0].startup.coldMs++ }, 'hash')
  invalid(i => { i.fixture.description = 'tampered' }, 'hash')
  invalid(i => { i.policy.cells['drive/steady'].medianMs.absolute = 100 }, 'policy')
  invalid((i, e) => { i.policy.frozenAt = '2026-02-01T00:00:00.000Z'; e.reviewedPolicySha256 = sha256(i.policy) }, 'policy')
})
test('known synthetic frame regression recomputes raw metrics despite supplied pass', () => {
  const { input, expected } = syntheticEvidence()
  for (const r of input.runs.filter(r => r.side === 'candidate')) r.phases[1] = phase('steady', 5000, 60000, 30)
  input.status = 'improved'; reseal(input)
  const report = compareEvidence(input, expected)
  assert.equal(report.status, 'regressed'); assert.equal(report.promotion, 'blocked')
  const row = report.comparisons.find(c => c.metric === 'medianMs')
  assert.equal(row.baseline, 20); assert.equal(row.candidate, 30); assert.equal(row.percent, 50)
})
test('mixed changes retain tail regression even with faster startup', () => {
  const { input, expected } = syntheticEvidence()
  for (const r of input.runs.filter(r => r.side === 'candidate')) { r.startup.coldMs = 500; r.phases[1] = phase('steady', 5000, 60000, 50) }
  reseal(input)
  const report = compareEvidence(input, expected)
  assert.equal(report.status, 'mixed'); assert.equal(report.promotion, 'blocked')
  assert.ok(report.comparisons.some(c => c.metric === 'stalls' && c.status === 'regressed' && c.percent === null))
})
test('A/A noise and unstable pairs remain inconclusive; practical bounds use whole guard', () => {
  const p = { absolute: 1, relative: 0, noiseMultiplier: 1 }
  assert.equal(classifyPairs([20, 20, 20], [20.2, 20.3, 20.4], [.1, -.1, .1], p).status, 'unchanged')
  assert.equal(classifyPairs([20, 20, 20], [20, 20, 20], [2, -2, 2], p).status, 'inconclusive')
  assert.equal(classifyPairs([20, 20, 20], [18, 20, 22], [0, 0, 0], p).status, 'inconclusive')
  assert.equal(classifyPairs([20, 20, 20], [19, 19, 19], [.1, -.1, .1], p).status, 'inconclusive')
})
test('calibration noise is recomputed from raw A/A pairs, not a supplied aggregate', () => {
  const { input, expected } = syntheticEvidence()
  for (const r of input.calibration.runs.filter(r => r.side === 'candidate')) { r.startup.coldMs += 5; r.rawSha256 = hashRun(r) }
  input.calibration.noise = 0
  expected.calibrationSha256 = sha256(input.calibration)
  input.policy.calibrationSha256 = expected.calibrationSha256
  expected.reviewedPolicySha256 = sha256(input.policy)
  const report = compareEvidence(input, expected)
  assert.equal(report.qualified, true)
  assert.equal(report.status, 'inconclusive'); assert.equal(report.promotion, 'blocked')
  assert.equal(report.comparisons.find(c => c.metric === 'coldStartupMs').uncertainty, 5)
})
test('hashes are canonical and nonrecursive; malformed JSON is rejected', () => {
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }))
  const { input } = syntheticEvidence(), r = input.runs[0]
  assert.equal(hashRun({ ...r, rawSha256: 'ignored' }), hashRun(r))
  assert.throws(() => canonicalJson([, 1]))
  assert.throws(() => canonicalJson({ n: NaN }))
  const cycle = {}; cycle.self = cycle; assert.throws(() => canonicalJson(cycle))
})
test('chart and numeric table share metrics, axis per metric, and notes/PR render identically', () => {
  const { input, expected } = syntheticEvidence()
  const report = compareEvidence(input, expected)
  const options = { version: input.builds.candidate.version, assetBaseUrl: 'https://example.invalid/immutable/synthetic' }
  const notes = renderPerformance(report, options), pr = renderPerformance(report, options), svg = renderChart(report)
  assert.equal(notes, pr)
  for (const row of report.comparisons.filter(c => ['medianMs', 'p99Ms'].includes(c.metric))) {
    assert.ok(notes.includes(`| ${row.metric} (ms) | ${row.baseline} | ${row.candidate} |`))
    assert.ok(svg.includes(`baseline: ${row.baseline} ms`)); assert.ok(svg.includes(`candidate: ${row.candidate} ms`))
  }
  assert.ok(notes.includes(report.assets.chart)); assert.ok(notes.includes('No physical measurement'))
  assert.throws(() => renderPerformance(report, { ...options, version: 'wrong' }))
  assert.throws(() => renderPerformance(report, { ...options, assetBaseUrl: 'http://example.invalid/' }))
})
test('missing evidence renders explicit nonpass and different invalid expectations get distinct artifacts', () => {
  const { input, expected } = syntheticEvidence()
  input.runs = []
  const report = compareEvidence(input, expected)
  const text = renderPerformance(report, { version: expected.candidate.version, assetBaseUrl: 'https://example.invalid/immutable' })
  assert.ok(text.includes('not measured')); assert.ok(text.includes('blocked')); assert.ok(!text.includes('![Paired'))
  assert.ok(renderChart(report).includes('Not measured'))
  const alternate = compareEvidence(input, { ...expected, candidate: { ...expected.candidate, version: 'other' } })
  assert.notEqual(report.assets.report, alternate.assets.report)
})
test('extra duration and altered startup method cannot masquerade as comparable samples', () => {
  invalid(i => { i.runs[0].startup.method = 'first draw, not play' }, 'startup')
  invalid(i => { i.runs[0].phases[1] = { ...phase('steady', 5000, 120000, 20), expectedDurationMs: 60000 }; i.runs[0].endedAt = new Date(Date.parse(i.runs[0].startedAt) + 125000).toISOString() }, 'truncated')
})
test('transition stalls remain separate from steady observations and chart axes match across phases', () => {
  const { input, expected } = syntheticEvidence()
  input.fixture.scenes.drive.phaseDurations.transition = 30000
  expected.fixtureSha256 = sha256(input.fixture)
  input.conditions.drive.fixtureSha256 = expected.fixtureSha256
  input.policy.cells['drive/transition'] = structuredClone(input.policy.cells['drive/steady'])
  for (const r of [...input.calibration.runs, ...input.runs]) {
    r.conditions.fixtureSha256 = expected.fixtureSha256
    const gap = input.runs.includes(r) && r.side === 'candidate' ? 50 : 20
    r.phases.push(phase('transition', 65000, 30000, gap))
    r.endedAt = new Date(Date.parse(r.startedAt) + 95000).toISOString()
    r.pacingAfter = control(Date.parse(r.endedAt) + 1000)
    r.rawSha256 = hashRun(r)
  }
  expected.calibrationSha256 = sha256(input.calibration)
  input.policy.calibrationSha256 = expected.calibrationSha256
  expected.reviewedPolicySha256 = sha256(input.policy)
  const report = compareEvidence(input, expected)
  assert.equal(report.qualified, true, JSON.stringify(report.issues))
  assert.equal(report.status, 'regressed')
  assert.equal(report.comparisons.find(c => c.phase === 'steady' && c.metric === 'medianMs').status, 'unchanged')
  assert.equal(report.comparisons.find(c => c.phase === 'transition' && c.metric === 'stalls').status, 'regressed')
  assert.equal(report.comparisons.filter(c => c.phase === 'transition' && c.metric === 'coldStartupMs').length, 0)
  const chart = renderChart(report)
  assert.equal((chart.match(/>50 ms<\/text>/g) ?? []).length, 4)
})
test('malformed structures produce validation issues rather than gate crashes', () => {
  const { input, expected } = syntheticEvidence()
  for (const value of [null, {}, [], { ...input, runs: [null] }, { ...input, policy: { ...input.policy, cells: null } }]) {
    assert.equal(validateEvidence(value, expected).valid, false)
    assert.equal(compareEvidence(value, expected).promotion, 'blocked')
  }
})
test('frame timestamps must match every interval, including the first boundary and final sample', () => {
  invalid(i => { i.runs[0].phases[1].frames[100].frameMs += 5; i.runs[0].phases[1].frames[101].frameMs -= 5 }, 'frames')
  invalid(i => { i.runs[0].phases[1].frames[0].at += 1 }, 'frames')
  invalid(i => { i.runs[0].phases[1].frames.pop() }, 'truncated')
  const { input, expected } = syntheticEvidence()
  input.runs[0].phases[1].frames[10].at += .001
  reseal(input)
  assert.equal(validateEvidence(input, expected).valid, true)
})
test('pacing gaps must cover the real window and be placed around the run', () => {
  invalid(i => { i.runs[0].pacingBefore.gaps = Array(1000).fill(20) }, 'pacing')
  invalid(i => { i.runs[0].pacingBefore.startedAt = i.runs[0].startedAt }, 'pacing')
  invalid(i => { i.runs[0].pacingAfter = control(Date.parse(i.runs[0].startedAt) + 1000) }, 'pacing')
  invalid(i => { delete i.runs[0].pacingBefore.endedAt }, 'pacing')
  invalid(i => { i.runs[0].pacingBefore.durationMs = 2000 }, 'pacing')
})
function twoSceneEvidence(overlapIn) {
  const { input, expected } = syntheticEvidence()
  input.fixture.scenes.lobby = structuredClone(input.fixture.scenes.drive)
  expected.requiredScenes.push('lobby')
  expected.fixtureSha256 = sha256(input.fixture)
  input.conditions.lobby = structuredClone(input.conditions.drive)
  input.policy.cells['lobby/steady'] = structuredClone(input.policy.cells['drive/steady'])
  for (const c of Object.values(input.conditions)) c.fixtureSha256 = expected.fixtureSha256
  for (const [label, runs] of [['calibration', input.calibration.runs], ['comparison', input.runs]]) {
    const extra = structuredClone(runs)
    for (const r of extra) {
      r.id += '-lobby'; r.scene = 'lobby'
      const offset = overlapIn === label ? 0 : 3600000
      for (const obj of [r, r.pacingBefore, r.pacingAfter]) for (const key of ['startedAt', 'endedAt']) obj[key] = new Date(Date.parse(obj[key]) + offset).toISOString()
    }
    runs.push(...extra)
    for (const r of runs) { r.conditions.fixtureSha256 = expected.fixtureSha256; r.rawSha256 = hashRun(r) }
  }
  expected.calibrationSha256 = sha256(input.calibration)
  input.policy.calibrationSha256 = expected.calibrationSha256
  expected.reviewedPolicySha256 = sha256(input.policy)
  return { input, expected }
}
test('serial scenes include controls in global nonoverlap checks, separately for A/A and comparison', () => {
  const good = twoSceneEvidence(null)
  assert.equal(validateEvidence(good.input, good.expected).valid, true)
  for (const label of ['calibration', 'comparison']) {
    const { input, expected } = twoSceneEvidence(label)
    assert.ok(validateEvidence(input, expected).issues.some(i => i.code === 'overlap'))
    assert.equal(compareEvidence(input, expected).promotion, 'blocked')
  }
  invalid(i => { i.runs[1].pacingBefore = control(Date.parse(i.runs[0].endedAt) + 2000) }, 'overlap')
})
test('canonical block fits release notes without a heading rewrite', () => {
  const { input, expected } = syntheticEvidence()
  assert.ok(renderPerformance(compareEvidence(input, expected), { version: expected.candidate.version, assetBaseUrl: 'https://example.invalid/immutable' }).startsWith('### Performance\n'))
})
