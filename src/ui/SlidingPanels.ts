/** LobbyScreens.cs uses a two-second depth transition, not a horizontal carousel. */
export const PANEL_TRANSITION_MS = 2000
export function easeInOutQuad(t: number): number { return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2 }
export function easeOutQuad(t: number): number { return 1 - (1 - t) ** 2 }

export class SlidingPanels {
  private readonly panels = new Map<string, HTMLElement>()
  private generation = 0
  private animations: Animation[] = []
  private current = ''
  constructor(readonly element: HTMLElement) {
    for (const panel of element.querySelectorAll<HTMLElement>('[data-panel]')) {
      this.panels.set(panel.dataset.panel!, panel); panel.hidden = true; panel.inert = true
    }
  }
  get active(): string { return this.current }
  async show(id: string, immediate = false): Promise<void> {
    const next = this.panels.get(id)
    if (!next || id === this.current && this.element.dataset.busy !== 'true') return
    const token = ++this.generation
    for (const animation of this.animations) animation.cancel()
    this.animations = []
    const previous = this.panels.get(this.current)
    this.current = id; this.element.dataset.busy = 'true'
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const animate = async (panel: HTMLElement, entering: boolean) => {
      const frames = Array.from({ length: 31 }, (_, i) => {
        const t = i / 30, progress = entering ? easeOutQuad(t) : easeInOutQuad(t)
        return { offset: t, opacity: entering ? progress : 1 - progress, transform: `translateZ(${entering ? -30 + 30 * progress : -30 * progress}px)` }
      })
      const animation = panel.animate(frames, { duration: PANEL_TRANSITION_MS / 2, fill: 'both' })
      this.animations.push(animation)
      try { await animation.finished } catch { /* Navigation can supersede a transition. */ }
      animation.cancel()
    }
    if (previous && !immediate && !reduced) {
      previous.inert = true
      await animate(previous, false)
      if (token !== this.generation) return
    }
    for (const panel of this.panels.values()) { panel.hidden = panel !== next; panel.inert = true }
    next.hidden = false
    if (!immediate && !reduced) await animate(next, true)
    if (token !== this.generation) return
    next.inert = false; this.element.dataset.activePanel = id; this.element.dataset.busy = 'false'
    next.querySelector<HTMLElement>('h1, h2, input, button')?.focus({ preventScroll: true })
  }
  dispose(): void { ++this.generation; for (const animation of this.animations) animation.cancel() }
}
