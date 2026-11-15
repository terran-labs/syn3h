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
}
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
}
/** Bind methods to their controller before passing this interface to presentation code. */
export interface PerformanceSource {
  getPerformanceSnapshot(): PerformanceSnapshot
  subscribePerformance(listener: (snapshot: PerformanceSnapshot) => void): () => void
  setDiagnosticsVisible(visible: boolean): void
  ignoreRecommendation(): void
  lowerRecommendedTier(): boolean
}
