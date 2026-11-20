import type { Game } from './Game'
import type { PerformanceEnvironment } from './performance'
import { deviceLostMessage, rendererBackendReason } from './renderOptions'
import type { StartFailure } from './graphicsSupport'

/**
 * Startup phase timing, always on. Each phase is a performance.measure named
 * `syn3h:<phase>` and a row in `window.syn3hStartup`, so the `?diag=1` overlay and automation
 * read the same numbers. Times are milliseconds since navigation start, the clock that
 * firstDrawSubmittedMs uses. Recording costs a few object writes per phase.
 */
export interface StartupPhase { name: string; startMs: number; endMs: number; ms: number; detail?: string }
export interface StartupTiming {
  phases: StartupPhase[]
  initialTerrainMs?: number
  firstLobbyFrameMs?: number
  firstWorldFrameMs?: number
  playRequestMs?: number
  firstRevealMs?: number
  firstPlayableFrameMs?: number
  entryPrecompileMs?: number
  /** Navigation milestones read from the browser, filled in when the overlay or automation asks. */
  navigation?: { responseEndMs: number; domContentLoadedMs: number; loadEventMs: number; scripts: number; scriptBytes: number; lastScriptEndMs: number }
  backend?: string
  fallbackReason?: string
  /** Why the lobby drew the flat wordmark instead of the name in the scene (src/ui/galaxy/Galaxy.ts), if it did. */
  wordmarkFallback?: string
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

/** First startup terrain generation, before any room or player world changes. */
export function recordInitialTerrainGeneration(durationMs: number): void {
  startupTiming.initialTerrainMs ??= durationMs
}

export function recordStartupLobbyFrame(): void {
  startupTiming.firstLobbyFrameMs ??= performance.now()
}

export function recordStartupPlayRequest(): void {
  startupTiming.playRequestMs ??= performance.now()
}

export function cancelStartupPlayRequest(): void {
  if (startupTiming.firstRevealMs !== undefined) return
  startupTiming.playRequestMs = undefined
  startupTiming.entryPrecompileMs = undefined
  coveredVehicleDraws.clear()
}

/** Returns true only at the first actual fade or immediate menu close into play. */
export function recordStartupReveal(): boolean {
  if (startupTiming.firstRevealMs !== undefined) return false
  startupTiming.firstRevealMs = performance.now()
  return true
}

export function recordStartupGameDraw(playing: boolean): void {
  const now = performance.now()
  startupTiming.firstWorldFrameMs ??= now
  if (playing && startupTiming.playRequestMs !== undefined && startupTiming.firstRevealMs !== undefined) {
    startupTiming.firstPlayableFrameMs ??= now
  }
}

export function recordStartupPrecompile(durationMs: number): void {
  if (startupTiming.playRequestMs === undefined || startupTiming.firstRevealMs !== undefined) return
  startupTiming.entryPrecompileMs ??= durationMs
}

const coveredVehicleKinds = ['buggy', 'jet', 'hovercraft', 'tank'] as const
type CoveredVehicleKind = typeof coveredVehicleKinds[number]
const coveredVehicleDraws = new Map<CoveredVehicleKind, { count: number; ms: number }>()

/** Record a real covered vehicle draw's synchronous duration for the first entry report. */
export function recordCoveredVehicleDraw(kind: string, durationMs: number): void {
  if (startupTiming.playRequestMs === undefined || startupTiming.firstRevealMs !== undefined) return
  const vehicle = kind === 'buggy-syn3h' || kind === 'buggy-classic'
    ? 'buggy' : coveredVehicleKinds.find(name => name === kind)
  if (!vehicle || !Number.isFinite(durationMs) || durationMs < 0) return
  const previous = coveredVehicleDraws.get(vehicle)
  if (previous) { previous.count++; previous.ms += durationMs }
  else coveredVehicleDraws.set(vehicle, { count: 1, ms: durationMs })
}

/** A fixed set of numeric timings for Copy diagnostics, with no free-form phase metadata. */
export function startupReportLines(): string[] {
  const t = startupTiming
  const phase = (name: string) => t.phases.find(p => p.name === name)
  const ms = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0
    ? `${value.toFixed(1)} ms` : 'unavailable'
  const since = (at: number | undefined, start: number | undefined) =>
    at === undefined || start === undefined ? undefined : at - start
  const nav = typeof performance !== 'undefined'
    ? performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
    : undefined
  const response = nav && nav.responseEnd > 0 ? nav.responseEnd : undefined
  const lines = [
    'Startup and entry timings',
    `Page response from navigation ${ms(response)}`,
    `Entry module from navigation ${ms(phase('run remaining modules to main()')?.endMs)}`,
    `Initial terrain generation ${ms(t.initialTerrainMs)}`,
    `First world frame submitted from navigation ${ms(t.firstWorldFrameMs)}`,
    `First lobby frame submitted from navigation ${ms(t.firstLobbyFrameMs)}`,
    `Covered entry precompile (elapsed) ${ms(t.entryPrecompileMs)}`,
  ]
  const vehicleLines = coveredVehicleKinds.flatMap(kind => {
    const entry = coveredVehicleDraws.get(kind)
    return entry ? [`${kind} ${ms(entry.ms)} (${entry.count} ${entry.count === 1 ? 'draw' : 'draws'})`] : []
  })
  lines.push(
    `Covered vehicle draws (synchronous) ${vehicleLines.join(', ') || 'unavailable'}`,
    `Play to first reveal ${ms(since(t.firstRevealMs, t.playRequestMs))}`,
    `Play to first playable frame submitted ${ms(since(t.firstPlayableFrameMs, t.playRequestMs))}`,
  )
  const fixedPhases = new Map([
    ['fetch and run modules up to Game.ts', 'Load modules through Game'],
    ['run remaining modules to main()', 'Remaining modules'],
    ['physics init (Rapier WASM), beside the probe and renderer', 'Physics init'],
    ['quality initialise (WebGPU adapter probe)', 'Adapter probe'],
    ['renderer.init (adapter, device, context)', 'Renderer init'],
    ['wait for physics after the renderer', 'Physics wait'],
    ['build until terrain attached to quality', 'Terrain setup'],
    ['param panel and wiring to game.start', 'Final setup'],
    ['game.start to first animation frame', 'Start to first animation frame'],
    ['frame 1 render end to next animation frame', 'Frame 1 to next animation frame'],
    ['frame 1 render end to GPU work done', 'Frame 1 to GPU completion'],
    ['lobby wordmark field bake', 'Lobby wordmark bake'],
  ])
  const phaseEntries: string[] = []
  let smallMs = 0, smallCount = 0
  for (const entry of [...t.phases].sort((a, b) => a.startMs - b.startMs)) {
    let label = fixedPhases.get(entry.name)
    if (!label) {
      // Only registered startup labels use this printable form.
      const system = /^build until add [1-9]\d*: ([A-Za-z][A-Za-z -]{2,32})$/.exec(entry.name)
      const frame = /^frame ([123]) (systems update|render call \(shader and pipeline compile\))$/.exec(entry.name)
      if (system) label = system[1]
      else if (frame) label = `Frame ${frame[1]} ${frame[2] === 'systems update' ? 'update' : 'render'}`
    }
    if (label && entry.ms < 1) { smallMs += entry.ms; smallCount++; continue }
    if (label) phaseEntries.push(`${label} ${ms(entry.ms)}`)
  }
  if (smallCount) phaseEntries.push(`Others under 1 ms (${smallCount}) ${ms(smallMs)}`)
  if (phaseEntries.length) {
    lines.push('Startup phases in start order (may overlap)')
    for (let i = 0; i < phaseEntries.length; i += 3) lines.push(phaseEntries.slice(i, i + 3).join(' | '))
  } else {
    lines.push('Startup phases unavailable')
  }
  return lines
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

/** The part of `document` the notices need, so tests can pass a fake. */
export interface NoticeNode { id: string; textContent: string | null; style: { cssText: string }; setAttribute(name: string, value: string): void; append(...nodes: unknown[]): void; addEventListener(type: 'click', listener: () => void): void }
export interface NoticeDocument {
  getElementById(id: string): unknown
  createElement(tag: 'div' | 'p' | 'button' | 'ul' | 'li' | 'details' | 'summary' | 'pre'): NoticeNode
  body: { append(node: unknown): void }
}
/** What a notice says: plain sentences, steps a person can take, one action, and technical detail behind a disclosure. */
export interface NoticeContent { text: string; steps?: readonly string[]; action?: { label: string; run: () => void }; details?: string }

/**
 * The look every full-screen notice shares (a lost device, a failed start): the HUD's neutral
 * greys, readable on a phone. Plain DOM and inline styles, not src/ui, so it works whatever
 * state the lobby is in and before any stylesheet has applied; the tokens fall back to their values.
 */
export const NOTICE_STYLE = 'position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;box-sizing:border-box;overflow:auto;background:rgb(8 8 9 / .94);color:var(--s3-ink,#efefef);font:17px/1.5 Barlow,system-ui,sans-serif;text-align:center'
const BUTTON_STYLE = 'font:inherit;min-height:44px;padding:10px 28px;border-radius:999px;border:1px solid var(--s3-line,rgb(225 225 225 / .28));background:rgb(205 205 205 / .08);color:var(--s3-ink,#efefef);cursor:pointer'

/** Fill `box` with a notice: the text, then the steps, then the action, then the details. */
export function fillNotice(doc: NoticeDocument, box: NoticeNode, content: NoticeContent): void {
  const text = doc.createElement('p')
  text.textContent = content.text
  text.style.cssText = 'margin:0;max-width:34em'
  box.append(text)
  if (content.steps?.length) {
    const list = doc.createElement('ul')
    list.style.cssText = 'margin:0;padding:0 0 0 1.2em;max-width:30em;text-align:left;color:var(--s3-dim,#c4c4c4)'
    for (const step of content.steps) { const item = doc.createElement('li'); item.textContent = step; item.style.cssText = 'margin:6px 0'; list.append(item) }
    box.append(list)
  }
  if (content.action) {
    const button = doc.createElement('button')
    button.textContent = content.action.label
    button.style.cssText = BUTTON_STYLE
    button.addEventListener('click', content.action.run)
    box.append(button)
  }
  if (content.details) {
    // The raw error, for a bug report: never the first thing a player reads.
    const details = doc.createElement('details'), summary = doc.createElement('summary'), pre = doc.createElement('pre')
    summary.textContent = 'Details'
    summary.style.cssText = 'cursor:pointer;color:var(--s3-soft,#a2a2a2);font-size:14px'
    pre.textContent = content.details
    pre.style.cssText = 'margin:8px 0 0;max-width:min(34em,90vw);white-space:pre-wrap;word-break:break-word;text-align:left;font:13px/1.4 ui-monospace,monospace;color:var(--s3-soft,#a2a2a2)'
    details.append(summary, pre)
    box.append(details)
  }
}

/**
 * The game could not start: a plain notice in #fatal (the loading veil lifts when it shows).
 * The raw error stays behind Details and in the console; a reload is offered only when it can help.
 */
export function showStartFailure(failure: StartFailure, doc: NoticeDocument | undefined = typeof document !== 'undefined' ? document as unknown as NoticeDocument : undefined, reload: () => void = () => location.reload()): boolean {
  const box = doc?.getElementById('fatal') as (NoticeNode & { dataset?: Record<string, string> }) | null | undefined
  if (!doc || !box) return false
  box.style.cssText = NOTICE_STYLE
  box.setAttribute('role', 'alert')
  box.setAttribute('data-failure', failure.kind)
  fillNotice(doc, box, { text: failure.text, steps: failure.steps, action: failure.reload ? { label: 'Reload', run: reload } : undefined, details: failure.details })
  return true
}

/**
 * Tell the player the renderer's GPU device or WebGL context is gone and offer a reload,
 * instead of leaving a frozen or black canvas. Shown once; later losses only update the record.
 */
export function showRendererLost(info?: { api?: string; message?: string; reason?: string | null }, doc: NoticeDocument | undefined = typeof document !== 'undefined' ? document as unknown as NoticeDocument : undefined, reload: () => void = () => location.reload()): boolean {
  startupTiming.deviceLost = [info?.api ?? 'GPU', info?.reason, info?.message].filter(Boolean).join(': ')
  if (!doc || doc.getElementById('syn3h-device-lost')) return false
  const box = doc.createElement('div')
  box.id = 'syn3h-device-lost'
  box.setAttribute('role', 'alert')
  box.style.cssText = NOTICE_STYLE
  fillNotice(doc, box, { text: deviceLostMessage(info), action: { label: 'Reload', run: reload } })
  doc.body.append(box)
  return true
}

interface GLIdentity {
  readonly vendor: string | null
  readonly family: string | null
  readonly maxTextureSize: number | null
}

// Query the existing context once. Keep only the recognized family and vendor, plus the limit.
const glIdentities = new WeakMap<WebGL2RenderingContext, GLIdentity>()
function glIdentity(gl: WebGL2RenderingContext): GLIdentity {
  const cached = glIdentities.get(gl)
  if (cached) return cached

  let renderer = ''
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    if (debug) {
      const value: unknown = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      if (typeof value === 'string') renderer = value
    }
  } catch { /* Some browsers withhold the unmasked renderer. */ }
  let maxTextureSize: number | null = null
  try {
    if (!renderer) {
      const value: unknown = gl.getParameter(gl.RENDERER)
      if (typeof value === 'string') renderer = value
    }
    const size: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) maxTextureSize = size
  } catch { /* A lost context may withhold these values. */ }

  // Fixed labels only. Give the software renderers priority over ANGLE's vendor prefix.
  const families: readonly (readonly [RegExp, string, string | null])[] = [
    [/\bswiftshader\b/i, 'google', 'swiftshader'],
    [/\bllvmpipe\b/i, 'mesa', 'llvmpipe'],
    [/\bsoftpipe\b/i, 'mesa', 'softpipe'],
    [/\b(?:warp|microsoft basic render driver)\b/i, 'microsoft', 'warp'],
    [/\bgeforce\b/i, 'nvidia', 'geforce'],
    [/\bquadro\b/i, 'nvidia', 'quadro'],
    [/\bradeon\b/i, 'amd', 'radeon'],
    [/\bintel\b.*\barc\b/i, 'intel', 'arc'],
    [/\biris\b/i, 'intel', 'iris'],
    [/\buhd graphics\b/i, 'intel', 'uhd'],
    [/\badreno\b/i, 'qualcomm', 'adreno'],
    [/\bmali\b/i, 'arm', 'mali'],
    [/\bpowervr\b/i, 'imagination', 'powervr'],
    [/\bapple\b/i, 'apple', 'apple-gpu'],
    [/\bnvidia\b/i, 'nvidia', null],
    [/\b(?:amd|ati)\b/i, 'amd', null],
    [/\bintel\b/i, 'intel', null],
    [/\bqualcomm\b/i, 'qualcomm', null],
  ]
  const match = families.find(([pattern]) => pattern.test(renderer))
  const identity = { vendor: match?.[1] ?? null, family: match?.[2] ?? null, maxTextureSize }
  glIdentities.set(gl, identity)
  return identity
}

/** Read the selected renderer and startup record. Never acquire a context or adapter. */
export function readPerformanceEnvironment(game: Game): PerformanceEnvironment {
  const renderer = game.renderer
  const backend = renderer?.backend as unknown as { device?: GPUDevice; gl?: WebGL2RenderingContext } | undefined
  const device = backend?.device, info = device?.adapterInfo
  const gl = !device && backend?.gl ? glIdentity(backend.gl) : null
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number }
  return {
    backend: startupTiming.backend ?? (renderer ? game.backend : 'initializing'),
    backendReason: renderer ? rendererBackendReason(renderer) : null,
    adapter: info ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') || null
      : [gl?.vendor, gl?.family].filter(Boolean).join(' / ') || null,
    adapterVendor: info?.vendor ?? gl?.vendor ?? null,
    adapterArchitecture: info?.architecture ?? gl?.family ?? null,
    memoryGB: nav?.deviceMemory ?? null,
    maxTextureSize: device?.limits.maxTextureDimension2D ?? gl?.maxTextureSize ?? null,
    fallbackReason: startupTiming.fallbackReason ?? null,
    deviceLost: startupTiming.deviceLost ?? null,
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
