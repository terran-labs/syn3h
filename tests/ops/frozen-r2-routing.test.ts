/**
 * Frozen versions served from R2 (server/worker.ts fromR2), with the static assets each
 * deployment still carries as the fallback while both exist.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import worker, { type FrozenBucket } from '../../server/worker'

/** Static assets: the latest build at the root, and one frozen version under /v/. */
const files: Record<string, string> = {
  '/index.html': 'latest page',
  '/build.json': 'latest build',
  '/v/versions.json': JSON.stringify({ versions: ['26.11.1503', '26.11.1600'] }),
  '/v/26.11.1503/index.html': 'carried 1503 page',
  '/v/26.11.1503/build.json': 'carried 1503 build',
  '/v/26.11.1503/models/old.glb': 'carried old model',
}
const ASSETS = {
  async fetch(req: Request): Promise<Response> {
    let path = new URL(req.url).pathname
    if (path.endsWith('/')) path += 'index.html'
    return path in files ? new Response(files[path], { headers: { etag: `"a${path}"` } }) : new Response('not found', { status: 404 })
  },
}

/** R2 as the Workers runtime presents it, for the calls the Worker makes. */
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
  'v/26.11.1503/assets/app-AbCd1234.js': { body: 'r2 script', type: 'text/javascript; charset=utf-8' },
  'v/26.11.1503/welcome/view-640.webp': { body: 'r2 picture', type: 'image/webp' },
}
const call = (env: unknown, path: string, init: RequestInit = {}) =>
  (worker as unknown as { fetch(req: Request, env: unknown): Promise<Response> }).fetch(new Request(`https://www.syn3h.com${path}`, init), env)
const from1503 = { Referer: 'https://www.syn3h.com/?v=26.11.1503' }

describe('frozen versions from R2', () => {
  it('serves a frozen page and its files from R2 first, with type, ETag and caching by kind', async () => {
    const env = { ASSETS, FROZEN: bucket(R2) }
    const page = await call(env, '/?v=26.11.1503')
    expect(await page.text()).toBe('r2 1503 page')
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(page.headers.get('etag')).toBe('"v/26.11.1503/index.html"')
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(page.headers.get('x-syn3h-version')).toBe('26.11.1503')
    // build.json is one address for every version: revalidated, and varied by the page asking.
    const build = await call(env, '/build.json', { headers: from1503 })
    expect(await build.text()).toBe('r2 1503 build')
    expect(build.headers.get('cache-control')).toBe('no-cache')
    expect(build.headers.get('vary')).toContain('Referer')
    // A content-hashed name, or the version's own /v/ address, never changes.
    const script = await call(env, '/assets/app-AbCd1234.js', { headers: from1503 })
    expect(await script.text()).toBe('r2 script')
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const picture = await call(env, '/v/26.11.1503/welcome/view-640.webp')
    expect(await picture.text()).toBe('r2 picture')
    expect(picture.headers.get('content-type')).toBe('image/webp')
    expect(picture.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('falls back to the carried static assets when R2 lacks the object, and 404s when neither has it', async () => {
    const env = { ASSETS, FROZEN: bucket({}) }
    expect(await (await call(env, '/?v=26.11.1503')).text()).toBe('carried 1503 page')
    expect(await (await call(env, '/build.json', { headers: from1503 })).text()).toBe('carried 1503 build')
    expect(await (await call(env, '/v/26.11.1503/models/old.glb')).text()).toBe('carried old model')
    expect((await call(env, '/assets/gone-ZzZz9999.js', { headers: from1503 })).status).toBe(404)
    expect((await call(env, '/v/26.11.1503/models/never.glb')).status).toBe(404)
    // And with no binding at all (local dev, older tests), exactly as before.
    expect(await (await call({ ASSETS }, '/?v=26.11.1503')).text()).toBe('carried 1503 page')
  })

  it('answers a repeat visit with 304, a range with 206, and a HEAD without a body', async () => {
    const env = { ASSETS, FROZEN: bucket(R2) }
    const again = await call(env, '/?v=26.11.1503', { headers: { 'If-None-Match': '"v/26.11.1503/index.html"' } })
    expect(again.status).toBe(304)
    expect(again.headers.get('etag')).toBe('"v/26.11.1503/index.html"')
    const part = await call(env, '/v/26.11.1503/welcome/view-640.webp', { headers: { Range: 'bytes=3-6' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(await part.text()).toBe('pict')
    const head = await call(env, '/v/26.11.1503/welcome/view-640.webp', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')
  })

  it('answers an unknown version with the list, and asks R2 nothing for the latest build', async () => {
    const FROZEN = bucket(R2)
    const env = { ASSETS, FROZEN }
    for (const address of ['/?v=1.2.3', '/?v=banana']) {
      const response = await call(env, address)
      expect(response.status).toBe(404)
      expect(await response.text()).toContain('https://www.syn3h.com/?v=26.11.1600')
    }
    FROZEN.keys.length = 0
    expect(await (await call(env, '/')).text()).toBe('latest page')
    expect(await (await call(env, '/build.json', { headers: { Referer: 'https://www.syn3h.com/' } })).text()).toBe('latest build')
    expect(FROZEN.keys).toEqual([])
  })

  it('never writes to the bucket: the Worker has no path that could damage the archive', () => {
    for (const file of readdirSync('server').filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join('server', file), 'utf8')
      expect(source, file).not.toMatch(/FROZEN\s*\??\.\s*(put|delete|createMultipartUpload|resumeMultipartUpload)\b/)
    }
  })
})
