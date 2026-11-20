import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { apiStore, archive, archivedVersions, bareVersion, carry, changedInPlace, check, contentType, mapPool, r2Upload, r2WriteIndex, retrying } from './frozen-versions.mjs'
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

/** A bucket in memory: { get(key), put(key, file, type) }, with a hook to corrupt reads. */
function memoryStore(objects = new Map(), { corrupt } = {}) {
  return {
    objects, puts: [],
    async get(key) { const o = objects.get(key); return o ? (corrupt === key ? Buffer.from('bad') : o.bytes) : null },
    async put(key, file, type) { this.puts.push(key); objects.set(key, { bytes: readFileSync(file), type }) },
  }
}

test('R2 upload stores each archived file once, with its type, and verifies it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-r2-'))
  try {
    const { store: dir } = archivedTwo(root)
    const store = memoryStore()
    const report = await r2Upload(['26.11.1503', '26.11.1600'], { store, archive: dir })
    assert.deepEqual({ ...report, bytes: undefined }, { versions: 2, objects: 8, bytes: undefined, uploaded: 8, present: 0, refused: [], mismatched: [] })
    assert.equal(store.objects.get('v/26.11.1503/assets/app-one.js').bytes.toString(), 'one')
    assert.equal(store.objects.get('v/26.11.1503/index.html').type, 'text/html; charset=utf-8')
    assert.equal(contentType('a/b.glb'), 'model/gltf-binary')
    // Again: everything is already there with the same bytes, so nothing is written.
    store.puts.length = 0
    const again = await r2Upload(['26.11.1503', '26.11.1600'], { store, archive: dir })
    assert.equal(again.present, 8)
    assert.deepEqual(store.puts, [])
    // The index lists the versions whose page is in the bucket, and only that object is rewritten.
    assert.deepEqual(await r2WriteIndex(['26.11.1600', '26.11.1503', '26.11.1700'], { store }), ['26.11.1503', '26.11.1600'])
    assert.deepEqual(JSON.parse(store.objects.get('v/versions.json').bytes).versions, ['26.11.1503', '26.11.1600'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('R2 upload refuses to overwrite a key holding other bytes, and catches a bad read-back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-r2-'))
  try {
    const { store: dir } = archivedTwo(root)
    const objects = new Map([['v/26.11.1503/build.json', { bytes: Buffer.from('{"mark":"xxx"}'), type: 'application/json' }]])
    const store = memoryStore(objects)
    const report = await r2Upload(['26.11.1503'], { store, archive: dir })
    assert.deepEqual(report.refused, ['v/26.11.1503/build.json'])
    assert.equal(objects.get('v/26.11.1503/build.json').bytes.toString(), '{"mark":"xxx"}', 'never overwritten')
    assert.ok(!store.puts.includes('v/26.11.1503/build.json'))
    const bad = await r2Upload(['26.11.1600'], { store: memoryStore(new Map(), { corrupt: 'v/26.11.1600/brand/share.png' }), archive: dir })
    assert.deepEqual(bad.mismatched, ['v/26.11.1600/brand/share.png'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('carry refuses a build that changes a root file a frozen version also serves', () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-r2-'))
  try {
    const { store: dir } = archivedTwo(root)
    const next = build(root, 'next', 'three')
    // Same share.png bytes as before, and its own build.json and script: fine.
    assert.deepEqual(changedInPlace(join(next, 'dist'), archivedVersions(dir), dir), [])
    // A redrawn share.png at the same address would reach every frozen page.
    writeFileSync(join(next, 'dist', 'brand', 'share.png'), 'new png')
    mkdirSync(join(next, 'dist', 'models'), { recursive: true })
    assert.deepEqual(changedInPlace(join(next, 'dist'), archivedVersions(dir), dir), ['brand/share.png (differs from 2 archived versions, newest 26.11.1600)'])
    assert.throws(() => carry(next, 'v26.11.1700', dir), /rename them instead:\n  brand\/share\.png/)
    assert.ok(!existsSync(join(next, 'dist', 'v')), 'a refused carry leaves no half-built dist/v')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

/** Two accepted releases in an archive under root. */
function archivedTwo(root) {
  const store = join(root, 'versions')
  for (const [name, mark, v] of [['a', 'one', '26.11.1503'], ['b', 'two', '26.11.1600']]) {
    const copy = build(root, name, mark)
    carry(copy, v, store)
    archive(copy, v, store)
  }
  return { store }
}

test('the R2 API client sends the token only as its Authorization header and never reports it', async () => {
  const TOKEN = 'fake-token-for-the-test-0123456789'
  assert.throws(() => apiStore('b', { token: '' }), /with_cf_token/)
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization })
    if (req.url.startsWith('/zones')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ result: [{ account: { id: 'acc' } }] })) }
    // An error that echoes the request back, as a careless API might.
    res.writeHead(403, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ errors: [{ code: 10000, message: `Authentication error for ${req.headers.authorization}`.replace(TOKEN, '<redacted>') }] }))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  try {
    const store = apiStore('syn3h-versions', { token: TOKEN, api: `http://127.0.0.1:${server.address().port}` })
    const error = await store.get('v/26.11.1503/index.html').then(() => null, (e) => e)
    assert.match(error.message, /could not read v\/26\.11\.1503\/index\.html: HTTP 403: Authentication error/)
    assert.ok(!error.message.includes(TOKEN))
    assert.equal(seen.at(-1).url, '/accounts/acc/r2/buckets/syn3h-versions/objects/v/26.11.1503/index.html')
    assert.ok(seen.every((r) => r.auth === `Bearer ${TOKEN}` && !r.url.includes(TOKEN)))
  } finally { await new Promise((done) => server.close(done)) }
})
