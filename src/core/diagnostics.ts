import type { Game } from './Game'
import type { PerformanceEnvironment } from './performance'
import { deviceLostMessage } from './renderOptions'

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
  /** Set when the renderer's GPU device or WebGL context was lost. */
  deviceLost?: string
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
  if (timing.deviceLost) lines.push(`lost: ${timing.deviceLost}`)
  return lines.join('\n')
}

/** The part of `document` the lost-device notice needs, so tests can pass a fake. */
export interface NoticeDocument {
  getElementById(id: string): unknown
  createElement(tag: 'div' | 'p' | 'button'): { id: string; textContent: string | null; style: { cssText: string }; setAttribute(name: string, value: string): void; append(...nodes: unknown[]): void; addEventListener(type: 'click', listener: () => void): void }
  body: { append(node: unknown): void }
}

/**
 * Tell the player the renderer's GPU device or WebGL context is gone and offer a reload,
 * instead of leaving a frozen or black canvas. Shown once; later losses only update the record.
 * Plain DOM made here, not in src/ui, so it works whatever state the lobby is in.
 */
export function showRendererLost(info?: { api?: string; message?: string; reason?: string | null }, doc: NoticeDocument | undefined = typeof document !== 'undefined' ? document as unknown as NoticeDocument : undefined, reload: () => void = () => location.reload()): boolean {
  startupTiming.deviceLost = [info?.api ?? 'GPU', info?.reason, info?.message].filter(Boolean).join(': ')
  if (!doc || doc.getElementById('syn3h-device-lost')) return false
  const box = doc.createElement('div')
  box.id = 'syn3h-device-lost'
  box.setAttribute('role', 'alert')
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;background:#020308e6;color:#e8edf5;font:16px/1.4 system-ui,sans-serif;text-align:center'
  const text = doc.createElement('p')
  text.textContent = deviceLostMessage(info)
  const button = doc.createElement('button')
  button.textContent = 'Reload'
  button.style.cssText = 'font:inherit;padding:10px 28px;border-radius:8px;border:1px solid #4da3ff;background:#0b1830;color:#e8edf5;cursor:pointer'
  button.addEventListener('click', reload)
  box.append(text, button)
  doc.body.append(box)
  return true
}

/**
 * getParameter is a blocking round trip to the GPU process and snapshots are built about once a
 * second, so the WebGL limit is asked once per context. It cannot change while the context lives.
 */
const glLimits=new WeakMap<object,number>()
function glMaxTextureSize(gl: WebGL2RenderingContext): number {
  let size=glLimits.get(gl)
  if(size===undefined){size=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;glLimits.set(gl,size)}
  return size
}
/** Read the selected renderer and startup record. Never acquire a context or adapter. */
export function readPerformanceEnvironment(game: Game): PerformanceEnvironment {
  const backend=game.renderer?.backend as unknown as {device?: GPUDevice;gl?: WebGL2RenderingContext}|undefined
  const device=backend?.device, info=device?.adapterInfo
  const nav=typeof navigator==='undefined'?undefined:navigator as Navigator & {deviceMemory?:number}
  return {
    backend:startupTiming.backend ?? (game.renderer?game.backend:'initializing'),
    adapter:info?[info.vendor,info.architecture,info.device,info.description].filter(Boolean).join(' ')||null:null,
    memoryGB:nav?.deviceMemory ?? null,
    maxTextureSize:device?.limits.maxTextureDimension2D ?? (backend?.gl?glMaxTextureSize(backend.gl):null),
    fallbackReason:startupTiming.fallbackReason??null,deviceLost:startupTiming.deviceLost??null,
  }
}

/**
 * Reuse the existing quality frame feed for diagnostics. The old opt-in path installed a
 * global getContext patch, anonymous listeners and an interval without a disposal path.
 * Keep its URL alias, but use the same toggleable panel as F3 and the touch control.
 */
export function installRenderDiagnostics(game: Game): () => void {
  const errors: string[]=[]
  const read=(): PerformanceEnvironment=>{
    const environment=readPerformanceEnvironment(game),r=game.renderer
    // Bounded compatibility data for existing capture tools; no global hooks or timer.
    ;(window as unknown as {syn3hDiagnostics:unknown}).syn3hDiagnostics={
      ...environment,adapter:environment.adapter??'not exposed',maxTexture:environment.maxTextureSize,
      canvas:`${game.canvas.width} x ${game.canvas.height}`,pixelRatio:r?.getPixelRatio(),
      firstDrawSubmittedMs:game.performance.firstFrameMs,tick:game.tick,fps:game.fps,
      draws:game.performance.drawCalls,errors:[...errors],startup:formatStartup(),
      contextEvents:[],webglContexts:'not tracked',
    }
    return environment
  }
  game.quality.setPerformanceEnvironment(read)
  if(new URLSearchParams(location.search).get('diag')==='1')game.quality.setDiagnosticsVisible(true)
  const observed=new WeakSet<object>()
  return () => {
    const renderer=game.renderer
    if(observed.has(renderer))return
    observed.add(renderer)
    const onLost=renderer.onDeviceLost,onError=renderer.onError
    renderer.onError=message=>{errors.push(String(message));if(errors.length>12)errors.shift();onError.call(renderer,message);game.quality.setPerformanceEnvironment(read)}
    renderer.onDeviceLost=info=>{
      startupTiming.deviceLost=deviceLostMessage(info);onLost.call(renderer,info)
      // Game wraps this callback and writes its detailed record after it returns.
      // Publish after that stack completes, even if the animation loop has stopped.
      queueMicrotask(()=>game.quality.setPerformanceEnvironment(read))
    }
  }
}
