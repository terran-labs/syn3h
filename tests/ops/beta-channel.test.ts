/**
 * The beta channel (shared/channel.ts): beta.mira.cc runs the same frozen build that is later
 * promoted to mira.cc, so everything channel-specific is decided at run time from the hostname.
 * Bugs caught, each by its own case below:
 * - a beta page taken for production, or production for beta (channelOf);
 * - a beta build indexed by search engines (robots.txt, X-Robots-Tag on beta hosts);
 * - a beta tester's shared link or share card pointing at mira.cc (forBeta, invites);
 * - production's responses or labels changed by the beta work (byte-for-byte checks);
 * - a tester unable to tell beta from production (the version mark);
 * - the Updates notice leaving beta for production (root-relative feed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { channelOf } from '../../shared/channel'
import worker, { forgetOwnVersion } from '../../server/worker'
import { inviteAddress } from '../../src/ui/LobbyAddress'
import { versionText } from '../../src/ui/LobbySettings'
import { FEED_URL, VERSIONS_URL } from '../../src/ui/updates/feed'
import { systemReportLines } from '../../src/core/diagnosticSystem'

describe('which channel a host is', () => {
  it('is beta on beta.* and any workers.dev address, production everywhere else', () => {
    for (const host of ['beta.mira.cc', 'BETA.mira.cc', 'beta.mira.cc.', 'syn3h-staging.example.workers.dev']) expect(channelOf(host), host).toBe('beta')
    for (const host of ['mira.cc', 'www.mira.cc', 'syn3h.com', 'localhost', '127.0.0.1', 'notbeta.mira.cc', 'workers.dev.example.com']) expect(channelOf(host), host).toBe('production')
  })
})

const PAGE = '<!doctype html><meta property="og:url" content="https://mira.cc/" /><meta property="og:image" content="https://mira.cc/brand/mira3-share.png" /><title>Mira</title>'
const ASSETS = {
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    if (path === '/' || path === '/index.html') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"page"' } })
    if (path === '/build.json') return new Response(JSON.stringify({ version: 'v26.11.2500' }), { headers: { 'content-type': 'application/json' } })
    if (path === '/v/versions.json') return new Response(JSON.stringify({ versions: ['26.11.2405', '26.11.2500'] }), { headers: { 'content-type': 'application/json' } })
    if (path === '/assets/app-AbCd1234.js') return new Response('script', { headers: { 'content-type': 'text/javascript' } })
    return new Response('not found', { status: 404 })
  },
}
const env = { ASSETS } as never
const get = (href: string) => worker.fetch(new Request(href), env)
beforeEach(() => forgetOwnVersion())

describe('the Worker by hostname', () => {
  it('on beta: robots.txt disallows everything, and pages say noindex and share this host', async () => {
    for (const origin of ['https://beta.mira.cc', 'https://syn3h-staging.example.workers.dev']) {
      const robots = await get(origin + '/robots.txt')
      expect(robots.status).toBe(200); expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
      const page = await get(origin + '/')
      expect(page.headers.get('x-robots-tag')).toBe('noindex')
      const html = await page.text()
      expect(html).not.toContain('https://mira.cc/')
      expect(html).toContain(`content="${origin}/"`); expect(html).toContain(`content="${origin}/brand/mira3-share.png"`)
      // The unknown-version page lists this host's addresses, not production's.
      expect(await (await get(origin + '/?v=1.2.3')).text()).not.toContain('https://mira.cc/')
      // Scripts are left exactly as they are.
      const script = await get(origin + '/assets/app-AbCd1234.js')
      expect(script.headers.get('x-robots-tag')).toBeNull(); expect(await script.text()).toBe('script')
    }
  })
  it('on production: nothing changes, byte for byte', async () => {
    const page = await get('https://mira.cc/')
    expect(page.headers.get('x-robots-tag')).toBeNull()
    expect(await page.text()).toBe(PAGE)
    expect(page.headers.get('etag')).toBe('"page"')
    // No robots.txt of the Worker's own: production's is whatever the assets serve.
    expect((await get('https://mira.cc/robots.txt')).status).toBe(404)
    expect(await (await get('https://mira.cc/?v=1.2.3')).text()).toContain('https://mira.cc/?v=26.11.2500')
  })
})

describe('what a beta page shows and shares', () => {
  it('invites and Copy link are built from the page\'s own host, and production\'s are unchanged', () => {
    expect(new URL(inviteAddress(new URL('https://beta.mira.cc/?v=26.11.2500'), 'friends', 'alpine.1')).origin).toBe('https://beta.mira.cc')
    expect(inviteAddress(new URL('https://mira.cc/'), 'friends', 'alpine.1')).toBe('https://mira.cc/?room=friends&world=alpine.1')
  })
  it('marks the version quietly on beta and leaves production\'s label as it was', () => {
    expect(versionText('v26.11.2500', 'beta')).toBe('v26.11.2500 · beta')
    expect(versionText('v26.11.2500', 'production')).toBe('v26.11.2500')
  })
  it('names the channel in the copied report only on beta', () => {
    vi.stubGlobal('location', { hostname: 'beta.mira.cc', href: 'https://beta.mira.cc/' })
    expect(systemReportLines(null).find(l => l.startsWith('Version:'))).toMatch(/\(beta\)$/)
    vi.stubGlobal('location', { hostname: 'mira.cc', href: 'https://mira.cc/' })
    expect(systemReportLines(null).find(l => l.startsWith('Version:'))).not.toMatch(/beta/)
  })
  it('reads the Updates feed and version list from its own host, never production\'s', () => {
    expect(FEED_URL.startsWith('/')).toBe(true); expect(VERSIONS_URL.startsWith('/')).toBe(true)
  })
})
afterEach(() => vi.unstubAllGlobals())
