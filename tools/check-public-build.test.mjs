import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPublicBuild } from './check-public-build.mjs'

for (const failure of [null, 'identity', 'html', 'missing', 'asset']) {
  test(`public build integrity: ${failure ?? 'matching deployment'}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'syn3h-public-integrity-'))
    try {
      await mkdir(join(dir, 'dist/assets'), { recursive: true })
      const files = { '/build.json': JSON.stringify({ id: 'frozen', commit: 'abc' }), '/': '<script type="module" src="/assets/main-123.js"></script>', '/assets/main-123.js': 'console.log("ready")' }
      for (const [path, value] of Object.entries(files)) await writeFile(join(dir, 'dist', path === '/' ? 'index.html' : path), value)
      const fetcher = async (url) => {
        const p = url.pathname
        if (failure === 'missing' && p.endsWith('.js')) return new Response('', { status: 404 })
        let value = files[p]
        if (failure === 'identity' && p === '/build.json') value = JSON.stringify({ id: 'old', commit: 'def' })
        if (failure === 'html' && p === '/') value = 'old HTML'
        if (failure === 'asset' && p.endsWith('.js')) value = 'old script'
        return new Response(value)
      }
      if (failure) await assert.rejects(checkPublicBuild('https://example.test/', dir, fetcher), /differs|404/)
      else assert.deepEqual(await checkPublicBuild('https://example.test/', dir, fetcher), { id: 'frozen', commit: 'abc', entryAssets: 1 })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
}

for (const failure of [null, 'older-first', 'no-summary']) {
  test(`public Updates feed: ${failure ?? 'lists the deployed version first'}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'syn3h-public-feed-'))
    try {
      await mkdir(join(dir, 'dist/assets'), { recursive: true })
      const feed = { releases: [{ version: failure === 'older-first' ? '26.11.1606' : '26.11.1607', summary: failure === 'no-summary' ? ' ' : 'Boxes become buggies again' }] }
      const files = { '/build.json': JSON.stringify({ id: 'frozen', commit: 'abc', version: 'v26.11.1607' }), '/': '<script type="module" src="/assets/main-123.js"></script>', '/assets/main-123.js': 'x', '/releases.json': JSON.stringify(feed) }
      for (const [path, value] of Object.entries(files)) if (path !== '/releases.json') await writeFile(join(dir, 'dist', path === '/' ? 'index.html' : path), value)
      const fetcher = async (url) => new Response(files[url.pathname])
      const run = checkPublicBuild('https://example.test/', dir, fetcher, { feed: true })
      if (failure) await assert.rejects(run, failure === 'older-first' ? /lists v26\.11\.1606 first/ : /no summary/)
      else assert.equal((await run).id, 'frozen')
      // Without the flag (a rollback), the feed is not consulted.
      assert.equal((await checkPublicBuild('https://example.test/', dir, fetcher)).id, 'frozen')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
}
