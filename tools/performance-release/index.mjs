import { createHash } from 'node:crypto'
import { summarizeFrames, judgePacing } from '../performance-check.mjs'

const scenes = ['lobby', 'drive', 'mixedbots', 'water', 'twohumans']
const frameMetrics = ['medianMs', 'p95Ms', 'p99Ms', 'stalls', 'maxStallMs']
const startupMetrics = ['coldStartupMs', 'warmStartupMs', 'transferBytes']
const hex = /^[a-f0-9]{64}$/
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const finite = v => typeof v === 'number' && Number.isFinite(v)
const positive = v => finite(v) && v > 0
const nonnegative = v => finite(v) && v >= 0
const string = v => typeof v === 'string' && v.length > 0
const time = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(v) && Number.isFinite(Date.parse(v))
const equal = (a, b) => canonicalJson(a) === canonicalJson(b)
const metricsFor = phase => phase === 'steady' ? [...frameMetrics, ...startupMetrics] : frameMetrics
const median = values => {
  const s = [...values].sort((a, b) => a - b), n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** Reject values JSON would silently lose, including nonfinite numbers and sparse arrays. */
export function canonicalJson(value) {
  const seen = new Set()
  function visit(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v)
    if (typeof v !== 'object' || seen.has(v)) throw new TypeError('Expected finite, acyclic JSON')
    seen.add(v)
    let result
    if (Array.isArray(v)) {
      const parts = []
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) throw new TypeError('Sparse arrays are not JSON evidence')
        parts.push(visit(v[i]))
      }
      result = `[${parts.join(',')}]`
    } else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new TypeError('Expected plain JSON object')
      result = `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${visit(v[k])}`).join(',')}}`
    }
    seen.delete(v)
    return result
  }
  return visit(value)
}
export const sha256 = value => createHash('sha256').update(canonicalJson(value)).digest('hex')
export function hashRun(run) {
  const { rawSha256: ignored, ...payload } = run
  return sha256(payload)
}

function runMetrics(run, kind) {
  const frames = run.phases.find(p => p.kind === kind).frames
  const summary = summarizeFrames(frames)
  const sorted = frames.map(f => f.frameMs).sort((a, b) => a - b)
  return {
    medianMs: summary.p50, p95Ms: sorted[Math.floor(sorted.length * .95)],
    p99Ms: summary.p99, stalls: summary.over2x, maxStallMs: summary.max,
    coldStartupMs: run.startup.coldMs, warmStartupMs: run.startup.warmMs,
    transferBytes: run.transfer.bytes,
  }
}

function validateInternal(input, expected) {
  const issues = []
  const require = (ok, code, path, message) => {
    if (!ok) issues.push({ code, path, message })
    return !!ok
  }
  try { canonicalJson(input); canonicalJson(expected) } catch (e) {
    return { valid: false, issues: [{ code: 'json', path: '$', message: e.message }] }
  }
  if (!require(object(input) && object(expected), 'schema', '$', 'Evidence and expectations must be objects')) return { valid: false, issues }
  const buildValid = b => object(b) && string(b.version) && /^[a-f0-9]{40}$/.test(b.commit) && hex.test(b.artifactSha256)
  require(input.schemaVersion === 1, 'schema', 'schemaVersion', 'Only schema version 1 is supported')
  if (!require(buildValid(expected.baseline) && buildValid(expected.candidate) &&
    Array.isArray(expected.requiredScenes) && expected.requiredScenes.length > 0 &&
    new Set(expected.requiredScenes).size === expected.requiredScenes.length && expected.requiredScenes.every(s => scenes.includes(s)) &&
    ['reviewedPolicySha256', 'calibrationSha256', 'fixtureSha256', 'collectorSha256'].every(k => hex.test(expected[k])),
  'expectations', 'expected', 'Trusted identities, reviewed policy and required scenes are required')) return { valid: false, issues }
  require(equal(input.builds ?? null, { baseline: expected.baseline, candidate: expected.candidate }), 'build', 'builds', 'Builds differ from the trusted release identities')
  if (!require(object(input.fixture) && object(input.calibration) && object(input.policy) && object(input.conditions),
    'schema', '$', 'Fixture, calibration, policy and conditions are required')) return { valid: false, issues }
  require(sha256(input.fixture) === expected.fixtureSha256, 'hash', 'fixture', 'Fixture content hash differs from approved artifact')
  require(sha256(input.calibration) === expected.calibrationSha256, 'hash', 'calibration', 'Calibration content hash differs from approved artifact')
  require(sha256(input.policy) === expected.reviewedPolicySha256, 'policy', 'policy', 'Policy content is not independently reviewed')
  require(input.policy.calibrationSha256 === expected.calibrationSha256 && time(input.policy.frozenAt) && string(input.policy.id),
    'policy', 'policy', 'Policy must bind calibration and an explicit freeze time')
  require(input.fixture.schemaVersion === 1 && string(input.fixture.description) && object(input.fixture.scenes), 'fixture', 'fixture', 'Fixture schema and scenes are required')
  require(input.calibration.schemaVersion === 1 && equal(input.calibration.build ?? null, expected.baseline), 'calibration', 'calibration.build', 'Calibration must use the accepted baseline')
  require(Array.isArray(input.limitations) && input.limitations.every(string), 'schema', 'limitations', 'Limitations must be a string array')
  if (!object(input.fixture.scenes) || !object(input.policy.cells)) {
    require(false, 'schema', '$', 'Fixture scenes and policy cells must be objects')
    return { valid: false, issues }
  }
  const required = expected.requiredScenes
  require(equal(Object.keys(input.conditions).sort(), [...required].sort()) && equal(Object.keys(input.fixture.scenes).sort(), [...required].sort()),
    'fixture', 'conditions', 'Scene set must exactly match the gate matrix')
  for (const scene of required) {
    const c = input.conditions[scene], f = input.fixture.scenes[scene]
    if (!require(object(c) && object(f) && object(f.conditions) && object(f.phaseDurations) && Object.hasOwn(f, 'inputTrace'), 'fixture', scene, 'Missing scene condition or fixture')) continue
    // Fixture conditions omit only their own hash and the derived trace hash.
    require(!Object.hasOwn(f.conditions, 'fixtureSha256') && !Object.hasOwn(f.conditions, 'inputTraceSha256'), 'fixture', scene, 'Fixture conditions cannot contain self-referential hashes')
    require(equal(c, { ...f.conditions, fixtureSha256: expected.fixtureSha256, inputTraceSha256: sha256(f.inputTrace) }), 'conditions', scene, 'Conditions do not match the immutable fixture')
    require(['hardware', 'os', 'browser', 'seed', 'camera', 'clock'].every(k => string(c[k])) && ['webgpu', 'webgl'].includes(c.backend) &&
      ['viewport', 'backing'].every(k => Array.isArray(c[k]) && c[k].length === 2 && c[k].every(n => Number.isInteger(n) && n > 0)) &&
      positive(c.dpr) && positive(c.refreshHz) && c.collectorSha256 === expected.collectorSha256,
    'conditions', scene, 'Incomplete environment or collector fingerprint')
    require(object(c.quality) && Number.isInteger(c.quality.level) && c.quality.level >= 0 && c.quality.level <= 5 && c.quality.auto === false && object(c.quality.settings), 'quality', scene, 'Fixed explicit quality settings required')
    require(object(c.actors) && ['bots', 'remotes'].every(k => Number.isInteger(c.actors[k]) && c.actors[k] >= 0) && (scene !== 'twohumans' || c.actors.remotes >= 1), 'actors', scene, 'Actor counts must match the workload, including an actual remote for two-client scenes')
    require(object(c.instrumentation) && string(c.instrumentation.method) &&
      (nonnegative(c.instrumentation.overheadMs) || (c.instrumentation.overheadMs === null && string(c.instrumentation.limitation))),
    'instrumentation', scene, 'Measure instrumentation overhead or disclose it')
    require(string(f.startupMethod) && string(f.transferMethod), 'fixture', scene, 'Startup and transfer methods must be frozen in the fixture')
    const durations = f.phaseDurations
    require(nonnegative(durations.warmup) && durations.warmup >= 5000 && nonnegative(durations.steady) && durations.steady >= 60000 &&
      Object.keys(durations).every(k => ['warmup', 'steady', 'transition'].includes(k)) &&
      (!Object.hasOwn(durations, 'transition') || positive(durations.transition)) && (scene !== 'water' || durations.transition >= 30000),
    'fixture', scene, 'Required warmup, steady and water transition durations are missing')
    for (const phase of Object.keys(durations).filter(k => k !== 'warmup')) {
      const cell = input.policy.cells[`${scene}/${phase}`]
      for (const metric of metricsFor(phase)) {
        const p = cell?.[metric]
        require(object(p) && nonnegative(p.absolute) && nonnegative(p.relative) && finite(p.noiseMultiplier) && p.noiseMultiplier >= 1,
          'policy', `${scene}/${phase}/${metric}`, 'Preapproved absolute/relative floors and noise multiplier >= 1 required')
      }
    }
  }
  function validateRuns(runs, calibration) {
    const root = calibration ? 'calibration.runs' : 'runs'
    if (!require(Array.isArray(runs) && runs.length > 0, 'missing', root, 'Complete paired raw runs required')) return
    const ids = new Set()
    for (const [i, r] of runs.entries()) {
      const path = `${root}[${i}]`
      if (!require(object(r), 'schema', path, 'Run must be an object')) continue
      require(string(r.id) && !ids.has(r.id), 'run', path, 'Unique run ID required'); ids.add(r.id)
      require(hex.test(r.rawSha256) && r.rawSha256 === hashRun(r), 'hash', `${path}.rawSha256`, 'Raw hash must match canonical run payload excluding rawSha256')
      require(required.includes(r.scene) && Number.isInteger(r.pair) && r.pair >= 0 && [0, 1].includes(r.position) && ['baseline', 'candidate'].includes(r.side), 'run', path, 'Invalid scene, pair or side')
      const trusted = calibration ? expected.baseline : expected[r.side]
      require(!!trusted && equal(r.observedBuild ?? null, trusted), 'build', path, 'Observed frozen build differs from trusted build')
      require(time(r.startedAt) && time(r.endedAt) && Date.parse(r.endedAt) > Date.parse(r.startedAt), 'time', path, 'Valid increasing run times required')
      require(calibration ? Date.parse(r.endedAt) <= Date.parse(input.policy.frozenAt) : Date.parse(r.startedAt) > Date.parse(input.policy.frozenAt), 'policy', path, 'Calibration must finish before freeze; measured comparisons must start afterwards')
      const c = input.conditions[r.scene]
      if (!require(object(c) && equal(r.conditions ?? null, c), 'conditions', path, 'Run conditions differ from scene fingerprint')) continue
      require(Array.isArray(r.errors) && r.errors.length === 0 && r.overflow === false && r.qualityStable === true, 'qualification', path, 'Errors, overflow or quality drift invalidate the run')
      for (const name of ['pacingBefore', 'pacingAfter']) {
        const control = r[name]
        const shape = object(control) && finite(control.durationMs) && control.durationMs >= 3000 && Array.isArray(control.gaps) && control.gaps.every(positive)
        require(shape && judgePacing(control.gaps, 1000 / c.refreshHz, control.durationMs).valid, 'pacing', `${path}.${name}`, 'Blank-page control is missing or unqualified')
      }
      require(object(r.startup) && positive(r.startup.coldMs) && positive(r.startup.warmMs) && r.startup.method === input.fixture.scenes[r.scene]?.startupMethod && r.startup.coldCacheVerified === true && r.startup.usablePlayVerified === true,
        'startup', path, 'Separate verified cold/warm usable-play timings required')
      require(object(r.transfer) && Number.isSafeInteger(r.transfer.bytes) && r.transfer.bytes > 0 && r.transfer.method === input.fixture.scenes[r.scene]?.transferMethod && hex.test(r.transfer.manifestSha256), 'transfer', path, 'Measured transfer bytes and frozen manifest identity required')
      const durations = input.fixture.scenes[r.scene]?.phaseDurations
      if (!require(Array.isArray(r.phases) && object(durations), 'phase', path, 'Missing phases')) continue
      require(equal(r.phases.map(p => p?.kind), ['warmup', 'steady', 'transition'].filter(k => Object.hasOwn(durations, k))), 'phase', path, 'Each fixture phase must occur exactly once')
      let previousEnd = -Infinity
      for (const p of r.phases) {
        if (!require(object(p) && finite(p.startedAtMs) && finite(p.endedAtMs) && p.startedAtMs >= 0 && p.endedAtMs > p.startedAtMs && p.startedAtMs >= previousEnd &&
          p.expectedDurationMs === durations[p.kind] && p.complete === true && p.endedAtMs - p.startedAtMs >= p.expectedDurationMs && Array.isArray(p.frames) && p.frames.length > 0,
        'truncated', path, 'Phase incomplete, short, unordered or missing frames')) continue
        previousEnd = p.endedAtMs
        require(p.endedAtMs <= Date.parse(r.endedAt) - Date.parse(r.startedAt), 'time', path, 'Phase extends beyond run duration')
        let last = p.startedAtMs, sum = 0, max = 0, valid = true
        for (const frame of p.frames) {
          const good = object(frame) && positive(frame.frameMs) && finite(frame.at) && frame.at > last && frame.at <= p.endedAtMs &&
            frame.hidden === false && positive(frame.targetBudgetMs) && Math.abs(frame.targetBudgetMs - 1000 / c.refreshHz) < .000001
          if (!good) valid = false
          if (good) { sum += frame.frameMs; max = Math.max(max, frame.frameMs); last = frame.at }
        }
        require(valid, 'frames', path, 'Invalid, hidden, nonmonotonic or wrong-target frames')
        if (valid) require(p.endedAtMs - p.startedAtMs - p.expectedDurationMs <= max && Math.abs(sum - (p.endedAtMs - p.startedAtMs)) <= max &&
          p.frames[0].at - p.startedAtMs <= max && p.endedAtMs - last <= max,
        'truncated', path, 'Raw samples do not cover the complete phase')
      }
    }
    for (const scene of required) {
      const group = runs.filter(r => r?.scene === scene)
      const count = group.length / 2
      require(Number.isInteger(count) && count >= 3, 'pairs', `${root}.${scene}`, 'At least three complete pairs required')
      let previousEnd = -Infinity
      for (let pair = 0; pair < Math.ceil(count); pair++) {
        const members = group.filter(r => r.pair === pair).sort((a, b) => a.position - b.position)
        require(members.length === 2 && members[0].position === 0 && members[1].position === 1 &&
          members[0].side === (pair % 2 ? 'candidate' : 'baseline') && members[1].side !== members[0].side,
        'order', `${root}.${scene}.${pair}`, 'Pairs must be complete and alternate AB/BA order')
        for (const member of members) {
          require(Date.parse(member.startedAt) >= previousEnd, 'order', root, 'Recorded pair order must match chronological nonoverlapping runs')
          previousEnd = Date.parse(member.endedAt)
        }
      }
    }
  }
  validateRuns(input.calibration.runs, true)
  validateRuns(input.runs, false)
  return { valid: issues.length === 0, issues }
}

/** Malformed submissions produce a nonpassing result rather than crashing a release gate. */
export function validateEvidence(input, expected) {
  try { return validateInternal(input, expected) }
  catch (error) { return { valid: false, issues: [{ code: 'schema', path: '$', message: error.message }] } }
}

/** Deterministic precision guard, not a confidence interval or independent-frame test. */
export function classifyPairs(baseline, candidate, calibrationDeltas, policy) {
  const deltas = candidate.map((v, i) => v - baseline[i])
  const b = median(baseline), c = median(candidate), delta = median(deltas)
  const tolerance = Math.max(policy.absolute, Math.abs(b) * policy.relative)
  const calibrationNoise = Math.max(...calibrationDeltas.map(Math.abs))
  const uncertainty = Math.max(policy.noiseMultiplier * calibrationNoise, (Math.max(...deltas) - Math.min(...deltas)) / 2)
  const needed = Math.ceil(2 * deltas.length / 3)
  let status = 'inconclusive'
  if (deltas.every(d => Math.abs(d) + uncertainty <= tolerance)) status = 'unchanged'
  else if (delta - uncertainty > tolerance && deltas.filter(d => d > tolerance).length >= needed) status = 'regressed'
  else if (delta + uncertainty < -tolerance && deltas.filter(d => d < -tolerance).length >= needed) status = 'improved'
  return { baseline: b, candidate: c, delta, percent: b === 0 ? null : delta / b * 100, tolerance, uncertainty, calibrationNoise, pairedDeltas: deltas, status }
}

export function compareEvidence(input, expected) {
  const validation = validateEvidence(input, expected)
  const safeHash = value => { try { return sha256(value) } catch { return null } }
  const evidenceSha256 = safeHash(input), policySha256 = safeHash(input?.policy)
  const report = {
    schemaVersion: 1, evidenceSha256, policySha256,
    builds: { baseline: expected?.baseline ?? null, candidate: expected?.candidate ?? null },
    conditions: validation.valid ? input.conditions : {},
    status: 'not measured', qualified: validation.valid, promotion: 'blocked',
    issues: validation.issues, comparisons: [], runs: [],
    limitations: Array.isArray(input?.limitations) ? input.limitations.filter(string) : [],
    assets: { report: evidenceSha256 ? `report-${evidenceSha256}.json` : null,
      chart: evidenceSha256 ? `chart-${evidenceSha256}.svg` : null,
      raw: [], fixture: `fixture-${expected?.fixtureSha256}.json`, calibration: `calibration-${expected?.calibrationSha256}.json` },
  }
  if (!validation.valid) return nameReport(report)
  report.assets.raw = [...new Set([...input.calibration.runs, ...input.runs].map(r => `raw-${r.rawSha256}.json`))]
  for (const scene of expected.requiredScenes) {
    const grouped = (runs, side) => runs.filter(r => r.scene === scene && r.side === side).sort((a, b) => a.pair - b.pair)
    const baseline = grouped(input.runs, 'baseline'), candidate = grouped(input.runs, 'candidate')
    const aa = grouped(input.calibration.runs, 'baseline'), ab = grouped(input.calibration.runs, 'candidate')
    for (const phase of Object.keys(input.fixture.scenes[scene].phaseDurations).filter(k => k !== 'warmup')) {
      for (const metric of metricsFor(phase)) {
        const values = runs => runs.map(r => runMetrics(r, phase)[metric])
        const calA = values(aa), calB = values(ab)
        report.comparisons.push({ scene, phase, metric, unit: metric === 'stalls' ? 'count' : metric === 'transferBytes' ? 'bytes' : 'ms',
          ...classifyPairs(values(baseline), values(candidate), calB.map((v, i) => v - calA[i]), input.policy.cells[`${scene}/${phase}`][metric]) })
      }
    }
  }
  report.runs = input.runs.map(r => ({ id: r.id, scene: r.scene, pair: r.pair, side: r.side,
    durationMs: r.phases.filter(p => p.kind !== 'warmup').reduce((sum, p) => sum + p.endedAtMs - p.startedAtMs, 0),
    frames: r.phases.filter(p => p.kind !== 'warmup').reduce((sum, p) => sum + p.frames.length, 0), rawSha256: r.rawSha256,
    phases: r.phases.map(p => ({ kind: p.kind, durationMs: p.endedAtMs - p.startedAtMs, frames: p.frames.length })),
    startupMethod: r.startup.method, transferMethod: r.transfer.method }))
  const statuses = new Set(report.comparisons.map(c => c.status))
  report.status = statuses.has('regressed') ? (statuses.has('improved') ? 'mixed' : 'regressed') :
    statuses.has('inconclusive') ? 'inconclusive' : statuses.has('improved') ? 'improved' : 'unchanged'
  report.promotion = ['unchanged', 'improved'].includes(report.status) ? 'eligible' : 'blocked'
  return nameReport(report)
}

// Hash report content before adding derived filenames; no self-reference.
function nameReport(report) {
  const { assets, ...content } = report
  const id = sha256({ ...content, assets: { raw: assets.raw, fixture: assets.fixture, calibration: assets.calibration } })
  report.assets.report = `report-${id}.json`
  report.assets.chart = `chart-${id}.svg`
  return report
}

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const md = s => escape(s).replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ').replace(/`/g, '&#96;')
const display = n => n === null ? 'unavailable' : Number(n.toFixed(3)).toString()
const chartRows = report => report.comparisons.filter(c => ['medianMs', 'p99Ms'].includes(c.metric))
export function renderChart(report) {
  const rows = chartRows(report), height = Math.max(150, 80 + rows.length * 62)
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" role="img"><title>Paired median and p99 frame times in milliseconds; lower is better</title><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="13" fill="#111"><text x="20" y="24">Frame time (ms), lower is better. Blue: baseline; orange: candidate.</text>`
  if (!rows.length) svg += `<text x="20" y="65">Not measured: evidence is missing or unqualified.</text>`
  const maxima = Object.fromEntries(['medianMs', 'p99Ms'].map(metric => [metric, Math.max(1, ...rows.filter(c => c.metric === metric).flatMap(c => [c.baseline, c.candidate]))]))
  for (const [i, c] of rows.entries()) {
    const y = 55 + i * 62, max = maxima[c.metric], width = value => value / max * 400
    svg += `<text x="20" y="${y}">${escape(`${c.scene}/${c.phase} ${c.metric}`)}</text><text x="250" y="${y}">0</text><text x="650" y="${y}">${display(max)} ms</text>`
    for (const [j, side] of ['baseline', 'candidate'].entries()) {
      svg += `<rect x="250" y="${y + 5 + j * 18}" width="${width(c[side]).toFixed(4)}" height="14" fill="${j ? '#bd5700' : '#2063a0'}"/><text x="670" y="${y + 17 + j * 18}">${side}: ${display(c[side])} ms</text>`
    }
  }
  return `${svg}</g></svg>\n`
}
export function renderPerformance(report, { version, assetBaseUrl }) {
  if (version !== report.builds.candidate.version) throw new Error('Rendered version must match candidate')
  const base = new URL(assetBaseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Immutable HTTPS asset directory required')
  const url = name => `${base.href.replace(/\/$/, '')}/${name}`
  const lines = ['## Performance', '', `${md(version)} against ${md(report.builds.baseline.version)}: **${report.status}**. Performance promotion: **${report.promotion}**.`, '']
  if (report.qualified) {
    lines.push(`![Paired median and p99 frame times by scene in milliseconds; lower is better. Exact values appear below.](${url(report.assets.chart)})`, '',
      '| Scene / phase | Metric | Baseline | Candidate | Paired delta | Change | Tolerance | Guard | Result |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
    for (const c of report.comparisons) lines.push(`| ${c.scene} / ${c.phase} | ${c.metric} (${c.unit}) | ${display(c.baseline)} | ${display(c.candidate)} | ${display(c.delta)} | ${c.percent === null ? 'unavailable' : `${display(c.percent)}%`} | ${display(c.tolerance)} | ${display(c.uncertainty)} | ${c.status} |`)
    lines.push('', 'Values are medians of run-level measurements. Delta is the median paired difference; it can differ from the difference of the displayed medians. Guard is deterministic, not a confidence interval.', '', '| Run | Scene | Side | Pair | Phase | Observed duration (ms) | Frames |', '| --- | --- | --- | ---: | --- | ---: | ---: |')
    for (const r of report.runs) for (const p of r.phases) lines.push(`| ${md(r.id)} | ${r.scene} | ${r.side} | ${r.pair} | ${p.kind} | ${display(p.durationMs)} | ${p.frames} |`)
    lines.push('', `Startup methods: ${[...new Set(report.runs.map(r => r.startupMethod))].map(md).join('; ')}. Transfer methods: ${[...new Set(report.runs.map(r => r.transferMethod))].map(md).join('; ')}.`)
    lines.push('', 'Environment and fixed quality:')
    for (const [scene, c] of Object.entries(report.conditions)) lines.push(`- ${scene}: ${md(c.hardware)}, ${md(c.os)}, ${md(c.browser)}, ${c.backend}; viewport ${c.viewport.join('x')}, backing ${c.backing.join('x')}, DPR ${c.dpr}, target ${c.refreshHz} Hz; level ${c.quality.level}, auto off. Instrumentation: ${md(c.instrumentation.method)}; ${c.instrumentation.overheadMs === null ? md(c.instrumentation.limitation) : `${display(c.instrumentation.overheadMs)} ms measured overhead`}.`)
  } else {
    lines.push('No qualified performance comparison. Missing or invalid measurements are not a pass.', '')
    for (const issue of report.issues) lines.push(`- ${md(issue.code)} at ${md(issue.path)}: ${md(issue.message)}`)
  }
  lines.push('', 'Limits: frame intervals are not GPU timings or physical-phone evidence. Cold and warm startup are separate observations of usable play; transfer bytes use the recorded method.')
  for (const limitation of report.limitations) lines.push(`- ${md(limitation)}`)
  lines.push('', `Fixture: [immutable artifact](${url(report.assets.fixture)}). Calibration: [immutable artifact](${url(report.assets.calibration)}).`)
  if (report.assets.report) lines.push(`Canonical report: [JSON](${url(report.assets.report)}).`)
  for (const raw of report.assets.raw) lines.push(`- [${raw}](${url(raw)})`)
  return `${lines.join('\n')}\n`
}
