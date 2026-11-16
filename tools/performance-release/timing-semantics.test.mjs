/** Source-only prepared tests; execution requires a separate allocation. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256 } from './index.mjs'
import { validateClockMappings, deriveFramePhases, derivePacingControls, validateSerialIntervals, deriveFrameMetrics } from './timing-semantics.mjs'

const epoch = 1700000000000
const bound = (lo = 0, hi = 0) => ({ mode: 'bounded', errorLoMs: lo, errorHiMs: hi, evidenceSha256: 'a'.repeat(64), evidenceDescription: 'Synthetic exact clock, not a real runtime guarantee' })
function clockFixture() {
  const profile = { schemaVersion: 1, hostClockId: 'synthetic-host', environment: { browser: 'synthetic' }, monotonicRelation: 'unit-offset', epochRelation: 'constant-offset',
    sources: Object.fromEntries(['hostMonotonic', 'hostEpoch', 'pageMonotonic', 'pageEpoch', 'timeOrigin', 'raf'].map(s => [s, bound()])) }
  const runtimePolicy = { executablesAndConfiguration: { clockProfiles: { exact: profile } } }
  const expectedRuntimePolicySha256 = sha256(runtimePolicy)
  const runtimeArtifact = { schemaVersion: 1, kind: 'runtime', payload: { runId: 'run', records: {
    clockProfileId: 'exact', runtimePolicySha256: expectedRuntimePolicySha256, clockEnvironment: { browser: 'synthetic' },
  } }, references: [], blobs: [] }
  const ref = { sha256: sha256(runtimeArtifact), kind: 'runtime' }
  const anchors = [0, 100000].map(t => ({ hostSendMs: t, hostReceiveMs: t, pageBeforeMs: t, pageAfterMs: t, dateNowMs: epoch + t }))
  const clockArtifact = { schemaVersion: 1, kind: 'clocks', payload: { runId: 'run', records: {
    schemaVersion: 1, runtimeRef: ref, hostClockId: 'synthetic-host', runOriginHostMs: 0, runEndHostMs: 90000,
    hostEpochAnchors: [0, 100000].map(t => ({ hostBeforeMs: t, hostAfterMs: t, utcMs: epoch + t })),
    pages: [{ pageId: 'page', navigationId: 'nav', timeOriginMs: epoch, anchors }],
  } }, references: [ref], blobs: [] }
  return { clockArtifact, context: { runtimeArtifact, runtimePolicy, expectedRuntimePolicySha256 } }
}
function reseal(f) {
  f.context.expectedRuntimePolicySha256 = sha256(f.context.runtimePolicy)
  f.context.runtimeArtifact.payload.records.runtimePolicySha256 = f.context.expectedRuntimePolicySha256
  const ref = { sha256: sha256(f.context.runtimeArtifact), kind: 'runtime' }
  f.clockArtifact.payload.records.runtimeRef = ref; f.clockArtifact.references = [ref]
}
function maps(f = clockFixture()) { const r = validateClockMappings(f.clockArtifact, f.context); assert.ok(r.derived, JSON.stringify(r)); return r.derived }
function frameFixture(gaps = [20, 20, 20]) {
  let at = 100
  const callback = (sequence, gap) => ({ sequence, gameLastMs: at, metricFrameMs: gap, callbackEntryMs: at + 1, callbackExitMs: at + 2,
    gameTick: sequence, hidden: false, paused: false, targetBudgetMs: 20, qualityBeforeSnapshotId: 'before', qualityAfterSnapshotId: 'after', conditionSnapshotId: 'condition' })
  const callbacks = [callback(10, 20)]
  for (const gap of gaps) { at += gap; callbacks.push(callback(callbacks.at(-1).sequence + 1, gap)) }
  return { schemaVersion: 1, pageId: 'page', navigationId: 'nav', callbacks,
    phases: [{ kind: 'steady', requestedDurationMs: gaps.reduce((a,b)=>a+b,0), boundarySequence: 10, finalSequence: callbacks.at(-1).sequence }], events: [], overflow: false, droppedCallbacks: 0 }
}
function phases(records, m = maps()) { return deriveFramePhases(records, m, { steady: records.phases[0].requestedDurationMs }) }
function has(r, code) { assert.ok(r.issues.some(i => i.code === code), JSON.stringify(r)) }
const pacingPolicy = { expectedIntervalMs: 20, requestedDurationMs: 3000 }
function inventory(runs) { return { runIds: runs.map(r => r.runId), scenes: ['drive'] } }
function control(start, sequence = 0) {
  return { pageId: 'page', navigationId: 'nav', boundarySequence: sequence, finalSequence: sequence + 150,
    callbacks: Array.from({ length: 151 }, (_, i) => ({ sequence: sequence + i, rafTimestampMs: start + i * 20, observedNowMs: start + i * 20 + 1, hidden: false })), events: [] }
}
function serialFixture() {
  return ['calibration', 'comparison'].flatMap(collection => Array.from({ length: 6 }, (_, i) => {
    const start = i * 10000 + (collection === 'calibration' ? -70000 : 0), point = v => ({ lo: v, hi: v }), pair = Math.floor(i / 2), position = i % 2
    return { runId: `${collection}${i}`, hostClockId: 'host', collection, scene: 'drive', pair, position, side: position === pair % 2 ? 'baseline' : 'candidate',
      before: { start: point(start), end: point(start + 3000) }, run: { start: point(start + 3001), end: point(start + 6000) }, after: { start: point(start + 6001), end: point(start + 9001) },
      utcStart: point(epoch + start), utcEnd: point(epoch + start + 9001) }
  }))
}

test('clock profile binds same-run runtime reference and trusted policy, not a submitted standalone bound', () => {
  const f = clockFixture(), good = validateClockMappings(f.clockArtifact, f.context)
  assert.equal(good.issues.length, 0); assert.equal(good.qualified, false); assert.equal(good.promotion, 'blocked')
  f.context.runtimeArtifact.payload.runId = 'other'
  has(validateClockMappings(f.clockArtifact, f.context), 'profile-binding')
  const g = clockFixture(); g.context.runtimePolicy.executablesAndConfiguration.clockProfiles.exact.sources.hostEpoch = bound(-100,100)
  has(validateClockMappings(g.clockArtifact, g.context), 'profile-binding')
  const h = clockFixture(); h.clockArtifact.references = []
  has(validateClockMappings(h.clockArtifact, h.context), 'profile-binding')
})
test('unknown epoch bounds leave monotonic mappings usable but epoch unavailable', () => {
  const f = clockFixture(); f.context.runtimePolicy.executablesAndConfiguration.clockProfiles.exact.sources.hostEpoch = { mode: 'unavailable' }; reseal(f)
  const r = validateClockMappings(f.clockArtifact, f.context)
  has(r, 'epoch-unavailable'); assert.equal(r.derived.hostEpoch, null)
  assert.ok(Object.values(r.derived.pages)[0].offset)
})
test('epoch drift and wrong navigation/timeOrigin cannot become qualified UTC', () => {
  const f = clockFixture(); f.clockArtifact.payload.records.hostEpochAnchors[1].utcMs += 10
  const r = validateClockMappings(f.clockArtifact, f.context); has(r, 'epoch-unavailable'); assert.equal(r.derived.hostEpoch, null)
  const g = clockFixture(); g.clockArtifact.payload.records.pages[0].timeOriginMs += 10
  has(validateClockMappings(g.clockArtifact, g.context), 'epoch-unavailable')
  const records = frameFixture(); records.navigationId = 'wrong'
  has(phases(records), 'navigation')
})
test('reviewed truncation enclosure differs from invented nearest rounding', () => {
  const f = clockFixture(), p = f.context.runtimePolicy.executablesAndConfiguration.clockProfiles.exact
  p.sources.hostEpoch = bound(0, 1); p.sources.pageEpoch = bound(0, 1)
  f.clockArtifact.payload.records.hostEpochAnchors.forEach(a => { a.utcMs -= .8 })
  f.clockArtifact.payload.records.pages[0].anchors.forEach(a => { a.dateNowMs -= .8 })
  reseal(f)
  assert.ok(Object.values(maps(f).pages)[0].epoch)
  p.sources.hostEpoch = bound(-.5, .5); p.sources.pageEpoch = bound(-.5, .5); reseal(f)
  has(validateClockMappings(f.clockArtifact, f.context), 'epoch-unavailable')
})
test('original frame arithmetic and long intervals are retained, independent of callback completion', () => {
  const records = frameFixture([20, 1200, 20]), r = phases(records)
  assert.equal(r.issues.length, 0)
  const metrics = deriveFrameMetrics(r.derived.phases)
  assert.equal(metrics.derived.metrics[0].maxStallMs, 1200)
  assert.equal(metrics.derived.metrics[0].stalls, 1); assert.equal(metrics.promotion, 'blocked')
  records.callbacks[1].callbackEntryMs += 3; records.callbacks[1].callbackExitMs += 3
  assert.equal(deriveFrameMetrics(phases(records).derived.phases).derived.metrics[0].maxStallMs, 1200)
})
test('coarse clock can pass observed arithmetic while physical intervals remain unavailable', () => {
  const f = clockFixture(), p = f.context.runtimePolicy.executablesAndConfiguration.clockProfiles.exact
  p.sources.pageMonotonic = bound(-50, 50); reseal(f)
  const r = phases(frameFixture(), maps(f))
  assert.equal(r.derived.phases[0].arithmeticValid, true)
  assert.equal(r.derived.phases[0].physicalAvailable, false); has(r, 'duration-unavailable')
})
test('missing/repeated callbacks, contradictory frameMs and non-first crossing fail', () => {
  for (const mutate of [r => { r.callbacks[1].sequence++ }, r => { r.callbacks[1].metricFrameMs++ }, r => { r.callbacks.pop() }, r => { r.phases[0].requestedDurationMs = 20 }]) {
    const r = frameFixture(); mutate(r); assert.equal(phases(r).derived, null)
  }
})
test('hidden and paused flags, event-only resets, duplicate phase IDs and dropped data fail', () => {
  for (const mutate of [r => { r.callbacks[1].hidden = true }, r => { r.callbacks[1].paused = true }, r => { r.events.push({ atMs:120, kind:'resume', detail:'reset' }) }, r => { r.phases.push({...r.phases[0]}) }, r => { r.droppedCallbacks=1 }]) {
    const r = frameFixture(); mutate(r); assert.equal(phases(r).derived, null)
  }
})
test('blank controls derive original contiguous gaps and enforce inclusive first crossing', () => {
  const records = { schemaVersion: 1, expectedIntervalMs: 20, before: control(1000), after: control(10000) }
  const r = derivePacingControls(records, maps(), pacingPolicy)
  assert.equal(r.issues.length, 0); assert.equal(r.derived.before.gaps.length, 150); assert.equal(r.derived.before.durationMs, 3000)
  records.before.callbacks.splice(3, 1)
  assert.equal(derivePacingControls(records, maps(), pacingPolicy).derived, null)
  const hidden = { schemaVersion:1, expectedIntervalMs:20, before:control(1000),after:control(10000) }; hidden.before.callbacks[2].hidden=true
  assert.equal(derivePacingControls(hidden,maps(),pacingPolicy).derived,null)
})
test('global serial envelopes use full bounds rather than passing midpoint order', () => {
  const runs = serialFixture(), freeze = { lo: epoch - 1000, hi: epoch - 1000 }
  assert.equal(validateSerialIntervals(runs, freeze, inventory(runs)).derived.serialAvailable, true)
  runs[1].before.start.lo = runs[0].after.end.hi - 1; runs[1].before.start.hi = runs[0].after.end.hi + 2000
  const r = validateSerialIntervals(runs, freeze, inventory(runs)); has(r,'serial-overlap'); assert.equal(r.derived.serialAvailable,false)
})
test('UTC freeze remains unavailable even with valid monotonic serial ordering', () => {
  const runs = serialFixture(); runs[0].utcStart=null; runs[0].utcEnd=null
  const r=validateSerialIntervals(runs,null,inventory(runs))
  assert.equal(r.derived.serialAvailable,true); assert.equal(r.derived.freezeAvailable,false); assert.equal(r.promotion,'blocked')
})
test('all five helpers retain partial blocked status and do not supply startup or transfer values', () => {
  const f=clockFixture(), c=validateClockMappings(f.clockArtifact,f.context), p=phases(frameFixture(),c.derived)
  const results=[c,p,deriveFrameMetrics(p.derived.phases),derivePacingControls({schemaVersion:1,expectedIntervalMs:20,before:control(1000),after:control(10000)},c.derived,pacingPolicy),validateSerialIntervals(serialFixture(),null,inventory(serialFixture()))]
  for(const r of results){assert.equal(r.qualified,false);assert.equal(r.promotion,'blocked')}
  assert.ok(results[2].derived.unsupported.includes('startup'));assert.ok(results[2].derived.unsupported.includes('transfer'))
})
test('pacing target is independently trusted and slow controls cannot redefine it', () => {
  const records = { schemaVersion: 1, expectedIntervalMs: 100, before: control(1000), after: control(10000) }
  has(derivePacingControls(records, maps(), pacingPolicy), 'pacing-target')
  records.expectedIntervalMs = 20
  for (const c of [records.before, records.after]) {
    c.callbacks = c.callbacks.slice(0, 31).map((f,i)=>({...f,rafTimestampMs:c.callbacks[0].rafTimestampMs+i*100,observedNowMs:c.callbacks[0].rafTimestampMs+i*100+1}))
    c.finalSequence = c.boundarySequence + 30
  }
  has(derivePacingControls(records, maps(), pacingPolicy), 'pacing-rate')
  has(derivePacingControls(records, maps()), 'pacing-target')
})
test('outward anchor interiors reject events that only fit by point estimates', () => {
  const f = clockFixture(), p = f.context.runtimePolicy.executablesAndConfiguration.clockProfiles.exact
  p.sources.pageMonotonic = bound(-2,2); reseal(f)
  // Point 100 lies after point anchor99, but the full intervals do not prove containment.
  Object.assign(f.clockArtifact.payload.records.pages[0].anchors[0], { hostSendMs:99,hostReceiveMs:99,pageBeforeMs:99,pageAfterMs:99,dateNowMs:epoch+99 })
  const m = maps(f), r = frameFixture()
  const result = phases(r,m)
  assert.equal(result.derived.phases[0].physicalAvailable,false)
  has(result,'phase-outside-run')
  const g=clockFixture();g.context.runtimePolicy.executablesAndConfiguration.clockProfiles.exact.sources.hostMonotonic=bound(-2,2);reseal(g)
  // Host run start is zero, so anchors at zero cannot prove they bracket its outward interval.
  has(validateClockMappings(g.clockArtifact,g.context),'epoch-unavailable')
})
test('hidden event uncertainty overlapping a phase boundary invalidates that phase', () => {
  const f=clockFixture();f.context.runtimePolicy.executablesAndConfiguration.clockProfiles.exact.sources.pageMonotonic=bound(-2,2);reseal(f)
  const r=frameFixture();r.events=[{atMs:99,kind:'hidden',detail:'point precedes start, enclosure overlaps'}]
  has(phases(r,maps(f)),'frame-events')
})
test('all callback endpoints must fit interior run coverage', () => {
  const f=clockFixture();f.clockArtifact.payload.records.runEndHostMs=161
  const m=maps(f), r=frameFixture()
  const result=phases(r,m)
  // Last game.last=160 fits, but its observed completion=162 does not.
  assert.equal(result.derived.phases[0].physicalAvailable,false);has(result,'phase-outside-run')
})
test('pacing retains final observed completion and rejects unordered observedNow', () => {
  const records={schemaVersion:1,expectedIntervalMs:20,before:control(1000),after:control(10000)}
  records.before.callbacks.at(-1).observedNowMs=4500
  const result=derivePacingControls(records,maps(),pacingPolicy)
  assert.equal(result.derived.before.hostSampleEnd.hi,4000)
  assert.equal(result.derived.before.hostEnd.hi,4500)
  const runs=serialFixture(), r=runs.find(x=>x.collection==='comparison')
  r.before={start:result.derived.before.hostStart,end:result.derived.before.hostEnd}
  has(validateSerialIntervals(runs,{lo:epoch-1000,hi:epoch-1000},inventory(runs)),'serial-overlap')
  records.before.callbacks[1].observedNowMs=5000
  has(derivePacingControls(records,maps(),pacingPolicy),'pacing-sequence')
})
test('both required serial collections and the full reviewed inventory are mandatory', () => {
  const all=serialFixture(), only=all.filter(r=>r.collection==='comparison')
  has(validateSerialIntervals(only,{lo:epoch-1000,hi:epoch-1000},inventory(all)),'missing-collection')
  has(validateSerialIntervals(all,null),'required-inventory')
  const missing=all.slice(1)
  has(validateSerialIntervals(missing,null,inventory(all)),'required-inventory')
})
test('malformed and reversed UTC endpoints never establish serial/freeze success', () => {
  for(const change of [r=>{r.utcStart={lo:5,hi:4}},r=>{r.utcStart={lo:epoch+100,hi:epoch+100};r.utcEnd={lo:epoch,hi:epoch}}]){
    const runs=serialFixture();change(runs[0])
    const result=validateSerialIntervals(runs,{lo:epoch-1000,hi:epoch-1000},inventory(runs))
    assert.equal(result.derived.serialAvailable,false);assert.equal(result.derived.freezeAvailable,false)
    assert.equal(validateSerialIntervals(runs,null,inventory(runs)).derived.serialAvailable,false)
  }
})
