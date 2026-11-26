// tools/analytics-report.mjs. Each test names the bug it catches.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventSql, main, sinceSql, summarize } from './analytics-report.mjs'

// Bug: counting rows instead of weighting by _sample_interval, which undercounts once
// Analytics Engine samples.
test('a sampled row counts as many as its sample interval', () => {
  const r = summarize({
    session_start: [{ timestamp: '2026-11-26 10:00:00', si: 10, aid: 'a'.repeat(32), country: 'NZ', continent: 'OC', device: 'phone', backend: 'webgpu', roomKind: 'public', ref: 'email' }],
    session_end: [{ timestamp: '2026-11-26 10:05:00', si: 10, recipe: 'alpine', seconds: 300, activeSeconds: 200, count: 1 }],
    vehicle: [{ si: 10, kind: 'jet', seconds: 300 }],
    presence: [{ timestamp: '2026-11-26 10:01:00', si: 2, players: 5, active: 4 }],
  })
  assert.equal(r.sessions, 10)
  assert.equal(r.playSeconds, 3000)
  assert.deepEqual(r.countries, [['NZ', 10]])
  assert.deepEqual(r.refs, [['email', 10]])
  assert.deepEqual(r.vehicles, [['jet', 3000]])
  assert.equal(r.peak, 10)
  assert.deepEqual(r.health.find(([k]) => k === 'rejoins'), ['rejoins', 10])
})

// Bug: returning players counted from the window only, so everyone looks new.
test('returning players are ids first seen on an earlier day', () => {
  const a = 'a'.repeat(32), b = 'b'.repeat(32)
  const r = summarize({ session_start: [
    { timestamp: '2026-11-26 09:00:00', si: 1, aid: a }, { timestamp: '2026-11-26 09:00:00', si: 1, aid: b },
    { timestamp: '2026-11-27 09:00:00', si: 1, aid: a },
  ] }, new Map([[a, '2026-11-20 08:00:00'], [b, '2026-11-26 09:00:00']]))
  assert.deepEqual(r.days, [{ day: '2026-11-26', uniques: 2, returning: 1 }, { day: '2026-11-27', uniques: 1, returning: 1 }])
})

// Bug: SQL injection through the window, or an unbounded query.
test('builds bounded queries only from known shapes', () => {
  assert.equal(sinceSql('24h'), "NOW() - INTERVAL '24' HOUR")
  assert.equal(sinceSql('2026-11-25'), "toDateTime('2026-11-25 00:00:00')")
  assert.throws(() => sinceSql("1d'; DROP"))
  assert.match(eventSql('crash', '7d', 'beta'), /blob1 = 'crash' AND timestamp >= NOW\(\) - INTERVAL '7' DAY AND blob2 = 'beta' LIMIT 200000 FORMAT JSON$/)
})

// Bug: the token printed, or a refused permission reported as an empty report.
test('never prints the token, and says which permission is missing', async () => {
  const token = 'secret-token-value-do-not-print'
  const lines = []
  const fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${token}`)
    if (String(url).includes('/zones?')) return new Response(JSON.stringify({ result: [{ id: 'zone1', account: { id: 'acct1' } }] }))
    if (String(url).includes('/graphql')) return new Response(JSON.stringify({ errors: [{ message: 'not authorized for that zone' }] }))
    return new Response(JSON.stringify({ errors: [{ message: 'Authentication error' }] }), { status: 403 })
  }
  await assert.rejects(main(['--since', '24h'], fetcher, (l) => lines.push(l), token), (e) => {
    assert.match(e.message, /Account \| Account Analytics \| Read/)
    assert.doesNotMatch(e.message, new RegExp(token))
    return true
  })
  const ok = async (url) => {
    if (String(url).includes('/zones?')) return new Response(JSON.stringify({ result: [{ id: 'zone1', account: { id: 'acct1' } }] }))
    if (String(url).includes('/graphql')) return new Response(JSON.stringify({ errors: [{ message: 'not authorized for that zone' }] }))
    return new Response(JSON.stringify({ data: [] }))
  }
  assert.equal(await main(['--since', '24h'], ok, (l) => lines.push(l), token), 0)
  const out = lines.join('\n')
  assert.doesNotMatch(out, new RegExp(token))
  assert.match(out, /Zone \| Analytics \| Read/)
  assert.equal(await main([], ok, (l) => lines.push(l), ''), 1)
})

// Bug: device shares counted by rows instead of sampled weight, or GPU strings too fine to group.
test('devices and rendering: weighted shares, model families, median frame time by family', async () => {
  const { summarizeDevices, modelFamily } = await import('./analytics-report.mjs')
  assert.equal(modelFamily('GeForce RTX 4070'), 'GeForce RTX')
  assert.equal(modelFamily('Apple M2 Max'), 'Apple M2')
  assert.equal(modelFamily(''), '(not given)')
  const d = summarizeDevices([
    { si: 10, gpuVendor: 'apple', gpuModel: 'Apple M2 Max', gpuSource: 'webgpu', features: 'f32f,ts', memoryGB: 0 },
    { si: 1, gpuVendor: 'nvidia', gpuModel: 'GeForce RTX 4070', gpuSource: 'webgl', backendReason: 'adapter-missing', features: '', memoryGB: 16 },
  ], [
    { si: 10, gpuVendor: 'apple', gpuModel: 'Apple M2 Max', settledLevel: 4, medianMs: 8 },
    { si: 1, gpuVendor: 'nvidia', gpuModel: 'GeForce RTX 4070', settledLevel: 2, medianMs: 16 },
  ])
  assert.deepEqual(d.vendor.rows[0], ['apple', 10, 10 / 11])
  assert.equal(d.highOrAbove, 10 / 11)
  assert.deepEqual(d.features, [['f32f', 10, 1], ['ts', 10, 1]])
  assert.deepEqual(d.frameByFamily[0], ['apple: Apple M2', 8, 10])
  assert.ok(d.memory.rows.some(([k]) => k.startsWith('not reported')))
})
