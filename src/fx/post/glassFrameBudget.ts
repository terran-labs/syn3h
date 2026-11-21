// Sample wall time between eligible drive frames. GPU timestamps alone miss CPU
// stalls and are unavailable on some devices.
export class GlassFrameBudget {
  enabled = true
  reason = 'drive started'
  private last = NaN
  private settled = 0
  private windowMs = 0
  private frames = 0
  private slow = 0
  private evidenceMs = 0
  private evidenceFrames = 0
  private evidenceSlow = 0
  private sinceChange = Infinity

  enter() {
    this.enabled = true
    this.reason = 'drive started'
    this.sinceChange = Infinity
    this.interrupt()
  }

  interrupt() {
    this.last = NaN
    this.settled = 0
    this.clearEvidence()
    this.clearWindow()
  }

  sample(now: number) {
    const interval = now - this.last
    if (interval <= 0 || interval > 250) this.interrupt()
    this.last = now
    if (!(interval > 0 && interval <= 250)) return
    this.sinceChange += interval
    if (this.settled < 2000) {
      this.settled += interval
      return
    }

    this.windowMs += interval
    this.frames++
    if (interval > 20.5) this.slow++
    if (this.windowMs < 1000 || this.frames < 20) return
    const share = this.slow / this.frames
    if (this.enabled ? share > .15 : share < .02) {
      this.evidenceMs += this.windowMs
      this.evidenceFrames += this.frames
      this.evidenceSlow += this.slow
    } else this.clearEvidence()
    this.clearWindow()

    if (this.sinceChange < 5000 || this.evidenceMs < (this.enabled ? 2000 : 5000)) return
    this.enabled = !this.enabled
    const percent = Math.round(100 * this.evidenceSlow / this.evidenceFrames)
    this.reason = this.enabled ? 'five calm seconds' : percent + '% of frames over 20.5 ms'
    this.sinceChange = 0
    this.clearEvidence()
  }

  private clearWindow() { this.frames = this.slow = this.windowMs = 0 }
  private clearEvidence() { this.evidenceFrames = this.evidenceSlow = this.evidenceMs = 0 }
}
