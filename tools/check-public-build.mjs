/** Verify public HTML and its entry assets against an exact frozen build before browser gates. */
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { expectedServed, robotsProblem } from './lib/served.mjs'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * With `feed`, also require the public Updates feed (/releases.json) to list this build's own
 * version first, with a summary: a release must announce itself. Off for rollbacks, whose older
 * builds predate the feed or omit themselves from it.
 */
export async function checkPublicBuild(base, dir, fetcher = fetch, { feed = false } = {}) {
  const dist = join(dir, 'dist')
  const expected = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'))
  const fetchOk = async (path) => {
    const url = new URL(path, base)
    const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`${response.status} ${url}`)
    return { body: Buffer.from(await response.arrayBuffer()), headers: response.headers }
  }
  const get = async (path) => (await fetchOk(path)).body
  const actual = JSON.parse((await get('/build.json')).toString())
  if (actual.id !== expected.id || actual.commit !== expected.commit) {
    throw new Error(`Public build ${actual.id} (${actual.commit}) differs from frozen ${expected.id} (${expected.commit})`)
  }
  const html = await readFile(join(dist, 'index.html'))
  // A beta host serves the page with its own origin for mira.cc's, and noindex (tools/lib/served.mjs).
  const page = await fetchOk('/')
  if (hash(page.body) !== hash(expectedServed(html, base, page.headers.get('content-type')))) throw new Error('Public HTML differs from frozen index.html')
  const robots = robotsProblem(base, page.headers)
  if (robots) throw new Error(robots)
  const assets = [...new Set([...html.toString().matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map((m) => m[1]))]
  if (!assets.length) throw new Error('Frozen HTML contains no script or stylesheet assets')
  for (const asset of assets) {
    const url = new URL(asset, base)
    if (url.origin !== new URL(base).origin) throw new Error(`Unexpected external entry asset ${url}`)
    const local = resolve(dist, '.' + url.pathname)
    if (!local.startsWith(resolve(dist) + '/')) throw new Error(`Asset outside frozen build: ${asset}`)
    if (hash(await get(asset)) !== hash(await readFile(local))) throw new Error(`Public asset differs from frozen file: ${asset}`)
  }
  if (feed) {
    const want = String(expected.version ?? '').replace(/^v/, '')
    if (!want) throw new Error('Frozen build.json names no version, so the Updates feed cannot be checked')
    const first = JSON.parse((await get('/releases.json')).toString()).releases?.[0]
    if (!first || String(first.version).replace(/^v/, '') !== want) throw new Error(`Public Updates feed lists v${first?.version ?? 'nothing'} first, not the deployed v${want}`)
    if (!String(first.summary ?? '').trim()) throw new Error(`Public Updates feed has no summary for v${want}`)
  }
  return { id: actual.id, commit: actual.commit, entryAssets: assets.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node tools/check-public-build.mjs <public-url> <frozen-directory> [--feed]')
    console.log('PUBLIC BUILD OK', JSON.stringify(await checkPublicBuild(process.argv[2], process.argv[3], fetch, { feed: process.argv.includes('--feed') })))
  } catch (error) { console.error('PUBLIC BUILD FAILED:', error.message); process.exitCode = 1 }
}
