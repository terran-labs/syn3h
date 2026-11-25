/**
 * Welcome's pictures in a row, styled after the "in Action" carousel on the owner's own site
 * (the owner, 25 November 2026: "This is the style of image carousel you should use for the
 * in-game welcome experience"). One large picture in front, the full width of the column; the one
 * either side of it, the same size, hinged at the front picture's edge and turned away in
 * perspective so about half of it shows, dimmed,
 * standing outside the column where the host lets it show (welcome.css); the rest wait unseen
 * beyond them. Under the front picture its title and caption between a pair of round arrows,
 * then a dot for each picture. Where the screen leaves room either side, a second pair of round
 * arrows stands at the far edges, level with the pictures.
 *
 * Moving: the arrows, the dots, a swipe across the pictures, the left and right arrow keys
 * anywhere in the panel, or a tap on a side picture. A move turns the panels round their hinges
 * in a short eased rotation while they crossfade; under reduced motion the change is instant.
 * It never moves by itself, so an idle Welcome draws nothing.
 *
 * Narrow screens: when either side has less than SIDE_ROOM px outside the front picture (a phone
 * held upright), the side pictures are hidden rather than shown as slivers, and the front one
 * stays the column's full width. The far-edge arrows appear only with OUTER_ROOM px either side
 * on a screen at least 500 px tall; elsewhere the pair under the picture does the job.
 *
 * This module requests nothing: the pictures inside are Welcome's own, whose sources are set only
 * when the player opens Welcome (welcome.ts, loadShots).
 */

export interface RingShot { title: string; caption: string }

/** Below this many px either side of the front picture, the side pictures are hidden, not slivers. */
export const SIDE_ROOM = 40
/** The far-edge arrows need this many px either side of the front picture: a 48 px button, 16 px from the screen's edge and a clear gap from the front picture. */
export const OUTER_ROOM = 120

const arrow = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
const LEFT = 'M15 6l-6 6 6 6', RIGHT = 'M9 6l6 6-6 6'
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The ring's markup round `cards` (each a picture's own <figure> html), with its captions and dots. */
export function ringHtml(cards: readonly string[], shots: readonly RingShot[]): string {
  const count = cards.length
  // The far-edge pair repeats the pair under the picture for a mouse or a finger; keyboards and
  // screen readers use the pair under the picture, so these take no focus and are not announced.
  const outer = (dir: 'prev' | 'next') => `<button type="button" class="welcome-ring-arrow welcome-ring-outer" data-ring="${dir}" tabindex="-1" aria-hidden="true">${arrow(dir === 'prev' ? LEFT : RIGHT)}</button>`
  return `<section class="welcome-ring" aria-roledescription="carousel" aria-label="Mira in pictures" style="--count:${count}">
  <div class="welcome-ring-stage">
    <ol class="welcome-ring-track">${cards.map((card, i) => `<li class="welcome-ring-card" aria-roledescription="slide" aria-label="${i + 1} of ${count}">${card}</li>`).join('')}</ol>
    ${outer('prev')}${outer('next')}
  </div>
  <div class="welcome-ring-foot">
    <button type="button" class="welcome-ring-arrow" data-ring="prev" aria-label="Previous picture" data-tip="Previous picture">${arrow(LEFT)}</button>
    <p class="welcome-ring-caption" aria-hidden="true"><strong></strong><span></span></p>
    <button type="button" class="welcome-ring-arrow" data-ring="next" aria-label="Next picture" data-tip="Next picture">${arrow(RIGHT)}</button>
  </div>
  <div class="welcome-ring-dots" role="group" aria-label="Choose a picture">${shots.map((shot, i) => `<button type="button" class="welcome-ring-dot" data-ring-dot="${i}" aria-label="Picture ${i + 1} of ${count}: ${escape(shot.title)}"></button>`).join('')}</div>
  <p class="welcome-ring-status" role="status" aria-live="polite"></p>
</section>`
}

const wrap = (value: number, count: number) => ((value % count) + count) % count
const typing = (el: Element | null) => !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable=true], [role=tab], [role=slider]')

export interface Ring {
  /** The front picture's index. */
  readonly current: number
  /** Re-measure the room either side (call when the host shows the ring). */
  measure(): void
}

/** Wire a ring made by ringHtml. */
export function wireRing(root: HTMLElement, shots: readonly RingShot[], signal?: AbortSignal): Ring {
  const track = root.querySelector<HTMLElement>('.welcome-ring-track')!
  const cards = [...root.querySelectorAll<HTMLElement>('.welcome-ring-card')]
  const dots = [...root.querySelectorAll<HTMLButtonElement>('.welcome-ring-dot')]
  const caption = root.querySelector<HTMLElement>('.welcome-ring-caption')!
  const status = root.querySelector<HTMLElement>('.welcome-ring-status')!
  const count = cards.length
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  // `position` is unwrapped, so the ring always turns the short way and never spins back round.
  let position = 0

  const show = (moved: boolean): void => {
    const current = wrap(position, count), instant = still()
    root.toggleAttribute('data-still', instant)
    cards.forEach((card, i) => {
      // Where the card stands from the front, signed: 0 the front, -1 and 1 either side, the rest
      // beyond them. Its place, angle, size and dimming follow from these alone (welcome.css).
      const off = ((i - current) % count + count + Math.floor(count / 2)) % count - Math.floor(count / 2)
      const away = Math.abs(off)
      card.style.setProperty('--side', String(Math.sign(off)))
      card.style.setProperty('--near', away >= 1 ? '1' : '0')
      card.style.setProperty('--far', away >= 2 ? '1' : '0')
      card.dataset.slot = away === 0 ? 'front' : away === 1 ? 'side' : 'far'
      // The front one paints over the rest as they turn behind it.
      card.style.zIndex = String(10 - away)
      card.setAttribute('aria-hidden', String(i !== current))
    })
    dots.forEach((dot, i) => { if (i === current) dot.setAttribute('aria-current', 'true'); else dot.removeAttribute('aria-current') })
    const shot = shots[current]!
    caption.querySelector('strong')!.textContent = shot.title
    caption.querySelector('span')!.textContent = shot.caption
    if (!moved) return
    // Screen readers hear the move; the visible caption is the front figure's own, so it is not read twice.
    status.textContent = `${current + 1} of ${count}: ${shot.title}`
    if (!instant) caption.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' })
  }
  const pick = (index: number): void => {
    const delta = wrap(index - position, count)
    if (delta === 0) return
    position += delta > count / 2 ? delta - count : delta
    show(true)
  }
  const step = (by: number) => pick(wrap(position, count) + by)

  /** Which of the side pictures and the far-edge arrows the room either side allows. */
  const measure = (): void => {
    const ring = root.getBoundingClientRect(), front = track.getBoundingClientRect()
    if (!front.width) return
    const style = getComputedStyle(root)
    const reach = (side: string) => { const v = parseFloat(style.getPropertyValue(`--reach-${side}`)); return Number.isFinite(v) ? v : 32 }
    const room = Math.min(front.left - ring.left + reach('left'), ring.right - front.right + reach('right'))
    root.toggleAttribute('data-sides', room >= SIDE_ROOM)
    const outer = room >= OUTER_ROOM && innerHeight >= 500
    root.toggleAttribute('data-outer', outer)
    // The far-edge arrows stand 16 px in from the screen's edges (the narrower side sets both), as on the owner's site.
    if (outer) root.style.setProperty('--outer', `${Math.round(room - 16 - 48)}px`)
  }

  for (const button of root.querySelectorAll<HTMLElement>('[data-ring]')) {
    button.addEventListener('click', () => step(button.dataset.ring === 'prev' ? -1 : 1), { signal })
  }
  dots.forEach((dot, i) => dot.addEventListener('click', () => pick(i), { signal }))

  // A swipe across the pictures: a mostly sideways drag of 40 px or more. The tap a swipe ends
  // with is swallowed, so it never also picks the picture under the finger.
  let down: { x: number; y: number; id: number } | null = null, swiped = false
  track.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY, id: event.pointerId }; swiped = false }, { signal })
  track.addEventListener('pointerup', event => {
    if (!down || down.id !== event.pointerId) return
    const dx = event.clientX - down.x, dy = event.clientY - down.y
    down = null
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { swiped = true; step(dx < 0 ? 1 : -1) }
  }, { signal })
  track.addEventListener('pointercancel', () => { down = null }, { signal })
  cards.forEach((card, i) => card.addEventListener('click', () => {
    if (swiped) { swiped = false; return }
    if (card.dataset.slot === 'side') pick(i)
  }, { signal }))

  // The left and right arrow keys, from anywhere in the panel that holds the ring (a lobby sheet
  // or the in-play guide, both dialogs that keep their keys to themselves), while it is shown.
  // Keys meant for a tab list, a slider or a text field are left to them.
  const scope = root.closest('dialog') ?? root
  scope.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent)
    if ((key.key !== 'ArrowLeft' && key.key !== 'ArrowRight') || key.altKey || key.ctrlKey || key.metaKey || key.shiftKey || key.defaultPrevented) return
    if (typing(key.target as Element) || !root.getClientRects().length || root.closest('[hidden], [inert]')) return
    key.preventDefault()
    step(key.key === 'ArrowLeft' ? -1 : 1)
  }, { signal })

  window.addEventListener('resize', measure, { signal })
  // Shown, hidden or resized by its host (a tab, a sheet's column): measure again.
  const observer = new ResizeObserver(measure)
  observer.observe(root)
  signal?.addEventListener('abort', () => observer.disconnect())
  show(false)
  return { get current() { return wrap(position, count) }, measure }
}
