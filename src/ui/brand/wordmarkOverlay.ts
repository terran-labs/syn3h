/**
 * The flat wordmark as a vector laid over a canvas that draws its glow (the lobby galaxy).
 * The galaxy renders at most 1.5 times CSS pixels, so a mark drawn into it is softened on
 * screens of pixel ratio 2 and 3; the browser draws this path at the screen's full
 * resolution, so its edges are as sharp as the screen allows, for no GPU time.
 *
 * It looks as the WebGL mark does (logoRenderer pass 4): a face of one dark colour with a
 * pale line just inside the outline, 2.7 path units wide or one CSS pixel,
 * whichever is wider. The line is a stroke twice that width clipped to the letters, so only
 * its inner half shows. Static: the caller moves it and sets its opacity (the fade in) only
 * when they change, so an idle lobby does no work for it.
 */
import { WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from './activeWordmark'
import type { PixelRect } from './logoRenderer'

const SVG = 'http://www.w3.org/2000/svg'
let ids = 0

export class WordmarkOverlay {
  readonly element: SVGSVGElement
  private readonly line: SVGPathElement
  private shown = { x: NaN, y: NaN, width: NaN, height: NaN, opacity: NaN }

  constructor(face = '#02040a', edge = '#ffeed7') {
    const id = `mira-wordmark-clip-${++ids}`
    const svg = this.element = document.createElementNS(SVG, 'svg')
    svg.setAttribute('viewBox', `0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`)
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false')
    svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;opacity:0'
    svg.innerHTML = `<defs><clipPath id="${id}"><path clip-rule="evenodd" d="${WORDMARK_PATH}"/></clipPath></defs>`
      + `<path fill="${face}" fill-rule="evenodd" d="${WORDMARK_PATH}"/>`
      + `<path fill="none" stroke="${edge}" stroke-linejoin="miter" clip-path="url(#${id})" d="${WORDMARK_PATH}"/>`
    this.line = svg.lastElementChild as SVGPathElement
  }

  /** Puts the mark over `box` (CSS pixels in its parent) at `opacity`, touching the DOM only for what changed. */
  update(box: PixelRect, opacity: number): void {
    const s = this.shown, style = this.element.style
    if (box.x !== s.x || box.y !== s.y) { style.transform = `translate(${box.x}px, ${box.y}px)`; s.x = box.x; s.y = box.y }
    if (box.width !== s.width || box.height !== s.height) {
      style.width = `${box.width}px`; style.height = `${box.height}px`; s.width = box.width; s.height = box.height
      // As the GL mark in the lobby: 0.012 box heights, never under one CSS pixel (its 1.5
      // canvas pixels); doubled, half clipped away.
      const edge = Math.max(0.012, 1 / Math.max(1, box.height)) * WORDMARK_HEIGHT
      this.line.setAttribute('stroke-width', (edge * 2).toFixed(3))
    }
    const o = Math.round(opacity * 1000) / 1000
    if (o !== s.opacity) { style.opacity = String(o); s.opacity = o }
  }

  /** Hidden at once, as when the canvas under it loses its context. */
  hide(): void { this.element.style.opacity = '0'; this.shown.opacity = 0 }
  remove(): void { this.element.remove() }
}
