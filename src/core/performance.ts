/** Read-only telemetry contract. QualityController remains the sole quality authority. */
import type { EffectiveQuality, GovernorReason, GraphicsLevel } from './quality'
import type { RendererBackendReason } from './renderOptions'

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
  readonly backendReason?: RendererBackendReason | null
  readonly adapter: string | null
  /** Adapter fields are filtered to recognized hardware labels in the copied report. */
  readonly adapterVendor?: string | null
  readonly adapterArchitecture?: string | null
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
  /**
   * Bots simulated here when the offer was made, and whether fewer of them is offered: true
   * when they measurably cost frame time. With it the offer reads "fewer bots, or a lower
   * level with the current bots"; at the lowest level it is the only offer.
   */
  readonly bots?: number
  readonly fewerBots?: boolean
}
/** Bots this device carries against what the host asked for, for the Performance card. */
export interface PerformanceBots { readonly carried: number; readonly requested: number; readonly costly: boolean }
export interface PerformanceSnapshot {
  readonly visible: boolean
  readonly quality: Readonly<EffectiveQuality>
  readonly levelPinned: boolean
  readonly qualityReason?: GovernorReason | 'start'
  /** Automatic changes across levels and easing rungs since the governor started. */
  readonly qualityChanges?: number
  /** All transitions after applying the initial quality level. */
  readonly qualityLevelChanges?: number
  readonly history: readonly PerformancePoint[]
  readonly recommendation: Readonly<PerformanceRecommendation> | null
  readonly environment: Readonly<PerformanceEnvironment>
  /** null means unavailable on this renderer: show that, never zero. */
  readonly pipelines?: Readonly<PerformancePipelines> | null
  readonly longFrames?: Readonly<PerformanceLongFrames>
  /** Absent where the game simulates no bots (a guest's bots are the host's). */
  readonly bots?: Readonly<PerformanceBots> | null
}
/** Bind methods to their controller before passing this interface to presentation code. */
export interface PerformanceSource {
  runPerformanceCheck?(signal: AbortSignal): Promise<string>
  diagnosticReport?(): string
  /** Blank frames recorded (Performance, Diagnostics, "Record blank frames"). */
  blankFrameCounts?(): { lastMinute: number; total: number } | null
  getPerformanceSnapshot(): PerformanceSnapshot
  subscribePerformance(listener: (snapshot: PerformanceSnapshot) => void): () => void
  setDiagnosticsVisible(visible: boolean): void
  ignoreRecommendation(): void
  lowerRecommendedTier(): boolean
  /** Accept the offer of fewer bots: one leaves now, and the governor does not bring it back on its own. */
  fewerRecommendedBots?(): boolean
}
