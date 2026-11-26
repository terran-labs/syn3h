import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPhysicsWasm, PhysicsLoadError, physicsWasmLoad, type PhysicsRetryNotice } from '../../src/core/physicsWasm'
import { externaliseRapierWasm } from '../../tools/rapier-wasm.mjs'

/** The smallest valid module: the magic number and version. */
const EMPTY = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
const RAPIER_WASM = readFileSync(new URL('../../node_modules/@dimforge/rapier3d-compat/dist/rapier_wasm3d_bg.wasm', import.meta.url))
const wasm = (type = 'application/wasm', bytes: Uint8Array = EMPTY) => new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'Content-Type': type } })
/** Each way a download can go wrong, all of which must be retried. */
const FAILURES: Array<[string, () => Promise<Response>]> = [
  ['network error', async () => { throw new TypeError('Failed to fetch') }],
  ['missing', async () => new Response('gone', { status: 404 })],
  ['wrong content type', async () => wasm('application/octet-stream')],
  ['truncated body', async () => wasm('application/wasm', RAPIER_WASM.subarray(0, 100000))],
  ['not WebAssembly', async () => wasm('application/wasm', new Uint8Array([1, 2, 3]))],
]
/** Records what the player would be shown. */
const recorder = () => {
  const seen: string[] = []; let retry: (() => void) | null = null
  const notice: PhysicsRetryNotice = { retrying: () => seen.push('retrying'), failed: r => { seen.push('failed'); retry = r }, clear: () => seen.push('clear') }
  return { notice, seen, retry: () => retry?.() }
}
const quick = { backoffMs: () => 0, onOnline: () => () => {} }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
describe('physics WebAssembly loading', () => {
  it('compiles while streaming, one request, nothing shown', async () => {
    const { notice, seen } = recorder(); let calls = 0
    const module = await loadPhysicsWasm('/assets/x.wasm', { ...quick, notice, fetch: async () => { calls++; return wasm() } })
    expect(module).toBeInstanceOf(WebAssembly.Module)
    expect(calls).toBe(1); expect(seen).toEqual(['clear'])
    expect(physicsWasmLoad).toMatchObject({ url: '/assets/x.wasm', error: null, attempts: 1 })
  })

  // Bug: one dropped download leaves the player on a dead page, or a retry is answered from the
  // browser's cache with the same bad file.
  it('retries every kind of failure, asking the network and not the cache', async () => {
    for (const [name, failure] of FAILURES) {
      const { notice, seen } = recorder(), caches: Array<RequestCache | undefined> = []
      const module = await loadPhysicsWasm('/x.wasm', { ...quick, notice, fetch: (_u, init) => { caches.push(init.cache); return caches.length === 1 ? failure() : Promise.resolve(wasm()) } })
      expect(module, name).toBeInstanceOf(WebAssembly.Module)
      expect(caches, name).toEqual([undefined, 'reload'])
      // One calm line while it retries, no final message, and the veil restored.
      expect(seen, name).toEqual(['retrying', 'clear'])
    }
  })

  // Bug: a request that never answers, or a body that stops, hangs the loading veil for ever.
  it('ends a stalled attempt, cancels it and tries again', async () => {
    let aborted = 0, calls = 0
    const stall = (_u: string, init: { signal: AbortSignal }) => new Promise<Response>(() => { init.signal.addEventListener('abort', () => aborted++) })
    const module = await loadPhysicsWasm('/x.wasm', { ...quick, notice: null, timeoutMs: 20, fetch: (u, init) => ++calls === 1 ? stall(u, init) : Promise.resolve(wasm()) })
    expect(module).toBeInstanceOf(WebAssembly.Module); expect(aborted).toBe(1); expect(calls).toBe(2)
  })

  // Bug: after the last try the player has no way on but a reload, or Try again does nothing.
  it('after the last try shows the final message, and Try again starts a fresh round that can succeed', async () => {
    const { notice, seen, retry } = recorder(); let calls = 0, up = false
    const loading = loadPhysicsWasm('/x.wasm', { ...quick, notice, attempts: 3, fetch: () => { calls++; return up ? Promise.resolve(wasm()) : Promise.reject(new TypeError('offline')) } })
    await vi.waitFor(() => expect(seen.at(-1)).toBe('failed'))
    expect(calls).toBe(3); expect(seen).toEqual(['retrying', 'retrying', 'failed'])
    up = true; retry()
    expect(await loading).toBeInstanceOf(WebAssembly.Module)
    expect(calls).toBe(4); expect(seen.slice(3)).toEqual(['retrying', 'clear'])
  })

  // Bug: with no page to show Try again on, a failure hangs instead of reaching the start-failure notice.
  it('without a notice, gives up after the cap with the cause kept', async () => {
    let calls = 0
    const error = await loadPhysicsWasm('/x.wasm', { ...quick, notice: null, attempts: 3, fetch: async () => { calls++; return new Response('gone', { status: 404 }) } }).catch(e => e)
    expect(error).toBeInstanceOf(PhysicsLoadError); expect(error.detail).toMatch(/HTTP 404/); expect(calls).toBe(3)
  })

  // Bug: the connection returns and the player still waits out a long backoff, or the final message.
  it('the online event retries at once, from a backoff wait and from the final message', async () => {
    let online = () => {}
    const onOnline = (listener: () => void) => { online = listener; return () => { online = () => {} } }
    const { notice, seen } = recorder(); let calls = 0
    const loading = loadPhysicsWasm('/x.wasm', { notice, onOnline, attempts: 2, backoffMs: () => 3600_000, fetch: () => { calls++; return calls === 4 ? Promise.resolve(wasm()) : Promise.reject(new TypeError('offline')) } })
    await vi.waitFor(() => expect(seen).toEqual(['retrying']))
    online()
    await vi.waitFor(() => expect(seen.at(-1)).toBe('failed'))
    expect(calls).toBe(2)
    online()
    await vi.waitFor(() => expect(seen.at(-1)).toBe('retrying'))
    online()
    expect(await loading).toBeInstanceOf(WebAssembly.Module); expect(calls).toBe(4)
  })

  it('takes over the download the page started, and retries a failed one from the network', async () => {
    const requests: Array<RequestCache | undefined> = []
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { requests.push(init.cache); return wasm() })
    vi.stubGlobal('window', { __miraPhysicsWasm: { url: '/assets/x.wasm', response: Promise.resolve(wasm()) } })
    expect(await loadPhysicsWasm('/assets/x.wasm', { ...quick, notice: null })).toBeInstanceOf(WebAssembly.Module)
    expect(requests).toEqual([]); expect('__miraPhysicsWasm' in window).toBe(false)
    vi.stubGlobal('window', { __miraPhysicsWasm: { url: '/assets/x.wasm', response: Promise.resolve(new TypeError('offline')) } })
    expect(await loadPhysicsWasm('/assets/x.wasm', { ...quick, notice: null })).toBeInstanceOf(WebAssembly.Module)
    expect(requests).toEqual(['reload'])
  })

  // Bug: a stalled early request left running, and counting into the veil's bytes, beside the retry.
  it('ends the page\'s stalled download when it gives up on it, then retries from the network', async () => {
    const requests: Array<RequestCache | undefined> = []
    let aborted = 0
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { requests.push(init.cache); return wasm() })
    vi.stubGlobal('window', { __miraPhysicsWasm: { url: '/assets/x.wasm', abort: () => { aborted++ }, response: new Promise(() => {}) } })
    expect(await loadPhysicsWasm('/assets/x.wasm', { ...quick, timeoutMs: 30, notice: null })).toBeInstanceOf(WebAssembly.Module)
    expect(aborted).toBe(1); expect(requests).toEqual(['reload'])
  })

  // Bug: a flaky download in the production build gives no engine, or initialises it twice.
  // The Rapier module as the build rewrites it (tools/rapier-wasm.mjs), loading through this file.
  it('the built engine survives a failed first download: one initialisation, and a world that simulates', async () => {
    const source = readFileSync(new URL('../../node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', import.meta.url), 'utf8')
    const loader = fileURLToPath(new URL('../../src/core/physicsWasm.ts', import.meta.url))
    const built = externaliseRapierWasm(source, loader).replace(/^import __miraPhysicsWasmUrl from .*$/m, "const __miraPhysicsWasmUrl = '/assets/rapier.wasm'").replace(/^\/\/# sourceMappingURL=.*$/m, '')
    const file = join(mkdtempSync(join(tmpdir(), 'mira-rapier-')), 'rapier.mjs'); writeFileSync(file, built)
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); return wasm('application/wasm', new Uint8Array(RAPIER_WASM)) })
    const instantiate = vi.spyOn(WebAssembly, 'instantiate')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const RAPIER = (await import(/* @vite-ignore */ file)).default
    const init = RAPIER.init(); let done = false; init.then(() => { done = true })
    while (!done) await vi.advanceTimersByTimeAsync(250)
    vi.useRealTimers()
    expect(calls).toBe(2); expect(instantiate).toHaveBeenCalledTimes(1)
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10))
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0))
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body)
    for (let i = 0; i < 120; i++) world.step()
    const y = body.translation().y
    expect(y).toBeLessThan(2); expect(y).toBeGreaterThan(0.4)
  })
})
