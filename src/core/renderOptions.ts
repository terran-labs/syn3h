/** Detection is ready for a guarded fallback, but does not change backend defaults. */
export function isIOSOrIPadSafari(userAgent: string, touchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || /Macintosh/.test(userAgent) && touchPoints > 1
  return ios && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
}
export function graphicsOverride(search: string): 0 | 1 | 2 | undefined {
  const value = new URLSearchParams(search).get('gfx')
  return value === '0' || value === '1' || value === '2' ? Number(value) as 0 | 1 | 2 : undefined
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
    return { renderer, fallbackReason: options.forceWebGL ? undefined : options.skipWebGPU }
  }
  const first = make(false, false)
  const result = await withDeadline(first.init(), options.deadlineMs)
  if (result.ok) {
    if ((first.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) return { renderer: first }
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
 * Bloom gating. Bloom is landed dark: strength 0 (the default) means the frame takes exactly
 * the old path, `renderer.render(scene, camera)`, with no pipeline object and no extra render
 * targets. Anything above 0 still blooms only on a desktop class device at graphics level 2,
 * on a backend where it has been checked to work.
 */
export type RenderBackend = 'webgpu' | 'webgl'
export interface BloomGate {
  strength: number
  /** Current graphics level; the governor may lower it at run time. */
  level: number
  /** The level the device was classified as (2 means a desktop class device). */
  deviceLevel: number
  backend: RenderBackend
  allowed?: Readonly<Record<RenderBackend, boolean>>
}
/** Backends where bloom was verified (tools/bloom-review.md). */
export const BLOOM_BACKENDS: Readonly<Record<RenderBackend, boolean>> = { webgpu: true, webgl: true }
export function bloomActive(gate: BloomGate): boolean {
  return gate.strength > 0 && Number.isFinite(gate.strength) && gate.level === 2 && gate.deviceLevel === 2 && (gate.allowed ?? BLOOM_BACKENDS)[gate.backend] === true
}
/** `?bloom=0.6` sets the bloom strength for this page load, clamped to 0..1. */
export function bloomOverride(search: string): number | undefined {
  const value = new URLSearchParams(search).get('bloom')
  if (value === null || value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : undefined
}
