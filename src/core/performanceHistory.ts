import type { EffectiveQuality, FrameMetrics } from './quality'
import type { PerformancePoint, PerformanceRecommendation } from './performance'

export const PERFORMANCE_POLICY = Object.freeze({ historyPoints: 120, windowMs: 1000, warmupMs: 5000, slowMs: 12000, slowRatio: .8, interruptedMs: 1000, maxWindowFrames: 2048 })
export const RECOMMENDATION_IGNORE_KEY = 'syn3h.performance.ignore'
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
  ignored = false
  recommendation: Readonly<PerformanceRecommendation> | null = null
  get history(): readonly PerformancePoint[] { return Object.freeze(this.points.slice()) }
  resetEvidence() {
    this.frames = []; this.elapsed = this.physics = this.draws = this.triangles = this.stalls = 0
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
    const point = Object.freeze({ timeMs: this.clock, frameMs: this.elapsed/n, p50Ms: percentile(.5), p90Ms: percentile(.9), p95Ms: percentile(.95), physicsMs: this.physics/n, drawCalls: this.draws/n, triangles: this.triangles/n, stalls: this.stalls, frames: n })
    this.points.push(point)
    if (this.points.length > PERFORMANCE_POLICY.historyPoints) this.points.shift()
    this.warmup += this.elapsed
    const fps = 1000/point.frameMs
    if (this.warmup > PERFORMANCE_POLICY.warmupMs) this.slow = fps < quality.targetFps*PERFORMANCE_POLICY.slowRatio ? this.slow+this.elapsed : 0
    this.recommendation = !this.ignored && quality.level > 0 && this.slow >= PERFORMANCE_POLICY.slowMs
      ? Object.freeze({ level: quality.level, targetLevel: (quality.level-1) as 0|1, observedFps: fps }) : null
    this.frames = []; this.elapsed = this.physics = this.draws = this.triangles = this.stalls = 0
    return true
  }
}
