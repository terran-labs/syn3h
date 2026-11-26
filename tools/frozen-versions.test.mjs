import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import {
  apiStore, archive, archivedVersions, bareVersion, changedInPlace, check, contentType, ledgerFile, mapPool, prepare,
  r2Preflight, r2Upload, r2WriteIndex, retrying, verifiedVersions,
} from './frozen-versions.mjs'
import { findForbidden } from './check-shipped-assets.mjs'
import { draftNotes, frozenUrl } from './release-notes.mjs'
import { parseHistory } from './lib/release-version.mjs'

/** A frozen copy holding a tiny built site whose page names its own version. */
function build(root, name, mark, version) {
  const copy = join(root, name)
  mkdirSync(join(copy, 'dist', 'assets'), { recursive: true })
  mkdirSync(join(copy, 'dist', 'brand'), { recursive: true })
  writeFileSync(join(copy, 'dist', 'index.html'), `<title>${mark}</title>`)
  writeFileSync(join(copy, 'dist', 'build.json'), JSON.stringify({ mark, version: `v${version}` }))
  writeFileSync(join(copy, 'dist', 'assets', `app-${mark}.js`), mark)
  writeFileSync(join(copy, 'dist', 'assets', `app-${mark}.js.map`), 'map')
  writeFileSync(join(copy, 'dist', 'brand', 'share.png'), 'png')
  writeFileSync(join(copy, 'dist', '.assetsignore'), '*.map\n')
  writeFileSync(join(copy, 'dist', 'releases.json'), JSON.stringify({ releases: [{ version: mark }] }))
  writeFileSync(join(copy, 'dist', 'releases-older.json'), JSON.stringify({ releases: [{ version: mark }] }))
  return copy
}

/** Two accepted releases in an archive under root, and a third being released. */
function released(root) {
  const store = join(root, 'versions')
  for (const [name, mark, v] of [['a', 'one', '26.11.1503'], ['b', 'two', '26.11.1600']]) {
    const copy = build(root, name, mark, v)
    prepare(copy, v, store)
    archive(copy, v, store)
  }
  const copy = build(root, 'c', 'six', '26.11.1700')
  writeFileSync(join(copy, 'dist', 'assets', 'big-Ab12Cd34.bin'), Buffer.alloc(4096, 7))
  prepare(copy, '26.11.1700', store)
  return { copy, store }
}

test('a release lists every version but carries none, and only acceptance archives', () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-frozen-'))
  try {
    const store = join(root, 'versions')
    const first = build(root, 'first', 'one', '26.11.1503')
    assert.deepEqual(prepare(first, 'v26.11.1503', store), ['26.11.1503'])
    assert.deepEqual(archivedVersions(store), [], 'preparing alone archives nothing: a dry run or rollback leaves no trace')
    archive(first, 'v26.11.1503', store)
    assert.deepEqual(archivedVersions(store), ['26.11.1503'])
    assert.ok(!existsSync(join(store, '26.11.1503/assets/app-one.js.map')), 'source maps are not archived')
    assert.ok(!existsSync(join(store, '26.11.1503/releases.json')), 'the Updates feed is the live site\'s, never archived')
    assert.ok(!existsSync(join(store, '26.11.1503/releases-older.json')), 'nor is its older history')
    assert.ok(!existsSync(join(store, '26.11.1503/v')), 'an archived version holds no list of the others')

    const second = build(root, 'second', 'two', '26.11.1600')
    mkdirSync(join(second, 'dist', 'v', '26.11.1503'), { recursive: true })
    writeFileSync(join(second, 'dist', 'v', '26.11.1503', 'index.html'), 'stale carried copy')
    assert.deepEqual(prepare(second, 'v26.11.1600', store), ['26.11.1503', '26.11.1600'])
    // Only the list: the Updates banner reads it for the newest release, this one included.
    assert.deepEqual(JSON.parse(readFileSync(join(second, 'dist/v/versions.json'), 'utf8')).versions, ['26.11.1503', '26.11.1600'])
    assert.ok(!existsSync(join(second, 'dist/v/26.11.1503')), 'no old version is carried')
    // Preparing twice (a dry run, then the release) gives the same result.
    assert.deepEqual(prepare(second, 'v26.11.1600', store), ['26.11.1503', '26.11.1600'])

    // An accepted release is what a judge was promised: it is never replaced.
    assert.throws(() => archive(second, 'v26.11.1503', store), /never replaced/)
    assert.equal(readFileSync(join(store, '26.11.1503/index.html'), 'utf8'), '<title>one</title>')
    assert.deepEqual(findForbidden(join(second, 'dist')).images, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('prepare refuses a build that changes a root file a frozen version also serves', () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-frozen-'))
  try {
    const { store } = released(root)
    const next = build(root, 'next', 'three', '26.11.1800')
    // Same share.png bytes as before, and its own build.json and script: fine.
    assert.deepEqual(changedInPlace(join(next, 'dist'), archivedVersions(store), store), [])
    // A redrawn share.png at the same address would reach every frozen page.
    writeFileSync(join(next, 'dist', 'brand', 'share.png'), 'new png')
    assert.deepEqual(changedInPlace(join(next, 'dist'), archivedVersions(store), store), ['brand/share.png (differs from 2 archived versions, newest 26.11.1600)'])
    assert.throws(() => prepare(next, 'v26.11.1800', store), /rename them instead:\n  brand\/share\.png/)
    assert.ok(!existsSync(join(next, 'dist', 'v')), 'a refused build gets no list')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('versions are written one way', () => {
  assert.equal(bareVersion('v26.11.1503'), '26.11.1503')
  assert.equal(bareVersion('26.11.1503'), '26.11.1503')
  assert.throws(() => bareVersion('../../etc'), /not a version/)
  assert.throws(() => bareVersion('release-7'), /not a version/)
})

test('production notes link the playable frozen version', () => {
  assert.equal(frozenUrl('v26.11.1503'), 'https://mira.cc/?v=26.11.1503')
  const [row] = parseHistory('v26.11.1600\tm20\tabc1234\t2026-11-16 09:00 PST\tproduction\n')
  assert.match(draftNotes(row, 'a', 'b', []), /https:\/\/mira\.cc\/\?v=26\.11\.1600/)
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
 * A site that answers like server/worker.ts in step two: the release being made (`copy`) is the
 * latest build and serves its own version from its own files; every archived version is served
 * from `store` (standing in for R2). A file is looked up in the version its Referer names, then
 * in the latest build. `faults` changes what it serves: drop '<version>/<file>' (or
 * 'latest/<file>'), swap '<version>/<file>' to other bytes of the same size.
 */
async function site(copy, store, faults = {}) {
  const dist = join(copy, 'dist')
  const own = bareVersion(JSON.parse(readFileSync(join(dist, 'build.json'), 'utf8')).version)
  const read = (path) => { try { return readFileSync(path) } catch { return null } }
  const from = (v, file) => {
    // The release being made is the latest build: dropping one drops the other.
    if (faults.drop === `${v}/${file}` || (v === own && faults.drop === `latest/${file}`)) return null
    const bytes = read(v === own ? join(dist, file) : join(store, v, file))
    return faults.swap === `${v}/${file}` && bytes ? Buffer.from(bytes.toString().replace(/./, '#')) : bytes
  }
  const seen = { requests: 0, limited: 0 }
  const server = createServer((req, res) => {
    seen.requests++
    const url = new URL(req.url, 'http://x')
    if (faults.limitOnce && !seen.limited++) { res.writeHead(429, { 'retry-after': '1' }); return res.end() }
    let body = null, version = null
    const direct = /^\/v\/(\d+\.\d+\.\d+)\/(.+)$/.exec(url.pathname)
    if (url.pathname === '/v/versions.json') body = faults.drop === 'latest/v/versions.json' ? null : read(join(dist, 'v', 'versions.json'))
    else if (direct) { version = direct[1]; body = from(direct[1], direct[2]) }
    else if (url.pathname === '/') {
      const v = url.searchParams.get('v')?.replace(/^v/, '')
      version = v ?? null
      body = v ? from(v, 'index.html') : read(join(dist, 'index.html'))
    } else {
      const file = url.pathname.slice(1)
      const v = new URL(req.headers.referer ?? 'http://x/').searchParams.get('v')
      if (v) { body = from(v, file); version = v }
      if (!body && faults.drop !== `latest/${file}`) { body = read(join(dist, file)); version = null }
    }
    if (!body) { res.writeHead(404); return res.end() }
    const headers = { etag: '"e"', 'content-length': body.length, ...(version ? { 'x-syn3h-version': version } : {}) }
    if (req.headers['if-none-match'] === '"e"') { res.writeHead(304, headers); return res.end() }
    res.writeHead(200, headers)
    res.end(body)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${server.address().port}/`, seen, close: () => new Promise((done) => server.close(done)) }
}

test('the frozen check passes: every file of the new release, and every old version\'s page', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-frozen-check-'))
  const { copy, store } = released(root)
  const s = await site(copy, store)
  try {
    const { problems, stats } = await check(s.url, copy, { archive: store })
    assert.deepEqual(problems, [])
    assert.equal(stats.versions, 3)
    // The new release's own files: build.json, its script, the big file, share.png, v/versions.json is not one.
    assert.equal(stats.files, 4)
    // Per version two spellings and a repeat visit; the new files; its /v/ address, the list,
    // an unknown version and the plain page.
    assert.equal(stats.requests, 3 * 3 + 4 + 4)
    assert.equal(s.seen.requests, stats.requests)
    // Served locally there is no R2: the new release alone.
    const local = await check(s.url, copy, { archive: store, newOnly: true })
    assert.deepEqual(local.problems, [])
    assert.equal(local.stats.versions, 1)
  } finally { await s.close(); rmSync(root, { recursive: true, force: true }) }
})

test('the frozen check fails loudly on a missing or wrong file of the new release or an old page', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-frozen-check-'))
  const { copy, store } = released(root)
  const fails = async (faults, pattern, count = 1) => {
    const s = await site(copy, store, faults)
    try {
      const { problems } = await check(s.url, copy, { archive: store })
      assert.equal(problems.length, count, `${JSON.stringify(faults)}: ${problems}`)
      assert.match(problems.join('\n'), pattern)
    } finally { await s.close() }
  }
  try {
    // A file of the new release missing everywhere: a 404.
    await fails({ drop: 'latest/assets/big-Ab12Cd34.bin' }, /\/assets\/big-Ab12Cd34\.bin asked by the 26\.11\.1700 page .*HTTP 404/)
    // The new release's build.json, same size, other bytes: by root path and by its /v/ address.
    await fails({ swap: '26.11.1700/build.json' }, /\/build\.json asked by the 26\.11\.1700 page[^]*\/v\/26\.11\.1700\/build\.json is not this release's/, 2)
    // An old version's page gone from R2: both spellings fail, as the repeat visit cannot happen.
    await fails({ drop: '26.11.1503/index.html' }, /\/\?v=26\.11\.1503 does not serve the frozen 26\.11\.1503 page \(HTTP 404\)/, 4)
    // The list without this release: the Updates banner would never see it.
    await fails({ drop: 'latest/v/versions.json' }, /\/v\/versions\.json does not list 26\.11\.1700/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a 429 holds the check for its Retry-After, and then it passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-frozen-check-'))
  const { copy, store } = released(root)
  const s = await site(copy, store, { limitOnce: true })
  try {
    const started = Date.now()
    assert.deepEqual((await check(s.url, copy, { archive: store })).problems, [])
    assert.ok(Date.now() - started >= 1000, 'the 429 held the check for its Retry-After')
  } finally { await s.close(); rmSync(root, { recursive: true, force: true }) }
})

/** A bucket in memory: { get(key), put(key, file, type) }, with hooks to corrupt reads or fail. */
function memoryStore(objects = new Map(), { corrupt, failPut } = {}) {
  return {
    objects, puts: [],
    async get(key) { const o = objects.get(key); return o ? (corrupt === key ? Buffer.from('bad') : o.bytes) : null },
    async put(key, file, type) {
      if (failPut === key) throw new Error(`could not upload ${key}: HTTP 500`)
      this.puts.push(key); objects.set(key, { bytes: readFileSync(file), type })
    },
  }
}

test('R2 upload stores each archived file once, with its type, verifies it, and records the version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-r2-'))
  try {
    const { store: dir } = released(root)
    const store = memoryStore()
    const report = await r2Upload(['26.11.1503', '26.11.1600'], { store, archive: dir })
    assert.deepEqual({ ...report, bytes: undefined }, { versions: 2, objects: 8, bytes: undefined, uploaded: 8, present: 0, refused: [], mismatched: [] })
    assert.equal(store.objects.get('v/26.11.1503/assets/app-one.js').bytes.toString(), 'one')
    assert.equal(store.objects.get('v/26.11.1503/index.html').type, 'text/html; charset=utf-8')
    assert.equal(contentType('a/b.glb'), 'model/gltf-binary')
    assert.deepEqual([...verifiedVersions(dir)], ['26.11.1503', '26.11.1600'])
    assert.match(readFileSync(ledgerFile(dir), 'utf8'), /^26\.11\.1503\t4 objects\t\d+ bytes\t\d{4}-/)
    // Again: everything is already there with the same bytes, so nothing is written or re-recorded.
    store.puts.length = 0
    const again = await r2Upload(['26.11.1503', '26.11.1600'], { store, archive: dir })
    assert.equal(again.present, 8)
    assert.deepEqual(store.puts, [])
    assert.equal(readFileSync(ledgerFile(dir), 'utf8').split('\n').filter(Boolean).length, 2)
    // A read-only audit writes nothing and finds what is missing.
    const audit = await r2Upload(['26.11.1503'], { store: memoryStore(), archive: dir, verifyOnly: true })
    assert.equal(audit.mismatched.length, 4)
    assert.equal(audit.uploaded, 0)
    // The index lists the versions whose page is in the bucket, and only that object is rewritten.
    assert.deepEqual(await r2WriteIndex(['26.11.1600', '26.11.1503', '26.11.1700'], { store }), ['26.11.1503', '26.11.1600'])
    assert.deepEqual(JSON.parse(store.objects.get('v/versions.json').bytes).versions, ['26.11.1503', '26.11.1600'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('R2 upload refuses to overwrite other bytes, catches a bad read-back, and records neither', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-r2-'))
  try {
    const { store: dir } = released(root)
    const objects = new Map([['v/26.11.1503/build.json', { bytes: Buffer.from('{"mark":"xxx"}'), type: 'application/json' }]])
    const store = memoryStore(objects)
    const report = await r2Upload(['26.11.1503'], { store, archive: dir })
    assert.deepEqual(report.refused, ['v/26.11.1503/build.json'])
    assert.equal(objects.get('v/26.11.1503/build.json').bytes.toString(), '{"mark":"xxx"}', 'never overwritten')
    assert.ok(!store.puts.includes('v/26.11.1503/build.json'))
    const bad = await r2Upload(['26.11.1600'], { store: memoryStore(new Map(), { corrupt: 'v/26.11.1600/brand/share.png' }), archive: dir })
    assert.deepEqual(bad.mismatched, ['v/26.11.1600/brand/share.png'])
    assert.deepEqual([...verifiedVersions(dir)], [], 'a version with a refused or mismatched object is not recorded')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the release preflight uploads what is not yet verified, and stops when it cannot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mira-r2-'))
  try {
    const { store: dir } = released(root)
    const store = memoryStore()
    await r2Upload(['26.11.1503'], { store, archive: dir })
    // 26.11.1600 was accepted but never stored: the preflight stores it before anything is built.
    const first = await r2Preflight({ store, archive: dir })
    assert.deepEqual(first.missing, ['26.11.1600'])
    assert.deepEqual(first.unverified, [])
    assert.ok(store.objects.has('v/26.11.1600/index.html'))
    // Nothing left to do: nothing read or written.
    const quiet = memoryStore()
    assert.deepEqual(await r2Preflight({ store: quiet, archive: dir }), { missing: [], report: null, unverified: [] })
    // An upload that cannot happen stops the release.
    rmSync(ledgerFile(dir))
    await assert.rejects(r2Preflight({ store: memoryStore(new Map(), { failPut: 'v/26.11.1503/index.html' }), archive: dir }), /could not upload v\/26\.11\.1503\/index\.html/)
    const refused = await r2Preflight({ store: memoryStore(new Map([['v/26.11.1503/build.json', { bytes: Buffer.from('other'), type: 'x' }]])), archive: dir })
    assert.deepEqual(refused.unverified, ['26.11.1503'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

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
