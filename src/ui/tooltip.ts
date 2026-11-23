/**
 * The one tooltip for icon-only buttons (the owner, 22 November 2026: "these buttons need to have
 * a tooltip on non-touch devices"). Any element with `data-tip` names itself in a small plate
 * beside it while the pointer rests on it or it has keyboard focus. Only on a device that can
 * hover: a finger gets the button's accessible name instead, which every one keeps (aria-label).
 *
 * One element for the whole page, generated, faded in and out (no slide). Its place is read once
 * as it shows, never per frame. Styled by tooltip.css.
 *
 * The plate and its tail are one generated outline (tipOutline), drawn as an SVG path behind the
 * words, so the tail is the plate's own edge with no seam (the owner: tooltips "should have a tail
 * connecting them to whatever hovered element is"). The tail sits on the side facing the element
 * and points at its centre, also when the plate is nudged along to stay on screen.
 */
import './tooltip.css'

const SHOW_DELAY_MS = 350
/** The tail: how far it stands out from the plate, and its width at the plate's edge, px. */
export const TAIL_DEPTH = 6
export const TAIL_WIDTH = 12
/** The plate's corner radius at most, px (a one-line plate is a pill). */
const RADIUS = 14
/** Room between the element and the tail's point, and between the plate and the screen's edge. */
const GAP = 4, MARGIN = 8

export type TipSide = 'top' | 'bottom' | 'left' | 'right'

/**
 * The plate's outline, w by h, with the tail on `side` (the edge facing the element) centred at
 * `at` along that edge (x for top and bottom, y for left and right), kept clear of the corners.
 * Coordinates are the plate's own, half a pixel in so a 1 px stroke lands on whole pixels.
 */
export function tipOutline(w: number, h: number, side: TipSide, at: number): string {
  const r = Math.min(RADIUS, h / 2, w / 2), half = TAIL_WIDTH / 2, d = TAIL_DEPTH
  const x0 = .5, y0 = .5, x1 = w - .5, y1 = h - .5
  const along = side === 'top' || side === 'bottom' ? w : h
  const t = Math.max(r + half, Math.min(along - r - half, at))
  const n = (v: number) => Math.round(v * 100) / 100
  const p: string[] = [`M${n(x0 + r)} ${y0}`]
  if (side === 'top') p.push(`L${n(t - half)} ${y0}L${n(t)} ${n(y0 - d)}L${n(t + half)} ${y0}`)
  p.push(`L${n(x1 - r)} ${y0}A${n(r)} ${n(r)} 0 0 1 ${x1} ${n(y0 + r)}`)
  if (side === 'right') p.push(`L${x1} ${n(t - half)}L${n(x1 + d)} ${n(t)}L${x1} ${n(t + half)}`)
  p.push(`L${x1} ${n(y1 - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x1 - r)} ${y1}`)
  if (side === 'bottom') p.push(`L${n(t + half)} ${y1}L${n(t)} ${n(y1 + d)}L${n(t - half)} ${y1}`)
  p.push(`L${n(x0 + r)} ${y1}A${n(r)} ${n(r)} 0 0 1 ${x0} ${n(y1 - r)}`)
  if (side === 'left') p.push(`L${x0} ${n(t + half)}L${n(x0 - d)} ${n(t)}L${x0} ${n(t - half)}`)
  p.push(`L${x0} ${n(y0 + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${y0}Z`)
  return p.join('')
}

/**
 * Where the plate goes for an element at `box`: under it, else over it, else beside it (left,
 * then right), nudged along to stay on screen. `side` is the plate's edge that faces the element.
 */
export function placeTip(box: { left: number; top: number; right: number; bottom: number }, w: number, h: number, view: { width: number; height: number }): { x: number; y: number; side: TipSide; at: number } {
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2, off = GAP + TAIL_DEPTH
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const alongX = () => clamp(cx - w / 2, MARGIN, view.width - w - MARGIN)
  const alongY = () => clamp(cy - h / 2, MARGIN, view.height - h - MARGIN)
  if (box.bottom + off + h <= view.height - MARGIN) { const x = alongX(); return { x, y: box.bottom + off, side: 'top', at: cx - x } }
  if (box.top - off - h >= MARGIN) { const x = alongX(); return { x, y: box.top - off - h, side: 'bottom', at: cx - x } }
  if (box.left - off - w >= MARGIN) { const y = alongY(); return { x: box.left - off - w, y, side: 'right', at: cy - y } }
  const y = alongY(); return { x: Math.min(box.right + off, view.width - w - MARGIN), y, side: 'left', at: cy - y }
}
const FOCUS_DELAY_MS = 450

export function installTooltips(signal: AbortSignal): void {
  if (typeof matchMedia === 'undefined' || !matchMedia('(hover: hover)').matches) return
  const tip = document.createElement('div')
  tip.className = 'ui-tip'; tip.setAttribute('aria-hidden', 'true')
  tip.innerHTML = '<svg class="ui-tip-plate" aria-hidden="true" focusable="false"><path/></svg><span class="ui-tip-text"></span>'
  const outline = tip.querySelector('path')!, words = tip.querySelector<HTMLElement>('.ui-tip-text')!
  document.body.append(tip)
  signal.addEventListener('abort', () => tip.remove())
  let owner: HTMLElement | null = null, timer: ReturnType<typeof setTimeout> | undefined

  const place = (el: HTMLElement) => {
    words.textContent = el.dataset.tip ?? ''
    const box = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight
    const at = placeTip(box, w, h, { width: innerWidth, height: innerHeight })
    outline.setAttribute('d', tipOutline(w, h, at.side, at.at))
    tip.dataset.side = at.side
    tip.style.translate = `${Math.round(at.x)}px ${Math.round(at.y)}px`
  }
  const show = (el: HTMLElement, delay: number) => {
    clearTimeout(timer); owner = el
    timer = setTimeout(() => { if (owner !== el || !el.isConnected || !el.dataset.tip) return; place(el); tip.classList.add('is-shown') }, delay)
  }
  const hide = (el?: HTMLElement) => {
    if (el && el !== owner) return
    clearTimeout(timer); owner = null; tip.classList.remove('is-shown')
  }
  const target = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null)

  document.addEventListener('pointerover', event => {
    if ((event as PointerEvent).pointerType !== 'mouse') return
    const el = target(event); if (el && el !== owner) show(el, SHOW_DELAY_MS)
  }, { signal, passive: true })
  document.addEventListener('pointerout', event => {
    const el = target(event); if (!el) return
    const to = (event as PointerEvent).relatedTarget
    if (!(to instanceof Node && el.contains(to))) hide(el)
  }, { signal, passive: true })
  // Keyboard focus only: WebKit counts focus a sheet moves to its X after a click as visible, so the
  // last input decides, and with no input yet it is not a keyboard's (cardClose.ts trackFocusModality). The short wait lets an opening sheet
  // settle before the tip measures where its button is.
  document.addEventListener('focusin', event => {
    const el = target(event)
    if (el?.matches(':focus-visible') && document.documentElement.dataset.focusBy === 'keyboard') show(el, FOCUS_DELAY_MS)
  }, { signal })
  document.addEventListener('focusout', event => { const el = target(event); if (el) hide(el) }, { signal })
  // A press acts on the button: the name has done its job.
  document.addEventListener('pointerdown', () => hide(), { signal, passive: true })
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide() }, { signal })
  addEventListener('scroll', () => hide(), { signal, capture: true, passive: true })
}
