/**
 * A lobby sheet: Welcome, Updates and Settings each open one from the lobby's buttons (the
 * owner, 16 and 17 November 2026). No box (the owner, 19 November 2026: "had the contents of
 * each panel appear pretty much where they currently are, but without the box or the planets
 * behind them"): as a sheet opens the worlds fade out, the sky dims a little and the name rises
 * and grows smaller (Galaxy.worlds, backdrop, markLift, set by Shell), and the contents appear
 * under the name on the darkened sky, their scroll edges fading out rather than ending at an edge.
 * Switching between the three swaps the contents in place (open with `morph`, after the open
 * sheet's handOff); the buttons stay beside it. Escape, a tap outside and the one X close it;
 * focus stays inside while it is open and returns to whatever opened it.
 */
import { cycleFocus } from './LobbySettings'
import { CARD_CLOSE } from './cardClose'
import './lobby-sheet.css'


export type Point = readonly [number, number]
/** The wordmark's lines on screen, as Galaxy.wordmarkEdges returns them. */
export interface WordmarkEdges { top: Point[]; bottom: Point[] }
export interface Box { left: number; top: number; width: number; height: number }

export interface LobbySheetOptions {
  /** A short class name for the sheet: lobby-sheet-<name>. */
  name: string
  title: string
  /** Builds the body the first time the sheet opens; nothing is in the page before then. */
  fill(body: HTMLElement): void
  /** Called on every open, after fill. */
  opened?(body: HTMLElement): void
  /** Called once it has closed. */
  closed?(): void
  /** The wordmark's lines on screen now, or null when it is not in space. */
  edges?(): WordmarkEdges | null
  /** Where focus goes on close when the opener cannot take it: the sheet's icon. */
  home?(): HTMLElement | undefined
  cue?(): void
  /** True while the wordmark is still moving to stand over an open panel: the sheet follows it. */
  following?(): boolean
}

let sheets = 0
export class LobbySheet {
  readonly element = document.createElement('dialog')
  readonly panel = document.createElement('div')
  readonly body = document.createElement('div')
  private readonly close_ = document.createElement('button')
  private readonly abort = new AbortController()
  private filled = false
  private shown = false
  private opener?: HTMLElement
  private fading?: Animation

  constructor(parent: HTMLElement, private readonly options: LobbySheetOptions) {
    const signal = this.abort.signal, id = `lobby-sheet-${++sheets}`
    this.element.className = `lobby-sheet lobby-sheet-${options.name}`
    this.element.setAttribute('aria-labelledby', `${id}-title`)
    this.panel.className = 'lobby-sheet-panel'
    const title = document.createElement('h2'); title.id = `${id}-title`; title.className = 'lobby-sheet-title'; title.textContent = options.title
    this.close_.type = 'button'; this.close_.className = 'lobby-sheet-close lobby-close card-close'; this.close_.setAttribute('aria-label', 'Close'); this.close_.dataset.tip = 'Close'
    // The lobby's one close control, the same in Welcome, Updates and Settings (lobby-sheet.css).
    this.close_.innerHTML = CARD_CLOSE
    this.body.className = 'lobby-sheet-body'
    this.body.append(title)
    this.panel.append(this.body, this.close_)
    this.element.append(this.panel)
    parent.append(this.element)

    this.close_.addEventListener('click', () => this.close(), { signal })
    // A tap on the dialog itself is a tap outside the panel: close, and let it do nothing else.
    this.element.addEventListener('pointerdown', event => { if (event.target === this.element) { event.preventDefault(); this.close() } }, { signal })
    // The dialog's own Escape (cancel) closes through here, with the fade.
    this.element.addEventListener('cancel', event => { event.preventDefault(); this.close() }, { signal })
    // While open the sheet owns the keyboard. Escape and Tab are its own, taken first. Every
    // other key reaches what has focus inside the sheet (a settings switch answers Enter) and
    // stops as it leaves the sheet, so nothing behind it (the galaxy, the lobby's shortcuts)
    // hears it; the shell's own shortcut handler stands down while a sheet is open.
    window.addEventListener('keydown', event => {
      if (!this.shown) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return }
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation()
        cycleFocus(this.focusable(), document.activeElement as HTMLElement | null, event.shiftKey)?.focus()
        return
      }
      if (!this.element.contains(event.target as Node)) event.stopImmediatePropagation()
    }, { capture: true, signal })
    this.element.addEventListener('keydown', event => { if (this.shown) event.stopPropagation() }, { signal })
    window.addEventListener('resize', () => { if (this.shown) this.layout() }, { signal })
  }

  get isOpen(): boolean { return this.shown }

  private focusable(): HTMLElement[] {
    // The panel, and the lobby's three buttons when they stand beside it (they switch sheets).
    return [...this.element.querySelectorAll<HTMLElement>('a[href], button, input, select, summary, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !(el as HTMLButtonElement).disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0)
  }

  /** Where the contents go: most of the screen, under the wordmark where there is room. */
  private frame(): Box {
    const w = innerWidth, h = innerHeight, phone = w < 600 || h < 500
    // One reading column, centred: the contents stand where the panel's body stood.
    const width = phone ? w - 16 : Math.min(680, w - 48)
    // Under the name, which rises to stand over the panel (Galaxy.markLift), so the two read as
    // one object; on a phone as well, while that leaves the panel at least half the screen.
    const edges = this.options.edges?.(), under = edges ? Math.max(...edges.bottom.map(p => p[1])) + (phone ? 10 : 18) : 0
    const bottom = h - (phone ? 8 : 24), fallback = phone ? (h < 500 ? 8 : Math.round(h * 0.14)) : Math.round(h * 0.1)
    const top = under > 0 && bottom - under >= h * (phone ? 0.5 : 0.6) ? under : fallback
    const frame = { left: (w - width) / 2, top, width, height: bottom - top }
    // The lobby's buttons stand beside an open sheet (Shell moves them into it): keep clear of
    // them, above a row of them on a phone held upright, left of their column otherwise.
    const dockEl = this.element.querySelector<HTMLElement>('.lobby-gear-dock'), dock = dockEl?.getBoundingClientRect()
    if (dockEl && dock && dock.width && dock.left < frame.left + frame.width && dock.top < frame.top + frame.height) {
      // A row (an upright phone lays the buttons side by side) by its layout, not its shape: two
      // stacked buttons are wider than they are tall.
      if (getComputedStyle(dockEl).gridAutoFlow.startsWith('column')) frame.height = Math.max(120, dock.top - 8 - frame.top)
      else frame.width = Math.max(240, dock.left - 12 - frame.left)
    }
    return frame
  }

  private layout(): void {
    const frame = this.frame()
    Object.assign(this.panel.style, { left: `${frame.left}px`, top: `${frame.top}px`, width: `${frame.width}px`, height: `${frame.height}px` })
  }

  /**
   * Open the sheet. `morph`: another sheet is handing over to this one (switching between
   * Welcome, Updates and Settings): the sky is already dark, so only the contents change,
   * crossfading.
   */
  open(opener: HTMLElement | null = document.activeElement as HTMLElement | null, morph = false): void {
    if (this.shown) return
    this.shown = true; this.fading?.cancel(); this.fading = undefined
    this.opener = opener ?? undefined
    if (!this.filled) { this.filled = true; this.options.fill(this.body) }
    this.options.opened?.(this.body)
    if (!morph) this.options.cue?.()
    // Shown first, so the buttons beside it have a place to keep clear of.
    if (!this.element.open) this.element.showModal()
    this.layout()
    this.body.scrollTop = 0
    // The contents arrive just after the sky starts to darken and the worlds to fade (150 ms),
    // rising a few pixels into place. Reduced motion: a short crossfade, nothing moves.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) this.panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' })
    else if (morph) this.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' })
    else this.panel.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 150, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' })
    this.close_.focus({ preventScroll: true })
    // Follow the name while it rises to stand over the panel, so the two stay joined.
    const follow = () => { if (!this.shown) return; this.layout(); if (this.options.following?.()) requestAnimationFrame(follow) }
    requestAnimationFrame(follow)
  }

  /** Give way to another sheet at once: no fade, no focus return, no closed() (the panel stays up). */
  handOff(): void {
    if (!this.shown) return
    this.shown = false; this.opener = undefined; this.fading?.cancel(); this.fading = undefined
    this.element.close()
  }

  /** `returnFocus` false: something else is taking over (the settings card) and owns focus. */
  close(returnFocus = true): void {
    if (!this.shown) return
    this.shown = false
    const opener = returnFocus ? this.opener : undefined; this.opener = undefined
    const done = () => {
      if (this.shown) return
      this.element.close()
      this.options.closed?.()
      // Back to whatever opened it; if that cannot take focus now (a banner that stepped
      // aside), to the sheet's own icon.
      if (!returnFocus) return
      opener?.focus({ preventScroll: true })
      if (document.activeElement !== opener) this.options.home?.()?.focus({ preventScroll: true })
    }
    // Taken over (the settings card opening): gone at once, so the dialog's own return of focus
    // happens now, before the card takes focus, and not at the end of a fade.
    if (!returnFocus) { done(); return }
    // The contents go first; then (closed, in Shell) the worlds come back and the name settles.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.fading = this.panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: still ? 120 : 150, easing: 'ease-in' })
    this.fading.onfinish = done
  }

  dispose(): void { this.abort.abort(); this.element.remove() }
}
