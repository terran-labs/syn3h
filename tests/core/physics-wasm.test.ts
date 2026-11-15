import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPhysicsWasm, PhysicsLoadError, physicsWasmLoad } from '../../src/core/physicsWasm'

/** The smallest valid module: the magic number and version. */
const EMPTY = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
const wasm = (type = 'application/wasm', bytes: Uint8Array = EMPTY) => new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'Content-Type': type } })

afterEach(() => vi.unstubAllGlobals())
describe('physics WebAssembly loading', () => {
  it('compiles while streaming when the server sends application/wasm', async () => {
    const module = await loadPhysicsWasm('/assets/x.wasm', { fetch: async () => wasm() })
    expect(module).toBeInstanceOf(WebAssembly.Module)
    expect(physicsWasmLoad).toMatchObject({ url: '/assets/x.wasm', error: null }); expect(physicsWasmLoad.ms).toBeGreaterThanOrEqual(0)
  })
  it('has one path: every failure asks for a reload, once, with the cause kept for diagnostics', async () => {
    const cases: Array<[string, () => Promise<Response>, RegExp]> = [
      ['network', async () => { throw new TypeError('Failed to fetch') }, /Failed to fetch/],
      ['missing', async () => new Response('gone', { status: 404 }), /HTTP 404/],
      ['wrong content type', async () => wasm('application/octet-stream'), /./],
      ['not WebAssembly', async () => wasm('application/wasm', new Uint8Array([1, 2, 3])), /./],
    ]
    for (const [name, get, cause] of cases) {
      let calls = 0
      const error = await loadPhysicsWasm('/x.wasm', { fetch: () => { calls++; return get() } }).catch(e => e)
      expect(error, name).toBeInstanceOf(PhysicsLoadError)
      expect(error.message, name).toBe('The physics engine could not be loaded. Check your connection and reload.')
      expect(error.detail, name).toMatch(cause); expect(physicsWasmLoad.error, name).toBe(error.detail)
      // No retry and no second way of loading.
      expect(calls, name).toBe(1)
    }
  })
  it('takes over the download the page started, requesting the file once', async () => {
    let requests = 0
    vi.stubGlobal('fetch', async () => { requests++; return wasm() })
    vi.stubGlobal('window', { __syn3hPhysicsWasm: { url: '/assets/x.wasm', response: Promise.resolve(wasm()) } })
    expect(await loadPhysicsWasm('/assets/x.wasm')).toBeInstanceOf(WebAssembly.Module)
    expect(requests).toBe(0); expect('__syn3hPhysicsWasm' in window).toBe(false)
    // A download started for another address is not this file: request the right one.
    vi.stubGlobal('window', { __syn3hPhysicsWasm: { url: '/assets/old.wasm', response: Promise.resolve(wasm()) } })
    expect(await loadPhysicsWasm('/assets/x.wasm')).toBeInstanceOf(WebAssembly.Module)
    expect(requests).toBe(1)
    // An early request that failed asks for a reload like any other failure, with no second try.
    vi.stubGlobal('window', { __syn3hPhysicsWasm: { url: '/assets/x.wasm', response: Promise.resolve(new TypeError('offline')) } })
    const error = await loadPhysicsWasm('/assets/x.wasm').catch(e => e)
    expect(error).toBeInstanceOf(PhysicsLoadError); expect(error.detail).toMatch(/offline/); expect(requests).toBe(1)
  })
  it('gives up after the stated timeout and cancels the download', async () => {
    let aborted = false
    const never = (_url: string, init: { signal: AbortSignal }) => new Promise<Response>(() => { init.signal.addEventListener('abort', () => { aborted = true }) })
    const error = await loadPhysicsWasm('/x.wasm', { fetch: never, timeoutMs: 20 }).catch(e => e)
    expect(error).toBeInstanceOf(PhysicsLoadError); expect(error.detail).toMatch(/no answer within 0 seconds/); expect(aborted).toBe(true)
  })
  it('compiles the binary the package ships, the file the build emits', async () => {
    const bytes = readFileSync(new URL('../../node_modules/@dimforge/rapier3d-compat/dist/rapier_wasm3d_bg.wasm', import.meta.url))
    expect(bytes.length).toBe(3082103)
    const module = await loadPhysicsWasm('/x.wasm', { fetch: async () => wasm('application/wasm', new Uint8Array(bytes)) })
    expect(WebAssembly.Module.exports(module).length).toBeGreaterThan(100)
  })
})
