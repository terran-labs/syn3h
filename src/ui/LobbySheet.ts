/**
 * A lobby sheet: a large flat black panel over the galaxy, partially see-through, with one X in
 * its upper right corner. About and Updates each open one from their icons above the settings
 * gear (the owner, 16 November 2026). Escape and a tap outside also close it; focus stays
 * inside while it is open and returns to whatever opened it. It fades, never slides, and with
 * reduced motion it simply appears.
 *
 * The shape follows the 2017 Syn3h lobby, whose panel was a dark slab standing on a curved
 * screen: square corners, its top and bottom edges bowed by perspective. Here the panel stands
 * on the same cylinder as the in-space wordmark (src/ui/brand/wordmarkScene.ts): the
 * wordmark's own top and bottom lines on screen are arcs, and the panel's edges continue that
 * family of arcs, so its top runs parallel to the name above it and the bow grows the further
 * an edge is from the name, as it would on the curved wall itself. `?sheet=round` instead
 * shows a flat panel with rounded corners whose radius matches the round of the wordmark's S
 * at the size it is drawn, and `?sheet=parallel` bows both edges exactly as the wordmark's
 * underline bows: both kept only to compare the readings.
 */
import { cycleFocus } from './LobbySettings'
import './lobby-sheet.css'

export type Point = readonly [number, number]
/** y = a + b (x - x0) + c (x - x0)^2, in screen pixels. */
export interface Parabola { a: number; b: number; c: number; x0: number }
export const at = (p: Parabola, x: number) => p.a + p.b * (x - p.x0) + p.c * (x - p.x0) ** 2

/** The least squares parabola through `points`, measured from x0 (their middle by default). */
export function fitParabola(points: readonly Point[], x0 = (points[0]![0] + points[points.length - 1]![0]) / 2): Parabola {
  // Normal equations for [a, b, c] over u = x - x0.
  const s = [0, 0, 0, 0, 0], t = [0, 0, 0]
  for (const [x, y] of points) { const u = x - x0; let k = 1; for (let i = 0; i < 5; i++) { s[i]! += k; if (i < 3) t[i]! += k * y; k *= u } }
  const m = [[s[0]!, s[1]!, s[2]!], [s[1]!, s[2]!, s[3]!], [s[2]!, s[3]!, s[4]!]]
  const det = (q: number[][]) => q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) - q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) + q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!)
  const d = det(m)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return { a: t[0]! / Math.max(1, s[0]!), b: 0, c: 0, x0 }
  const swap = (col: number) => m.map((row, i) => row.map((v, j) => (j === col ? t[i]! : v)))
  return { a: det(swap(0)) / d, b: det(swap(1)) / d, c: det(swap(2)) / d, x0 }
}

/**
 * The arc on the wordmark's cylinder that passes through (x0, y): the wordmark's top and
 * bottom lines on screen, carried on past them in proportion. A horizontal line on an upright
 * cylinder seen in perspective is, near the middle of the view, a parabola whose height and
 * bow both change in step with its height on the wall: the same blend that takes the bottom
 * line to the top line takes it below the name too.
 */
export function arcThrough(top: Parabola, bottom: Parabola, x0: number, y: number): Parabola {
  const t0 = at(top, x0), b0 = at(bottom, x0), span = t0 - b0
  if (!Number.isFinite(span) || Math.abs(span) < 1) return { a: y, b: 0, c: 0, x0 }
  const k = (y - b0) / span
  const T = shiftTo(top, x0), B = shiftTo(bottom, x0)
  return { a: y, b: B.b + k * (T.b - B.b), c: B.c + k * (T.c - B.c), x0 }
}

/** The same parabola, measured from x0. */
export function shiftTo(p: Parabola, x0: number): Parabola { const u = x0 - p.x0; return { a: at(p, x0), b: p.b + 2 * p.c * u, c: p.c, x0 } }

/** The wordmark's lines on screen, as Galaxy.wordmarkEdges returns them. */
export interface WordmarkEdges { top: Point[]; bottom: Point[] }
export interface Box { left: number; top: number; width: number; height: number }
export interface Bend { box: Box; top: Parabola; bottom: Parabola; /** The deepest each edge reaches into the box, from its own extreme. */ insetTop: number; insetBottom: number }

/**
 * Bend a panel meant to fill `frame` (viewport pixels) on the wordmark's cylinder. Returns the
 * box that contains both bowed edges, and how far each edge dips into it, so the content can
 * stay clear of them. With no wordmark in space the edges are straight.
 */
export function bendPanel(frame: Box, edges: WordmarkEdges | null, parallel = false): Bend {
  const x0 = frame.left + frame.width / 2, half = frame.width / 2
  const flat = (y: number): Parabola => ({ a: y, b: 0, c: 0, x0 })
  let top = flat(frame.top), bottom = flat(frame.top + frame.height)
  if (edges && edges.top.length >= 3 && edges.bottom.length >= 3) {
    const T = fitParabola(edges.top), B = fitParabola(edges.bottom)
    // A bow is a lean of perspective, not a wave: at most a tenth of the panel's height and
    // a fourteenth of its width, so a narrow phone panel is not bent into a lens.
    const limit = (p: Parabola) => { const sag = Math.abs(p.c) * half * half, most = Math.min(frame.height / 10, frame.width / 14); return sag > most ? { ...p, c: p.c * most / sag } : p }
    // Parallel: both edges take the wordmark's own underline arc, only moved down.
    const along = (y: number): Parabola => parallel ? { ...shiftTo(B, x0), a: y } : arcThrough(T, B, x0, y)
    // A few passes: move each centre so the edge's extreme lands on the frame.
    let yTop = frame.top, yBottom = frame.top + frame.height
    for (let i = 0; i < 4; i++) {
      top = limit(along(yTop)); bottom = limit(along(yBottom))
      const [topMin] = range(top, x0, half), [, bottomMax] = range(bottom, x0, half)
      yTop += frame.top - topMin; yBottom += frame.top + frame.height - bottomMax
    }
  }
  const [topMin, topMax] = range(top, x0, half), [bottomMin, bottomMax] = range(bottom, x0, half)
  return { box: { left: frame.left, top: topMin, width: frame.width, height: bottomMax - topMin }, top, bottom, insetTop: topMax - topMin, insetBottom: bottomMax - bottomMin }
}

function range(p: Parabola, x0: number, half: number): [number, number] {
  const ys = [at(p, x0 - half), at(p, x0 + half)]
  const vertex = p.c ? p.x0 - p.b / (2 * p.c) : NaN
  if (vertex > x0 - half && vertex < x0 + half) ys.push(at(p, vertex))
  return [Math.min(...ys), Math.max(...ys)]
}

/** The SVG path of a bent panel, in its box's own coordinates. */
export function bendPath(bend: Bend, steps = 32): string {
  const { box } = bend, points: string[] = []
  const x = (i: number) => box.left + box.width * i / steps
  for (let i = 0; i <= steps; i++) points.push(`${(x(i) - box.left).toFixed(1)} ${(at(bend.top, x(i)) - box.top).toFixed(1)}`)
  for (let i = steps; i >= 0; i--) points.push(`${(x(i) - box.left).toFixed(1)} ${(at(bend.bottom, x(i)) - box.top).toFixed(1)}`)
  return `M${points.join('L')}Z`
}

/**
 * The round of the wordmark's S, as a fraction of the wordmark's height: its outer bowl,
 * fitted from the traced outline (src/ui/brand/wordmarkPath.ts), is about 40 units round on a
 * 226 unit tall mark. Every other corner of the letters is square. Used by `?sheet=round`.
 */
export const WORDMARK_ROUND = 40 / 226

/**
 * bent: on the wordmark's cylinder (the default). round: square-on, rounded corners.
 * parallel: both edges copy the wordmark's underline arc. The last two exist only to compare.
 */
export type SheetShape = 'bent' | 'round' | 'parallel'
/** The shape to draw: bent on the wordmark's cylinder unless the address asks for a comparison. */
export const sheetShape = (search: string): SheetShape => { const v = new URLSearchParams(search).get('sheet'); return v === 'round' || v === 'parallel' ? v : 'bent' }

export interface LobbySheetOptions {
  /** A short class name for the sheet: lobby-sheet-<name>. */
  name: string
  title: string
  /** Builds the body the first time the sheet opens; nothing is in the page before then. */
  fill(body: HTMLElement): void
  /** Called on every open, after fill. */
  opened?(body: HTMLElement): void
  /** The wordmark's lines on screen now, or null when it is not in space. */
  edges?(): WordmarkEdges | null
  cue?(): void
  shape?: SheetShape
}

let sheets = 0
export class LobbySheet {
  readonly element = document.createElement('dialog')
  readonly panel = document.createElement('div')
  readonly body = document.createElement('div')
  private readonly slab = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  private readonly close_ = document.createElement('button')
  private readonly abort = new AbortController()
  private filled = false
  private shown = false
  private opener?: HTMLElement
  private fading?: Animation

  constructor(parent: HTMLElement, private readonly options: LobbySheetOptions) {
    const signal = this.abort.signal, id = `lobby-sheet-${++sheets}`
    const shape = options.shape ?? 'bent'
    this.element.className = `lobby-sheet lobby-sheet-${options.name}`; this.element.dataset.shape = shape
    this.element.setAttribute('aria-labelledby', `${id}-title`)
    this.panel.className = 'lobby-sheet-panel'
    this.slab.setAttribute('class', 'lobby-sheet-slab'); this.slab.setAttribute('aria-hidden', 'true')
    this.slab.innerHTML = '<path/>'
    const title = document.createElement('h2'); title.id = `${id}-title`; title.className = 'lobby-sheet-title'; title.textContent = options.title
    this.close_.type = 'button'; this.close_.className = 'lobby-sheet-close'; this.close_.setAttribute('aria-label', `Close ${options.title}`); this.close_.title = 'Close'
    this.close_.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg>'
    this.body.className = 'lobby-sheet-body'
    this.body.append(title)
    this.panel.append(this.slab, this.body, this.close_)
    this.element.append(this.panel)
    parent.append(this.element)

    this.close_.addEventListener('click', () => this.close(), { signal })
    // A tap on the dialog itself is a tap outside the panel: close, and let it do nothing else.
    this.element.addEventListener('pointerdown', event => { if (event.target === this.element) { event.preventDefault(); this.close() } }, { signal })
    // The dialog's own Escape (cancel) closes through here, with the fade.
    this.element.addEventListener('cancel', event => { event.preventDefault(); this.close() }, { signal })
    // Registered before the shell's own keyboard handler: while open the sheet owns the keyboard
    // and nothing reaches the galaxy or the lobby's shortcuts.
    window.addEventListener('keydown', event => {
      if (!this.shown) return
      event.stopImmediatePropagation()
      if (event.key === 'Escape') { event.preventDefault(); this.close(); return }
      if (event.key === 'Tab') {
        event.preventDefault()
        cycleFocus(this.focusable(), document.activeElement as HTMLElement | null, event.shiftKey)?.focus()
      }
    }, { capture: true, signal })
    window.addEventListener('resize', () => { if (this.shown) this.layout() }, { signal })
  }

  get isOpen(): boolean { return this.shown }

  private focusable(): HTMLElement[] {
    return [...this.panel.querySelectorAll<HTMLElement>('a[href], button, input, select, summary, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !(el as HTMLButtonElement).disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0)
  }

  /** Where the panel goes: most of the screen, under the wordmark where there is room. */
  private frame(): Box {
    const w = innerWidth, h = innerHeight, phone = w < 600 || h < 500
    const width = phone ? w - 16 : Math.min(1000, w - 48)
    let top: number, bottom: number
    if (phone) {
      // Low enough that the X is in reach of a thumb, tall enough to read in.
      top = h < 500 ? 8 : Math.round(h * 0.14); bottom = h - 8
    } else {
      const edges = this.options.edges?.(), under = edges ? Math.max(...edges.bottom.map(p => p[1])) + 18 : 0
      top = under > 0 && h - 24 - under >= h * 0.6 ? under : Math.round(h * 0.1); bottom = h - 24
    }
    return { left: (w - width) / 2, top, width, height: bottom - top }
  }

  private layout(): void {
    const frame = this.frame(), shape = this.element.dataset.shape as SheetShape, edges = this.options.edges?.() ?? null
    const style = this.panel.style
    if (shape === 'round') {
      const mark = edges ? Math.abs(at(fitParabola(edges.top), frame.left + frame.width / 2) - at(fitParabola(edges.bottom), frame.left + frame.width / 2)) : 0
      style.setProperty('--sheet-radius', `${Math.round(mark ? mark * WORDMARK_ROUND : 24)}px`)
      Object.assign(style, { left: `${frame.left}px`, top: `${frame.top}px`, width: `${frame.width}px`, height: `${frame.height}px` })
      style.setProperty('--inset-top', '0px'); style.setProperty('--inset-bottom', '0px'); style.setProperty('--close-top', '0px')
      return
    }
    const bend = bendPanel(frame, edges, shape === 'parallel'), box = bend.box
    Object.assign(style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
    this.slab.setAttribute('viewBox', `0 0 ${box.width.toFixed(1)} ${box.height.toFixed(1)}`)
    this.slab.querySelector('path')!.setAttribute('d', bendPath(bend))
    style.setProperty('--inset-top', `${bend.insetTop.toFixed(1)}px`)
    style.setProperty('--inset-bottom', `${bend.insetBottom.toFixed(1)}px`)
    // The X sits a fixed distance inside the top edge where that edge passes under it.
    style.setProperty('--close-top', `${(at(bend.top, box.left + box.width - 34) - box.top).toFixed(1)}px`)
  }

  open(opener: HTMLElement | null = document.activeElement as HTMLElement | null): void {
    if (this.shown) return
    this.shown = true; this.fading?.cancel(); this.fading = undefined
    this.opener = opener ?? undefined
    if (!this.filled) { this.filled = true; this.options.fill(this.body) }
    this.options.opened?.(this.body)
    this.options.cue?.()
    this.layout()
    if (!this.element.open) this.element.showModal()
    this.body.scrollTop = 0
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    this.close_.focus({ preventScroll: true })
  }

  close(): void {
    if (!this.shown) return
    this.shown = false
    const opener = this.opener; this.opener = undefined
    const done = () => {
      if (this.shown) return
      this.element.close()
      if (opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus({ preventScroll: true })
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return }
    this.fading = this.panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in' })
    this.fading.onfinish = done
  }

  dispose(): void { this.abort.abort(); this.element.remove() }
}
