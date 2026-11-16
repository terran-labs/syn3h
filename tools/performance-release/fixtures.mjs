/** Synthetic milliseconds and bytes only. These are not Syn3h measurements or proposed tolerances. */
import { sha256, hashRun } from './index.mjs'
export const syntheticMetrics = ['medianMs', 'p95Ms', 'p99Ms', 'stalls', 'maxStallMs', 'coldStartupMs', 'warmStartupMs', 'transferBytes']
const build = (version, digit) => ({ version, commit: digit.repeat(40), artifactSha256: digit.repeat(64) })
export function syntheticEvidence() {
  const baseline = build('synthetic-A', 'a'), candidate = build('synthetic-B', 'b')
  const collectorSha256 = 'c'.repeat(64)
  const fixture = { schemaVersion: 1, description: 'Synthetic fixture; no real browser or production timings', scenes: {
    drive: { conditions: {
      hardware: 'synthetic', os: 'synthetic', browser: 'synthetic 1', backend: 'webgpu',
      viewport: [800, 600], backing: [800, 600], dpr: 1, refreshHz: 50,
      quality: { level: 3, auto: false, settings: { scale: 1 } }, seed: 'synthetic', camera: 'fixed', clock: 'noon',
      actors: { bots: 0, remotes: 0 }, collectorSha256,
      instrumentation: { method: 'generated fixture', overheadMs: null, limitation: 'No physical measurement' },
    }, inputTrace: [{ at: 0, throttle: .5 }], startupMethod: 'synthetic usable-play predicate', transferMethod: 'synthetic gzip transfer', phaseDurations: { warmup: 5000, steady: 60000 } },
  } }
  const fixtureSha256 = sha256(fixture)
  const conditions = { drive: { ...fixture.scenes.drive.conditions, fixtureSha256, inputTraceSha256: sha256(fixture.scenes.drive.inputTrace) } }
  function runs(calibration) {
    const result = []
    for (let pair = 0; pair < 3; pair++) for (let position = 0; position < 2; position++) {
      const side = position === pair % 2 ? 'baseline' : 'candidate'
      const start = Date.UTC(2026, 0, calibration ? 1 : 3, 0, (pair * 2 + position) * 2)
      const r = { id: `${calibration ? 'cal' : 'run'}-${pair}-${side}`, scene: 'drive', pair, position, side,
        startedAt: new Date(start).toISOString(), endedAt: new Date(start + 65000).toISOString(),
        observedBuild: calibration || side === 'baseline' ? baseline : candidate, conditions: structuredClone(conditions.drive),
        pacingBefore: { durationMs: 3000, gaps: Array(150).fill(20) }, pacingAfter: { durationMs: 3000, gaps: Array(150).fill(20) },
        phases: [phase('warmup', 0, 5000, 20), phase('steady', 5000, 60000, 20)],
        startup: { coldMs: 1000, warmMs: 500, method: 'synthetic usable-play predicate', coldCacheVerified: true, usablePlayVerified: true },
        transfer: { bytes: 1000000, method: 'synthetic gzip transfer', manifestSha256: (calibration || side === 'baseline' ? 'a' : 'b').repeat(64) },
        errors: [], overflow: false, qualityStable: true,
      }
      r.rawSha256 = hashRun(r); result.push(r)
    }
    return result
  }
  const calibration = { schemaVersion: 1, build: baseline, runs: runs(true) }
  const calibrationSha256 = sha256(calibration)
  const policy = { id: 'synthetic-policy-NOT-production', frozenAt: '2026-01-02T00:00:00.000Z', calibrationSha256,
    cells: { 'drive/steady': Object.fromEntries(syntheticMetrics.map(m => [m, { absolute: m === 'transferBytes' ? 100 : m === 'stalls' ? 0 : 1, relative: 0, noiseMultiplier: 1 }])) } }
  const input = { schemaVersion: 1, builds: { baseline, candidate }, fixture, calibration, conditions, policy, runs: runs(false), limitations: ['Synthetic test data only.'] }
  const expected = { baseline, candidate, requiredScenes: ['drive'], reviewedPolicySha256: sha256(policy), calibrationSha256, fixtureSha256, collectorSha256 }
  return { input, expected }
}
export function phase(kind, start, duration, frameMs) {
  const frames = []
  let elapsed = 0
  while (elapsed < duration) { const gap = Math.min(frameMs, duration - elapsed); elapsed += gap; frames.push({ at: start + elapsed, frameMs: gap, targetBudgetMs: 20, hidden: false }) }
  return { kind, startedAtMs: start, endedAtMs: start + duration, expectedDurationMs: duration, complete: true, frames }
}
export function reseal(input) { for (const r of input.runs) r.rawSha256 = hashRun(r) }
