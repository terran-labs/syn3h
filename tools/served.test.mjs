// What a host serves for a frozen file (tools/lib/served.mjs). Bugs caught: a beta host's page,
// which the Worker rewrites to its own origin, judged as "not the frozen build" (the first beta's
// staging settle, 25 November 2026); a production host allowed anything but the exact bytes; a
// beta page without noindex passing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPublicBuild } from './check-public-build.mjs'
import { expectedServed, isBetaHost, robotsProblem } from './lib/served.mjs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('beta hosts are beta.* and every workers.dev address; production is exact', () => {
  for (const u of ['https://beta.mira.cc/', 'https://syn3h-staging.af-4e7.workers.dev/', 'https://syn3h.af-4e7.workers.dev/']) assert.equal(isBetaHost(u), true, u)
  for (const u of ['https://mira.cc/', 'https://www.mira.cc/', 'http://127.0.0.1:8795/']) assert.equal(isBetaHost(u), false, u)
  const page = Buffer.from('<meta property="og:url" content="https://mira.cc/">')
  assert.equal(expectedServed(page, 'https://mira.cc/', 'text/html').toString(), page.toString())
  assert.equal(expectedServed(page, 'https://beta.mira.cc/', 'text/html; charset=utf-8').toString(), '<meta property="og:url" content="https://beta.mira.cc/">')
  assert.equal(expectedServed(page, 'https://beta.mira.cc/', 'application/javascript').toString(), page.toString(), 'scripts are never rewritten')
  assert.match(robotsProblem('https://beta.mira.cc/', new Headers({ 'content-type': 'text/html' })), /noindex/)
  assert.equal(robotsProblem('https://beta.mira.cc/', new Headers({ 'content-type': 'text/html', 'x-robots-tag': 'noindex' })), null)
  assert.equal(robotsProblem('https://mira.cc/', new Headers({ 'content-type': 'text/html' })), null)
})

test('checkPublicBuild accepts a beta host serving the rewritten page with noindex, and nothing else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mira-served-')), dist = join(dir, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'build.json'), JSON.stringify({ id: 'x', commit: 'c' }))
  const html = '<link rel="stylesheet" href="/assets/a.css"><meta property="og:url" content="https://mira.cc/">'
  writeFileSync(join(dist, 'index.html'), html)
  writeFileSync(join(dist, 'assets', 'a.css'), 'body{}')
  const serve = (pageBody, robots) => async (url) => {
    const path = new URL(url).pathname
    if (path === '/build.json') return new Response(JSON.stringify({ id: 'x', commit: 'c' }))
    if (path === '/assets/a.css') return new Response('body{}', { headers: { 'content-type': 'text/css' } })
    return new Response(pageBody, { headers: { 'content-type': 'text/html', ...(robots ? { 'x-robots-tag': 'noindex' } : {}) } })
  }
  const rewritten = html.replace('https://mira.cc/', 'https://beta.mira.cc/')
  assert.equal((await checkPublicBuild('https://beta.mira.cc/', dir, serve(rewritten, true))).id, 'x')
  await assert.rejects(checkPublicBuild('https://beta.mira.cc/', dir, serve(rewritten, false)), /noindex/)
  await assert.rejects(checkPublicBuild('https://beta.mira.cc/', dir, serve(html, true)), /differs from frozen index\.html/)
  assert.equal((await checkPublicBuild('https://mira.cc/', dir, serve(html, false))).id, 'x')
  await assert.rejects(checkPublicBuild('https://mira.cc/', dir, serve(rewritten, false)), /differs from frozen index\.html/)
})
