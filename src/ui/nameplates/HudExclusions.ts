import type { Rect } from './layout'

const SELECTORS = '.world-inspector,.shell-minimap,.gear-selector,.gear-actions,.zorb-toggle,.touch-actions,.touch-stick,.match-hud,.match-announcement,.race-hud,.performance-recommendation,.inspector-toggle,.spawn-help,.focus-hud .fh-read'
/** One read phase before plate writes. Never measure the plates themselves. */
export class HudExclusions {
  private elements: Element[] = []
  private dirty = true
  private readonly observer: MutationObserver
  constructor(private readonly root: HTMLElement) {
    this.observer = new MutationObserver(records => {
      if (records.some(r => r.type === 'childList' && !(r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.vehicle-nameplates'))) this.dirty = true
    })
    this.observer.observe(root.ownerDocument.body, { subtree: true, childList: true })
  }
  read(width: number, height: number): Rect[] {
    if (this.dirty) { this.elements = [...new Set([...this.root.querySelectorAll(SELECTORS), ...this.root.ownerDocument.querySelectorAll('.touch-actions,.touch-stick')])]; this.dirty = false }
    const boxes: Rect[] = []
    for (const element of this.elements) {
      let visible = true
      for (let p: Element | null = element; p; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (p.hasAttribute('hidden') || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < .02) { visible = false; break }
      }
      if (!visible) continue
      const b = element.getBoundingClientRect()
      const box = { left: Math.max(0, b.left - 6), top: Math.max(0, b.top - 6), right: Math.min(width, b.right + 6), bottom: Math.min(height, b.bottom + 6) }
      if (box.right > box.left && box.bottom > box.top) boxes.push(box)
    }
    return boxes
  }
  dispose(): void { this.observer.disconnect(); this.elements.length = 0 }
}
