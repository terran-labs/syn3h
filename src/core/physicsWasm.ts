/**
 * Fetch and compile Rapier's WebAssembly from its own file. Production builds only: the build
 * plugin (tools/rapier-wasm.mjs) makes the Rapier module call this instead of decoding a
 * 4.1 MB base64 string out of the main script. Development, vitest and Node keep the stock
 * package and never load this module.
 *
 * There is one way to load it: the file is compiled while it downloads and the compiled module
 * is handed to Rapier's unchanged initialiser. That needs the server to send it as
 * application/wasm. There is no second path (the owner's ruling of 15 November 2026).
 *
 * A failed download retries by itself (the owner, 24 November 2026: "failed physics downloads
 * should retry automatically"). Every failure counts the same: no answer, a network error, a
 * status other than 200, a body that stops arriving, or a body that does not compile. Up to
 * PHYSICS_ATTEMPTS tries, waiting longer between each (PHYSICS_BACKOFF_MS), and at once when
 * the browser reports it is back online. Every retry asks the network, never the browser's
 * cache, so a bad response kept there is not served again. While it retries, the loading veil
 * says so in one plain line; after the last try it says the engine could not be downloaded
 * and offers Try again, which starts another round. All of this happens inside the one call
 * Rapier makes, so the engine is initialised once, whatever the number of downloads.
 *
 * The download is started by a line in index.html (written by the build plugin) while the
 * page is still being parsed, so it runs beside the main script. The first attempt takes that
 * response over when its address matches; otherwise it makes the request itself.
 */
/** One attempt gives up when nothing has arrived for this long: no answer, or a body that stopped. A slow download that keeps arriving is never cut off. */
export const PHYSICS_STALL_MS = 15000
/** Tries per round, before the veil offers Try again. */
export const PHYSICS_ATTEMPTS = 5
/** The wait before the second, third, ... try. The last value repeats. */
export const PHYSICS_BACKOFF_MS = [1000, 2000, 4000, 8000]

/** Thrown when the physics engine cannot be loaded and there is no page to offer Try again on (Node, tests). The start-failure notice shows `message` (graphicsSupport.ts). */
export class PhysicsLoadError extends Error {
  constructor(readonly detail: string) {
    super('The physics engine could not be loaded. Check your connection and reload.')
    this.name = 'PhysicsLoadError'
  }
}

/** What the player is shown while the engine is retried, and after the last try. */
export interface PhysicsRetryNotice {
  /** A try failed and another is coming. */
  retrying(): void
  /** Every try in the round failed. `retry` starts another round. */
  failed(retry: () => void): void
  /** The engine arrived: put the veil back as it was. */
  clear(): void
}
type Fetch = (url: string, init: { signal: AbortSignal; cache?: RequestCache }) => Promise<Response>
export interface PhysicsWasmOptions {
  fetch?: Fetch
  /** Silence that ends one attempt (PHYSICS_STALL_MS). */
  timeoutMs?: number
  attempts?: number
  /** The wait after failed attempt `n` (1 based). */
  backoffMs?: (n: number) => number
  /** Default: the loading veil, when there is a document. `null`: none, and a final failure throws. */
  notice?: PhysicsRetryNotice | null
  /** Calls `listener` when the browser comes back online; returns the unsubscribe. Default: the window's online event. */
  onOnline?: (listener: () => void) => () => void
}
/** Launch analytics hooks (src/net/analytics.ts, set in main.ts): a retry, a failed round. */
export const physicsLoadEvents: { retry?: (attempt: number) => void; failed?: (error: string) => void } = {}
/** How the binary was obtained, for diagnostics. `attempts` counts requests made, `error` is the last failure. */
export const physicsWasmLoad: { url: string | null; ms: number | null; error: string | null; attempts: number } = { url: null, ms: null, error: null, attempts: 0 }

export async function loadPhysicsWasm(url: string, options: PhysicsWasmOptions = {}): Promise<WebAssembly.Module> {
  const get: Fetch = options.fetch ?? ((u, init) => fetch(u, init))
  const timeoutMs = options.timeoutMs ?? PHYSICS_STALL_MS
  const attempts = Math.max(1, options.attempts ?? PHYSICS_ATTEMPTS)
  const backoff = options.backoffMs ?? (n => PHYSICS_BACKOFF_MS[Math.min(n, PHYSICS_BACKOFF_MS.length) - 1])
  const notice = options.notice === undefined ? veilNotice() : options.notice
  const onOnline = options.onOnline ?? windowOnline
  const start = performance.now()
  Object.assign(physicsWasmLoad, { url, ms: null, error: null, attempts: 0 })
  // Coming back online cuts short a wait, and ends an attempt that has heard nothing yet.
  let wake: (() => void) | null = null, hush: (() => void) | null = null
  const stop = onOnline(() => { wake?.(); hush?.() })
  try {
    for (;;) {
      for (let n = 1; n <= attempts; n++) {
        const first = physicsWasmLoad.attempts === 0
        physicsWasmLoad.attempts++
        try {
          const module = await attempt(url, get, timeoutMs, first, abort => { hush = abort })
          physicsWasmLoad.ms = performance.now() - start; physicsWasmLoad.error = null
          notice?.clear()
          return module
        } catch (error) {
          physicsWasmLoad.error = `${url}: ${error instanceof Error ? error.message : String(error)}`
        } finally { hush = null }
        if (n === attempts) break
        try { physicsLoadEvents.retry?.(physicsWasmLoad.attempts) } catch { /* analytics never affects loading */ }
        notice?.retrying()
        await new Promise<void>(resolve => { const timer = setTimeout(resolve, backoff(n)); wake = () => { clearTimeout(timer); resolve() } })
        wake = null
      }
      try { physicsLoadEvents.failed?.(physicsWasmLoad.error ?? url) } catch { /* analytics never affects loading */ }
      if (!notice) throw new PhysicsLoadError(physicsWasmLoad.error ?? url)
      // Wait for the player's Try again, or the connection's return, then a fresh round.
      await new Promise<void>(resolve => { wake = resolve; notice.failed(resolve) })
      wake = null
      notice.retrying()
    }
  } finally { stop() }
}

/**
 * One download and compile. The first takes over the page's early request when its address
 * matches; every later one goes to the network with `cache: 'reload'`. Ends with an error
 * after `stallMs` with nothing arriving; the timer stops once the body is complete, so
 * compiling is never timed. `onHush` receives a function that ends the attempt if no byte
 * has arrived yet (used when the browser comes back online).
 */
async function attempt(url: string, get: Fetch, stallMs: number, first: boolean, onHush: (abort: () => void) => void): Promise<WebAssembly.Module> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined, fail: (error: Error) => void = () => {}, heard = false
  const ended = new Promise<never>((_, reject) => { fail = reject })
  const end = (reason: string) => { clearTimeout(timer); abort.abort(); fail(new Error(reason)) }
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => end(`nothing arrived for ${Math.round(stallMs / 1000)} seconds`), stallMs) }
  onHush(() => { if (!heard) end('back online: asking again') })
  arm()
  const load = (async () => {
    const w = typeof window === 'undefined' ? undefined : window as unknown as { __miraPhysicsWasm?: { url: string; response: Promise<Response | Error> }; __miraPhysicsBytes?: number }
    const early = first ? w?.__miraPhysicsWasm : undefined
    if (w && first) delete w.__miraPhysicsWasm
    const response = early?.url === url ? await early.response : await get(url, first ? { signal: abort.signal } : { signal: abort.signal, cache: 'reload' })
    if (!(response instanceof Response)) throw response
    heard = true
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // A retry's bytes feed the veil's megabytes counter, as the early request's do (index.html).
    if (w && !early) w.__miraPhysicsBytes = 0
    arm()
    return WebAssembly.compileStreaming(watched(response, bytes => { arm(); if (w && !early) w.__miraPhysicsBytes = (w.__miraPhysicsBytes ?? 0) + bytes }, () => clearTimeout(timer)))
  })()
  load.catch(() => { /* Reported through the race below. */ })
  try { return await Promise.race([load, ended]) } finally { clearTimeout(timer) }
}

/** The same response, calling `progress` as each chunk arrives and `done` when the body is complete. Status and headers are kept, so it still streams. */
function watched(response: Response, progress: (bytes: number) => void, done: () => void): Response {
  if (!response.body || typeof TransformStream !== 'function') return response
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) { progress(chunk.byteLength); out.enqueue(chunk) },
    flush() { done() },
  }))
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

function windowOnline(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  window.addEventListener('online', listener)
  return () => window.removeEventListener('online', listener)
}

/** The lines the veil shows. */
export const PHYSICS_RETRY_TEXT = {
  retrying: 'The physics engine did not download. Trying again.',
  failed: 'The physics engine could not be downloaded. Check your connection, then try again.',
  button: 'Try again',
}

/**
 * The loading veil's side of a retry (index.html). The veil's status line (.boot-status) says
 * what is happening in place of its joke, and is shown at once (data-boot-late). While
 * <html data-boot-retry> is set the veil stays up: its own failsafe is off (index.html) and
 * LoadingScreen holds its time limit (the mira:physics-retry event). After the last try a
 * Try again button sits under the lines. The veil is never lifted for this, and nothing slides.
 */
function veilNotice(): PhysicsRetryNotice | null {
  if (typeof document === 'undefined') return null
  const root = document.documentElement
  let joke: string | null = null, button: HTMLButtonElement | null = null
  const status = () => document.querySelector<HTMLElement>('.boot-status')
  const say = (state: 'retrying' | 'failed', text: string) => {
    const line = status()
    if (line && joke === null) joke = line.textContent
    if (line) { line.textContent = text; line.setAttribute('role', state === 'failed' ? 'alert' : 'status'); line.removeAttribute('aria-hidden') }
    root.dataset.bootRetry = state; root.dataset.bootLate = ''
    window.dispatchEvent(new CustomEvent('mira:physics-retry', { detail: { state } }))
  }
  const removeButton = () => { button?.remove(); button = null }
  return {
    retrying() { removeButton(); say('retrying', PHYSICS_RETRY_TEXT.retrying) },
    failed(retry) {
      say('failed', PHYSICS_RETRY_TEXT.failed)
      removeButton()
      button = document.createElement('button')
      button.type = 'button'; button.className = 'boot-retry'; button.textContent = PHYSICS_RETRY_TEXT.button
      button.addEventListener('click', () => retry(), { once: true })
      document.querySelector('.boot-veil')?.append(button)
      button.focus({ preventScroll: true })
    },
    clear() {
      if (root.dataset.bootRetry === undefined) return
      removeButton()
      const line = status()
      if (line) { if (joke !== null) line.textContent = joke; line.removeAttribute('role'); line.setAttribute('aria-hidden', 'true') }
      joke = null
      delete root.dataset.bootRetry
      window.dispatchEvent(new CustomEvent('mira:physics-retry', { detail: { state: 'clear' } }))
    },
  }
}
