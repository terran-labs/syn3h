import { canonicalJson, sha256 } from './index.mjs'
import { summarizeFrames, judgePacing } from '../performance-check.mjs'

const ROUND = .002 // Serialization only, never a source clock precision claim.
const finite = n => typeof n === 'number' && Number.isFinite(n)
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const interval = i => obj(i) && finite(i.lo) && finite(i.hi) && i.lo <= i.hi
const add = (a, b) => ({ lo: a.lo + b.lo, hi: a.hi + b.hi })
const sub = (a, b) => ({ lo: a.lo - b.hi, hi: a.hi - b.lo })
const key = p => JSON.stringify([p.pageId, p.navigationId])
const text = v => typeof v === 'string' && v.length > 0
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
function output(issues, derived) { return { qualified: false, promotion: 'blocked', issues, derived } }
function intersect(values) {
  if (!values.length) return null
  const i = { lo: Math.max(...values.map(v => v.lo)), hi: Math.min(...values.map(v => v.hi)) }
  return interval(i) ? i : null
}
function bounded(source) {
  return obj(source) && source.mode === 'bounded' && finite(source.errorLoMs) && finite(source.errorHiMs) && source.errorLoMs <= source.errorHiMs &&
    digest(source.evidenceSha256) && text(source.evidenceDescription)
}
function q(value, source) { return finite(value) && bounded(source) ? { lo: value + source.errorLoMs, hi: value + source.errorHiMs } : null }
function capture(work) {
  const issues = [], check = (yes, code, message) => { if (!yes) issues.push({ code, message }); return !!yes }
  try { return output(issues, work(check)) } catch (e) { check(false, 'shape', String(e.message)); return output(issues, null) }
}

/** Clock profile is trusted only via a same-run runtime artifact and reviewed policy hash. */
export function validateClockMappings(clockArtifact, { runtimeArtifact, runtimePolicy, expectedRuntimePolicySha256 }) {
  return capture(check => {
    canonicalJson(clockArtifact); canonicalJson(runtimeArtifact); canonicalJson(runtimePolicy)
    const records = clockArtifact?.payload?.records, runtime = runtimeArtifact?.payload?.records
    if (!check(clockArtifact?.kind === 'clocks' && runtimeArtifact?.kind === 'runtime' && text(clockArtifact.payload?.runId) &&
      clockArtifact.payload.runId === runtimeArtifact.payload?.runId && obj(records) && obj(runtime), 'profile-binding', 'Same-run clocks and runtime artifacts required')) return null
    const ref = records.runtimeRef
    if (!check(ref?.kind === 'runtime' && digest(ref.sha256) && ref.sha256 === sha256(runtimeArtifact) &&
      clockArtifact.references?.some(r => r.kind === ref.kind && r.sha256 === ref.sha256) && digest(expectedRuntimePolicySha256) &&
      sha256(runtimePolicy) === expectedRuntimePolicySha256 && runtime.runtimePolicySha256 === expectedRuntimePolicySha256,
    'profile-binding', 'Runtime reference and independently reviewed policy hash must match')) return null
    const profile = runtimePolicy.executablesAndConfiguration?.clockProfiles?.[runtime.clockProfileId]
    if (!check(profile?.schemaVersion === 1 && records.schemaVersion === 1 && profile.hostClockId === records.hostClockId &&
      obj(profile.environment) && obj(runtime.clockEnvironment) && canonicalJson(profile.environment) === canonicalJson(runtime.clockEnvironment) && obj(profile.sources),
    'profile-binding', 'Named reviewed profile must match the observed clock environment and host domain')) return null
    if (!check(canonicalJson(Object.keys(profile.sources).sort()) === canonicalJson(['hostMonotonic', 'hostEpoch', 'pageMonotonic', 'pageEpoch', 'timeOrigin', 'raf'].sort()), 'profile', 'Every clock source must explicitly declare bounds or unavailable status')) return null
    for (const source of Object.values(profile.sources)) if (!check(source?.mode === 'unavailable' || bounded(source), 'profile', 'Clock source needs reviewed bounds or explicit unavailable status')) return null
    const s = profile.sources
    if (!check(finite(records.runOriginHostMs) && finite(records.runEndHostMs) && records.runEndHostMs > records.runOriginHostMs &&
      Array.isArray(records.pages) && records.pages.length > 0 && Array.isArray(records.hostEpochAnchors), 'clock-shape', 'Run bounds, pages and original anchors required')) return null
    let epoch = null
    const epochAnchors = records.hostEpochAnchors
    if (bounded(s.hostMonotonic) && bounded(s.hostEpoch) && profile.epochRelation === 'constant-offset') {
      const ranges = [], valid = epochAnchors.length >= 2
      let last = -Infinity, all = valid
      for (const a of epochAnchors) {
        const okay = finite(a.hostBeforeMs) && finite(a.hostAfterMs) && finite(a.utcMs) && a.hostBeforeMs <= a.hostAfterMs && a.hostBeforeMs >= last
        all &&= okay; last = a.hostAfterMs
        if (okay) ranges.push({ lo: q(a.utcMs, s.hostEpoch).lo - q(a.hostAfterMs, s.hostMonotonic).hi,
          hi: q(a.utcMs, s.hostEpoch).hi - q(a.hostBeforeMs, s.hostMonotonic).lo })
      }
      epoch = all ? intersect(ranges) : null
      check(!!epoch, 'epoch-unavailable', 'Epoch anchors must be ordered and admit the reviewed constant offset')
    } else check(false, 'epoch-unavailable', 'Reviewed epoch bounds and constant-offset relation are unavailable')
    const pages = {}, seen = new Set()
    for (const p of records.pages) {
      if (!check(text(p.pageId) && text(p.navigationId) && !seen.has(key(p)) && finite(p.timeOriginMs) && Array.isArray(p.anchors) && p.anchors.length >= 2,
        'navigation', 'Unique page/navigation and bracketing original anchors required')) return null
      seen.add(key(p))
      let offset = null, pageEpoch = null, lastHost = -Infinity, lastPage = -Infinity, valid = true
      const offsets = [], epochs = []
      for (const a of p.anchors) {
        const okay = [a.hostSendMs, a.hostReceiveMs, a.pageBeforeMs, a.pageAfterMs, a.dateNowMs].every(finite) &&
          a.hostSendMs <= a.hostReceiveMs && a.pageBeforeMs <= a.pageAfterMs && a.hostSendMs >= lastHost && a.pageBeforeMs >= lastPage
        if (!check(okay, 'anchor', 'Original anchor endpoints must be ordered and monotonic')) valid = false
        lastHost = a.hostReceiveMs; lastPage = a.pageAfterMs
        if (!okay) continue
        if (bounded(s.hostMonotonic) && bounded(s.pageMonotonic)) offsets.push({
          lo: q(a.hostSendMs, s.hostMonotonic).lo - q(a.pageBeforeMs, s.pageMonotonic).hi,
          hi: q(a.hostReceiveMs, s.hostMonotonic).hi - q(a.pageAfterMs, s.pageMonotonic).lo,
        })
        if (bounded(s.pageEpoch) && bounded(s.pageMonotonic)) epochs.push({
          lo: q(a.dateNowMs, s.pageEpoch).lo - q(a.pageAfterMs, s.pageMonotonic).hi,
          hi: q(a.dateNowMs, s.pageEpoch).hi - q(a.pageBeforeMs, s.pageMonotonic).lo,
        })
      }
      if (!valid) return null
      if (profile.monotonicRelation === 'unit-offset' && offsets.length === p.anchors.length) offset = intersect(offsets)
      check(!!offset, 'monotonic-unavailable', 'Reviewed page-to-host offset could not be established')
      if (profile.epochRelation === 'constant-offset' && epochs.length === p.anchors.length && epoch && offset && bounded(s.timeOrigin)) {
        pageEpoch = intersect([...epochs, q(p.timeOriginMs, s.timeOrigin), add(offset, epoch)])
      }
      check(!!pageEpoch, 'epoch-unavailable', 'Page epoch mapping needs consistent original anchors and supported timeOrigin bounds')
      pages[key(p)] = { pageId: p.pageId, navigationId: p.navigationId, offset, epoch: pageEpoch,
        // Only observations inside these measured anchor windows are covered.
        pageCoverage: { lo: p.anchors[0].pageAfterMs, hi: p.anchors.at(-1).pageBeforeMs } }
    }
    const hostCoverage = epochAnchors.length >= 2 ? { lo: epochAnchors[0].hostAfterMs, hi: epochAnchors.at(-1).hostBeforeMs } : null
    if (epoch && (!interval(hostCoverage) || hostCoverage.lo > records.runOriginHostMs || hostCoverage.hi < records.runEndHostMs)) {
      check(false, 'epoch-unavailable', 'Host epoch anchors must bracket the run')
      epoch = null
      for (const page of Object.values(pages)) page.epoch = null
    }
    return { hostClockId: records.hostClockId, runId: clockArtifact.payload.runId,
      runOriginHostMs: records.runOriginHostMs, runEndHostMs: records.runEndHostMs,
      hostEpoch: epoch, hostEpochCoverage: hostCoverage, sources: s, pages,
      profileId: runtime.clockProfileId, runtimePolicySha256: expectedRuntimePolicySha256 }
  })
}

function pageFor(records, clocks, check) {
  const page = clocks?.pages?.[key(records)]
  return check(!!page, 'navigation', 'Observation navigation must resolve to a clock mapping') ? page : null
}
function mapTime(value, page, clocks, sourceName = 'pageMonotonic') {
  const observation = q(value, clocks.sources[sourceName])
  if (!observation || !page.offset || value < page.pageCoverage.lo || value > page.pageCoverage.hi) return null
  return add(observation, page.offset)
}
function epochTime(host, clocks) { return host && clocks.hostEpoch && interval(clocks.hostEpochCoverage) && host.lo >= clocks.hostEpochCoverage.lo && host.hi <= clocks.hostEpochCoverage.hi ? add(host, clocks.hostEpoch) : null }
function eventsClear(events, lo, hi) {
  return Array.isArray(events) && events.every(e => finite(e.atMs) && text(e.kind) && (e.atMs < lo || e.atMs > hi))
}

/** Arithmetic consistency is separately reported from physical timing availability. */
export function deriveFramePhases(records, clocks, fixtureDurations) {
  return capture(check => {
    canonicalJson(records)
    const page = pageFor(records, clocks, check)
    if (!page || !check(records.schemaVersion === 1 && Array.isArray(records.callbacks) && records.callbacks.length >= 2 &&
      Array.isArray(records.phases) && records.overflow === false && records.droppedCallbacks === 0, 'frames', 'Complete original callback records required')) return null
    const callbacks = records.callbacks, bySequence = new Map()
    for (let i = 0; i < callbacks.length; i++) {
      const f = callbacks[i], prev = callbacks[i - 1]
      if (!check(Number.isInteger(f.sequence) && !bySequence.has(f.sequence) && [f.gameLastMs, f.metricFrameMs, f.callbackEntryMs, f.callbackExitMs].every(finite) &&
        f.metricFrameMs > 0 && f.callbackEntryMs + ROUND >= f.gameLastMs && f.callbackExitMs + ROUND >= f.callbackEntryMs &&
        Number.isInteger(f.gameTick) && f.gameTick >= 0 && text(f.qualityBeforeSnapshotId) && text(f.qualityAfterSnapshotId) && text(f.conditionSnapshotId) &&
        typeof f.hidden === 'boolean' && typeof f.paused === 'boolean' && finite(f.targetBudgetMs) && f.targetBudgetMs > 0 &&
        (!prev || (f.sequence === prev.sequence + 1 && f.gameLastMs > prev.gameLastMs && f.gameLastMs + ROUND >= prev.callbackExitMs &&
          Math.abs(f.gameLastMs - prev.gameLastMs - f.metricFrameMs) <= ROUND)), 'frame-arithmetic', 'Original callback sequence and game.last subtraction must match metricFrameMs')) return null
      bySequence.set(f.sequence, f)
    }
    const kinds = new Set(), used = new Set(), phases = []
    let priorFinalSequence = -Infinity
    for (const phase of records.phases) {
      const start = bySequence.get(phase.boundarySequence), end = bySequence.get(phase.finalSequence)
      if (!check(['warmup', 'steady', 'transition'].includes(phase.kind) && !kinds.has(phase.kind) && start && end && phase.finalSequence > phase.boundarySequence && phase.boundarySequence >= priorFinalSequence &&
        finite(phase.requestedDurationMs) && phase.requestedDurationMs > 0 && phase.requestedDurationMs === fixtureDurations[phase.kind],
      'phase-boundary', 'Unique phase kind and observed boundary/final IDs must match fixture')) return null
      kinds.add(phase.kind); priorFinalSequence = phase.finalSequence
      const selected = callbacks.filter(f => f.sequence > start.sequence && f.sequence <= end.sequence)
      const priorEnd = bySequence.get(end.sequence - 1)
      if (!check(end.gameLastMs - start.gameLastMs >= phase.requestedDurationMs && priorEnd.gameLastMs - start.gameLastMs < phase.requestedDurationMs,
        'first-crossing', 'Include the first complete interval crossing requested duration')) return null
      if (!check([start, ...selected].every(f => !f.hidden && !f.paused) && eventsClear(records.events, start.gameLastMs, end.callbackExitMs),
        'frame-events', 'Hidden, paused, reset or error observations invalidate the phase')) return null
      for (const f of selected) { if (!check(!used.has(f.sequence), 'phase-overlap', 'An included interval may belong to only one phase')) return null; used.add(f.sequence) }
      let physicalAvailable = true
      const bounds = [start, ...selected].map(f => mapTime(f.gameLastMs, page, clocks))
      const callbackEnd = mapTime(end.callbackExitMs, page, clocks)
      for (let i = 1; i < bounds.length; i++) if (!bounds[i] || !bounds[i - 1] || sub(bounds[i], bounds[i - 1]).lo <= 0) physicalAvailable = false
      if (!callbackEnd || bounds.some(b => !b)) physicalAvailable = false
      if (bounds[0] && callbackEnd && !check(bounds[0].lo >= clocks.runOriginHostMs && callbackEnd.hi <= clocks.runEndHostMs, 'phase-outside-run', 'Full phase interval must fit the recorded host run boundaries')) physicalAvailable = false
      check(physicalAvailable, 'duration-unavailable', 'Consistent subtraction alone cannot establish positive physical intervals under coarse/unsupported clocks')
      phases.push({ kind: phase.kind, arithmeticValid: true, physicalAvailable,
        boundarySequence: start.sequence, finalSequence: end.sequence,
        observedStartMs: start.gameLastMs, observedEndMs: end.gameLastMs,
        observedDurationMs: end.gameLastMs - start.gameLastMs,
        hostStart: bounds[0], hostEnd: bounds.at(-1), observedCallbackEnd: callbackEnd,
        duration: bounds[0] && bounds.at(-1) ? sub(bounds.at(-1), bounds[0]) : null,
        frames: selected.map(f => ({ at: f.gameLastMs, frameMs: f.metricFrameMs, targetBudgetMs: f.targetBudgetMs, hidden: f.hidden })) })
    }
    if (!check(canonicalJson([...kinds].sort()) === canonicalJson(Object.keys(fixtureDurations).sort()), 'missing-phase', 'Exactly the fixture phases must be present')) return null
    return { runId: clocks.runId, hostClockId: clocks.hostClockId, phases }
  })
}

export function derivePacingControls(records, clocks, requestedDuration = 3000) {
  return capture(check => {
    canonicalJson(records)
    if (!check(records.schemaVersion === 1 && finite(requestedDuration) && requestedDuration >= 3000, 'pacing', 'Approved control duration must retain the existing minimum')) return null
    const derived = {}
    for (const name of ['before', 'after']) {
      const c = records[name], page = pageFor(c, clocks, check)
      if (!page || !check(Array.isArray(c.callbacks) && c.callbacks.length >= 2, 'pacing', 'Original control callbacks required')) return null
      const first = c.callbacks[0], last = c.callbacks.at(-1), gaps = []
      if (!check(first.sequence === c.boundarySequence && last.sequence === c.finalSequence && last.sequence > first.sequence,
        'control-boundary', 'Control boundary and final IDs must identify included original callbacks')) return null
      for (let i = 0; i < c.callbacks.length; i++) {
        const f = c.callbacks[i], prev = c.callbacks[i - 1]
        if (!check(Number.isInteger(f.sequence) && finite(f.rafTimestampMs) && finite(f.observedNowMs) && f.observedNowMs + ROUND >= f.rafTimestampMs && f.hidden === false &&
          (!prev || (f.sequence === prev.sequence + 1 && f.rafTimestampMs > prev.rafTimestampMs)), 'pacing-sequence', 'Contiguous visible original animation callbacks required')) return null
        if (prev) gaps.push(f.rafTimestampMs - prev.rafTimestampMs)
      }
      const durationMs = last.rafTimestampMs - first.rafTimestampMs
      if (!check(durationMs >= requestedDuration && c.callbacks.at(-2).rafTimestampMs - first.rafTimestampMs < requestedDuration &&
        eventsClear(c.events, first.rafTimestampMs, last.observedNowMs), 'pacing-coverage', 'Control must end at first crossing with no visibility/error event')) return null
      const start = mapTime(first.rafTimestampMs, page, clocks, 'raf'), end = mapTime(last.rafTimestampMs, page, clocks, 'raf')
      let physicalAvailable = !!start && !!end
      for (let i = 1; i < c.callbacks.length; i++) {
        const a = mapTime(c.callbacks[i - 1].rafTimestampMs, page, clocks, 'raf'), b = mapTime(c.callbacks[i].rafTimestampMs, page, clocks, 'raf')
        if (!a || !b || sub(b, a).lo <= 0) physicalAvailable = false
      }
      const judged = judgePacing(gaps, records.expectedIntervalMs, durationMs)
      check(judged.valid, 'pacing-rate', 'Derived control intervals fail the existing blank pacing judge')
      check(physicalAvailable, 'duration-unavailable', 'Control physical intervals are not established under the reviewed clock bounds')
      derived[name] = { gaps, durationMs, judged, physicalAvailable, hostStart: start, hostEnd: end,
        utcStart: page.epoch ? epochTime(start, clocks) : null, utcEnd: page.epoch ? epochTime(end, clocks) : null }
    }
    return { runId: clocks.runId, hostClockId: clocks.hostClockId, ...derived }
  })
}

/** Envelopes include uncertainty, not scalar/midpoint ordering. No qualification is granted. */
export function validateSerialIntervals(runs, freezeUtc) {
  return capture(check => {
    const ids = new Set(), domains = new Set(), envelopes = [], groups = new Map()
    if (!check(Array.isArray(runs) && runs.length > 0, 'serial', 'Derived run intervals required')) return null
    let serialAvailable = true, freezeAvailable = true
    for (const r of runs) {
      if (!check(text(r.runId) && !ids.has(r.runId) && text(r.hostClockId) && ['calibration', 'comparison'].includes(r.collection) &&
        text(r.scene) && Number.isInteger(r.pair) && r.pair >= 0 && [0, 1].includes(r.position) && ['baseline', 'candidate'].includes(r.side), 'serial-shape', 'Unique run identity and pair metadata required')) return null
      ids.add(r.runId); domains.add(r.hostClockId)
      if (!check([r.before?.start, r.before?.end, r.run?.start, r.run?.end, r.after?.start, r.after?.end].every(interval), 'serial-unavailable', 'All conservative host endpoint intervals required')) return null
      const ordered = [r.before, r.run, r.after].every(w => w.start.hi <= w.end.lo) && r.before.end.hi <= r.run.start.lo && r.run.end.hi <= r.after.start.lo
      if (!check(ordered, 'serial-overlap', 'Full endpoint intervals must prove before/run/after order')) serialAvailable = false
      envelopes.push({ ...r, start: r.before.start, end: r.after.end })
      if (!interval(freezeUtc) || !interval(r.utcStart) || !interval(r.utcEnd)) {
        check(false, 'freeze-unavailable', 'UTC freeze ordering requires qualified epoch mappings'); freezeAvailable = false
      } else if (!check(r.collection === 'calibration' ? r.utcEnd.hi <= freezeUtc.lo : r.utcStart.lo > freezeUtc.hi, 'freeze-order', 'Calibration must finish before freeze and comparison start afterwards')) freezeAvailable = false
      const groupKey = JSON.stringify([r.collection, r.scene]), list = groups.get(groupKey) ?? []
      list.push(r); groups.set(groupKey, list)
    }
    if (!check(domains.size === 1, 'clock-domain', 'Serial proof cannot compare unrelated host monotonic domains')) return null
    // Check both collections together where they share one monotonic domain; no scene overlap is allowed.
    envelopes.sort((a, b) => a.start.lo - b.start.lo)
    for (let i = 1; i < envelopes.length; i++) if (!check(envelopes[i - 1].end.hi <= envelopes[i].start.lo, 'serial-overlap', 'Scene envelopes overlap or uncertainty prevents separation')) serialAvailable = false
    for (const list of groups.values()) {
      list.sort((a, b) => a.before.start.lo - b.before.start.lo)
      for (let i = 0; i < list.length; i++) {
        const r = list[i], pair = Math.floor(i / 2), position = i % 2
        if (!check(r.pair === pair && r.position === position && r.side === (position === pair % 2 ? 'baseline' : 'candidate'), 'pair-order', 'Observed serial order must alternate AB/BA pairs')) serialAvailable = false
      }
      if (!check(list.length >= 6 && list.length % 2 === 0, 'pairs', 'Three complete alternating pairs remain required')) serialAvailable = false
    }
    return { serialAvailable, freezeAvailable }
  })
}

export function deriveFrameMetrics(phases) {
  return capture(check => {
    if (!check(Array.isArray(phases) && phases.length > 0, 'metrics', 'Derived phases required')) return null
    const metrics = []
    for (const phase of phases) {
      if (!check(phase.arithmeticValid === true && Array.isArray(phase.frames) && phase.frames.length > 0 && phase.frames.every(f => finite(f.frameMs) && f.frameMs > 0 && f.hidden === false && finite(f.targetBudgetMs) && f.targetBudgetMs > 0),
        'metrics', 'Metrics require complete arithmetic-consistent original samples')) return null
      const summary = summarizeFrames(phase.frames), sorted = phase.frames.map(f => f.frameMs).sort((a, b) => a - b)
      metrics.push({ kind: phase.kind, physicalAvailable: phase.physicalAvailable === true,
        label: 'observed-clock-arithmetic-only', medianMs: summary.p50, p95Ms: sorted[Math.floor(sorted.length * .95)],
        p99Ms: summary.p99, stalls: summary.over2x, maxStallMs: summary.max, samples: summary.frames,
        durationMs: phase.observedDurationMs })
    }
    return { metrics, unsupported: ['resource', 'startup', 'transfer', 'conditions', 'runtime-authenticity', 'closure', 'measurement-eligibility'] }
  })
}
