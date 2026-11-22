/**
 * The one tooltip for icon-only buttons (the owner, 22 November 2026: "these buttons need to have
 * a tooltip on non-touch devices"). Any element with `data-tip` names itself in a small pill under
 * it while the pointer rests on it or it has keyboard focus. Only on a device that can hover: a
 * finger gets the button's accessible name instead, which every one keeps (aria-label).
 *
 * One element for the whole page, generated, faded in and out (no slide). Its place is read once
 * as it shows, never per frame. Styled by .ui-tip (card-chrome.css).
 */
const SHOW_DELAY_MS = 350

export function installTooltips(signal: AbortSignal): void {
  if (typeof matchMedia === 'undefined' || !matchMedia('(hover: hover)').matches) return
  const tip = document.createElement('div')
  tip.className = 'ui-tip'; tip.setAttribute('aria-hidden', 'true')
  document.body.append(tip)
  signal.addEventListener('abort', () => tip.remove())
  let owner: HTMLElement | null = null, timer: ReturnType<typeof setTimeout> | undefined

  const place = (el: HTMLElement) => {
    tip.textContent = el.dataset.tip ?? ''
    const box = el.getBoundingClientRect(), own = tip.getBoundingClientRect()
    const margin = 8, gap = 8
    // Under the button, centred on it, kept on screen; above it when there is no room below.
    let x = box.left + box.width / 2 - own.width / 2
    x = Math.max(margin, Math.min(innerWidth - own.width - margin, x))
    let y = box.bottom + gap
    if (y + own.height > innerHeight - margin) y = box.top - gap - own.height
    tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
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
  document.addEventListener('focusin', event => {
    const el = target(event); if (el?.matches(':focus-visible')) show(el, 0)
  }, { signal })
  document.addEventListener('focusout', event => { const el = target(event); if (el) hide(el) }, { signal })
  // A press acts on the button: the name has done its job.
  document.addEventListener('pointerdown', () => hide(), { signal, passive: true })
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide() }, { signal })
  addEventListener('scroll', () => hide(), { signal, capture: true, passive: true })
}
