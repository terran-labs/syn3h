/**
 * Liquid Glass stays out of scrolling regions (the owner, 22 November 2026: scrolling the
 * Welcome sheet left the glass "lagging a few visual frames behind" the button's contents,
 * "This is unacceptable").
 *
 * The shader draws each glass face into a canvas from element positions read on the main
 * thread, while the browser scrolls a region's contents on its compositor (and on iOS in a
 * separate scrolling process) without waiting for the main thread. Measured on the Welcome sheet:
 * the face trailed its button by up to 36 px in Chrome (wheel, trackpad and touch) and 31 px in
 * WebKit, and re-reading positions on every frame at full rate did not close it. So a glass
 * control inside a scroll container takes the CSS glass of the current material, which the
 * compositor moves with the content, and controls outside keep the shader.
 *
 * The rule is the element's ancestry, not a list of sheets: any ancestor below <body> whose
 * computed overflow on either axis is auto, scroll or overlay. Callers evaluate it when they
 * rebuild their element lists, never per frame.
 */
const SCROLLING = /^(auto|scroll|overlay)$/

/** True when `element` sits inside a scroll container (the page's own root and body excepted). */
export function insideScroller(element: Element): boolean {
  const body = element.ownerDocument.body
  for (let p = element.parentElement; p && p !== body; p = p.parentElement) {
    const style = getComputedStyle(p)
    if (SCROLLING.test(style.overflowY) || SCROLLING.test(style.overflowX)) return true
  }
  return false
}
