import type { Exclusion } from './layout'

// The gear selector's own box reserves room for its detail pane even when that pane is empty,
// and on a phone that box spans the screen's middle. Avoid only what is drawn: the drum and
// each detail line while it is showing (empty lines carry [hidden] and are skipped below).
// The world inspector is the same: its box is the whole right-hand column, top to bottom, while
// only its command bar, its cards and its foot are drawn. Avoiding the column hid every label on
// the right of a desktop screen, which looked like your own wings hiding them in flight.
const SELECTORS = '.world-inspector .rail-command,.world-inspector .wi-cards > *,.world-inspector .rail-foot,.shell-minimap,.gear-selector .gs-drum,.gear-selector .gs-detail > *,.gear-selector .gs-meter > *,.gear-actions,.hud-accessories .acc-row,.hud-chat .acc-row,.touch-actions,.touch-stick,.match-hud,.match-announcement,.race-hud,.performance-recommendation,.inspector-toggle,.spawn-help,.focus-hud .fh-read'
/** Passive text (speed, height): a label may cover these when a step up does not clear them.
 *  Everything else is hard, including the gear drum, the gear's explanation and its key lines
 *  (a label over them made them unreadable: the owner, 18 November 2026), the left column's
 *  rows and the world name and heading line (.fh-top), a title. */
const SOFT = '.focus-hud .fh-read:not(.fh-top)'
/** How often the HUD is re-measured even when nothing announced a change (style-only edits). */
const BACKSTOP_MS = 250

/**
 * HUD rectangles for labels to avoid, cached. Measuring forces style and layout, which costs
 * milliseconds when done mid-frame after the HUD and the plates have written styles. So the
 * draw call only reads the cache, and re-measuring runs in a task after the frame, when style
 * is clean: on HUD class, hidden or child changes, on resize, and every BACKSTOP_MS.
 */
export class HudExclusions {
  private elements: Element[] = []
  private boxes: Exclusion[] | null = null
  private listDirty = true
  private stale = false
  private measuredAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly observer: MutationObserver
  private readonly onResize = () => { this.stale = true }
  constructor(private readonly root: HTMLElement) {
    const outside = (r: MutationRecord) => !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.vehicle-nameplates')
    this.observer = new MutationObserver(records => {
      for (const r of records) if (outside(r)) { this.stale = true; if (r.type === 'childList') this.listDirty = true }
    })
    this.observer.observe(root.ownerDocument.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] })
    root.ownerDocument.defaultView?.addEventListener('resize', this.onResize)
  }
  /** The cached rectangles. Only the first call measures synchronously. */
  read(width: number, height: number): Exclusion[] {
    if (!this.boxes) return this.measure(width, height)
    if (!this.timer && (this.stale || performance.now() - this.measuredAt > BACKSTOP_MS)) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        const view = this.root.ownerDocument.defaultView
        this.measure(view?.innerWidth ?? width, view?.innerHeight ?? height)
      }, 0)
    }
    return this.boxes
  }
  /** Measure now. Forces style and layout; call it outside the frame's write phase. */
  measure(width: number, height: number): Exclusion[] {
    this.stale = false; this.measuredAt = performance.now()
    if (this.listDirty) { this.elements = [...new Set([...this.root.querySelectorAll(SELECTORS), ...this.root.ownerDocument.querySelectorAll('.touch-actions,.touch-stick')])]; this.listDirty = false }
    const boxes: Exclusion[] = []
    for (const element of this.elements) {
      let visible = true
      for (let p: Element | null = element; p; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (p.hasAttribute('hidden') || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < .02) { visible = false; break }
      }
      if (!visible) continue
      const b = element.getBoundingClientRect()
      const box: Exclusion = { left: Math.max(0, b.left - 6), top: Math.max(0, b.top - 6), right: Math.min(width, b.right + 6), bottom: Math.min(height, b.bottom + 6) }
      if (element.matches(SOFT)) box.soft = true
      if (box.right > box.left && box.bottom > box.top) boxes.push(box)
    }
    this.boxes = boxes
    return boxes
  }
  dispose(): void {
    this.observer.disconnect(); clearTimeout(this.timer)
    this.root.ownerDocument.defaultView?.removeEventListener('resize', this.onResize)
    this.elements.length = 0; this.boxes = null
  }
}
