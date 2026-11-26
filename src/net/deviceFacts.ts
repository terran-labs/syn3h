/**
 * Device and rendering facts for launch analytics (the owner: decide rendering features by
 * "what percentage of players will be able to appreciate them"). Two small records:
 *
 *  - deviceFacts(): capability, once per page, sent in the hello; the room writes one `device`
 *    row per session (server/analytics.ts cleanDevice re-checks every field).
 *  - perfFacts(): how the game actually ran, from counters the quality governor already keeps
 *    (PerformanceHistory: per-second p50 and p95 windows at the settled level). Posted at most
 *    once per page by src/net/analytics.ts reportPerf. No per-frame work here at all.
 *
 * What a browser does not say stays unknown (0 or ''), never guessed: Safari and Firefox give
 * no device memory, Safari clamps cores to 4 or 8, and adapter strings may be withheld.
 * Deliberately not collected: see server/analytics.ts, "Device and rendering".
 */
import type { Game } from '../core/Game'
import { LEVELS, levelNumber, qualityLevel } from '../core/quality'
import { rendererBackendReason } from '../core/renderOptions'
import { pinnedValue } from '../core/flashSwitches'
import { liquidSelected } from '../ui/glassMaterial'
import { params } from '../../shared/params'
import { featureCodes, gpuFamily, gpuVendor } from '../../shared/gpu'

export interface DeviceFacts {
  vendor: string; model: string; source: 'webgpu' | 'webgl' | 'none'; reason: string; probe: string; features: string
  gamut: string; hdr: string; pointer: string; motion: string
  mem: number; cores: number; start: number; maxTex: number; w: number; h: number; dpr: number
}

const media = (q: string): boolean => { try { return typeof matchMedia !== 'undefined' && matchMedia(q).matches } catch { return false } }
const POW2 = [2048, 4096, 8192, 16384, 32768]

/** The GPU as the renderer sees it: WebGPU's adapter info, else WebGL's unmasked strings. */
export function gpuOf(game: Pick<Game, 'renderer'>): { vendor: string; model: string; source: 'webgpu' | 'webgl' | 'none'; features: string; maxTex: number } {
  try {
    const backend = game.renderer?.backend as unknown as { device?: GPUDevice; gl?: WebGL2RenderingContext } | undefined
    const device = backend?.device
    if (device) {
      const info = (device as GPUDevice & { adapterInfo?: { vendor?: string; architecture?: string; device?: string; description?: string } }).adapterInfo ?? {}
      const model = gpuFamily(info.description || [info.vendor, info.architecture, info.device].filter(Boolean).join(' '))
      return { vendor: gpuVendor(info.vendor, info.description, info.architecture), model, source: 'webgpu', features: featureCodes(device.features as unknown as Iterable<string>), maxTex: device.limits.maxTextureDimension2D }
    }
    const gl = backend?.gl
    if (gl) {
      let renderer = '', vendor = ''
      const debug = gl.getExtension('WEBGL_debug_renderer_info')
      if (debug) { renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? ''); vendor = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? '') }
      if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) ?? '')
      return { vendor: gpuVendor(vendor, renderer), model: gpuFamily(renderer), source: 'webgl', features: '', maxTex: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0 }
    }
  } catch { /* a lost context or device withholds these: unknown */ }
  return { vendor: 'unknown', model: '', source: 'none', features: '', maxTex: 0 }
}

let cached: DeviceFacts | null = null
/** Capability, read once per page (cheap, but nothing here needs reading twice). */
export function deviceFacts(game: Game): DeviceFacts {
  if (cached) return cached
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number }
  const gpu = gpuOf(game)
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 0
  const facts: DeviceFacts = {
    vendor: gpu.vendor, model: gpu.model, source: gpu.source,
    reason: (game.renderer ? rendererBackendReason(game.renderer) : null) ?? '', probe: game.quality.adapterProbe ?? '', features: gpu.features,
    gamut: media('(color-gamut: rec2020)') ? 'rec2020' : media('(color-gamut: p3)') ? 'p3' : 'srgb',
    hdr: media('(dynamic-range: high)') ? 'high' : 'standard',
    pointer: media('(pointer: coarse)') ? 'coarse' : media('(pointer: fine)') ? 'fine' : 'none',
    motion: media('(prefers-reduced-motion: reduce)') ? 'reduce' : 'no-preference',
    mem: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 0,
    cores: Math.min(256, Math.max(0, Math.round(nav.hardwareConcurrency ?? 0))),
    start: levelNumber(qualityLevel.value),
    maxTex: POW2.includes(gpu.maxTex) ? gpu.maxTex : 0,
    w: typeof innerWidth === 'number' ? Math.min(100, Math.max(1, Math.round(innerWidth / 100))) : 0,
    h: typeof innerHeight === 'number' ? Math.min(100, Math.max(1, Math.round(innerHeight / 100))) : 0,
    dpr: dpr > 0 ? Math.min(6, Math.max(0.25, Math.round(dpr * 4) / 4)) : 0,
  }
  cached = facts
  return facts
}

export interface PerfFacts {
  vendor: string; model: string; start: number; settled: number; auto: number; medianMs: number; p95Ms: number; windows: number
  shadow: number; glass: number; post: number; longFrames: number; fps: number; seconds: number
}

const POST_TIERS = ['off', 'base', 'lite', 'full']
const FPS = [30, 60, 90, 120, 144]

/** Median of the windows' p50 (0.5 ms buckets) and 95th percentile of their p95 (1 ms). */
export function frameSummary(points: readonly { p50Ms: number; p95Ms: number }[]): { medianMs: number; p95Ms: number; windows: number; fps: number } {
  const p50 = points.map((p) => p.p50Ms).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  const p95 = points.map((p) => p.p95Ms).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (!p50.length) return { medianMs: 0, p95Ms: 0, windows: 0, fps: 0 }
  const at = (a: number[], q: number) => a[Math.min(a.length - 1, Math.floor(q * a.length))]
  const best = 1000 / p50[0]
  // The observed ceiling: the highest common refresh rate the best window reached (within 10%).
  const fps = [...FPS].reverse().find((f) => best >= f * 0.9) ?? 30
  return { medianMs: Math.max(0.5, Math.round(at(p50, 0.5) * 2) / 2), p95Ms: Math.max(1, Math.round(at(p95, 0.95))), windows: p50.length, fps }
}

/** How the game ran this page, from what the quality governor already measured. */
export function perfFacts(game: Game, startLevel: number, seconds: number): PerfFacts | null {
  try {
    const snap = game.quality.getPerformanceSnapshot()
    const frames = frameSummary(snap.history)
    if (!frames.windows) return null
    const level = levelNumber(snap.quality.level)
    const gpu = gpuOf(game)
    const shadow = Number(pinnedValue('gfx.shadowQuality') ?? params.get('gfx.shadowQuality')?.value ?? 0)
    return {
      vendor: gpu.vendor, model: gpu.model, start: startLevel, settled: level, auto: snap.quality.auto ? 1 : 0,
      medianMs: frames.medianMs, p95Ms: frames.p95Ms, windows: frames.windows,
      shadow: Number.isInteger(shadow) ? Math.min(5, Math.max(0, shadow)) : 0,
      glass: liquidSelected() ? 1 : 0, post: Math.max(0, POST_TIERS.indexOf(LEVELS[level].postTier)),
      longFrames: snap.longFrames?.over50 ?? 0, fps: frames.fps, seconds: Math.min(86_400, Math.max(0, Math.round(seconds))),
    }
  } catch { return null }
}
