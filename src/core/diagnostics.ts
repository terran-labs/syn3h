import type { Game } from './Game'
import { graphicsLevel, loadingProgress } from './quality'

/**
 * Startup phase timing, always on. Each phase is a performance.measure named
 * `syn3h:<phase>` and a row in `window.syn3hStartup`, so the `?diag=1` overlay and automation
 * read the same numbers. Times are milliseconds since navigation start, the clock that
 * firstDrawSubmittedMs uses. Recording costs a few object writes per phase.
 */
export interface StartupPhase { name: string; startMs: number; endMs: number; ms: number; detail?: string }
export interface StartupTiming {
  phases: StartupPhase[]
  /** Navigation milestones read from the browser, filled in when the overlay or automation asks. */
  navigation?: { responseEndMs: number; domContentLoadedMs: number; loadEventMs: number; scripts: number; scriptBytes: number; lastScriptEndMs: number }
  backend?: string
  fallbackReason?: string
  pipelines?: { render: number; compute: number; vertexShaders: number; fragmentShaders: number }
}
export const startupTiming: StartupTiming = { phases: [] }
if (typeof window !== 'undefined') (window as unknown as { syn3hStartup: StartupTiming }).syn3hStartup = startupTiming

/** Record a phase that ran from `startMs` until now. */
export function recordStartupPhase(name: string, startMs: number, detail?: string, end?: number): number {
  const endMs = end ?? (typeof performance !== 'undefined' ? performance.now() : startMs)
  startupTiming.phases.push({ name, startMs, endMs, ms: endMs - startMs, detail })
  try { performance.measure(`syn3h:${name}`, { start: startMs, end: endMs, detail }) } catch { /* Older engines lack measure options. */ }
  return endMs
}

/** Time an async step as one phase. */
export async function timeStartup<T>(name: string, step: () => Promise<T> | T): Promise<T> {
  const start = performance.now()
  try { return await step() } finally { recordStartupPhase(name, start) }
}

/** Fill navigation milestones from the browser's own timing entries. */
export function readNavigationTiming(): StartupTiming['navigation'] {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return undefined
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const scripts = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(r => r.initiatorType === 'script' || r.initiatorType === 'other' && /\.(m?js|ts)(\?|$)/.test(r.name))
  startupTiming.navigation = {
    responseEndMs: nav?.responseEnd ?? 0, domContentLoadedMs: nav?.domContentLoadedEventEnd ?? 0, loadEventMs: nav?.loadEventEnd ?? 0,
    scripts: scripts.length, scriptBytes: scripts.reduce((sum, r) => sum + (r.transferSize || r.encodedBodySize || 0), 0),
    lastScriptEndMs: scripts.reduce((max, r) => Math.max(max, r.responseEnd), 0),
  }
  return startupTiming.navigation
}

/** One line per phase for the overlay: start, duration and name. */
export function formatStartup(timing: StartupTiming = startupTiming): string {
  const nav = timing.navigation
  const lines = timing.phases.map(p => `${p.startMs.toFixed(0).padStart(6)} +${p.ms.toFixed(0).padStart(5)}  ${p.name}${p.detail ? ` (${p.detail})` : ''}`)
  if (nav) lines.unshift(`html ${nav.responseEndMs.toFixed(0)}, ${nav.scripts} scripts ${(nav.scriptBytes / 1024).toFixed(0)} KB, last script ${nav.lastScriptEndMs.toFixed(0)}, DOMContentLoaded ${nav.domContentLoadedMs.toFixed(0)}`)
  if (timing.pipelines) lines.push(`pipelines ${timing.pipelines.render} render, ${timing.pipelines.compute} compute, shaders ${timing.pipelines.vertexShaders} vertex / ${timing.pipelines.fragmentShaders} fragment`)
  if (timing.fallbackReason) lines.push(`fallback: ${timing.fallbackReason}`)
  return lines.join('\n')
}

/** Opt-in diagnostics only. Submitted draws are not proof that the display has pixels. */
export function installRenderDiagnostics(game: Game): (() => void) | undefined {
  if (new URLSearchParams(location.search).get('diag') !== '1') return
  const panel = document.createElement('details')
  panel.open = true
  panel.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;background:#080b12f5;color:#fff;padding:10px;max-width:calc(100vw - 36px);max-height:48vh;overflow:auto;font:12px monospace'
  const title = document.createElement('summary'); title.textContent = 'Syn3h device diagnostics (tap to fold)'
  const text = document.createElement('pre'); text.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0'
  panel.append(title, text); document.body.append(panel)
  const errors: string[] = []
  const contextEvents: string[] = []
  const contextEvent = (message: string) => { contextEvents.push(message); if (contextEvents.length > 12) contextEvents.shift(); refresh() }
  const record = (message: string) => { errors.push(message); if (errors.length > 12) errors.shift(); refresh() }
  const contexts: WeakRef<WebGLRenderingContext | WebGL2RenderingContext>[] = []
  const seen = new WeakSet<object>()
  const original = HTMLCanvasElement.prototype.getContext
  // Observe successful contexts, including detached planet canvases, without creating any.
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
    const context = original.apply(this, args)
    if (context && (args[0] === 'webgl' || args[0] === 'webgl2' || args[0] === 'experimental-webgl') && !seen.has(context)) {
      seen.add(context); contexts.push(new WeakRef(context as WebGLRenderingContext))
      this.addEventListener('webglcontextlost', () => contextEvent(`WebGL context lost: ${this === game.canvas ? 'GAME' : 'lobby/other'}`))
      this.addEventListener('webglcontextrestored', () => contextEvent('WebGL context restored'))
    }
    return context
  } as typeof original
  window.addEventListener('error', event => record(`Error: ${event.message}`))
  window.addEventListener('unhandledrejection', event => record(`Rejected: ${String(event.reason)}`))
  let observed: GPUDevice | undefined
  function refresh() {
    const renderer = game.renderer
    const backend = renderer?.backend as unknown as { device?: GPUDevice; gl?: WebGL2RenderingContext; context?: GPUCanvasContext } | undefined
    const device = backend?.device
    if (device && observed !== device) {
      observed = device
      // Keep Three's own error handlers intact.
      device.addEventListener('uncapturederror', event => record(`GPU error: ${(event as GPUUncapturedErrorEvent).error.message}`))
      void device.lost.then(info => record(`GPU lost: ${info.reason}: ${info.message}`))
    }
    const adapter = device?.adapterInfo
    const rect = game.canvas.getBoundingClientRect()
    const live = contexts.filter(ref => { const context = ref.deref(); return context && !context.isContextLost() }).length
    const snapshot = {
      phase: loadingProgress.phase, backend: renderer ? game.backend : 'initializing',
      adapter: adapter ? `${adapter.vendor} ${adapter.architecture} ${adapter.device} ${adapter.description}`.trim() || 'not disclosed' : 'not exposed',
      maxTexture: device?.limits.maxTextureDimension2D ?? backend?.gl?.getParameter(backend.gl.MAX_TEXTURE_SIZE),
      canvas: `${game.canvas.width} x ${game.canvas.height}`, css: `${Math.round(rect.width)} x ${Math.round(rect.height)}`,
      pixelRatio: renderer?.getPixelRatio(), devicePixelRatio: window.devicePixelRatio,
      graphics: graphicsLevel.value, exposure: renderer?.toneMappingExposure,
      colorSpace: renderer?.outputColorSpace, toneMapping: renderer?.toneMapping,
      samples: (renderer as unknown as { _samples?: number })?._samples,
      firstDrawSubmittedMs: game.performance.firstFrameMs, tick: game.tick,
      fps: Math.round(game.fps), draws: game.performance.drawCalls,
      webglContexts: `${live} live / ${contexts.length} created since Game construction`,
      domCanvases: document.querySelectorAll('canvas').length, errors: [...errors], contextEvents: [...contextEvents],
      startup: (readNavigationTiming(), formatStartup()),
    }
    ;(window as unknown as { syn3hDiagnostics: unknown }).syn3hDiagnostics = snapshot
    text.textContent = Object.entries(snapshot).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('\n') || 'none' : key === 'startup' ? `\n${value}` : value ?? 'pending'}`).join('\n')
  }
  refresh()
  window.setInterval(refresh, 500)
  return () => {
    const renderer = game.renderer
    const onError = renderer.onError
    const onLost = renderer.onDeviceLost
    // Cover failures during init, before the periodic device observer can attach.
    renderer.onError = message => { record(`Renderer error: ${message}`); onError.call(renderer, message) }
    renderer.onDeviceLost = info => { record(`Renderer device lost: ${JSON.stringify(info)}`); onLost.call(renderer, info) }
  }
}
