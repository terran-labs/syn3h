import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { archive, archivedVersions, bareVersion, carry, check, mapPool, retrying } from './frozen-versions.mjs'
import { findForbidden } from './check-shipped-assets.mjs'
import { draftNotes, frozenUrl } from './release-notes.mjs'
import { parseHistory } from './lib/release-version.mjs'

/** A frozen copy holding a tiny built site whose page names its own version. */
function build(root, name, mark) {
  const copy = join(root, name)
  mkdirSync(join(copy, 'dist', 'assets'), { recursive: true })
  mkdirSync(join(copy, 'dist', 'brand'), { recursive: true })
  writeFileSync(join(copy, 'dist', 'index.html'), `<title>${mark}</title>`)
  writeFileSync(join(copy, 'dist', 'build.json'), JSON.stringify({ mark }))
  writeFileSync(join(copy, 'dist', 'assets', `app-${mark}.js`), mark)
  writeFileSync(join(copy, 'dist', 'assets', `app-${mark}.js.map`), 'map')
  writeFileSync(join(copy, 'dist', 'brand', 'share.png'), 'png')
  writeFileSync(join(copy, 'dist', '.assetsignore'), '*.map\n')
  writeFileSync(join(copy, 'dist', 'releases.json'), JSON.stringify({ releases: [{ version: mark }] }))
  return copy
}

test('each release carries itself and every archived release, and only acceptance archives', () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-'))
  try {
    const store = join(root, 'versions')
    const first = build(root, 'first', 'one')
    assert.deepEqual(carry(first, 'v26.11.1503', store), ['26.11.1503'])
    assert.equal(readFileSync(join(first, 'dist/v/26.11.1503/index.html'), 'utf8'), '<title>one</title>')
    assert.ok(!existsSync(join(first, 'dist/v/26.11.1503/assets/app-one.js.map')), 'source maps are not carried')
    assert.ok(!existsSync(join(first, 'dist/v/26.11.1503/releases.json')), 'the Updates feed is the live site\'s, never carried')
    assert.ok(!existsSync(join(first, 'dist/v/26.11.1503/v')), 'a frozen version never nests the others')
    assert.deepEqual(archivedVersions(store), [], 'carrying alone archives nothing: a dry run or rollback leaves no trace')
    archive(first, 'v26.11.1503', store)
    assert.deepEqual(archivedVersions(store), ['26.11.1503'])

    const second = build(root, 'second', 'two')
    assert.deepEqual(carry(second, 'v26.11.1600', store), ['26.11.1503', '26.11.1600'])
    assert.equal(readFileSync(join(second, 'dist/v/26.11.1503/assets/app-one.js'), 'utf8'), 'one')
    assert.equal(readFileSync(join(second, 'dist/v/26.11.1600/index.html'), 'utf8'), '<title>two</title>')
    assert.deepEqual(JSON.parse(readFileSync(join(second, 'dist/v/versions.json'), 'utf8')).versions, ['26.11.1503', '26.11.1600'])
    // Carrying twice (a dry run, then the release) gives the same result, not a nested copy.
    assert.deepEqual(carry(second, 'v26.11.1600', store), ['26.11.1503', '26.11.1600'])
    assert.ok(!existsSync(join(second, 'dist/v/26.11.1600/v')))

    // An accepted release is what a judge was promised: it is never replaced.
    assert.throws(() => archive(second, 'v26.11.1503', store), /never replaced/)
    assert.equal(readFileSync(join(store, '26.11.1503/index.html'), 'utf8'), '<title>one</title>')

    // The bitmap rule judges the new build, not the frozen ones it carries.
    assert.deepEqual(findForbidden(join(second, 'dist')).images, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('versions are written one way', () => {
  assert.equal(bareVersion('v26.11.1503'), '26.11.1503')
  assert.equal(bareVersion('26.11.1503'), '26.11.1503')
  assert.throws(() => bareVersion('../../etc'), /not a version/)
  assert.throws(() => bareVersion('release-7'), /not a version/)
})

test('production notes link the playable frozen version', () => {
  assert.equal(frozenUrl('v26.11.1503'), 'https://www.syn3h.com/?v=26.11.1503')
  const [row] = parseHistory('v26.11.1600\tm20\tabc1234\t2026-11-16 09:00 PST\tproduction\n')
  assert.match(draftNotes(row, 'a', 'b', []), /https:\/\/www\.syn3h\.com\/\?v=26\.11\.1600/)
})

test('a transport error, a 5xx or a 429 is retried, at most three attempts', async () => {
  const answers = [() => { throw new Error('fetch failed') }, () => ({ status: 503 }), () => ({ status: 200 })]
  const slept = [], logged = []
  const got = await retrying('https://x/a.js', async () => answers.shift()(), { sleep: async (ms) => { slept.push(ms) }, log: (line) => logged.push(line) })
  assert.equal(got.status, 200)
  assert.deepEqual(slept, [1000, 3000])
  assert.equal(logged.length, 2)
  assert.ok(logged.every((line) => line.includes('https://x/a.js')))
  // Still failing after three attempts: the last answer stands, or the last error is thrown.
  assert.equal((await retrying('u', async () => ({ status: 429 }), { sleep: async () => {}, log() {} })).status, 429)
  await assert.rejects(retrying('u', async () => { throw new Error('reset') }, { sleep: async () => {}, log() {} }), /reset/)
})

test('a 429 waits at least its Retry-After, capped at a minute', async () => {
  const slept = []
  const answers = [{ status: 429, retryAfter: '7' }, { status: 429, retryAfter: '900' }, { status: 200 }]
  await retrying('u', async () => answers.shift(), { sleep: async (ms) => { slept.push(ms) }, log() {} })
  assert.deepEqual(slept, [7000, 60000])
})

test('a 404 or any other answer is final at once', async () => {
  let calls = 0
  const slept = []
  const got = await retrying('u', async () => { calls++; return { status: 404 } }, { sleep: async (ms) => { slept.push(ms) }, log() {} })
  assert.equal(got.status, 404)
  assert.equal(calls, 1)
  assert.deepEqual(slept, [])
})

test('the pool never runs more than its limit at once and keeps results in order', async () => {
  let running = 0, most = 0
  const out = await mapPool([...Array(40).keys()], 16, async (i) => {
    most = Math.max(most, ++running)
    await new Promise((done) => setTimeout(done, 2))
    running--
    return i * 2
  })
  assert.equal(most, 16)
  assert.deepEqual(out, [...Array(40).keys()].map((i) => i * 2))
})

/**
 * A site that answers like server/worker.ts: /?v=<version> is that release's page, a file is
 * looked up in the version its Referer names, then in the latest build, then in any frozen
 * version. `faults` changes what it serves.
 */
async function site(copy, faults = {}) {
  const frozen = join(copy, 'dist', 'v')
  const { versions } = JSON.parse(readFileSync(join(frozen, 'versions.json'), 'utf8'))
  const read = (path) => { try { return readFileSync(path) } catch { return null } }
  const seen = { requests: 0, heads: 0, limited: 0 }
  const server = createServer((req, res) => {
    seen.requests++
    if (req.method === 'HEAD') seen.heads++
    const url = new URL(req.url, 'http://x')
    if (faults.limitOnce && !seen.limited++) { res.writeHead(429, { 'retry-after': '1' }); return res.end() }
    let body = null, version = null
    if (url.pathname === '/') {
      const v = url.searchParams.get('v')?.replace(/^v/, '')
      if (v && !versions.includes(v)) { res.writeHead(404); return res.end() }
      version = v ?? null
      body = read(v ? join(frozen, v, 'index.html') : join(copy, 'dist', 'index.html'))
    } else {
      const file = url.pathname.slice(1)
      const v = new URL(req.headers.referer ?? 'http://x/').searchParams.get('v')
      const dropped = (w) => faults.drop === `${w}/${file}` || faults.drop === `*/${file}`
      const swap = (bytes, w) => (faults.swap === `${w}/${file}` && bytes ? Buffer.from(bytes.toString().replace(/./, '#')) : bytes)
      if (v && !dropped(v)) { body = swap(read(join(frozen, v, file)), v); version = v }
      if (!dropped('latest')) body ??= read(join(copy, 'dist', file))
      for (const w of versions) if (!body && !dropped(w)) body = read(join(frozen, w, file))
    }
    if (!body) { res.writeHead(404); return res.end() }
    const headers = { etag: '"e"', ...(version ? { 'x-syn3h-version': version } : {}) }
    if (faults.noLength && req.method === 'HEAD') headers['transfer-encoding'] = 'chunked'
    else headers['content-length'] = body.length
    if (req.headers['if-none-match'] === '"e"') { res.writeHead(304, headers); return res.end() }
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${server.address().port}/`, seen, close: () => new Promise((done) => server.close(done)) }
}

/** Two archived releases and a new one, whose build.json differ at the same size. */
function released(root) {
  const store = join(root, 'versions')
  for (const [name, mark, v] of [['a', 'one', '26.11.1503'], ['b', 'two', '26.11.1600']]) {
    const copy = build(root, name, mark)
    carry(copy, v, store)
    archive(copy, v, store)
  }
  const copy = build(root, 'c', 'six')
  writeFileSync(join(copy, 'dist', 'assets', 'big-Ab12Cd34.bin'), Buffer.alloc(4096, 7))
  carry(copy, 'v26.11.1700', store)
  return { copy, store }
}

test('the frozen check passes a correct site and hashes only what size cannot tell apart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-check-'))
  const { copy, store } = released(root)
  const s = await site(copy)
  try {
    const quick = await check(s.url, copy, { archive: store })
    assert.deepEqual(quick.problems, [])
    assert.deepEqual(quick.stats.fresh, ['26.11.1700'])
    // Archived releases: build.json differs between them at one size, so it is hashed; their
    // brand image is the same everywhere and their scripts have their own names, so sized.
    // Everything of the new release is hashed.
    assert.equal(quick.stats.files, 10)
    assert.equal(quick.stats.hashed, 2 + 4)
    assert.equal(quick.stats.sized, 4)
    const full = await check(s.url, copy, { archive: store, full: true })
    assert.deepEqual(full.problems, [])
    assert.equal(full.stats.hashed, 10)
  } finally { await s.close(); rmSync(root, { recursive: true, force: true }) }
})

test('the frozen check fails loudly on a missing file or a wrong one, in quick and full modes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-check-'))
  const { copy, store } = released(root)
  try {
    for (const faults of [{ drop: '26.11.1503/assets/app-one.js' }, { drop: '*/assets/big-Ab12Cd34.bin' }]) {
      const s = await site(copy, faults)
      try {
        for (const full of [false, true]) {
          const { problems } = await check(s.url, copy, { archive: store, full })
          assert.equal(problems.length, 1, `${JSON.stringify(faults)} full=${full}: ${problems}`)
          assert.match(problems[0], /HTTP 404/)
        }
      } finally { await s.close() }
    }
    // Same size, other bytes, where only a hash can tell: build.json of an archived release.
    const s = await site(copy, { swap: '26.11.1503/build.json' })
    try {
      const { problems } = await check(s.url, copy, { archive: store })
      assert.equal(problems.length, 1)
      assert.match(problems[0], /\/build\.json asked by the 26\.11\.1503 page/)
    } finally { await s.close() }
    // A dropped archived file that another version serves at another size.
    writeFileSync(join(copy, 'dist', 'v', '26.11.1503', 'brand', 'share.png'), 'png-longer')
    const t = await site(copy, { drop: '26.11.1503/brand/share.png' })
    try {
      const { problems } = await check(t.url, copy, { archive: store })
      assert.equal(problems.length, 1)
      assert.match(problems[0], /\/brand\/share\.png asked by the 26\.11\.1503 page .*want 10\)/)
    } finally { await t.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a HEAD without a length falls back to a GET, and a 429 backs off and passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-check-'))
  const { copy, store } = released(root)
  try {
    const s = await site(copy, { noLength: true })
    try {
      const { problems, stats } = await check(s.url, copy, { archive: store })
      assert.deepEqual(problems, [])
      assert.equal(stats.hashed, 10)
    } finally { await s.close() }
    const t = await site(copy, { limitOnce: true })
    try {
      const started = Date.now()
      assert.deepEqual((await check(t.url, copy, { archive: store })).problems, [])
      assert.ok(Date.now() - started >= 1000, 'the 429 held the check for its Retry-After')
    } finally { await t.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
