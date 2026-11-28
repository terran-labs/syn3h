import './scroll-boundary-fade.css'

const horizontal = '.update-table'
const vertical = '.wi-body, .wi-sheet, .chat-log, .lobby-sheet-body, .about-updates, .lobby-panels > section, .in-play-about, .performance-body'
const targets = `${horizontal}, ${vertical}`
const edgeEpsilon = 0.5 // scroll offsets can be fractional while scroll extents are rounded

function boundaryMask(element: HTMLElement): string | null {
  const x = element.matches(horizontal)
  const viewport = x ? element.clientWidth : element.clientHeight
  const range = (x ? element.scrollWidth : element.scrollHeight) - viewport
  if (viewport === 0 || range <= edgeEpsilon) return null

  const style = getComputedStyle(element)
  const overflow = x ? style.overflowX : style.overflowY
  if (overflow !== 'auto' && overflow !== 'scroll') return null
  const rtl = x && style.direction === 'rtl'
  const offset = x ? element.scrollLeft : element.scrollTop
  const before = rtl ? range + offset : offset
  const after = range - before
  const startCap = parseFloat(style.getPropertyValue('--scroll-fade-start')) || 28
  const endCap = parseFloat(style.getPropertyValue('--scroll-fade-end')) || 28
  const start = before > edgeEpsilon ? Math.min(startCap, viewport, before) : 0
  const end = after > edgeEpsilon ? Math.min(endCap, viewport, after) : 0
  if (start === 0 && end === 0) return null

  // Offset the fade to the scrollport and retain opaque strips over borders and native gutters.
  const origin = x ? element.clientLeft : element.clientTop
  const far = origin + viewport
  const direction = x ? 'right' : 'bottom'
  const crossDirection = x ? 'bottom' : 'right'
  const crossStart = x ? element.clientTop : element.clientLeft
  const crossEnd = crossStart + (x ? element.clientHeight : element.clientWidth)
  const shared = [
    `linear-gradient(to ${direction}, #000 ${origin}px, ${start ? 'transparent' : '#000'} ${origin}px, #000 ${origin + start}px, #000 ${far - end}px, ${end ? 'transparent' : '#000'} ${far}px, #000 ${far}px)`,
  ]
  const crossSize = x ? element.offsetHeight : element.offsetWidth
  const gutter = crossStart > 0 || crossEnd < crossSize
    ? `linear-gradient(to ${crossDirection}, #000 ${crossStart}px, transparent ${crossStart}px ${crossEnd}px, #000 ${crossEnd}px)`
    : 'none'
  // Very short scrollports can have overlapping fades. Intersect the two ramps in that case.
  const ink = start + end <= viewport ? shared : [
    `linear-gradient(to ${direction}, #000 ${origin}px, transparent ${origin}px, #000 ${origin + start}px)`,
    `linear-gradient(to ${direction}, #000 ${far - end}px, transparent ${far}px, #000 ${far}px)`,
  ]
  return [gutter, ...ink].join(', ')
}

export function mountScrollBoundaryFades(root: HTMLElement, signal: AbortSignal): void {
  const masks = new Map<HTMLElement, string | null>()
  const dirty = new Set<HTMLElement>()
  let frame = 0

  const refresh = () => {
    frame = 0
    // Read every dirty scrollport before setting any inline styles.
    const updates = [...dirty].map(element => ({
      element,
      mask: root.contains(element) ? boundaryMask(element) : null,
    }))
    dirty.clear()
    for (const { element, mask } of updates) {
      if (masks.get(element) !== mask) {
        if (mask) element.style.setProperty('--scroll-boundary-mask', mask)
        else element.style.removeProperty('--scroll-boundary-mask')
        masks.set(element, mask)
      }
    }
  }

  const queueFrame = () => {
    if (dirty.size && !frame) frame = requestAnimationFrame(refresh)
  }

  const schedule = (target: Element) => {
    let element = target.closest<HTMLElement>(targets)
    while (element && root.contains(element)) {
      dirty.add(element)
      element = element.parentElement?.closest<HTMLElement>(targets) ?? null
    }
    queueFrame()
  }

  const sizes = new ResizeObserver(entries => {
    for (const { target } of entries) schedule(target)
  })

  const observe = (element: Element) => {
    sizes.observe(element)
    for (const child of element.children) sizes.observe(child)
    schedule(element)
  }

  const unobserve = (element: HTMLElement) => {
    sizes.unobserve(element)
    for (const child of element.children) sizes.unobserve(child)
    dirty.delete(element)
    masks.delete(element)
    element.style.removeProperty('--scroll-boundary-mask')
  }

  const visit = (node: Node, callback: (element: HTMLElement) => void) => {
    if (!(node instanceof HTMLElement)) return
    if (node.matches(targets)) callback(node)
    node.querySelectorAll<HTMLElement>(targets).forEach(callback)
  }

  const contents = new MutationObserver(records => {
    for (const { target, addedNodes, removedNodes } of records) {
      if (!(target instanceof Element)) continue
      const direct = target.matches(targets)
      // Changes to text inside a child are covered by its size observer. Ignore ordinary
      // HUD text replacements here, since they can happen on each rendered frame.
      if (!direct && !Array.from(addedNodes).some(node => node instanceof Element)
        && !Array.from(removedNodes).some(node => node instanceof Element)) continue
      for (const node of removedNodes) {
        if (!(node instanceof Element)) continue
        if (!root.contains(node)) visit(node, unobserve)
        if (direct && (!root.contains(node) || (!node.matches(targets) && !node.parentElement?.matches(targets)))) sizes.unobserve(node)
      }
      for (const node of addedNodes) {
        if (!root.contains(node)) continue
        if (direct && node instanceof Element) sizes.observe(node)
        visit(node, observe)
      }
      schedule(target)
    }
  })
  contents.observe(root, { childList: true, subtree: true })
  visit(root, observe)
  root.addEventListener('scroll', event => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(targets)) return
    dirty.add(event.target)
    queueFrame()
  }, { capture: true, passive: true, signal })
  root.addEventListener('toggle', event => {
    if (event.target instanceof Element) schedule(event.target)
  }, { capture: true, signal })
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame)
    contents.disconnect()
    sizes.disconnect()
    for (const element of masks.keys()) element.style.removeProperty('--scroll-boundary-mask')
  }, { once: true })
}
