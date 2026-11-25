// The Worker entry must load in the real Workers runtime (workerd, through Miniflare).
//
// Bug this guards against: on 25 November 2026 a branch's entry module exported two numbers. Every
// unit test passed, because vitest imports the module as plain JavaScript, but workerd refuses
// such an entry ("Incorrect type for map entry ...") and the whole game would have been down.
// This bundles server/worker.ts as wrangler does and asks it for /status and /presence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('the Worker entry loads in workerd and answers /status and /presence', async () => {
  const out = await build({
    entryPoints: [`${root}server/worker.ts`],
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false,
    conditions: ['workerd', 'worker', 'browser'], logLevel: 'silent',
  })
  // Miniflare 5 still takes the familiar (v4) option shape through its converter.
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: out.outputFiles[0].text,
    compatibilityDate: '2026-11-01',
    durableObjects: { ROOMS: 'RoomDO' },
    serviceBindings: { ASSETS: () => new Response('asset') },
  }))
  try {
    const status = await mf.dispatchFetch('http://localhost/status')
    assert.equal(status.status, 200)
    assert.deepEqual(await status.json(), { rooms: 0, players: 0 })
    const presence = await mf.dispatchFetch('http://localhost/presence')
    assert.equal(presence.status, 200)
    assert.equal((await presence.json()).version, 1)
  } finally {
    await mf.dispose()
  }
})
