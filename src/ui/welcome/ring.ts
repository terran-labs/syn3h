/**
 * Welcome's pictures turning in space, after the "Syn3h in Action" panel on terranlabs.com
 * (src/concepts/descent/rows/syn3h/ScreensPanel.tsx there; the owner, 21 November 2026: "Pull in
 * the carousel from our Terran Labs media previewer instead"). Plain DOM and CSS (welcome.css):
 * the front picture faces you, one either side stands back and turns away, the rest wait behind
 * them unseen; every few seconds they move round one place, and the front one's title and caption
 * show beneath it. (A true ring, as on terranlabs.com, reaches past a phone's column; drawn tighter
 * its cards cut through each other: the phone layout check, 22 November 2026.) The arrows, or a tap on a card, take over, and
 * the ring stops turning by itself from then on. Under reduced motion it never turns by itself
 * and moves without a glide.
 *
 * This module requests nothing: the pictures inside are Welcome's own, whose sources are set only
 * when the player opens Welcome (welcome.ts, loadShots).
 */

export interface RingShot { title: string; caption: string }

/** How far either side of the front its neighbours stand, in card widths. */
export const RING_SIDE_X = 0.45
/** Seconds between turns while nobody has touched the ring, as on terranlabs.com. */
export const RING_TURN_MS = 5200

/** The ring's markup round `cards` (each a picture's own <figure> html), with its captions. */
export function ringHtml(cards: readonly string[]): string {
  const arrow = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
  return `<section class="welcome-ring" aria-roledescription="carousel" aria-label="Syn3h in pictures" style="--count:${cards.length}">
  <div class="welcome-ring-stage"><ol class="welcome-ring-track">${cards.map((card, i) => `<li class="welcome-ring-card" aria-label="${i + 1} of ${cards.length}">${card}</li>`).join('')}</ol></div>
  <div class="welcome-ring-foot">
    <button type="button" class="welcome-ring-arrow" data-ring="prev" aria-label="Previous picture">${arrow('M15 6l-6 6 6 6')}</button>
    <p class="welcome-ring-caption" aria-hidden="true"><strong></strong><span></span></p>
    <button type="button" class="welcome-ring-arrow" data-ring="next" aria-label="Next picture">${arrow('M9 6l6 6-6 6')}</button>
  </div>
</section>`
}

const wrap = (value: number, count: number) => ((value % count) + count) % count

/** Wire a ring made by ringHtml. `start()` begins the slow turn; it stops once the player takes over. */
export function wireRing(root: HTMLElement, shots: readonly RingShot[], signal?: AbortSignal): { start(): void } {
  const track = root.querySelector<HTMLElement>('.welcome-ring-track')!
  const cards = [...root.querySelectorAll<HTMLElement>('.welcome-ring-card')]
  const caption = root.querySelector<HTMLElement>('.welcome-ring-caption')!
  const count = cards.length
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  // `position` is unwrapped, so the ring always turns the short way and never spins back round.
  let position = 0, touched = false, timer = 0
  const show = (): void => {
    const current = wrap(position, count)
    track.toggleAttribute('data-still', still())
    cards.forEach((card, i) => {
      // Where the card stands from the front, signed: 0 the front, -1 and 1 either side, the rest
      // behind them. Its place, depth and angle follow from this alone (welcome.css).
      const off = ((i - current) % count + count + Math.floor(count / 2)) % count - Math.floor(count / 2)
      const away = Math.abs(off), side = Math.sign(off)
      card.style.setProperty('--x', String(side * RING_SIDE_X))
      card.style.setProperty('--z', String(away === 0 ? 0 : away === 1 ? -0.5 : -0.9))
      card.style.setProperty('--ry', `${-side * 40}deg`)
      card.style.setProperty('--away', String(away))
      // The unseen ones behind take no taps.
      card.style.pointerEvents = away >= 2 ? 'none' : ''
      // Nearer cards paint over farther ones even where a browser does not sort the 3D scene
      // (WebKit drew the side cards over the front one in document order).
      card.style.zIndex = String(10 - away)
      card.toggleAttribute('data-front', i === current)
      card.setAttribute('aria-hidden', String(i !== current))
    })
    const shot = shots[current]!
    caption.querySelector('strong')!.textContent = shot.title
    caption.querySelector('span')!.textContent = shot.caption
    if (!still()) caption.animate([{ opacity: 0, transform: 'rotateX(-60deg) translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.16,1,.3,1)' })
  }
  const pick = (index: number): void => {
    touched = true; clearInterval(timer)
    const delta = wrap(index - position, count)
    position += delta > count / 2 ? delta - count : delta
    show()
  }
  root.querySelector('[data-ring=prev]')!.addEventListener('click', () => pick(wrap(position, count) - 1), { signal })
  root.querySelector('[data-ring=next]')!.addEventListener('click', () => pick(wrap(position, count) + 1), { signal })
  cards.forEach((card, i) => card.addEventListener('click', () => { if (i !== wrap(position, count)) pick(i) }, { signal }))
  signal?.addEventListener('abort', () => clearInterval(timer))
  show()
  return {
    start() {
      clearInterval(timer)
      if (touched || still()) return
      // Turns only while the ring is on screen: a closed Welcome draws nothing and is left alone.
      timer = window.setInterval(() => { if (!touched && root.getClientRects().length) { position++; show() } }, RING_TURN_MS)
    },
  }
}
