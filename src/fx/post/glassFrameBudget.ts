// GPU cost starts a trial. On backends without timestamps, repeated jumps in
// frame time can also start one. Only a measured improvement keeps glass off.
type Cause = 'GPU cost' | 'uneven frames'
const windowMs = 2000
const dwellMs = 5000
const gpuBudgetMs = 1.5

export class GlassFrameBudget {
  enabled = true
  reason = 'drive started'
  private last = NaN
  private previous = NaN
  private settled = 0
  private sinceChange = Infinity
  private duration = 0
  private frames = 0
  private jumps = 0
  private gpuTotal = 0
  private gpuSamples = 0
  private cheapSample = false
  private lastStamp = -Infinity
  private trial?: Cause
  private before = 0
  private after?: number
  private invalidTrial = false
  private calmMs = 0
  private readonly ineffective = new Set<Cause>()

  enter() {
    this.enabled = true
    this.reason = 'drive started'
    this.sinceChange = Infinity
    this.trial = undefined
    this.ineffective.clear()
    this.interrupt()
  }

  interrupt() {
    if (this.trial && this.after === undefined) this.invalidTrial = true
    this.last = this.previous = NaN
    this.settled = this.calmMs = 0
    this.clearWindow()
  }

  sample(now: number, cost: number | null = null, stamp = -Infinity) {
    const dt = now - this.last
    if (dt <= 0 || dt > 250) this.interrupt()
    this.last = now
    if (!(dt > 0 && dt <= 250)) return
    this.sinceChange += dt
    if (this.settled < windowMs) { this.settled += dt; return }
    if (this.enabled && cost !== null && stamp > this.lastStamp && stamp >= now - this.duration - dt) {
      this.lastStamp = stamp
      this.gpuTotal += cost
      this.gpuSamples++
      if (cost <= gpuBudgetMs) this.cheapSample = true
    }

    this.duration += dt
    this.frames++
    if (dt > this.previous * 1.35 && dt - this.previous > 5) this.jumps++
    this.previous = dt

    if (this.trial && this.sinceChange >= dwellMs && this.after !== undefined &&
        (this.invalidTrial || this.after > this.before * .92)) {
      this.ineffective.add(this.trial)
      this.restore(this.invalidTrial ? 'trial interrupted; glass restored' :
        this.comparison() + '; under 8% gain, trial retired for this drive')
      return
    }
    if (this.duration < windowMs) return
    const mean = this.duration / this.frames
    const uneven = this.jumps / this.frames > .15
    if (this.trial) {
      if (this.after === undefined) {
        this.after = mean
        if (!this.invalidTrial && mean <= this.before * .92) this.reason = this.comparison() + '; glass remains shed'
      } else if (this.after <= this.before * .92 && !this.invalidTrial) {
        // A useful shed can reverse when the scene becomes cheaper than the
        // already improved CSS baseline, including on a 30 Hz display.
        this.calmMs = !uneven && mean < this.after * .92 ? this.calmMs + this.duration : 0
        if (this.calmMs >= dwellMs) this.restore('frame time recovered after a useful shed')
      }
    } else if (this.sinceChange >= dwellMs) {
      const cause = this.gpuSamples >= 2 && !this.cheapSample ? 'GPU cost' :
        !this.gpuSamples && now - this.lastStamp > windowMs && uneven ? 'uneven frames' : undefined
      if (cause && !this.ineffective.has(cause)) {
        const trigger = cause === 'GPU cost' ? (this.gpuTotal / this.gpuSamples).toFixed(2) + ' ms glass GPU' : cause
        this.reason = trigger + '; trial from ' + mean.toFixed(1) + ' ms/frame'
        this.enabled = false
        this.trial = cause
        this.before = mean
        this.after = undefined
        this.invalidTrial = false
        this.sinceChange = 0
      }
    }
    this.clearWindow()
  }

  private comparison() {
    const gain = (1 - this.after! / this.before) * 100
    return this.before.toFixed(1) + ' to ' + this.after!.toFixed(1) + ' ms/frame, ' + gain.toFixed(1) + '% gain'
  }

  private restore(reason: string) {
    this.enabled = true
    this.reason = reason
    this.trial = undefined
    this.sinceChange = this.calmMs = 0
    this.clearWindow()
  }

  private clearWindow() {
    this.duration = this.frames = this.jumps = this.gpuTotal = this.gpuSamples = 0
    this.cheapSample = false
  }
}
