/**
 * Frozen versions: https://mira.cc/?v=<version> keeps serving that exact build after later
 * releases. The owner's rule of 15 November 2026: judges must be able to load the build frozen
 * before noon (v26.11.1503) by a version in the address while newer builds keep shipping.
 *
 * Where they live (the owner's decision of 19 November 2026, step two of the move to R2): each
 * accepted release is stored once in the R2 bucket syn3h-versions under v/<version>/<path>, and
 * server/worker.ts reads every frozen version from there, except its own, which it serves from
 * its own static assets so a release's link works from its first minute. Deployments no longer
 * carry old versions. ../Syn3h-stable/versions/<version>/ keeps a second copy on this Mac.
 *
 *   node tools/frozen-versions.mjs r2-preflight                     before freeze: every archived version in R2
 *   node tools/frozen-versions.mjs prepare <frozen-copy> <version>   before deploy: guard, versions.json
 *   node tools/frozen-versions.mjs check <base-url> <frozen-copy> [--new-only]  verify a running site
 *   node tools/frozen-versions.mjs archive <frozen-copy> <version>   after acceptance: keep, upload, verify
 *   node tools/frozen-versions.mjs r2-upload --all | <version>...    upload and verify archived versions
 *   node tools/frozen-versions.mjs r2-verify --all | <version>...    re-download and compare, writing nothing
 *   node tools/frozen-versions.mjs list                              archived versions
 *
 * The commands that talk to R2 (r2-*, archive) run through the scoped-token wrapper:
 *   bash -c '. tools/cloudflare-token.sh; with_cf_token node tools/frozen-versions.mjs r2-preflight'
 * Only `archive`, run after public acceptance, adds a version: a dry run or a rolled back release
 * leaves nothing behind, locally or in R2.
 */
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expectedServed } from './lib/served.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = /^v?(\d+\.\d+\.\d+)$/

/** Where accepted releases are kept. Tests point this somewhere temporary. */
export function archiveDir() {
  return process.env.MIRA_VERSION_ARCHIVE || resolve(REPO, '..', 'Syn3h-stable', 'versions')
}

/** "v26.11.1503" or "26.11.1503" to "26.11.1503"; anything else throws. */
export function bareVersion(value) {
  const match = VERSION.exec(String(value ?? '').trim())
  if (!match) throw new Error(`"${value}" is not a version like v26.11.1503`)
  return match[1]
}

const compare = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

export function archivedVersions(dir = archiveDir()) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => VERSION.test(name) && existsSync(join(dir, name, 'index.html'))).sort(compare)
}

/**
 * A release's own files: no source maps, no upload ignore list, no nested frozen versions, and
 * no Updates feed (/releases.json describes the live site for every page, pinned or not; see
 * src/ui/updates/feed.ts), so a pinned page and the frozen check never ask for an old one.
 */
function copyBuild(from, to) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const path = relative(from, source)
      return path !== 'v' && !path.startsWith('v/') && !path.endsWith('.map') && path !== '.assetsignore' && path !== 'releases.json'
    },
  })
}

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)]
  })
}

/**
 * Ready a frozen copy for deploy: refuse a build that changes a root file a frozen version also
 * serves (changedInPlace), drop any dist/v/, and write dist/v/versions.json, the list of every
 * archived version and this one. The Updates banner (src/ui/updates/feed.ts) reads that list for
 * the newest release, and the Worker for its unknown-version page and its search order; serving
 * a version never depends on it. Returns the versions listed, oldest first.
 */
export function prepare(copy, version, archive = archiveDir()) {
  const dist = join(copy, 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist} holds no built site`)
  const current = bareVersion(version)
  const versions = archivedVersions(archive).filter((v) => v !== current)
  const changed = changedInPlace(dist, versions, archive)
  if (changed.length) throw new Error(`this build changes files that frozen versions also serve at the same address, and static assets would give every frozen page the new bytes; rename them instead:\n  ${changed.join('\n  ')}`)
  versions.push(current)
  versions.sort(compare)
  rmSync(join(dist, 'v'), { recursive: true, force: true })
  mkdirSync(join(dist, 'v'))
  writeFileSync(join(dist, 'v', 'versions.json'), JSON.stringify({ versions, note: 'Open https://mira.cc/?v=<version> to play a frozen build.' }) + '\n')
  return versions
}

/** Keep an accepted release for every later deploy. An archived version is never replaced. */
export function archive(copy, version, dir = archiveDir()) {
  const v = bareVersion(version)
  const to = join(dir, v)
  if (existsSync(join(to, 'index.html'))) throw new Error(`${v} is already archived in ${to}; an accepted release is never replaced`)
  copyBuild(join(copy, 'dist'), to)
  return to
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

/* ---------------------------------------------------------------------------------------------
 * R2: the durable home of frozen versions (the owner's decision of 19 November 2026). Each
 * accepted version is stored once in the bucket below under v/<version>/<path>, and
 * v/versions.json lists them. server/worker.ts serves frozen requests from it.
 *
 * Every v/<version>/ key is written once. The object API has no documented conditional put, so
 * each key is read first: absent, it is uploaded; the same bytes, it is
 * left alone; different bytes, the upload is refused and the run fails. versions.json is the one
 * object rewritten, and it only lists what the keys already hold. After uploading, every object
 * is downloaded again and its hash compared with the local archive.
 *
 * Run through the scoped-token wrapper, never with a token of your own in the environment:
 *   bash -c '. tools/cloudflare-token.sh; with_cf_token node tools/frozen-versions.mjs r2-upload --all'
 * ------------------------------------------------------------------------------------------- */
export const BUCKET = 'syn3h-versions'
export const INDEX_KEY = 'v/versions.json'

/** Content types stored with each object, for the Worker to send (writeHttpMetadata). */
export const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', webmanifest: 'application/manifest+json',
  wasm: 'application/wasm', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml',
  glb: 'model/gltf-binary', txt: 'text/plain; charset=utf-8', ico: 'image/x-icon',
}
export function contentType(file) {
  return CONTENT_TYPES[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * The bucket through Cloudflare's API: the object endpoints wrangler's `r2 object get|put` call
 * (/accounts/<id>/r2/buckets/<bucket>/objects/<key>), from this one process rather than a
 * wrangler process per object, which costs seconds of CPU each. The token is the one
 * with_cf_token put in this process's environment; it goes only into the Authorization header
 * and is never logged. 404 means the key is absent; a 5xx, a 429 or a transport error is retried.
 */
export function apiStore(bucket = BUCKET, { token = process.env.CLOUDFLARE_API_TOKEN, api = 'https://api.cloudflare.com/client/v4' } = {}) {
  if (!token) throw new Error('no Cloudflare token: run through tools/cloudflare-token.sh with_cf_token')
  const auth = { Authorization: `Bearer ${token}` }
  const pool = backoff()
  let account
  const base = async () => {
    account ??= (async () => {
      // The account that owns the site's zone, as tools/domain.sh finds it: the token may see more.
      // The old zone stays in that account for good (its redirect to mira.cc), and the token has
      // always been able to read it.
      const res = await fetch(`${api}/zones?name=syn3h.com`, { headers: auth }) // rename-keep
      const body = await res.json().catch(() => ({}))
      const id = body.result?.[0]?.account?.id
      if (!res.ok || body.result?.length !== 1 || !id) throw new Error(`could not find the account that owns the zones (HTTP ${res.status})`)
      return id
    })()
    return `${api}/accounts/${await account}/r2/buckets/${bucket}/objects/`
  }
  const url = async (key) => (await base()) + key.split('/').map(encodeURIComponent).join('/')
  const failure = async (res) => {
    const body = await res.json().catch(() => ({}))
    return `HTTP ${res.status}${body.errors?.length ? `: ${body.errors.map((e) => `${e.message} [${e.code}]`).join('; ')}` : ''}`
  }
  return {
    async get(key) {
      const u = await url(key)
      const got = await retrying(key, async () => {
        const res = await fetch(u, { headers: auth, signal: AbortSignal.timeout(120_000) })
        if (res.status === 404) { await res.body?.cancel(); return { status: 404, body: null } }
        if (!res.ok) return { status: res.status, error: await failure(res), retryAfter: res.headers.get('retry-after') }
        return { status: 200, body: Buffer.from(await res.arrayBuffer()) }
      }, { pool })
      if (got.status === 404) return null
      if (got.status !== 200) throw new Error(`could not read ${key}: ${got.error}`)
      return got.body
    },
    async put(key, file, type) {
      const u = await url(key)
      const bytes = readFileSync(file)
      const got = await retrying(key, async () => {
        const res = await fetch(u, { method: 'PUT', headers: { ...auth, 'Content-Type': type }, body: bytes, signal: AbortSignal.timeout(120_000) })
        return res.ok ? { status: res.status } : { status: res.status, error: await failure(res), retryAfter: res.headers.get('retry-after') }
      }, { pool })
      if (got.error) throw new Error(`could not upload ${key}: ${got.error}`)
    },
  }
}

/** @typedef {{ get(key: string): Promise<Buffer | null>, put(key: string, file: string, type: string): Promise<void> }} Store */

/**
 * Upload `versions` from the archive to the store and verify every object. A key already
 * holding other bytes is refused, never overwritten. Returns a report; `refused` and
 * `mismatched` must both be empty for the run to count. `store` is { get(key), put(key, file, type) }.
 * With `verifyOnly`, nothing is written: an absent object counts as mismatched. A version all of
 * whose objects verify gets its row in the ledger (verifiedVersions).
 * @param {string[]} versions
 * @param {{ store: Store, archive?: string, concurrency?: number, verifyOnly?: boolean, log?: (line: string) => void }} options
 */
export async function r2Upload(versions, { store, archive = archiveDir(), concurrency = 8, verifyOnly = false, log = (/** @type {string} */ _line) => {} }) {
  const report = { versions: versions.length, objects: 0, bytes: 0, uploaded: 0, present: 0, refused: /** @type {string[]} */ ([]), mismatched: /** @type {string[]} */ ([]) }
  const entries = versions.flatMap((v) => walk(join(archive, v)).map((file) => ({ v, file, key: `v/${v}/${file}`, path: join(archive, v, file) })))
  report.objects = entries.length
  await mapPool(entries, concurrency, async (e) => {
    const bytes = readFileSync(e.path)
    report.bytes += bytes.length
    const there = await store.get(e.key)
    if (there === null && verifyOnly) { report.mismatched.push(e.key); return }
    if (there === null) { await store.put(e.key, e.path, contentType(e.file)); report.uploaded++ }
    else if (sha(there) === sha(bytes)) report.present++
    else { report.refused.push(e.key); return }
    const back = await store.get(e.key)
    if (back === null || sha(back) !== sha(bytes)) report.mismatched.push(e.key)
    const done = report.uploaded + report.present + report.refused.length
    if (done % 100 === 0) log(`r2: ${done} of ${entries.length} objects`)
  })
  report.refused.sort(); report.mismatched.sort()
  // A version every one of whose objects verified is recorded as whole in R2.
  const failed = new Set([...report.refused, ...report.mismatched].map((key) => key.split('/')[1]))
  const known = verifiedVersions(archive)
  for (const v of versions) {
    if (failed.has(v) || known.has(v)) continue
    const mine = entries.filter((e) => e.v === v)
    recordVerified(archive, v, mine.length, mine.reduce((sum, e) => sum + statSync(e.path).size, 0))
  }
  return report
}

/**
 * Rewrite the index from what is verified in the store: every version given whose page is there.
 * @param {string[]} versions
 * @param {{ store: Store }} options
 */
export async function r2WriteIndex(versions, { store }) {
  const listed = []
  for (const v of [...versions].sort(compare)) if (await store.get(`v/${v}/index.html`)) listed.push(v)
  const dir = mkdtempSync(join(tmpdir(), 'mira-r2-index-'))
  const file = join(dir, 'versions.json')
  writeFileSync(file, JSON.stringify({ versions: listed, note: 'Open https://mira.cc/?v=<version> to play a frozen build.' }) + '\n')
  await store.put(INDEX_KEY, file, CONTENT_TYPES.json)
  rmSync(dir, { recursive: true, force: true })
  return listed
}

/**
 * The versions known to be whole in R2: a row in r2-verified.tsv beside the archive, written only
 * after every object of the version was uploaded or found and then read back hash-equal. Objects
 * are written once and only this tool writes them, so a verified version stays verified;
 * `r2-verify` re-downloads to audit that on demand.
 */
export function ledgerFile(archive = archiveDir()) { return join(dirname(archive), 'r2-verified.tsv') }
export function verifiedVersions(archive = archiveDir()) {
  const file = ledgerFile(archive)
  return new Set(existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((line) => line.split('\t')[0]).filter((v) => VERSION.test(v)) : [])
}
function recordVerified(archive, version, objects, bytes) {
  appendFileSync(ledgerFile(archive), `${version}\t${objects} objects\t${bytes} bytes\t${new Date().toISOString()}\n`)
}

/**
 * Before a release: every archived version must be verified in R2, because the deploy no longer
 * carries any. A version without a ledger row is uploaded and verified now. Returns what was
 * done; `unverified` must be empty for the release to go on.
 * @param {{ store: Store, archive?: string, log?: (line: string) => void }} options
 */
export async function r2Preflight({ store, archive = archiveDir(), log = (/** @type {string} */ _line) => {} }) {
  const done = verifiedVersions(archive)
  const missing = archivedVersions(archive).filter((v) => !done.has(v))
  const report = missing.length ? await r2Upload(missing, { store, archive, log }) : null
  const now = verifiedVersions(archive)
  return { missing, report, unverified: archivedVersions(archive).filter((v) => !now.has(v)) }
}

/**
 * Refuse a build that changes the bytes of a file an archived version also has at the same root
 * path, when that path is answered by the static assets before the Worker runs. Static assets
 * serve the latest build's copy of such a path to every page, so a frozen page would silently
 * get the new bytes (fonts, brand images, and the Welcome pictures of builds older than
 * src/core/frozenResources.ts). The Worker routes the exempt paths by version. Rename the file
 * (or give it a content hash) instead. Returns the offending paths.
 */
export const WORKER_ROUTED = /^(index\.html|build\.json|models\/|v\/)/
export function changedInPlace(dist, versions, archive = archiveDir()) {
  const changed = []
  for (const file of walk(dist)) {
    if (WORKER_ROUTED.test(file) || file.endsWith('.map') || file === '.assetsignore' || file === 'releases.json') continue
    const mine = sha(readFileSync(join(dist, file)))
    const owners = versions.filter((v) => existsSync(join(archive, v, file)) && sha(readFileSync(join(archive, v, file))) !== mine)
    if (owners.length) changed.push(`${file} (differs from ${owners.length === 1 ? owners[0] : `${owners.length} archived versions, newest ${owners.at(-1)}`})`)
  }
  return changed
}

/** Waits before the second and third attempts. */
export const RETRY_DELAYS = [1000, 3000]
/** Longest a 429's Retry-After may hold the whole check. */
const MAX_HOLD_MS = 60_000
/** Requests in flight at once. Enough to hide the round trip, few enough not to look like a flood. */
export const CONCURRENCY = 16

const realSleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Run one request, and again after a transport error or an HTTP 5xx or 429, up to three
 * attempts. Anything else, a 404 included, is the answer: wrong content stays a hard failure.
 * A 429 also holds every other request of the check (see `pool.hold`) for its Retry-After or
 * the retry delay, whichever is longer, so a pool of parallel requests backs off together
 * instead of each one hammering on alone. Every retry is logged with its URL.
 * @param {string} url
 * @param {() => Promise<any>} once
 * @param {{ delays?: number[], sleep?: (ms: number) => Promise<void>, log?: (line: string) => void, pool?: Backoff }} [options]
 */
export async function retrying(url, once, { delays = RETRY_DELAYS, sleep = realSleep, log = (line) => console.error(line), pool } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (pool) await pool.ready(sleep)
    let result, error
    try { result = await once() } catch (e) { error = e }
    const transient = error !== undefined || result.status >= 500 || result.status === 429
    if (!transient || attempt >= delays.length) { if (error !== undefined) throw error; return result }
    let wait = delays[attempt]
    if (result?.status === 429) {
      const after = Number(result.retryAfter)
      if (Number.isFinite(after) && after > 0) wait = Math.max(wait, after * 1000)
      wait = Math.min(wait, MAX_HOLD_MS)
      pool?.hold(wait)
    }
    log(`frozen-versions: retry ${attempt + 1} of ${delays.length} for ${url} after ${error !== undefined ? `transport error: ${String(error.message).split('\n')[0]}` : `HTTP ${result.status}`}, waiting ${wait} ms`)
    await sleep(wait)
  }
}

/** @typedef {ReturnType<typeof backoff>} Backoff */
/** Shared state for one check: a 429 anywhere pauses new requests everywhere until it passes. */
function backoff(now = Date.now) {
  let until = 0
  return {
    hold(ms) { until = Math.max(until, now() + ms) },
    async ready(sleep) { for (let left; (left = until - now()) > 0;) await sleep(left) },
  }
}

/** Run `work` over `items`, at most `limit` at a time, in order of starting. */
export async function mapPool(items, limit, work) {
  const out = new Array(items.length)
  let next = 0
  const lane = async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return out
}

/**
 * One request with Node's fetch: keep-alive, and it sends the Referer that picks a frozen file.
 * (Cloudflare answers a HEAD without a Content-Length and ignores Range, so a file's size
 * cannot be had without its bytes; every file is fetched whole.)
 * @param {string} url
 * @param {{ headers?: Record<string, string>, pool?: Backoff }} [options]
 */
async function get(url, { headers = {}, pool } = {}) {
  return retrying(url, async () => {
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) })
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()), retryAfter: res.headers.get('retry-after') }
  }, { pool })
}

/**
 * Verify a running site after a deploy. The release being made (the copy's build.json version):
 * its page in both spellings, every one of its files as its page asks for them (from its own
 * static assets), one of its direct /v/<version>/ addresses, and that /v/versions.json lists it.
 * Every archived version: its page in both spellings, marked with its version, and a repeat
 * visit by ETag; those pages come from R2, so this proves R2 is serving them. Then an unknown
 * version and the plain address. Every file fetched is hashed, CONCURRENCY at a time. Returns
 * { problems, stats }; an empty problems list is a pass. `newOnly` checks the new release alone,
 * for a copy served locally, where there is no R2 to serve the others from.
 */
export async function check(base, copy, { concurrency = CONCURRENCY, archive = archiveDir(), newOnly = false } = {}) {
  const root = join(copy, 'dist')
  const problems = []
  const origin = new URL(base).origin
  const stats = { versions: 0, files: 0, requests: 0 }
  const current = bareVersion(JSON.parse(readFileSync(join(root, 'build.json'), 'utf8')).version)
  const versions = newOnly ? [current] : [...new Set([...archivedVersions(archive), current])].sort(compare)
  const pageOf = (v) => readFileSync(v === current ? join(root, 'index.html') : join(archive, v, 'index.html'))
  const pool = backoff()
  const request = (url, options = {}) => { stats.requests++; return get(url, { ...options, pool }) }

  // Pages: both spellings, the version header, and a browser's repeat visit with the ETag.
  await mapPool(versions, concurrency, async (v) => {
    for (const address of [`/?v=${v}`, `/?v=v${v}`]) {
      const got = await request(origin + address)
      // A beta host serves each page with its own origin for mira.cc's (tools/lib/served.mjs).
      const page = sha(expectedServed(pageOf(v), base, got.headers.get('content-type')))
      if (got.status !== 200 || sha(got.body) !== page) problems.push(`${address} does not serve the frozen ${v} page (HTTP ${got.status})`)
      if (got.headers.get('x-syn3h-version') !== v) problems.push(`${address} is not marked x-syn3h-version: ${v}`)
      // A repeat visit revalidates with the ETag. A 404 here once broke frozen pages.
      const etag = got.headers.get('etag')
      if (etag && address === `/?v=${v}`) {
        const again = await request(origin + address, { headers: { 'If-None-Match': etag } })
        if (again.status !== 200 && again.status !== 304) problems.push(`${address} answers a repeat visit with HTTP ${again.status}`)
      }
    }
  })

  // The new release's files, asked for the way its page asks: by root path, from that page.
  const files = walk(root).filter((file) => file !== 'index.html' && !file.endsWith('.map') && file !== '.assetsignore' && file !== 'releases.json' && !file.startsWith('v/'))
  await mapPool(files, concurrency, async (file) => {
    const got = await request(`${origin}/${file}`, { headers: { Referer: `${origin}/?v=${current}` } })
    const want = expectedServed(readFileSync(join(root, file)), base, got.headers.get('content-type'))
    if (got.status === 200 && sha(got.body) === sha(want)) return
    problems.push(`/${file} asked by the ${current} page is not that release's file (HTTP ${got.status}, ${got.body.length} bytes, want ${want.length})`)
  })
  // Its own /v/ address (a pinned page asks for models, licences and pictures this way).
  const direct = await request(`${origin}/v/${current}/build.json`)
  if (direct.status !== 200 || sha(direct.body) !== sha(readFileSync(join(root, 'build.json')))) problems.push(`/v/${current}/build.json is not this release's build.json (HTTP ${direct.status})`)
  const listed = await request(`${origin}/v/versions.json`)
  let list = []
  try { list = JSON.parse(listed.body.toString()).versions ?? [] } catch { /* reported below */ }
  if (!list.includes(current)) problems.push(`/v/versions.json does not list ${current} (HTTP ${listed.status})`)

  const unknown = await request(`${origin}/?v=0.0.0`)
  if (unknown.status !== 404) problems.push(`an unknown version answers HTTP ${unknown.status}, not 404`)
  if ((await request(`${origin}/`)).status !== 200) problems.push('the plain address does not answer 200')
  problems.sort()
  return { problems, stats: { versions: versions.length, files: files.length, requests: stats.requests } }
}

/** Print an upload or verification report; returns true when nothing was refused or mismatched. */
function printReport(report, started, verb = 'uploaded') {
  for (const key of report.refused) console.log(`REFUSED: ${key} already holds other bytes; not overwritten`)
  for (const key of report.mismatched) console.log(`MISMATCH: ${key} is missing or does not read back as the archived bytes`)
  console.log(`R2 ${BUCKET}: ${report.versions} versions, ${report.objects} objects, ${report.bytes} bytes; ${report.uploaded} ${verb}, ${report.present} already there; ${report.refused.length} refused, ${report.mismatched.length} mismatched; ${((Date.now() - started) / 1000).toFixed(0)} s`)
  return !report.refused.length && !report.mismatched.length
}

async function main(argv) {
  const [command, a, b] = argv
  const pick = (usage) => {
    const all = archivedVersions()
    const wanted = argv.includes('--all') ? all : argv.slice(1).map(bareVersion)
    if (!wanted.length) throw new Error(usage)
    for (const v of wanted) if (!all.includes(v)) throw new Error(`${v} is not archived`)
    return wanted
  }
  const log = (line) => console.log(line)
  switch (command) {
    case 'prepare': {
      if (!a || !b) throw new Error('Usage: frozen-versions.mjs prepare <frozen-copy> <version>')
      console.log(`Frozen versions listed: ${prepare(resolve(a), b).join(', ')}`)
      return 0
    }
    case 'r2-preflight': {
      // Before a release: every archived version must be whole in R2, since no deploy carries them.
      const started = Date.now()
      const { missing, report, unverified } = await r2Preflight({ store: apiStore(), log })
      if (report) printReport(report, started)
      if (unverified.length) { console.log(`R2 PREFLIGHT FAILED: not verified in R2: ${unverified.join(', ')}`); return 1 }
      console.log(`R2 PREFLIGHT OK: ${archivedVersions().length} versions verified in R2${missing.length ? ` (uploaded and verified now: ${missing.join(', ')})` : ''}`)
      return 0
    }
    case 'archive': {
      // After acceptance: the local second copy, then R2, verified. Loud on any failure.
      if (!a || !b) throw new Error('Usage: frozen-versions.mjs archive <frozen-copy> <version>')
      const v = bareVersion(b)
      if (existsSync(join(archiveDir(), v, 'index.html'))) console.log(`${v} is already archived locally; not replaced`)
      else console.log(`Archived ${v} at ${archive(resolve(a), v)}`)
      const store = apiStore()
      const started = Date.now()
      let ok = false
      try { ok = printReport(await r2Upload([v], { store, log }), started) } catch (error) { console.log(`R2 error: ${error instanceof Error ? error.message : String(error)}`) }
      if (!ok) { console.log(`ARCHIVE FAILED: ${v} is not verified in R2. The next release's r2-preflight uploads it again or stops.`); return 1 }
      console.log(`R2 index lists ${(await r2WriteIndex(archivedVersions(), { store })).length} versions`)
      console.log(`ARCHIVE OK: ${v} kept locally and verified in R2`)
      return 0
    }
    case 'check': {
      if (!a || !b) throw new Error('Usage: frozen-versions.mjs check <base-url> <frozen-copy> [--new-only]')
      const started = Date.now()
      const { problems, stats } = await check(a, resolve(b), { newOnly: argv.includes('--new-only') })
      for (const problem of problems) console.log(`FAIL: ${problem}`)
      console.log(`Checked ${stats.versions} version pages and ${stats.files} files of the new one in ${stats.requests} requests, ${((Date.now() - started) / 1000).toFixed(1)} s`)
      console.log(problems.length ? `FROZEN VERSIONS FAILED at ${a}` : `FROZEN VERSIONS OK at ${a}`)
      return problems.length ? 1 : 0
    }
    case 'r2-upload': {
      const wanted = pick('Usage: frozen-versions.mjs r2-upload --all | <version>...')
      const store = apiStore()
      const started = Date.now()
      if (!printReport(await r2Upload(wanted, { store, log }), started)) { console.log('R2 UPLOAD FAILED: index not rewritten'); return 1 }
      console.log(`R2 index lists ${(await r2WriteIndex(archivedVersions(), { store })).length} versions`)
      return 0
    }
    case 'r2-verify': {
      const wanted = pick('Usage: frozen-versions.mjs r2-verify --all | <version>...')
      const started = Date.now()
      if (!printReport(await r2Upload(wanted, { store: apiStore(), verifyOnly: true, log }), started, 'written')) { console.log('R2 VERIFY FAILED'); return 1 }
      console.log('R2 VERIFY OK')
      return 0
    }
    case 'list': {
      for (const v of archivedVersions()) console.log(v)
      return 0
    }
    default:
      throw new Error('Usage: frozen-versions.mjs prepare|r2-preflight|check|archive|r2-upload|r2-verify|list')
  }
}

// realpath: run through a symlinked path (/tmp is one on macOS), a plain comparison is false and
// the check would exit 0 having checked nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (error) => { console.error(`frozen-versions: ${error.message}`); process.exitCode = 1 })
}
