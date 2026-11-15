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
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

/** A release's own files: no source maps, no upload ignore list, no nested frozen versions. */
function copyBuild(from, to) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const path = relative(from, source)
      return path !== 'v' && !path.startsWith('v/') && !path.endsWith('.map') && path !== '.assetsignore'
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

/** curl, because fetch may not set Referer, and the Referer is what picks a frozen file. */
function get(url, headers = {}) {
  const args = ['-s', '-m', '60', '-o', '-', '-w', '\n%{http_code}', ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), url]
  const out = execFileSync('curl', args, { maxBuffer: 256 * 1024 * 1024 })
  const cut = out.lastIndexOf(10)
  return { status: Number(out.subarray(cut + 1).toString()), body: out.subarray(0, cut) }
}
function head(url) {
  const out = execFileSync('curl', ['-s', '-m', '30', '-I', url], { encoding: 'utf8' })
  return Object.fromEntries(out.split(/\r?\n/).map((line) => line.match(/^([^:]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].toLowerCase(), m[2]]))
}

/**
 * Verify a running site against <copy>/dist/v: each frozen version's page, every one of its
 * files as that page would ask for it, a browser's repeat visit, and an unknown version.
 * Returns the problems found; an empty list is a pass.
 */
export function check(base, copy) {
  const root = join(copy, 'dist')
  const frozen = join(root, 'v')
  const problems = []
  const origin = new URL(base).origin
  if (!existsSync(join(frozen, 'versions.json'))) return [`${frozen} has no versions.json: this build carries no frozen versions`]
  const { versions } = JSON.parse(readFileSync(join(frozen, 'versions.json'), 'utf8'))
  if (!versions.length) problems.push('versions.json lists no versions')
  for (const v of versions) {
    const dir = join(frozen, v)
    const page = sha(readFileSync(join(dir, 'index.html')))
    for (const address of [`/?v=${v}`, `/?v=v${v}`]) {
      const got = get(origin + address)
      if (got.status !== 200 || sha(got.body) !== page) problems.push(`${address} does not serve the frozen ${v} page (HTTP ${got.status})`)
    }
    const headers = head(`${origin}/?v=${v}`)
    if (headers['x-syn3h-version'] !== v) problems.push(`/?v=${v} is not marked x-syn3h-version: ${v}`)
    // A repeat visit revalidates with the ETag. A 404 here once broke frozen pages.
    if (headers.etag) {
      const again = get(`${origin}/?v=${v}`, { 'If-None-Match': headers.etag })
      if (again.status !== 200 && again.status !== 304) problems.push(`/?v=${v} answers a repeat visit with HTTP ${again.status}`)
    }
    // Every file, asked for the way the frozen page asks: by its root path, from that page.
    for (const file of walk(dir)) {
      if (file === 'index.html') continue
      const got = get(`${origin}/${file}`, { Referer: `${origin}/?v=${v}` })
      const want = sha(readFileSync(join(dir, file)))
      if (got.status === 200 && sha(got.body) === want) continue
      // Hashed names carry no Referer rule: the latest build wins when it has the same name.
      // That is right only when the bytes are the same, so any difference is a failure.
      problems.push(`/${file} asked by the ${v} page is not that release's file (HTTP ${got.status})`)
    }
  }
  const unknown = get(`${origin}/?v=0.0.0`)
  if (unknown.status !== 404) problems.push(`an unknown version answers HTTP ${unknown.status}, not 404`)
  if (get(`${origin}/`).status !== 200) problems.push('the plain address does not answer 200')
  return problems
}

function main(argv) {
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
      const problems = check(a, resolve(b))
      for (const problem of problems) console.log(`FAIL: ${problem}`)
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (error) { console.error(`frozen-versions: ${error.message}`); process.exitCode = 1 }
}
