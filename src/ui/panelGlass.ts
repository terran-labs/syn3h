/** A transparent sticky search-result title must still cover the rows scrolling under it. */
export function clipSearchResults(rail: HTMLElement, signal: AbortSignal) {
  let frame = 0
  const refresh = () => {
    if (frame || !rail.classList.contains('is-searching')) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!rail.classList.contains('is-searching')) return
      const cuts: [HTMLElement, string][] = []
      for (const card of rail.querySelectorAll<HTMLElement>('.wi-card.is-open:not([hidden])')) {
        const head = card.querySelector<HTMLElement>(':scope > .wi-head')
        if (!head) continue
        const edge = head.getBoundingClientRect().bottom
        for (const content of card.querySelectorAll<HTMLElement>(':scope > .wi-body, :scope > .wi-foot')) {
          const cut = Math.max(0, edge - content.getBoundingClientRect().top)
          cuts.push([content, cut + 'px'])
        }
      }
      for (const [content, cut] of cuts) {
        if (content.style.getPropertyValue('--glass-title-overlap') !== cut)
          content.style.setProperty('--glass-title-overlap', cut)
      }
    })
  }
  for (const event of ['scroll', 'input', 'toggle', 'transitionend', 'animationend'])
    rail.addEventListener(event, refresh, { capture: true, passive: true, signal })
  window.addEventListener('resize', refresh, { passive: true, signal })
  signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once: true })
}
