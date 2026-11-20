/**
 * The address that serves a frozen release: https://www.syn3h.com/?v=<version>.
 *
 * The owner's rule of 15 November 2026: judges load the build frozen before noon by a version in
 * the address while newer builds keep shipping. Step two of the move to R2 (server/worker.ts):
 * the deployment's own version comes from its own static assets, so its link works before it is
 * archived; every other version comes from R2 only, and deployments carry none.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import worker, { type FrozenBucket, forgetOwnVersion } from '../../server/worker'

/** Static assets: the deployment, v26.11.1700, at the root, and the list of versions. No old files. */
const files: Record<string, string> = {
  '/index.html': 'latest page',
  '/build.json': JSON.stringify({ version: 'v26.11.1700' }),
  '/models/buggy.glb': 'latest buggy',
  '/assets/app-NEW-QqWw1234.js': 'latest script',
  '/v/versions.json': JSON.stringify({ versions: ['26.11.1503', '26.11.1600', '26.11.1700'] }),
}
const ASSETS = {
  async fetch(req: Request): Promise<Response> {
    let path = new URL(req.url).pathname
    if (path.endsWith('/')) path += 'index.html'
    if (!(path in files)) return new Response('not found', { status: 404 })
    if (req.headers.get('If-None-Match') === `"a${path}"`) return new Response(null, { status: 304, headers: { etag: `"a${path}"` } })
    return new Response(files[path], { headers: { etag: `"a${path}"` } })
  },
}

/** R2 as the Workers runtime presents it, for the calls the Worker makes; `keys` records reads. */
function bucket(objects: Record<string, { body: string; type: string }>): FrozenBucket & { keys: string[] } {
  const keys: string[] = []
  const meta = (key: string) => {
    const o = objects[key]
    return { size: o.body.length, httpEtag: `"${key}"`, writeHttpMetadata: (h: Headers) => h.set('content-type', o.type) }
  }
  return {
    keys,
    async head(key) { keys.push(key); return objects[key] ? meta(key) : null },
    async get(key, options) {
      keys.push(key)
      const o = objects[key]
      if (!o) return null
      if (options?.onlyIf?.get('If-None-Match') === `"${key}"`) return meta(key)
      const range = /^bytes=(\d+)-(\d+)$/.exec(options?.range?.get('Range') ?? '')
      if (range) {
        const offset = Number(range[1]), length = Number(range[2]) - offset + 1
        return { ...meta(key), range: { offset, length }, body: new Response(o.body.slice(offset, offset + length)).body! }
      }
      return { ...meta(key), body: new Response(o.body).body! }
    },
  }
}
const R2 = {
  'v/26.11.1503/index.html': { body: 'r2 1503 page', type: 'text/html; charset=utf-8' },
  'v/26.11.1503/build.json': { body: 'r2 1503 build', type: 'application/json' },
  'v/26.11.1503/models/buggy.glb': { body: 'r2 1503 buggy', type: 'model/gltf-binary' },
  'v/26.11.1503/assets/app-OLD-AbCd1234.js': { body: 'r2 old script', type: 'text/javascript; charset=utf-8' },
  'v/26.11.1503/welcome/view-640.webp': { body: 'r2 picture', type: 'image/webp' },
  'v/26.11.1600/index.html': { body: 'r2 1600 page', type: 'text/html; charset=utf-8' },
  'v/26.11.1600/build.json': { body: 'r2 1600 build', type: 'application/json' },
}
const call = (env: unknown, path: string, init: RequestInit = {}) =>
  (worker as unknown as { fetch(req: Request, env: unknown): Promise<Response> }).fetch(new Request(`https://www.syn3h.com${path}`, init), env)
const from = (v: string) => ({ Referer: `https://www.syn3h.com/?v=${v}&autoplay=1` })

describe('frozen versions', () => {
  let FROZEN: ReturnType<typeof bucket>
  let env: { ASSETS: typeof ASSETS; FROZEN: ReturnType<typeof bucket> }
  beforeEach(() => { forgetOwnVersion(); FROZEN = bucket(R2); env = { ASSETS, FROZEN } })

  it('serves its own version from its own assets from the first minute, asking R2 nothing', async () => {
    const page = await call(env, '/?v=26.11.1700')
    expect(await page.text()).toBe('latest page')
    expect(page.headers.get('x-syn3h-version')).toBe('26.11.1700')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const build = await call(env, '/build.json', { headers: from('26.11.1700') })
    expect(JSON.parse(await build.text()).version).toBe('v26.11.1700')
    expect(build.headers.get('vary')).toContain('Referer')
    expect(await (await call(env, '/v/26.11.1700/models/buggy.glb')).text()).toBe('latest buggy')
    expect((await call(env, '/?v=26.11.1700', { headers: { 'If-None-Match': '"a/index.html"' } })).status).toBe(304)
    expect(FROZEN.keys).toEqual([])
  })

  it('serves every other version from R2, with type, ETag and caching by kind', async () => {
    for (const address of ['/?v=26.11.1503', '/?v=v26.11.1503', '/index.html?v=26.11.1503&room=abc']) {
      const page = await call(env, address)
      expect(await page.text()).toBe('r2 1503 page')
      expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(page.headers.get('etag')).toBe('"v/26.11.1503/index.html"')
      expect(page.headers.get('cache-control')).toBe('no-store')
      expect(page.headers.get('x-syn3h-version')).toBe('26.11.1503')
    }
    // build.json and models are one address for every version: revalidated, varied by the page.
    const build = await call(env, '/build.json', { headers: from('26.11.1503') })
    expect(await build.text()).toBe('r2 1503 build')
    expect(build.headers.get('cache-control')).toBe('no-cache')
    expect(build.headers.get('vary')).toContain('Referer')
    expect(await (await call(env, '/models/buggy.glb', { headers: from('26.11.1503') })).text()).toBe('r2 1503 buggy')
    // A content-hashed name, or the version's own /v/ address, never changes.
    const script = await call(env, '/assets/app-OLD-AbCd1234.js', { headers: from('26.11.1503') })
    expect(await script.text()).toBe('r2 old script')
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const picture = await call(env, '/v/26.11.1503/welcome/view-640.webp')
    expect(await picture.text()).toBe('r2 picture')
    expect(picture.headers.get('content-type')).toBe('image/webp')
    // The latest page keeps the latest copies of the same names.
    expect(await (await call(env, '/models/buggy.glb', { headers: from('26.11.1700') })).text()).toBe('latest buggy')
    expect(await (await call(env, '/models/buggy.glb')).text()).toBe('latest buggy')
  })

  it('has no fallback to carried copies: what R2 lacks is not served as that version', async () => {
    const empty = { ASSETS, FROZEN: bucket({}) }
    const page = await call(empty, '/?v=26.11.1503')
    expect(page.status).toBe(404)
    expect(await page.text()).toContain('https://www.syn3h.com/?v=26.11.1503')
    expect((await call(empty, '/v/26.11.1503/welcome/view-640.webp')).status).toBe(404)
    // A root file the version never had is the latest build's, unmarked, as before.
    const model = await call(env, '/models/buggy.glb', { headers: from('26.11.1600') })
    expect(await model.text()).toBe('latest buggy')
    expect(model.headers.get('x-syn3h-version')).toBeNull()
    expect((await call(env, '/assets/gone-ZzZz9999.js', { headers: from('26.11.1503') })).status).toBe(404)
  })

  it('answers a repeat visit with 304, a range with 206, and a HEAD without a body', async () => {
    const again = await call(env, '/?v=26.11.1503', { headers: { 'If-None-Match': '"v/26.11.1503/index.html"' } })
    expect(again.status).toBe(304)
    expect(again.headers.get('etag')).toBe('"v/26.11.1503/index.html"')
    const model = await call(env, '/models/buggy.glb', { headers: { ...from('26.11.1503'), 'If-None-Match': '"v/26.11.1503/models/buggy.glb"' } })
    expect(model.status).toBe(304)
    expect(model.headers.get('x-syn3h-version')).toBe('26.11.1503')
    const part = await call(env, '/v/26.11.1503/welcome/view-640.webp', { headers: { Range: 'bytes=3-6' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(await part.text()).toBe('pict')
    const head = await call(env, '/v/26.11.1503/welcome/view-640.webp', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')
  })

  it('finds a stored version\'s content-hashed file asked without a Referer, and 404s a made-up one', async () => {
    const script = await call(env, '/assets/app-OLD-AbCd1234.js')
    expect(script.status).toBe(200)
    expect(await script.text()).toBe('r2 old script')
    expect(script.headers.get('x-syn3h-version')).toBe('26.11.1503')
    expect((await call(env, '/assets/nope-Zz9Qx7Lk.js')).status).toBe(404)
    // Many versions: still found in the oldest, still 404 for a name nobody has.
    const versions = Array.from({ length: 60 }, (_, i) => `26.12.${1000 + i}`)
    const many = { [`v/${versions[0]}/assets/first-Aa11Bb22.js`]: { body: 'oldest', type: 'text/javascript' } }
    const wide = { ASSETS: { fetch: async (req: Request) => new URL(req.url).pathname === '/v/versions.json' ? new Response(JSON.stringify({ versions })) : ASSETS.fetch(req) }, FROZEN: bucket(many) }
    forgetOwnVersion()
    expect(await (await call(wide, '/assets/first-Aa11Bb22.js')).text()).toBe('oldest')
    expect((await call(wide, '/assets/nope-Zz9Qx7Lk.js')).status).toBe(404)
  })

  it('answers an unknown version with the list, and asks R2 nothing for the latest build', async () => {
    for (const address of ['/?v=1.2.3', '/?v=banana', '/?v=']) {
      const response = await call(env, address)
      expect(response.status).toBe(404)
      expect(await response.text()).toContain('https://www.syn3h.com/?v=26.11.1600')
    }
    FROZEN.keys.length = 0
    expect(await (await call(env, '/')).text()).toBe('latest page')
    expect(await (await call(env, '/build.json', { headers: { Referer: 'https://www.syn3h.com/' } })).text()).toContain('26.11.1700')
    expect(await (await call(env, '/assets/app-NEW-QqWw1234.js')).text()).toBe('latest script')
    // The Updates banner's list comes from the deployment, whatever page asks.
    expect(JSON.parse(await (await call(env, '/v/versions.json', { headers: from('26.11.1503') })).text()).versions).toContain('26.11.1700')
    expect(FROZEN.keys).toEqual([])
  })

  it('never writes to the bucket: the Worker has no path that could damage the archive', () => {
    for (const file of readdirSync('server').filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join('server', file), 'utf8')
      expect(source, file).not.toMatch(/FROZEN\s*\??\.\s*(put|delete|createMultipartUpload|resumeMultipartUpload)\b/)
    }
  })
})
