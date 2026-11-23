/**
 * Fetch and compile Rapier's WebAssembly from its own file. Production builds only: the build
 * plugin (tools/rapier-wasm.mjs) makes the Rapier module call this instead of decoding a
 * 4.1 MB base64 string out of the main script. Development, vitest and Node keep the stock
 * package and never load this module.
 *
 * There is one way to load it: the file is compiled while it downloads and the compiled module
 * is handed to Rapier's unchanged initialiser. That needs the server to send it as
 * application/wasm. There is no second path (the owner's ruling of 15 November 2026). A failed
 * download, or one with nothing arriving for the timeout, rejects; since 23 November 2026 the
 * lobby opens without the engine and src/core/physicsGate.ts tries again in place, so a slow
 * or broken connection never leaves the page needing a reload. A slow download that keeps
 * arriving is never cut off: the timeout counts silence, not the whole download.
 *
 * The download is started by a line in index.html (written by the build plugin) while the
 * page is still being parsed, so it runs beside the main script. This module takes that
 * response over when its address matches; otherwise it makes the request itself. Either way
 * the file is requested once.
 */
/** Give up when nothing has arrived for this long (no answer, or a download that stopped). */
export const PHYSICS_LOAD_TIMEOUT_MS = 30000
/** Thrown when the physics engine cannot be loaded. The start-failure notice shows `message` with a reload button, `detail` behind Details (graphicsSupport.ts). */
export class PhysicsLoadError extends Error {
  constructor(readonly detail: string) {
    super('The physics engine could not be loaded. Check your connection and reload.')
    this.name = 'PhysicsLoadError'
  }
}
export interface PhysicsWasmOptions { fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>; timeoutMs?: number }
/** How the binary was obtained, for diagnostics. */
export const physicsWasmLoad: { url: string | null; ms: number | null; error: string | null } = { url: null, ms: null, error: null }

export async function loadPhysicsWasm(url: string, options: PhysicsWasmOptions = {}): Promise<WebAssembly.Module> {
  const get = options.fetch ?? ((u: string, init: { signal: AbortSignal }) => fetch(u, init))
  const timeoutMs = options.timeoutMs ?? PHYSICS_LOAD_TIMEOUT_MS
  const abort = new AbortController(), start = performance.now()
  physicsWasmLoad.url = url; physicsWasmLoad.ms = null; physicsWasmLoad.error = null
  // The timer restarts whenever bytes arrive: it measures silence, so a slow but live download
  // finishes however long it takes.
  let timer: ReturnType<typeof setTimeout> | undefined, fail: (error: Error) => void = () => {}
  const timeout = new Promise<never>((_, reject) => { fail = reject })
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { abort.abort(); fail(new Error(`nothing arrived for ${Math.round(timeoutMs / 1000)} seconds`)) }, timeoutMs) }
  arm()
  const load = (async () => {
    const early = typeof window === 'undefined' || options.fetch ? undefined : (window as unknown as { __miraPhysicsWasm?: { url: string; response: Promise<Response | Error> } }).__miraPhysicsWasm
    if (early) delete (window as unknown as { __miraPhysicsWasm?: unknown }).__miraPhysicsWasm
    const response = early?.url === url ? await early.response : await get(url, { signal: abort.signal })
    if (!(response instanceof Response)) throw response
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    arm()
    return WebAssembly.compileStreaming(watched(response, arm))
  })()
  load.catch(() => { /* Reported through the race below. */ })
  try {
    const module = await Promise.race([load, timeout])
    physicsWasmLoad.ms = performance.now() - start
    return module
  } catch (error) {
    const detail = `${url}: ${error instanceof Error ? error.message : String(error)}`
    physicsWasmLoad.error = detail
    throw new PhysicsLoadError(detail)
  } finally { clearTimeout(timer) }
}

/** The same response, calling `progress` as each chunk of its body arrives. Status and headers are kept, so it still streams. */
function watched(response: Response, progress: () => void): Response {
  if (!response.body || typeof TransformStream !== 'function') return response
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, out) { progress(); out.enqueue(chunk) } }))
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}
