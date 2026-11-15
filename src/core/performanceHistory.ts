import type { EffectiveQuality, FrameMetrics, GraphicsLevel } from './quality'
import type { PerformanceLongFrames, PerformancePipelines, PerformancePoint, PerformanceRecommendation } from './performance'

export const PERFORMANCE_POLICY = Object.freeze({ historyPoints: 120, windowMs: 1000, warmupMs: 5000, slowMs: 10000, slowRatio: .8, interruptedMs: 1000, maxWindowFrames: 2048 })
export const RECOMMENDATION_IGNORE_KEY = 'syn3h.performance.ignore'
/**
 * Counts pipeline objects by identity from the renderer's own cache, read once per frame. A size
 * delta would miss a swap that releases and creates in the same frame, which is exactly how the
 * underwater fog defect behaved. The WeakSet holds no pipeline alive.
 */
export class PipelineCounter {
  private seen = new WeakSet<object>()
  created = 0
  /** Returns pipelines not seen before, or null when there is no cache to read. */
  scan(cache: { readonly size: number; values(): Iterable<object> } | null | undefined): { live: number; fresh: number } | null {
    if (!cache || typeof cache.values !== 'function') return null
    let fresh = 0
    for (const pipeline of cache.values()) if (!this.seen.has(pipeline)) { this.seen.add(pipeline); fresh++ }
    this.created += fresh
    return { live: cache.size, fresh }
  }
}
/** Bounded observation, never changes rendering. Decisions stay with QualityController. */
export class PerformanceHistory {
  private points: PerformancePoint[] = []
  private frames: number[] = []
  private elapsed = 0
  private physics = 0
  private draws = 0
  private triangles = 0
  private stalls = 0
  private clock = 0
  private warmup = 0
  private slow = 0
  private key = ''
  private pipelineWindow: number | null = null
  private over50 = 0
  private over1000 = 0
  private unpublished = 0
  private dirty = false
  /** null until a frame reports readable pipeline bookkeeping. */
  pipelines: Readonly<PerformancePipelines> | null = null
  get longFrames(): Readonly<PerformanceLongFrames> { return Object.freeze({ over50: this.over50, over1000: this.over1000 }) }
  /**
   * Every frame, before eligibility: device readback counters that recommendation resets must not
   * touch. Returns true about once a second while they are changing, so listeners hear about
   * freezes in the menu, where no history point is produced.
   */
  observe(metrics: FrameMetrics, visible: boolean): boolean {
    const ms = metrics.frameMs
    if (typeof metrics.pipelinesLive === 'number' && typeof metrics.pipelinesFresh === 'number') {
      const created = (this.pipelines?.created ?? 0) + metrics.pipelinesFresh
      if (!this.pipelines || metrics.pipelinesFresh > 0 || this.pipelines.live !== metrics.pipelinesLive) this.dirty = true
      this.pipelines = Object.freeze({ live: metrics.pipelinesLive, created })
      this.pipelineWindow = (this.pipelineWindow ?? 0) + metrics.pipelinesFresh
    }
    if (!visible || !Number.isFinite(ms) || ms <= 0) return false
    if (ms > 50) { this.over50++; this.dirty = true }
    if (ms > 1000) this.over1000++
    this.unpublished += ms
    if (!this.dirty || this.unpublished < PERFORMANCE_POLICY.windowMs) return false
    this.unpublished = 0; this.dirty = false
    return true
  }
  ignored = false
  recommendation: Readonly<PerformanceRecommendation> | null = null
  get history(): readonly PerformancePoint[] { return Object.freeze(this.points.slice()) }
  resetEvidence() {
    this.frames = []; this.elapsed = this.physics = this.draws = this.triangles = this.stalls = 0
    this.pipelineWindow = this.pipelines ? 0 : null
    this.warmup = this.slow = 0; this.recommendation = null
  }
  ignore() { this.ignored = true; this.resetEvidence() }
  sample(metrics: FrameMetrics, eligible: boolean, quality: EffectiveQuality): boolean {
    const ms = metrics.frameMs
    if (!eligible || !Number.isFinite(ms) || ms <= 0 || ms > PERFORMANCE_POLICY.interruptedMs) {
      const changed = this.recommendation !== null
      this.resetEvidence(); return changed
    }
    const key = `${quality.level}:${quality.rung}:${quality.auto}:${quality.targetFps}`
    if (key !== this.key) { this.key = key; this.resetEvidence() }
    this.clock += ms
    // A pathological stream must not turn one window into an unbounded allocation.
    if (this.frames.length >= PERFORMANCE_POLICY.maxWindowFrames) { this.resetEvidence(); return false }
    this.frames.push(ms); this.elapsed += ms
    this.physics += metrics.physicsMs; this.draws += metrics.drawCalls; this.triangles += metrics.triangles
    if (ms > 50) this.stalls++
    if (this.elapsed < PERFORMANCE_POLICY.windowMs) return false
    const n = this.frames.length, sorted = this.frames.sort((a,b) => a-b)
    const percentile = (q: number) => sorted[Math.min(n-1, Math.floor(n*q))]
    const point = Object.freeze({ timeMs: this.clock, frameMs: this.elapsed/n, p50Ms: percentile(.5), p90Ms: percentile(.9), p95Ms: percentile(.95), physicsMs: this.physics/n, drawCalls: this.draws/n, triangles: this.triangles/n, stalls: this.stalls, frames: n, pipelinesCreated: this.pipelineWindow })
    this.points.push(point)
    if (this.points.length > PERFORMANCE_POLICY.historyPoints) this.points.shift()
    this.warmup += this.elapsed
    const fps = 1000/point.frameMs
    // Match the governor's p90 pressure test. Let Auto exhaust its cheap sheds first.
    const exhausted = !quality.auto || quality.rung === quality.rungs - 1
    const slow = point.p90Ms > 1000 / quality.targetFps / PERFORMANCE_POLICY.slowRatio
    this.slow = exhausted && slow ? this.slow + this.elapsed : 0
    this.recommendation = !this.ignored && quality.level > 0 && this.warmup >= PERFORMANCE_POLICY.warmupMs && this.slow >= PERFORMANCE_POLICY.slowMs
      ? Object.freeze({ level: quality.level, targetLevel: (quality.level-1) as GraphicsLevel, observedFps: fps }) : null
    this.frames = []; this.elapsed = this.physics = this.draws = this.triangles = this.stalls = 0
    this.pipelineWindow = this.pipelines ? 0 : null
    this.unpublished = 0; this.dirty = false
    return true
  }
}
