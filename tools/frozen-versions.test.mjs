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
  const seen = { requests: 0, limited: 0 }
  const server = createServer((req, res) => {
    seen.requests++
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
    headers['content-length'] = body.length
    if (req.headers['if-none-match'] === '"e"') { res.writeHead(304, headers); return res.end() }
    res.writeHead(200, headers)
    res.end(body)
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
  return { copy }
}

test('the frozen check passes a correct site, fetching every file once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-check-'))
  const { copy } = released(root)
  const s = await site(copy)
  try {
    const { problems, stats } = await check(s.url, copy)
    assert.deepEqual(problems, [])
    assert.equal(stats.versions, 3)
    assert.equal(stats.files, 10)
    // Two spellings and a repeat visit per page, every file, an unknown version, the plain page.
    assert.equal(stats.requests, 3 * 3 + 10 + 2)
    assert.equal(s.seen.requests, stats.requests)
  } finally { await s.close(); rmSync(root, { recursive: true, force: true }) }
})

test('the frozen check fails loudly on a missing file, a wrong size or the wrong bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-check-'))
  const { copy } = released(root)
  const fails = async (faults, pattern) => {
    const s = await site(copy, faults)
    try {
      const { problems } = await check(s.url, copy)
      assert.equal(problems.length, 1, `${JSON.stringify(faults)}: ${problems}`)
      assert.match(problems[0], pattern)
    } finally { await s.close() }
  }
  try {
    // Gone from every version and the latest build: a 404.
    await fails({ drop: '*/assets/big-Ab12Cd34.bin' }, /\/assets\/big-Ab12Cd34\.bin asked by the 26\.11\.1700 page .*HTTP 404/)
    await fails({ drop: '*/assets/app-one.js' }, /\/assets\/app-one\.js asked by the 26\.11\.1503 page .*HTTP 404/)
    // Same size, other bytes: build.json of an archived release.
    await fails({ swap: '26.11.1503/build.json' }, /\/build\.json asked by the 26\.11\.1503 page/)
    // Dropped from its version, and another version's file of another size answers instead.
    writeFileSync(join(copy, 'dist', 'v', '26.11.1503', 'brand', 'share.png'), 'png-longer')
    await fails({ drop: '26.11.1503/brand/share.png' }, /\/brand\/share\.png asked by the 26\.11\.1503 page .*\(HTTP 200, 3 bytes, want 10\)/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a 429 holds the check for its Retry-After, and then it passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-check-'))
  const { copy } = released(root)
  const s = await site(copy, { limitOnce: true })
  try {
    const started = Date.now()
    assert.deepEqual((await check(s.url, copy)).problems, [])
    assert.ok(Date.now() - started >= 1000, 'the 429 held the check for its Retry-After')
  } finally { await s.close(); rmSync(root, { recursive: true, force: true }) }
})
