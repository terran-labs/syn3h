import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { externaliseRapierWasm, physicsEarlyFetchTag } from './rapier-wasm.mjs'

const blob = n => 'QUJD'.repeat(n)
const shaped = (...blobs) => `const a=1;${blobs.map(b => `init({module_or_path:oC.toByteArray("${b}").buffer});`).join('')}export{a}`

test('removes the one inlined binary and asks the loader for it', () => {
  const out = externaliseRapierWasm(shaped(blob(30000)), '/abs/physicsWasm.ts')
  assert.ok(out.length < 600)
  assert.match(out, /^import __miraPhysicsWasmUrl from '\.\/rapier_wasm3d_bg\.wasm\?url'\nimport \{ loadPhysicsWasm as __miraPhysicsWasm \} from "\/abs\/physicsWasm\.ts"\n/)
  assert.match(out, /init\(\{module_or_path:__miraPhysicsWasm\(__miraPhysicsWasmUrl\)\}\)/)
})
test('fails closed on anything but exactly one inlined binary', () => {
  assert.throws(() => externaliseRapierWasm('export const a=1', '/x'), /found 0/)
  assert.throws(() => externaliseRapierWasm(shaped(blob(30000), blob(30000)), '/x'), /found 2/)
  // A binary inlined some other way would ship beside the separate file: refuse.
  assert.throws(() => externaliseRapierWasm(shaped(blob(30000)) + `;const other="${blob(30000)}"`, '/x'), /1 more inlined/)
  // A short string is not a binary and is not expected: still nothing to rewrite.
  assert.throws(() => externaliseRapierWasm(shaped(blob(10)), '/x'), /found 0/)
})
test('rewrites the installed package', () => {
  const source = readFileSync(new URL('../node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url), 'utf8')
  const out = externaliseRapierWasm(source, '/x')
  assert.ok(source.length > 4_000_000 && out.length < 400_000, `${source.length} -> ${out.length}`)
  assert.equal(out.match(/[A-Za-z0-9+/=]{100000,}/), null)
})
test('starts the download of exactly one emitted binary from the page head', () => {
  const tag = physicsEarlyFetchTag(['assets/index-abc.js', 'assets/rapier_wasm3d_bg-Dx9_k2.wasm'], '/')
  assert.deepEqual({ tag: tag.tag, injectTo: tag.injectTo }, { tag: 'script', injectTo: 'head-prepend' })
  // Run the script as the page would: one request, kept with its address for the loader.
  const calls = [], window = {}
  new Function('window', 'fetch', tag.children)(window, url => { calls.push(url); return Promise.resolve('response') })
  assert.deepEqual(calls, ['/assets/rapier_wasm3d_bg-Dx9_k2.wasm'])
  assert.equal(window.__miraPhysicsWasm.url, '/assets/rapier_wasm3d_bg-Dx9_k2.wasm')
  assert.throws(() => physicsEarlyFetchTag(['assets/index-abc.js']), /found 0/)
  assert.throws(() => physicsEarlyFetchTag(['assets/rapier_wasm3d_bg-a.wasm', 'assets/rapier_wasm3d_bg-b.wasm']), /found 2/)
})
test('a failed early request becomes a value, not an unhandled rejection', async () => {
  const tag = physicsEarlyFetchTag(['assets/rapier_wasm3d_bg-a.wasm'], '/'), window = {}
  new Function('window', 'fetch', tag.children)(window, () => Promise.reject(new TypeError('offline')))
  assert.ok(await window.__miraPhysicsWasm.response instanceof TypeError)
})
test('counts the engine as it arrives, before the loader reads it, and lets the loader end the request', async () => {
  // Bugs caught: the veil's count standing still until the game's script starts reading (Slow 4G,
  // 25 November 2026); a stalled early request left running, and counting, beside a retry.
  const tag = physicsEarlyFetchTag(['assets/rapier_wasm3d_bg-a.wasm'], '/'), window = {}
  let push, signal
  const body = new ReadableStream({ start(c) { push = c } })
  new Function('window', 'fetch', tag.children)(window, (_url, init) => { signal = init.signal; return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/wasm' } })) })
  const response = await window.__miraPhysicsWasm.response
  push.enqueue(new Uint8Array(1000)); push.enqueue(new Uint8Array(500))
  await new Promise(r => setTimeout(r, 0))
  assert.equal(window.__miraPhysicsBytes, 1500, 'counted with nobody reading the response')
  assert.equal(response.headers.get('content-type'), 'application/wasm')
  assert.ok(response.body instanceof ReadableStream && !response.bodyUsed, 'the loader gets an unread stream')
  // The loader still receives every byte.
  push.close()
  assert.equal((await response.arrayBuffer()).byteLength, 1500)
  assert.equal(signal.aborted, false)
  window.__miraPhysicsWasm.abort()
  assert.equal(signal.aborted, true)
})
