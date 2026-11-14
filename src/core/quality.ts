/** Local rendering budgets. World parameters and physics resolution are never changed here. */
import { defineParam, params } from '../../shared/params'
import type { WebGPURenderer } from 'three/webgpu'
export type GraphicsLevel = 0 | 1 | 2
export const graphicsLevel = defineParam({ id: 'gfx.level', label: 'Graphics: 0 safe, 1 mobile, 2 desktop', group: 'Graphics', scope: 'client', default: 2, min: 0, max: 2, step: 1 })
export const QUALITY = [
  { name: 'safe', pixelRatio: 1, shadows: 0, particles: 240, bots: 2, drawDistance: 700, detail: 0.5 },
  { name: 'mobile', pixelRatio: 1.25, shadows: 1, particles: 960, bots: 4, drawDistance: 1400, detail: 0.75 },
  { name: 'desktop', pixelRatio: 2, shadows: 2, particles: 2400, bots: 16, drawDistance: 3000, detail: 1 },
] as const
export const levelNumber = (value: number): GraphicsLevel => Math.max(0, Math.min(2, Math.round(Number.isFinite(value) ? value : 0))) as GraphicsLevel
export function qualityBudget() { return QUALITY[levelNumber(graphicsLevel.value)] }
export interface DeviceHints { userAgent: string; touchPoints: number; memoryGB?: number; adapter?: 'available' | 'missing' | 'fallback'; maxTextureDimension2D?: number }
export function classifyDevice(hints: DeviceHints): GraphicsLevel {
  const mobile = /Android|iPhone|iPad|iPod/i.test(hints.userAgent) || /Macintosh/i.test(hints.userAgent) && hints.touchPoints > 1
  if ((hints.memoryGB !== undefined && hints.memoryGB <= 2) || hints.adapter === 'fallback' || (hints.maxTextureDimension2D !== undefined && hints.maxTextureDimension2D < 8192)) return 0
  if (mobile) return hints.adapter === 'missing' ? 0 : 1
  if (hints.adapter === 'missing' || (hints.memoryGB !== undefined && hints.memoryGB <= 4)) return 1
  return 2
}
export const LOAD_KEY = 'syn3h.loading.level'
export const LEVEL_KEY = 'syn3h.graphics.level'
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function storageRead(storage: StorageLike | null, key: string): string | null { try { return storage?.getItem(key) ?? null } catch { return null } }
function storageWrite(storage: StorageLike | null, key: string, value: string | null) { try { if (value === null) storage?.removeItem(key); else storage?.setItem(key, value) } catch { /* Private mode may reject storage writes. */ } }
/** An unfinished previous load lowers its previous level, including repeated failed loads. */
export function beginLoad(storage: StorageLike | null, detected: GraphicsLevel): GraphicsLevel {
  const pending = storageRead(storage, LOAD_KEY), saved = storageRead(storage, LEVEL_KEY)
  let level = Math.min(detected, saved === null ? 2 : levelNumber(Number(saved)))
  if (pending !== null) level = Math.min(level, Math.max(0, levelNumber(Number(pending)) - 1))
  storageWrite(storage, LOAD_KEY, String(level))
  return level as GraphicsLevel
}
export function finishLoad(storage: StorageLike | null) { storageWrite(storage, LOAD_KEY, null) }

/** Ignore hidden tabs and startup. Require four consecutive two-second slow windows. */
export class FrameBudgetMonitor {
  private warmup = 0
  private elapsed = 0
  private frames = 0
  private slow = 0
  private cooldown = 0
  sample(frameMs: number, visible = true): boolean {
    if (!visible || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) { this.elapsed = this.frames = this.slow = 0; return false }
    this.warmup += frameMs
    if (this.warmup < 5000) return false
    if (this.cooldown > 0) { this.cooldown -= frameMs; return false }
    this.elapsed += frameMs; this.frames++
    if (this.elapsed < 2000) return false
    const fps = this.frames * 1000 / this.elapsed
    this.slow = fps < 28 ? this.slow + this.elapsed : 0
    this.elapsed = this.frames = 0
    if (this.slow < 8000) return false
    this.slow = 0; this.cooldown = 15000
    return true
  }
}
export interface LoadProgress { phase: 'device' | 'physics' | 'renderer' | 'world' | 'ready'; progress: number; elapsedMs: number }
export let loadingProgress: LoadProgress = { phase: 'device', progress: 0, elapsedMs: 0 }
export function reportLoading(phase: LoadProgress['phase'], progress: number) {
  loadingProgress = { phase, progress: Math.max(loadingProgress.progress, progress), elapsedMs: performance.now() }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('syn3h:loading', { detail: loadingProgress }))
}
export interface QualityTerrain { setRenderQuality?(options: { level: GraphicsLevel; drawDistance: number; detail: number }): void }
export interface FrameMetrics { fps: number; frameMs: number; physicsMs: number; drawCalls: number; triangles: number; firstFrameMs: number | null }
export class QualityController {
  private storage: StorageLike | null = null
  private readonly monitor = new FrameBudgetMonitor()
  private renderer: WebGPURenderer | null = null
  private terrain: QualityTerrain | null = null
  private hud: HTMLPreElement | null = null
  private hudElapsed = 0
  private loading = true
  private unsubscribe: (() => void) | null = null
  private detected: GraphicsLevel = 2
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.code !== 'F3' || event.repeat) return
    event.preventDefault()
    if (!this.hud) {
      this.hud = document.createElement('pre'); this.hud.id = 'frame-time-hud'
      this.hud.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:10000;padding:10px;background:#100e16e8;color:#d9f4dc;font:12px monospace;pointer-events:none;margin:0'
      document.body.append(this.hud)
    } else this.hud.hidden = !this.hud.hidden
  }
  constructor() {
    if (typeof window === 'undefined') return
    // Session storage survives a tab reload without making another tab look crashed.
    try { this.storage = window.sessionStorage } catch { try { this.storage = window.localStorage } catch { /* No storage available. */ } }
    const nav = navigator as Navigator & { deviceMemory?: number }
    this.detected = classifyDevice({ userAgent: nav.userAgent, touchPoints: nav.maxTouchPoints, memoryGB: nav.deviceMemory })
    params.set(graphicsLevel.def.id, beginLoad(this.storage, this.detected))
    reportLoading('device', 0.05)
    window.addEventListener('keydown', this.onKey)
    this.unsubscribe = params.onChange(id => {
      if (id !== graphicsLevel.def.id) return
      storageWrite(this.storage, LEVEL_KEY, String(levelNumber(graphicsLevel.value)))
      if (this.loading) storageWrite(this.storage, LOAD_KEY, String(levelNumber(graphicsLevel.value)))
      this.apply()
    })
  }
  async initialize() {
    const nav = navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(options?: { powerPreference: string }): Promise<{ isFallbackAdapter?: boolean; limits: { maxTextureDimension2D: number } } | null> } }
    let adapter: Awaited<ReturnType<NonNullable<typeof nav.gpu>['requestAdapter']>> = null
    try {
      if (nav.gpu) adapter = await nav.gpu.requestAdapter({ powerPreference: this.detected < 2 ? 'low-power' : 'high-performance' })
    } catch { /* WebGL fallback remains usable when adapter discovery fails. */ }
    const detected = classifyDevice({ userAgent: nav.userAgent, touchPoints: nav.maxTouchPoints, memoryGB: nav.deviceMemory, adapter: adapter ? adapter.isFallbackAdapter ? 'fallback' : 'available' : 'missing', maxTextureDimension2D: adapter?.limits.maxTextureDimension2D })
    params.set(graphicsLevel.def.id, Math.min(graphicsLevel.value, detected))
    this.apply()
  }
  attachRenderer(renderer: WebGPURenderer) { this.renderer = renderer; this.apply() }
  /** Optional hook for terrain builders; no regeneration or physics changes are implied. */
  attachTerrain(terrain: QualityTerrain) { this.terrain = terrain; this.apply() }
  private apply() {
    const budget = qualityBudget()
    this.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, budget.pixelRatio))
    params.set('gfx.shadowQuality', budget.shadows)
    params.set('lava.particleBudget', budget.particles)
    this.terrain?.setRenderQuality?.({ level: levelNumber(graphicsLevel.value), drawDistance: budget.drawDistance, detail: budget.detail })
    window.dispatchEvent(new CustomEvent('syn3h:quality', { detail: { level: levelNumber(graphicsLevel.value), ...budget } }))
  }
  frame(metrics: FrameMetrics) {
    if (this.loading && metrics.drawCalls > 0) {
      this.loading = false; finishLoad(this.storage); reportLoading('ready', 1)
    }
    if (!this.loading && this.monitor.sample(metrics.frameMs, !document.hidden) && graphicsLevel.value > 0) params.set(graphicsLevel.def.id, levelNumber(graphicsLevel.value) - 1)
    this.hudElapsed += metrics.frameMs
    if (this.hud && !this.hud.hidden && this.hudElapsed >= 250) {
      this.hudElapsed = 0
      this.hud.textContent = `${qualityBudget().name} / ${metrics.fps.toFixed(0)} fps\nFrame ${metrics.frameMs.toFixed(1)} ms\nPhysics ${metrics.physicsMs.toFixed(2)} ms\nDraws ${metrics.drawCalls} / triangles ${metrics.triangles.toLocaleString()}`
    }
  }
  dispose() { this.unsubscribe?.(); window.removeEventListener('keydown', this.onKey); this.hud?.remove() }
}
