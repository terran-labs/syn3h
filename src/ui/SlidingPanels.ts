/** One short motion opens the requested panel directly from the lobby. */
export const PANEL_TRANSITION_MS = 240
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
    // The galaxy is a state, not a hidden welcome panel to animate through.
    if ((!next && id !== 'index') || id === this.current && this.element.dataset.busy !== 'true') return
    const token = ++this.generation
    for (const animation of this.animations) animation.cancel()
    this.animations = []
    const previous = this.panels.get(this.current)
    this.current = id; this.element.dataset.busy = 'true'
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const panel of this.panels.values()) {
      panel.hidden = panel !== (next ?? previous)
      panel.inert = true
    }
    const visible = next ?? previous
    if (visible) {
      this.element.hidden = false
      visible.hidden = false
      if (!immediate && !reduced) {
        const frames = [{ opacity: 0, transform: 'translateY(16px) scale(.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }]
        const animation = visible.animate(next ? frames : [...frames].reverse(), { duration: PANEL_TRANSITION_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' })
        this.animations.push(animation)
        try { await animation.finished } catch { /* A later selection owns the transition. */ }
        animation.cancel()
      }
    }
    if (token !== this.generation) return
    for (const panel of this.panels.values()) { panel.hidden = panel !== next; panel.inert = panel !== next }
    this.element.hidden = !next
    this.element.dataset.activePanel = id; this.element.dataset.busy = 'false'
    next?.querySelector<HTMLElement>('h1, h2, input, button')?.focus({ preventScroll: true })
  }
  dispose(): void { ++this.generation; for (const animation of this.animations) animation.cancel() }
}
