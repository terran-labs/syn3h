/**
 * /webgpu-present-test.html, the standalone WebGPU present test, at its own .html address.
 * Bugs caught: the page answering 307 (Workers Assets' default html_handling redirects /name.html
 * to /name), which the release guard rejects as not the release's file (v26.11.2404 staging); and
 * a frozen page asking for it getting another version's copy.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import worker, { type FrozenBucket, forgetOwnVersion } from '../../server/worker'

const PAGE = '<!doctype html><title>WebGPU present test</title>'
/** Static assets as the default html_handling answers them: name.html redirects, name serves it. */
const ASSETS = {
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    if (path === '/webgpu-present-test.html') return new Response(null, { status: 307, headers: { location: '/webgpu-present-test' } })
    if (path === '/webgpu-present-test') {
      if (req.headers.get('If-None-Match') === '"page"') return new Response(null, { status: 304, headers: { etag: '"page"' } })
      return new Response(req.method === 'HEAD' ? null : PAGE, { headers: { 'content-type': 'text/html', etag: '"page"', 'cache-control': 'public, max-age=0, must-revalidate' } })
    }
    if (path === '/build.json') return new Response(JSON.stringify({ version: 'v26.11.2405' }))
    if (path === '/v/versions.json') return new Response(JSON.stringify({ versions: ['26.11.2404', '26.11.2405'] }))
    return new Response('not found', { status: 404 })
  },
}
const R2: FrozenBucket = {
  async head(key) { return key === 'v/26.11.2404/webgpu-present-test.html' ? { size: 9, httpEtag: '"old"', writeHttpMetadata: (h: Headers) => h.set('content-type', 'text/html') } : null },
  async get(key) { return key === 'v/26.11.2404/webgpu-present-test.html' ? { size: 9, httpEtag: '"old"', writeHttpMetadata: (h: Headers) => h.set('content-type', 'text/html'), body: new Response('old page!').body! } : null },
}
const env = { ASSETS, FROZEN: R2 } as never
const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => worker.fetch(new Request(`https://mira.cc${path}`, { method, headers }), env)

beforeEach(() => forgetOwnVersion())
describe('the WebGPU present test page', () => {
  it('is a 200 text/html at its .html address, with the asset\'s caching, never a redirect', async () => {
    const r = await get('/webgpu-present-test.html')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/^text\/html/)
    expect(r.headers.get('etag')).toBe('"page"'); expect(r.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(await r.text()).toBe(PAGE)
    expect((await get('/webgpu-present-test.html', { 'If-None-Match': '"page"' })).status).toBe(304)
    expect((await get('/webgpu-present-test.html', {}, 'HEAD')).status).toBe(200)
  })
  it('is each release\'s own file when that release\'s page asks for it', async () => {
    const own = await get('/webgpu-present-test.html', { Referer: 'https://mira.cc/?v=26.11.2405' })
    expect(own.status).toBe(200); expect(own.headers.get('x-syn3h-version')).toBe('26.11.2405'); expect(await own.text()).toBe(PAGE)
    const old = await get('/webgpu-present-test.html', { Referer: 'https://mira.cc/?v=26.11.2404' })
    expect(old.status).toBe(200); expect(old.headers.get('x-syn3h-version')).toBe('26.11.2404'); expect(await old.text()).toBe('old page!')
  })
  it('changes no other address', async () => {
    expect((await get('/no-such-page.html')).status).toBe(404)
    expect((await get('/webgpu-present-test')).status).toBe(200)
  })
})
