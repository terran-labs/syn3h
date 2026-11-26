/**
 * The in-play sidebar's width, set by dragging its edge (the owner, 25 November 2026: "When
 * users hover near the left edge of any card or button on the right-hand sidebar, they should
 * see a vertical grab handle that allows them to resize it. This should persist between visits
 * for the device they are on.").
 *
 * One width for the whole column. It is a personal interface preference kept in this device's
 * storage and never sent anywhere. Storage is optional: the getter itself may throw (private
 * modes, blocked storage), so every access is guarded and the default stands in.
 *
 * The width reaches the page as --rail-width on the root element (sidebar-resize.css and
 * chat.css read it), so
 * everything laid out from the column follows in the same frame, and the Liquid glass behind
 * the cards re-measures its rectangles (GlassButton.ts listens for glassgeometrychange) without
 * rebuilding anything.
 */
import './sidebar-resize.css'

export const SIDEBAR_WIDTH_KEY = 'mira.sidebar.width'
/** The column's width before anyone drags it (exploration.css's 352 px). */
export const DEFAULT_WIDTH = 352
/**
 * Narrowest: a card header's label and value, and Chat's field and Send, still read whole. The
 * longest value in play, Performance's "High · Auto on · Running slow", needs 320 px (measured
 * 25 November 2026); 8 px more leaves room for a longer world or player name.
 */
export const MIN_WIDTH = 328
/** Widest in pixels, and as a share of the window, so the game stays playable beside it. */
export const MAX_WIDTH = 600
export const MAX_SHARE = 0.45
/** Keyboard steps: an arrow, and Shift with an arrow. */
export const STEP = 16
export const BIG_STEP = 64
/** Milliseconds the column must be still before the handle's span is measured again. */
export const SPAN_SETTLE_MS = 150
/**
 * A wider column must never cover the centred play HUD (the Foreman, 25 November 2026). Beside
 * the column that is the bottom stack: the world name and the speed and altitude readouts show only
 * with the cursor captured, when the column is hidden. Its inner edge stays this far from the
 * HUD's widest reach either side of the centre line.
 */
export const CLEAR_GAP = 16
/** Half the bottom stack at its widest in play: the slow-frames offer, min(360px, ...) wide. */
export const STACK_HALF = 180
/** A side readout's text at its widest, from its inner edge: five digits, a gap and the unit. */
export const READOUT_RESERVE = 96

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * The allowed range in a window this wide. `room` is how wide the column may be before it meets
 * the centred HUD (Infinity when nothing is measured). The share of the window and the room limit
 * widening only: neither takes the column below the default, so a smaller window or a tablet
 * keeps today's layout (a 744 px iPad once got 334 px, 45% of it, against today's 352). The
 * stylesheet still keeps the column inside the window (sidebar-resize.css).
 */
export function widthLimits(viewport: number, room = Infinity): { min: number; max: number } {
  return { min: MIN_WIDTH, max: Math.max(DEFAULT_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewport * MAX_SHARE), Math.floor(room))) }
}

/** A width the window can hold; anything not a finite number is the default. */
export function clampWidth(width: number, viewport: number, room = Infinity): number {
  const { min, max } = widthLimits(viewport, room)
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(width) ? width : DEFAULT_WIDTH)))
}

/**
 * How far the centred play HUD reaches from the centre line, in CSS pixels, from the live layout:
 * the bottom stack at its widest (or wider, if something in it now is), the world name, and the
 * speed and altitude readouts with room for their longest values. Whatever is not laid out (a HUD
 * style that hides it) does not count.
 */
export function hudReach(doc: Document = document, viewport = innerWidth): number {
  const centre = viewport / 2
  let reach = STACK_HALF
  const laidOut = (el: Element) => el.getClientRects().length > 0
  // Not the pause bar: paused, the column fades out with the rest of the interface.
  for (const el of doc.querySelectorAll('.bottom-stack > :not(.pause-actions)')) if (laidOut(el)) { const r = el.getBoundingClientRect(); reach = Math.max(reach, centre - r.left, r.right - centre) }
  // The instruments show only with the cursor captured (exploration.css), when the column is hidden;
  // beside the column they are gone, so they count only in that state.
  const instruments = doc.querySelector('.mira-shell.is-focus') ? doc.querySelectorAll('.focus-hud .fh-read:not(.fh-corner)') : []
  for (const el of instruments) {
    if (!laidOut(el)) continue
    const r = el.getBoundingClientRect()
    reach = Math.max(reach, centre - r.left, r.right - centre)
    if (el.classList.contains('fh-right')) reach = Math.max(reach, r.left + READOUT_RESERVE - centre)
    if (el.classList.contains('fh-left')) reach = Math.max(reach, centre - (r.right - READOUT_RESERVE))
  }
  return reach
}

/** The saved width, or null when none is saved, it is unreadable, or storage is unavailable. */
export function readWidth(storage?: Store): number | null {
  try {
    storage ??= globalThis.localStorage
    const raw = storage?.getItem(SIDEBAR_WIDTH_KEY)
    if (raw == null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch { return null }
}

/** Save a width, or forget it (null). Never throws. */
export function saveWidth(width: number | null, storage?: Store): void {
  try {
    storage ??= globalThis.localStorage
    if (width === null) storage?.removeItem(SIDEBAR_WIDTH_KEY)
    else storage?.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)))
  } catch { /* Optional persistence. */ }
}

/** The width to show on arrival: the saved one fitted to this window, else the default. */
export function initialWidth(viewport: number, storage?: Store): number {
  return clampWidth(readWidth(storage) ?? DEFAULT_WIDTH, viewport)
}

export interface SidebarResizeOptions {
  /** The shell, marked while a drag runs. */
  shell: HTMLElement
  /** The in-play column. */
  rail: HTMLElement
  signal: AbortSignal
}

/**
 * Give the column its saved width and a grab handle on its inner edge. The handle is one
 * 12 px strip along the part of the edge the column actually fills (its top row to its last
 * card), so it never covers empty game; its visible bar fades in beside the card or button the
 * pointer is next to. On phones the column is a full panel and the strip is hidden (CSS).
 */
export function mountSidebarResize({ shell, rail, signal }: SidebarResizeOptions): { readonly width: number; reset(): void } {
  let saved = readWidth()
  // On the root, so everything laid out beside the column inherits it, inside the shell or not.
  const root = document.documentElement
  let width = clampWidth(saved ?? DEFAULT_WIDTH, innerWidth)

  const strip = document.createElement('div')
  strip.className = 'rail-resize'
  strip.tabIndex = 0
  strip.setAttribute('role', 'separator')
  strip.setAttribute('aria-orientation', 'vertical')
  strip.setAttribute('aria-label', 'Sidebar width')
  strip.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End Enter')
  const bar = document.createElement('span'); bar.className = 'rail-resize-bar'; bar.setAttribute('aria-hidden', 'true')
  strip.append(bar)
  rail.append(strip)

  /** The column is on the right unless it sits on the left half (a left-handed tablet). */
  const onLeft = () => { const r = rail.getBoundingClientRect(); return r.left + r.width / 2 < innerWidth / 2 }
  /** How wide the column may grow, from its outer edge to the centred HUD less the gap. */
  const room = () => {
    const r = rail.getBoundingClientRect(), centre = innerWidth / 2, reach = hudReach()
    return (onLeft() ? centre - reach - r.left : r.right - (centre + reach)) - CLEAR_GAP
  }
  const apply = (next: number) => {
    const space = room()
    width = clampWidth(next, innerWidth, space)
    const value = `${width}px`
    if (root.style.getPropertyValue('--rail-width') !== value) {
      root.style.setProperty('--rail-width', value)
      // The glass measures its surfaces on this event in the same frame: no lag, no rebuild.
      dispatchEvent(new Event('glassgeometrychange'))
    }
    const { min, max } = widthLimits(innerWidth, space)
    strip.setAttribute('aria-valuemin', String(min)); strip.setAttribute('aria-valuemax', String(max))
    strip.setAttribute('aria-valuenow', String(width)); strip.setAttribute('aria-valuetext', `${width} pixels`)
  }
  const commit = (next: number) => { apply(next); saved = width; saveWidth(width) }
  const reset = () => { saved = null; saveWidth(null); apply(DEFAULT_WIDTH) }
  apply(width)
  // The play HUD is built after the column: fit the saved width to it once it exists.
  const settle = () => { if (signal.aborted) return; apply(saved ?? DEFAULT_WIDTH); if (!document.querySelector('.focus-hud')) setTimeout(settle, 1000) }
  setTimeout(settle, 0)

  // A smaller window clamps the column; a larger one gives back the width the player chose.
  addEventListener('resize', () => apply(saved ?? DEFAULT_WIDTH), { signal })

  // The strip covers the column's filled span only: the top row to the last card's bottom,
  // or the stack's bottom when the cards scroll.
  const cards = rail.querySelector<HTMLElement>('.wi-cards')
  const span = () => {
    const top = rail.getBoundingClientRect().top
    let bottom = top
    for (const el of rail.children) {
      if (el === strip || !(el instanceof HTMLElement) || el.hidden || !el.getClientRects().length) continue
      if (el === cards) {
        const view = el.getBoundingClientRect()
        const last = [...el.children].reverse().find((c): c is HTMLElement => c instanceof HTMLElement && !c.hidden && c.getClientRects().length > 0)
        if (last) bottom = Math.max(bottom, Math.min(view.bottom, last.getBoundingClientRect().bottom))
      } else bottom = Math.max(bottom, el.getBoundingClientRect().bottom)
    }
    strip.style.height = `${Math.max(0, Math.round(bottom - top))}px`
    strip.classList.toggle('on-left', onLeft())
  }
  // Measured once the column has been still for SPAN_SETTLE_MS, never on the frame a change lands:
  // reading the column's layout then forced it mid-way through the panels' opening and stalled
  // that motion for a fifth of a second on a phone (phone-panels.mjs). Where the handle is hidden
  // (the phone layout, sidebar-resize.css) nothing is measured at all.
  const hidden = matchMedia('(max-width: 700px), (max-height: 500px)')
  let spanTimer: ReturnType<typeof setTimeout> | undefined
  const queueSpan = () => {
    if (hidden.matches) return
    clearTimeout(spanTimer)
    spanTimer = setTimeout(() => { if (!signal.aborted) span() }, SPAN_SETTLE_MS)
  }
  hidden.addEventListener('change', queueSpan, { signal })
  // What moves the column's filled span: a card opening or closing, cards added or removed, a
  // window resize. Deliberately no ResizeObserver: one more observer on the rail and its cards
  // made WebKit report a ResizeObserver loop on phones whenever another observer's callback
  // changed their size in the same frame. A mutation observer queues the measure for the next
  // frame instead, and entering the strip measures again, so a press always meets a current span.
  // Only the cards themselves (open, closed, hidden) and the lists' members, not classes deep inside.
  const changes = new MutationObserver(records => { if (records.some(r => r.type === 'childList' || r.target.parentElement === cards)) queueSpan() })
  changes.observe(rail, { childList: true })
  if (cards) changes.observe(cards, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] })
  addEventListener('resize', queueSpan, { signal })
  rail.addEventListener('transitionend', queueSpan, { signal })
  signal.addEventListener('abort', () => changes.disconnect())
  queueSpan()

  // The bar stands beside whichever card or button the pointer is next to.
  const besideTarget = (y: number) => {
    const top = rail.getBoundingClientRect().top
    const items = [...rail.querySelectorAll<HTMLElement>(':scope > .rail-command, :scope > .wi-cards > *, :scope > .rail-foot > *')]
    for (const el of items) {
      if (el.hidden || !el.getClientRects().length) continue
      const r = el.getBoundingClientRect()
      if (y >= r.top - 4 && y <= r.bottom + 4) { bar.style.top = `${Math.round(r.top - top)}px`; bar.style.height = `${Math.round(r.height)}px`; return }
    }
  }
  strip.addEventListener('pointermove', event => { if (!strip.classList.contains('is-dragging')) besideTarget(event.clientY) }, { signal })
  strip.addEventListener('pointerenter', event => { span(); besideTarget(event.clientY) }, { signal })
  strip.addEventListener('focus', () => { bar.style.top = '0px'; bar.style.height = strip.style.height }, { signal })

  // Dragging: one width per animation frame, saved when the pointer lets go. The press never
  // reaches the game (camera drag and pointer lock start from the canvas) or the cards.
  let drag: { id: number; x: number; from: number; left: boolean } | null = null
  let pending: number | null = null, frame = 0
  const flush = () => { frame = 0; if (pending !== null) { apply(pending); pending = null } }
  strip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    strip.setPointerCapture(event.pointerId)
    drag = { id: event.pointerId, x: event.clientX, from: width, left: onLeft() }
    strip.classList.add('is-dragging'); shell.classList.add('is-resizing-rail')
  }, { signal })
  strip.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return
    const moved = event.clientX - drag.x
    pending = drag.from + (drag.left ? moved : -moved)
    if (!frame) frame = requestAnimationFrame(flush)
  }, { signal })
  const end = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    drag = null; cancelAnimationFrame(frame); flush()
    strip.classList.remove('is-dragging'); shell.classList.remove('is-resizing-rail')
    if (Math.abs(width - (saved ?? DEFAULT_WIDTH)) >= 1) commit(width)
  }
  strip.addEventListener('pointerup', end, { signal }); strip.addEventListener('pointercancel', end, { signal })
  strip.addEventListener('lostpointercapture', end as EventListener, { signal })
  strip.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); reset() }, { signal })
  strip.addEventListener('click', event => event.stopPropagation(), { signal })

  // Keys. Registered on the window in the capture phase before the shell's own listener (this
  // is mounted first), so the arrows resize instead of driving or capturing the cursor.
  addEventListener('keydown', event => {
    if (event.target !== strip || event.isComposing) return
    const { min, max } = widthLimits(innerWidth, room())
    const step = event.shiftKey ? BIG_STEP : STEP, wider = onLeft() ? 'ArrowRight' : 'ArrowLeft', narrower = onLeft() ? 'ArrowLeft' : 'ArrowRight'
    let next: number | null = null
    if (event.key === wider) next = width + step
    else if (event.key === narrower) next = width - step
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    else if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); reset(); return }
    if (next === null) return
    event.preventDefault(); event.stopImmediatePropagation()
    commit(next)
  }, { capture: true, signal })

  signal.addEventListener('abort', () => { cancelAnimationFrame(frame); clearTimeout(spanTimer); strip.remove(); root.style.removeProperty('--rail-width') })
  return { get width() { return width }, reset }
}
