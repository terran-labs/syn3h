/**
 * Fetch and compile Rapier's WebAssembly from its own file. Production builds only: the build
 * plugin (tools/rapier-wasm.mjs) makes the Rapier module call this instead of decoding a
 * 4.1 MB base64 string out of the main script. Development, vitest and Node keep the stock
 * package and never load this module.
 *
 * There is one way to load it: the file is compiled while it downloads and the compiled module
 * is handed to Rapier's unchanged initialiser. That needs the server to send it as
 * application/wasm. There is no second path and no retry (the owner's ruling of 15 November
 * 2026): if the download or compile fails, or takes longer than the timeout, the error
 * reaches Game.init, the game does not start, and the page asks the player to reload.
 *
 * The download is started by a line in index.html (written by the build plugin) while the
 * page is still being parsed, so it runs beside the main script. This module takes that
 * response over when its address matches; otherwise it makes the request itself. Either way
 * the file is requested once.
 */
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
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error(`no answer within ${Math.round(timeoutMs / 1000)} seconds`)) }, timeoutMs) })
  const load = (async () => {
    const early = typeof window === 'undefined' || options.fetch ? undefined : (window as unknown as { __miraPhysicsWasm?: { url: string; response: Promise<Response | Error> } }).__miraPhysicsWasm
    if (early) delete (window as unknown as { __miraPhysicsWasm?: unknown }).__miraPhysicsWasm
    const response = early?.url === url ? await early.response : await get(url, { signal: abort.signal })
    if (!(response instanceof Response)) throw response
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return WebAssembly.compileStreaming(response)
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
