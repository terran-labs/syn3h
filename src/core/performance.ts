/** Read-only telemetry contract. QualityController remains the sole quality authority. */
import type { EffectiveQuality, GraphicsLevel } from './quality'

/** One second of eligible play, not a continuous wall-clock timeline. Times are ms. */
export interface PerformancePoint {
  readonly timeMs: number
  readonly frameMs: number
  readonly p50Ms: number
  readonly p90Ms: number
  readonly p95Ms: number
  readonly physicsMs: number
  readonly drawCalls: number
  readonly triangles: number
  readonly stalls: number
  readonly frames: number
  /**
   * Pipeline objects first seen in this window; null where the renderer's bookkeeping is not
   * readable. A count of CPU-side creations, not GPU compile or execution time.
   */
  readonly pipelinesCreated?: number | null
}
/** Live and cumulative pipeline objects. Misses one created and released inside a single frame. */
export interface PerformancePipelines { readonly live: number; readonly created: number }
/**
 * Visible frames since start, counted in menus and loading too and never reset by recommendation
 * evidence, so freezes over a second are included. `stalls` in the history is the narrower count.
 */
export interface PerformanceLongFrames { readonly over50: number; readonly over1000: number }
export interface PerformanceEnvironment {
  readonly backend: string
  readonly adapter: string | null
  /** Browser estimate, not measured RAM or available GPU memory. */
  readonly memoryGB: number | null
  readonly maxTextureSize: number | null
  readonly fallbackReason: string | null
  readonly deviceLost: string | null
}
export interface PerformanceRecommendation {
  readonly level: GraphicsLevel
  readonly targetLevel: GraphicsLevel
  readonly observedFps: number
}
export interface PerformanceSnapshot {
  readonly visible: boolean
  readonly quality: Readonly<EffectiveQuality>
  readonly levelPinned: boolean
  readonly history: readonly PerformancePoint[]
  readonly recommendation: Readonly<PerformanceRecommendation> | null
  readonly environment: Readonly<PerformanceEnvironment>
  /** null means unavailable on this renderer: show that, never zero. */
  readonly pipelines?: Readonly<PerformancePipelines> | null
  readonly longFrames?: Readonly<PerformanceLongFrames>
}
/** Bind methods to their controller before passing this interface to presentation code. */
export interface PerformanceSource {
  getPerformanceSnapshot(): PerformanceSnapshot
  subscribePerformance(listener: (snapshot: PerformanceSnapshot) => void): () => void
  setDiagnosticsVisible(visible: boolean): void
  ignoreRecommendation(): void
  lowerRecommendedTier(): boolean
}
