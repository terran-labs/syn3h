/** Detection is ready for a guarded fallback, but does not change backend defaults. */
export function isIOSOrIPadSafari(userAgent: string, touchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || /Macintosh/.test(userAgent) && touchPoints > 1
  return ios && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
}
/** A quality level chosen in the address for one page load: ?gfx=0 (Minimal) to ?gfx=5 (Cinematic). */
export function graphicsOverride(search: string): 0 | 1 | 2 | 3 | 4 | 5 | undefined {
  const value = new URLSearchParams(search).get('gfx')
  return value !== null && /^[0-5]$/.test(value) ? Number(value) as 0 | 1 | 2 | 3 | 4 | 5 : undefined
}

/**
 * Graphics startup must never hang. These helpers are pure so the stalled, rejected and
 * missing adapter cases can be tested with fakes (tests/core/renderer-startup.test.ts).
 */
export type Settled<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'rejected'; error?: unknown }

/** Settle `work` or report a timeout after `ms`. A deadline of 0 or less waits forever. */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<Settled<T>> {
  return new Promise(resolve => {
    let done = false
    const timer = ms > 0 ? setTimeout(() => { if (!done) { done = true; resolve({ ok: false, reason: 'timeout' }) } }, ms) : undefined
    work.then(
      value => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: true, value }) } },
      error => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, reason: 'rejected', error }) } },
    )
  })
}

/**
 * How long WebGPU adapter, device and renderer startup may take before the game gives up on
 * it and starts WebGL 2. Healthy devices take milliseconds (15 ms worst seen under 6x CPU
 * throttling), so 8 seconds only ever fires on a stall. `?gpudeadline=MS` overrides it and
 * `?gpudeadline=0` turns the deadline off.
 */
export const DEFAULT_GPU_DEADLINE_MS = 8000
export function gpuDeadlineMs(search: string): number {
  const value = new URLSearchParams(search).get('gpudeadline')
  if (value === null || value.trim() === '') return DEFAULT_GPU_DEADLINE_MS
  const ms = Number(value)
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_GPU_DEADLINE_MS
}

export type AdapterProbe = 'available' | 'fallback' | 'missing' | 'timeout' | 'rejected' | 'unsupported'
interface GPULike<A> { requestAdapter(options?: object): Promise<A | null> }
/** Ask for a WebGPU adapter within a deadline and say what happened. */
export async function probeAdapter<A extends { isFallbackAdapter?: boolean }>(gpu: GPULike<A> | undefined, options: object, deadlineMs: number): Promise<{ probe: AdapterProbe; adapter: A | null }> {
  if (!gpu) return { probe: 'unsupported', adapter: null }
  let request: Promise<A | null>
  try { request = gpu.requestAdapter(options) } catch (error) { request = Promise.reject(error) }
  const result = await withDeadline(request, deadlineMs)
  if (!result.ok) return { probe: result.reason, adapter: null }
  if (!result.value) return { probe: 'missing', adapter: null }
  return { probe: result.value.isFallbackAdapter ? 'fallback' : 'available', adapter: result.value }
}

/** The parts of a three.js renderer that startup needs. */
export interface StartableRenderer { init(): Promise<unknown>; backend: object; dispose?(): void }
export interface RendererStart<R> { renderer: R; fallbackReason?: string }

export type RendererBackendReason = 'forced-webgl2' | 'webgpu' | 'adapter-timeout' | 'adapter-missing'
  | 'webgpu-unsupported' | 'webgpu-start-timeout' | 'webgpu-start-failed' | 'webgpu-device-failed'

const rendererReasons = new WeakMap<object, RendererBackendReason>()

/** Stable classification from the renderer's actual startup path. */
export function rendererBackendReason(renderer: object): RendererBackendReason | null {
  return rendererReasons.get(renderer) ?? null
}

/**
 * Start a renderer, never hanging on WebGPU.
 *
 * - `forceWebGL` (from `?webgl=1`): WebGL 2 only.
 * - `skipWebGPU`: a reason to go straight to WebGL 2, used when the adapter probe stalled.
 * - Otherwise WebGPU first. three.js already falls back to WebGL 2 by itself when there is no
 *   adapter or the device request rejects; that is recorded as the reason. If init stalls
 *   past the deadline or rejects outright, the WebGPU renderer is abandoned (disposed if it
 *   ever finishes) and `make(true, true)` builds a WebGL 2 renderer on a fresh canvas, in
 *   case the stalled one had already claimed the old canvas.
 *
 * `make(forceWebGL, freshCanvas)` builds an uninitialised renderer.
 */
export async function startRenderer<R extends StartableRenderer>(make: (forceWebGL: boolean, freshCanvas: boolean) => R, options: { forceWebGL: boolean; skipWebGPU?: string; deadlineMs: number; probe?: AdapterProbe }): Promise<RendererStart<R>> {
  if (options.forceWebGL || options.skipWebGPU) {
    const renderer = make(true, false)
    await renderer.init()
    rendererReasons.set(renderer, options.forceWebGL ? 'forced-webgl2' : 'adapter-timeout')
    return { renderer, fallbackReason: options.forceWebGL ? undefined : options.skipWebGPU }
  }
  const first = make(false, false)
  const result = await withDeadline(first.init(), options.deadlineMs)
  if (result.ok) {
    if ((first.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
      rendererReasons.set(first, 'webgpu')
      return { renderer: first }
    }
    rendererReasons.set(first, options.probe === 'missing' ? 'adapter-missing'
      : options.probe === 'unsupported' ? 'webgpu-unsupported' : 'webgpu-device-failed')
    const why = options.probe === 'missing' ? 'no WebGPU adapter' : options.probe === 'unsupported' ? 'no WebGPU in this browser' : 'WebGPU device or context failed'
    return { renderer: first, fallbackReason: `${why}; three.js started WebGL 2` }
  }
  const reason = result.reason === 'timeout'
    ? `WebGPU startup took longer than ${options.deadlineMs} ms`
    : `WebGPU startup failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`
  // A stalled init may still finish later; release whatever it acquired.
  if (result.reason === 'timeout') first.init().then(() => first.dispose?.(), () => {})
  else first.dispose?.()
  const second = make(true, true)
  await second.init()
  rendererReasons.set(second, result.reason === 'timeout' ? 'webgpu-start-timeout' : 'webgpu-start-failed')
  return { renderer: second, fallbackReason: `${reason}; started WebGL 2 instead` }
}

/** Something the player can act on when the GPU goes away. */
export function deviceLostMessage(info: { api?: string; message?: string; reason?: string | null } | undefined): string {
  const api = info?.api === 'WebGL' ? 'WebGL context' : 'graphics device'
  // three.js says 'Unknown reason' when the browser gives none; that tells the player nothing.
  const detail = info?.message && info.message !== 'Unknown reason' ? ` (${info.message})` : ''
  return `The ${api} was lost${detail}. Reload to keep playing.`
}

/**
 * What the lobby is doing to the 3D view, from the shell's own state classes.
 *
 *  - 'playing': the world is the picture. Render every frame and judge the frame rate.
 *  - 'lobby': a menu or the start screen is up but the world shows through or is about to
 *    (the plain lobby, the descent from the galaxy). Render every frame,
 *    but the frame rate says nothing about how the game will run, so do not judge it.
 *  - 'covered': the opaque galaxy lobby hides the world entirely. Do not judge the frame
 *    rate, and there is no point drawing a world nobody can see at full rate.
 *
 * Without a shell at all (a lab page, a test) the view is always 'playing'.
 */
export type ViewState = 'playing' | 'lobby' | 'covered'
export function viewState(shell: { contains(name: string): boolean } | null | undefined): ViewState {
  if (!shell || shell.contains('is-playing')) return 'playing'
  return shell.contains('is-galaxy') && !shell.contains('is-descending') ? 'covered' : 'lobby'
}

/**
 * A post-processing chain, owned by the Post Effects lane (src/fx/post). When one is
 * registered with `game.setPostChain`, it is handed each frame instead of the renderer being
 * asked to draw it: the chain renders the scene itself, through whatever passes it likes,
 * and puts the result on screen. Game knows nothing about any effect.
 */
export interface PostChain<Renderer = unknown, Scene = unknown, Camera = unknown> {
  /** Mark draws covered by the entry overlay, where optional effects can compile. */
  setCovered?(covered: boolean): void
  /** The scene pass's sample count, for diagnostics; null before a graph is built. */
  sceneSamples?(): number | null
  /** Draw this frame to the screen. `frameMs` is the time since the previous frame. */
  render(renderer: Renderer, scene: Scene, camera: Camera, frameMs: number): void
}

/**
 * Draw one frame: straight through the renderer when no chain is registered, exactly as
 * before the hook existed, and through the chain alone when one is.
 */
export function drawFrame<R extends { render(scene: S, camera: C): unknown }, S, C>(renderer: R, scene: S, camera: C, chain: PostChain<R, S, C> | null, frameMs: number): void {
  if (chain) chain.render(renderer, scene, camera, frameMs)
  else renderer.render(scene, camera)
}
