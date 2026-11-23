/**
 * Every card's close control: a bare, drawn X, no word and no pill (the owner, 22 November 2026:
 * "the close button should also just be a larger X"). One vector path, the same in the lobby's
 * Settings card, Welcome and Updates, the in-play guide and an open panel on a phone. Styled by
 * .card-close (card-chrome.css), larger on touch screens.
 */
export const CARD_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6L18 18M18 6L6 18"/></svg>'

/**
 * Which input moved focus last: `data-focus-by="pointer"` or `"keyboard"` on <html>.
 *
 * A sheet moves focus to its X as it opens, so keyboard and screen reader users start there. WebKit
 * (and Chromium when nothing had focus) treats that scripted focus as :focus-visible and draws the
 * keyboard ring, so a click or tap open showed a ringed X (the owner, 23 November 2026). The X
 * shows its ring only while the last input was a key (card-chrome.css): after a pointer or touch,
 * or before any input (nothing says a keyboard is in use), it has none.
 */
export function trackFocusModality(signal: AbortSignal): void {
  const root = document.documentElement
  const set = (by: 'pointer' | 'keyboard') => { if (root.dataset.focusBy !== by) root.dataset.focusBy = by }
  addEventListener('pointerdown', () => set('pointer'), { capture: true, passive: true, signal })
  addEventListener('keydown', event => {
    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return
    set('keyboard')
  }, { capture: true, signal })
}
