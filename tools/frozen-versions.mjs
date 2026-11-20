/**
 * Frozen versions: every production deploy carries each earlier release's files, so
 * https://www.syn3h.com/?v=<version> keeps serving that exact build after later releases.
 *
 * The owner's rule of 15 November 2026: judges must be able to load the build frozen before
 * noon (v26.11.1503) by a version in the address while newer builds keep shipping. A deploy
 * that leaves out dist/v/ breaks every frozen link, so tools/release.sh runs `carry` before
 * it deploys and `check` against what it deployed, and fails the release on either.
 *
 *   node tools/frozen-versions.mjs carry <frozen-copy> [version]   fill <frozen-copy>/dist/v/
 *   node tools/frozen-versions.mjs archive <frozen-copy> <version> keep an accepted release
 *   node tools/frozen-versions.mjs check <base-url> <frozen-copy>  verify a running site
 *   node tools/frozen-versions.mjs list                            archived versions
 *
 * The archive lives beside the frozen copies, in ../Syn3h-stable/versions/<version>/, one
 * directory per accepted production release, holding that release's dist without source maps.
 * `carry` copies every archived version into dist/v/<version>/, adds the build being released
 * under its own version so its link works from its first minute, and writes
 * dist/v/versions.json for server/worker.ts. Only `archive`, run after public acceptance,
 * adds to the archive: a dry run or a rolled back release leaves nothing behind.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = /^v?(\d+\.\d+\.\d+)$/

/** Where accepted releases are kept. Tests point this somewhere temporary. */
export function archiveDir() {
  return process.env.SYN3H_VERSION_ARCHIVE || resolve(REPO, '..', 'Syn3h-stable', 'versions')
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
 * Fill <copy>/dist/v/ with every archived version, plus the build in <copy>/dist itself when
 * its version is given. Returns the versions carried, oldest first.
 */
export function carry(copy, version, archive = archiveDir()) {
  const dist = join(copy, 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist} holds no built site`)
  const current = version ? bareVersion(version) : null
  const target = join(dist, 'v')
  // Built beside dist and moved in: Node refuses to copy a directory into itself.
  const staging = join(copy, '.frozen-versions')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const versions = archivedVersions(archive).filter((v) => v !== current)
  for (const v of versions) copyBuild(join(archive, v), join(staging, v))
  if (current) {
    copyBuild(dist, join(staging, current))
    versions.push(current)
  }
  versions.sort(compare)
  writeFileSync(join(staging, 'versions.json'), JSON.stringify({ versions, note: 'Open https://www.syn3h.com/?v=<version> to play a frozen build.' }) + '\n')
  rmSync(target, { recursive: true, force: true })
  renameSync(staging, target)
  return versions
}

/** Keep an accepted release for every later deploy. An archived version is never replaced. */
export function archive(copy, version, dir = archiveDir()) {
  const v = bareVersion(version)
  const to = join(dir, v)
  if (existsSync(join(to, 'index.html'))) throw new Error(`${v} is already archived in ${to}; an accepted release is never replaced`)
  const carried = join(copy, 'dist', 'v', v)
  copyBuild(existsSync(join(carried, 'index.html')) ? carried : join(copy, 'dist'), to)
  return to
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

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
 * Verify a running site against <copy>/dist/v: each frozen version's page, every one of its
 * files as that page would ask for it, a browser's repeat visit, and an unknown version.
 * Every file is fetched and hashed, CONCURRENCY at a time. Returns { problems, stats }; an
 * empty problems list is a pass.
 */
export async function check(base, copy, { concurrency = CONCURRENCY } = {}) {
  const root = join(copy, 'dist')
  const frozen = join(root, 'v')
  const problems = []
  const origin = new URL(base).origin
  const stats = { versions: 0, files: 0, requests: 0 }
  if (!existsSync(join(frozen, 'versions.json'))) return { problems: [`${frozen} has no versions.json: this build carries no frozen versions`], stats }
  const { versions } = JSON.parse(readFileSync(join(frozen, 'versions.json'), 'utf8'))
  if (!versions.length) problems.push('versions.json lists no versions')
  const pool = backoff()
  const request = (url, options = {}) => { stats.requests++; return get(url, { ...options, pool }) }

  // Pages: both spellings, the version header, and a browser's repeat visit with the ETag.
  await mapPool(versions, concurrency, async (v) => {
    const page = sha(readFileSync(join(frozen, v, 'index.html')))
    for (const address of [`/?v=${v}`, `/?v=v${v}`]) {
      const got = await request(origin + address)
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

  // Every file, asked for the way the frozen page asks: by its root path, from that page.
  const entries = versions.flatMap((v) => walk(join(frozen, v)).filter((file) => file !== 'index.html').map((file) => ({ version: v, file })))
  await mapPool(entries, concurrency, async ({ version, file }) => {
    const got = await request(`${origin}/${file}`, { headers: { Referer: `${origin}/?v=${version}` } })
    const want = readFileSync(join(frozen, version, file))
    if (got.status === 200 && sha(got.body) === sha(want)) return
    // Hashed names carry no Referer rule: the latest build wins when it has the same name.
    // That is right only when the bytes are the same, so any difference is a failure.
    problems.push(`/${file} asked by the ${version} page is not that release's file (HTTP ${got.status}, ${got.body.length} bytes, want ${want.length})`)
  })

  const unknown = await request(`${origin}/?v=0.0.0`)
  if (unknown.status !== 404) problems.push(`an unknown version answers HTTP ${unknown.status}, not 404`)
  if ((await request(`${origin}/`)).status !== 200) problems.push('the plain address does not answer 200')
  problems.sort()
  return { problems, stats: { versions: versions.length, files: entries.length, requests: stats.requests } }
}

async function main(argv) {
  const [command, a, b] = argv
  switch (command) {
    case 'carry': {
      if (!a) throw new Error('Usage: frozen-versions.mjs carry <frozen-copy> [version]')
      console.log(`Frozen versions carried: ${carry(resolve(a), b).join(', ') || 'none'}`)
      return 0
    }
    case 'archive': {
      if (!a || !b) throw new Error('Usage: frozen-versions.mjs archive <frozen-copy> <version>')
      console.log(`Archived ${bareVersion(b)} at ${archive(resolve(a), b)}`)
      return 0
    }
    case 'check': {
      if (!a || !b) throw new Error('Usage: frozen-versions.mjs check <base-url> <frozen-copy>')
      const started = Date.now()
      const { problems, stats } = await check(a, resolve(b))
      for (const problem of problems) console.log(`FAIL: ${problem}`)
      console.log(`Checked ${stats.files} files of ${stats.versions} versions in ${stats.requests} requests, ${((Date.now() - started) / 1000).toFixed(1)} s`)
      console.log(problems.length ? `FROZEN VERSIONS FAILED at ${a}` : `FROZEN VERSIONS OK at ${a}`)
      return problems.length ? 1 : 0
    }
    case 'list': {
      for (const v of archivedVersions()) console.log(v)
      return 0
    }
    default:
      throw new Error('Usage: frozen-versions.mjs carry|archive|check|list')
  }
}

// realpath: run through a symlinked path (/tmp is one on macOS), a plain comparison is false and
// the check would exit 0 having checked nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (error) => { console.error(`frozen-versions: ${error.message}`); process.exitCode = 1 })
}
