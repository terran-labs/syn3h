/**
 * What happened to the page in the last few seconds, for the diagnostic counters
 * (frameCanary.ts, frameProbe.ts): quality steps, pixel ratio and size changes, the page hidden or
 * shown. Each bad frame they count is reported with these notes, so a pattern (every black frame
 * just after a rotation, say) shows in one report.
 */
export class RecentEvents {
  private readonly events: { t: number; what: string }[] = []
  private lastPixelRatio = 0

  constructor() {
    if (typeof window === 'undefined') return
    window.addEventListener('mira:quality', event => { const d = (event as CustomEvent<{ level?: number; rung?: number }>).detail; this.note(`quality level ${d?.level} rung ${d?.rung}`) })
    window.addEventListener('resize', () => this.note(`resize ${innerWidth}x${innerHeight}`))
    document.addEventListener('visibilitychange', () => this.note(`page ${document.visibilityState}`))
  }

  note(what: string): void { this.events.push({ t: now(), what }); if (this.events.length > 40) this.events.shift() }

  /** Note a pixel ratio change; call once per frame. */
  pixelRatio(ratio: number): void {
    if (ratio !== this.lastPixelRatio) { if (this.lastPixelRatio) this.note(`pixel ratio ${this.lastPixelRatio}→${ratio}`); this.lastPixelRatio = ratio }
  }

  /** The notes of the last `seconds`, newest last, as "-1.2 s what". */
  within(seconds: number, t = now()): string[] {
    return this.events.filter(e => t - e.t <= seconds).map(e => `-${(t - e.t).toFixed(1)} s ${e.what}`)
  }
}

export const now = (): number => performance.now() / 1000
