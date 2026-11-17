/**
 * Loads the vehicle models that still come from files (the buggy's two, the legacy tank's two)
 * and keeps trying until they arrive.
 *
 * Why it exists. The buggy used to call GLTFLoader once per vehicle and, if that one request
 * failed, keep its primitive box for the rest of the session. A dropped connection or a slow
 * phone network during the first seconds of a page was enough: the player's own buggy is
 * built at startup, and the vehicle swapper reuses that same instance for every later switch
 * back to the buggy, so the box stayed until the tab was reloaded. Bots, built later, loaded
 * fine. Here one failure never sticks:
 *
 *  - Each URL is fetched once and the bytes are shared, so ten bots cost one request.
 *  - A failed or bad response (network error, HTTP error, an HTML fallback page, a truncated
 *    file) is forgotten at once, so the next caller fetches again, bypassing the HTTP cache.
 *  - Each caller retries with backoff (half a second, doubling, at most 15 s apart) until it
 *    succeeds or the caller cancels, and retries straight away when the browser comes back
 *    online.
 *  - Every caller parses its own copy of the scene, since vehicles rework their meshes.
 */
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'

export class ModelLoadCancelled extends Error {
  constructor(url: string) { super(`Model load cancelled: ${url}`) }
}

export interface ModelLoadOptions {
  /** Stop retrying (and reject with ModelLoadCancelled) once this returns true. */
  cancelled?: () => boolean
  /** Called after each failed attempt, before waiting to retry. */
  onRetry?: (attempt: number, error: unknown) => void
}

/** Delay before retry `attempt` (1 based): 0.5 s, 1, 2, 4, 8, then 15 s. */
export function retryDelay(attempt: number): number {
  return Math.min(15000, 500 * 2 ** (attempt - 1))
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>
type Wait = (ms: number) => Promise<void>

const defaultWait: Wait = ms => new Promise(resolve => {
  const timer = setTimeout(done, ms)
  function done() {
    clearTimeout(timer)
    globalThis.removeEventListener?.('online', done)
    resolve()
  }
  // A network that comes back should not wait out the rest of a long backoff.
  globalThis.addEventListener?.('online', done)
})

let fetcher: Fetcher = (url, init) => fetch(url, init)
let wait: Wait = defaultWait
const buffers = new Map<string, Promise<ArrayBuffer>>()

/** Tests: replace the network and the clock, and forget every cached model. */
export function setModelTransport(next: { fetch?: Fetcher; wait?: Wait } = {}): void {
  fetcher = next.fetch ?? ((url, init) => fetch(url, init))
  wait = next.wait ?? defaultWait
  buffers.clear()
}

/** GLB files start with the ASCII magic "glTF"; anything else (an HTML error page) is not a model. */
function isGlb(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 20) return false
  const view = new DataView(buffer)
  // Header: magic, version, total length. A short body is a truncated download.
  return view.getUint32(0, true) === 0x46546c67 && view.getUint32(8, true) <= buffer.byteLength
}

function sharedBytes(url: string, fresh: boolean): Promise<ArrayBuffer> {
  // A failure is removed at once, so an entry here is a success or a request in flight
  // (perhaps another caller's retry): share it either way.
  let pending = buffers.get(url)
  if (pending) return pending
  pending = (async () => {
    const response = await fetcher(url, { cache: fresh ? 'reload' : 'default' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = await response.arrayBuffer()
    if (!isGlb(bytes)) throw new Error('not a complete GLB file')
    return bytes
  })()
  buffers.set(url, pending)
  // Never keep a failure: the next caller must try the network again.
  pending.catch(() => { if (buffers.get(url) === pending) buffers.delete(url) })
  return pending
}

/** The model's bytes, retried until they arrive. Rejects only with ModelLoadCancelled. */
export async function loadModelBytes(url: string, options: ModelLoadOptions = {}): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    if (options.cancelled?.()) throw new ModelLoadCancelled(url)
    try {
      return await sharedBytes(url, attempt > 0)
    } catch (error) {
      if (options.cancelled?.()) throw new ModelLoadCancelled(url)
      if (attempt === 0) console.warn(`Vehicle model ${url} failed to load, retrying`, error)
      options.onRetry?.(attempt + 1, error)
      await wait(retryDelay(attempt + 1))
    }
  }
}

const parser = new GLTFLoader()

/** A fresh parse of the model at `url`, retried until it loads. Rejects only when cancelled. */
export async function loadModel(url: string, options: ModelLoadOptions = {}): Promise<GLTF> {
  const base = url.slice(0, url.lastIndexOf('/') + 1)
  for (let attempt = 0; ; attempt++) {
    const bytes = await loadModelBytes(url, options)
    try {
      return await parser.parseAsync(bytes, base)
    } catch (error) {
      // Bytes that passed the header check but do not parse: forget them and fetch again.
      if (buffers.has(url)) buffers.delete(url)
      if (options.cancelled?.()) throw new ModelLoadCancelled(url)
      console.warn(`Vehicle model ${url} did not parse, fetching again`, error)
      await wait(retryDelay(attempt + 1))
    }
  }
}
