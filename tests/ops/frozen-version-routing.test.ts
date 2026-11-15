/**
 * The address that serves a frozen release: https://www.syn3h.com/?v=<version>.
 *
 * The owner's rule of 15 November 2026: judges load the build frozen before noon by a version
 * in the address while newer builds keep shipping. These pin how server/worker.ts chooses
 * files once a later release has replaced the root build, including the repeat visit that
 * was broken in the first deployment (a 304 from the asset store was read as "not found").
 */
import { expect, it } from 'vitest'
import worker from '../../server/worker'

/** An asset store holding a later release at the root and v26.11.1503 under /v/. */
const files: Record<string, string> = {
  '/index.html': 'latest page',
  '/build.json': 'latest build',
  '/models/buggy.glb': 'latest buggy',
  '/assets/app-NEW.js': 'latest script',
  '/v/versions.json': JSON.stringify({ versions: ['26.11.1503'] }),
  '/v/26.11.1503/index.html': 'frozen page',
  '/v/26.11.1503/build.json': 'frozen build',
  '/v/26.11.1503/models/buggy.glb': 'frozen buggy',
  '/v/26.11.1503/assets/app-OLD.js': 'frozen script',
}
const etag = (path: string) => `"${path}"`
const ASSETS = {
  async fetch(req: Request): Promise<Response> {
    let path = new URL(req.url).pathname
    if (path.endsWith('/')) path += 'index.html'
    if (!(path in files)) return new Response('not found', { status: 404 })
    if (req.headers.get('If-None-Match') === etag(path)) return new Response(null, { status: 304, headers: { etag: etag(path) } })
    return new Response(files[path], { headers: { etag: etag(path) } })
  },
}
const get = (path: string, headers: Record<string, string> = {}) =>
  (worker as unknown as { fetch(req: Request, env: unknown): Promise<Response> }).fetch(new Request(`https://www.syn3h.com${path}`, { headers }), { ASSETS })
const fromFrozenPage = { Referer: 'https://www.syn3h.com/?v=26.11.1503&autoplay=1' }

it('serves the latest build at the plain address and the frozen page by version', async () => {
  expect(await (await get('/')).text()).toBe('latest page')
  for (const address of ['/?v=26.11.1503', '/?v=v26.11.1503', '/index.html?v=26.11.1503&room=abc']) {
    const response = await get(address)
    expect(await response.text()).toBe('frozen page')
    expect(response.headers.get('x-syn3h-version')).toBe('26.11.1503')
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
})

it('gives the frozen page its own unhashed files and its replaced hashed files', async () => {
  expect(await (await get('/build.json', fromFrozenPage)).text()).toBe('frozen build')
  expect(await (await get('/models/buggy.glb', fromFrozenPage)).text()).toBe('frozen buggy')
  expect((await get('/models/buggy.glb', fromFrozenPage)).headers.get('vary')).toContain('Referer')
  // The latest page keeps the latest copies of the same names.
  expect(await (await get('/build.json', { Referer: 'https://www.syn3h.com/' })).text()).toBe('latest build')
  expect(await (await get('/models/buggy.glb')).text()).toBe('latest buggy')
  // A hashed file the latest build no longer has is found in the release that owns it.
  expect(await (await get('/assets/app-OLD.js', fromFrozenPage)).text()).toBe('frozen script')
  expect(await (await get('/assets/app-NEW.js')).text()).toBe('latest script')
  expect((await get('/assets/never-existed.js')).status).toBe(404)
})

it('answers a repeat visit, which revalidates by ETag, with the frozen release and not a 404', async () => {
  const page = await get('/?v=26.11.1503', { 'If-None-Match': etag('/v/26.11.1503/index.html') })
  expect(page.status).toBe(304)
  const script = await get('/assets/app-OLD.js', { ...fromFrozenPage, 'If-None-Match': etag('/v/26.11.1503/assets/app-OLD.js') })
  expect(script.status).toBe(304)
  const model = await get('/models/buggy.glb', { ...fromFrozenPage, 'If-None-Match': etag('/v/26.11.1503/models/buggy.glb') })
  expect(model.status).toBe(304)
  expect(model.headers.get('x-syn3h-version')).toBe('26.11.1503')
})

it('answers an unknown or malformed version with the list of frozen links', async () => {
  for (const address of ['/?v=1.2.3', '/?v=banana', '/?v=']) {
    const response = await get(address)
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('https://www.syn3h.com/?v=26.11.1503')
  }
})
