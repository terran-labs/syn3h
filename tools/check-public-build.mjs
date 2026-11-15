/** Verify public HTML and its entry assets against an exact frozen build before browser gates. */
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function checkPublicBuild(base, dir, fetcher = fetch) {
  const dist = join(dir, 'dist')
  const expected = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'))
  const get = async (path) => {
    const url = new URL(path, base)
    const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`${response.status} ${url}`)
    return Buffer.from(await response.arrayBuffer())
  }
  const actual = JSON.parse((await get('/build.json')).toString())
  if (actual.id !== expected.id || actual.commit !== expected.commit) {
    throw new Error(`Public build ${actual.id} (${actual.commit}) differs from frozen ${expected.id} (${expected.commit})`)
  }
  const html = await readFile(join(dist, 'index.html'))
  if (hash(await get('/')) !== hash(html)) throw new Error('Public HTML differs from frozen index.html')
  const assets = [...new Set([...html.toString().matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map((m) => m[1]))]
  if (!assets.length) throw new Error('Frozen HTML contains no script or stylesheet assets')
  for (const asset of assets) {
    const url = new URL(asset, base)
    if (url.origin !== new URL(base).origin) throw new Error(`Unexpected external entry asset ${url}`)
    const local = resolve(dist, '.' + url.pathname)
    if (!local.startsWith(resolve(dist) + '/')) throw new Error(`Asset outside frozen build: ${asset}`)
    if (hash(await get(asset)) !== hash(await readFile(local))) throw new Error(`Public asset differs from frozen file: ${asset}`)
  }
  return { id: actual.id, commit: actual.commit, entryAssets: assets.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node tools/check-public-build.mjs <public-url> <frozen-directory>')
    console.log('PUBLIC BUILD OK', JSON.stringify(await checkPublicBuild(process.argv[2], process.argv[3])))
  } catch (error) { console.error('PUBLIC BUILD FAILED:', error.message); process.exitCode = 1 }
}
