/**
 * The one expand and collapse arrow (the owner, 23 November 2026: "proper animated arrows for the
 * expanding collapse accordions"): a single drawn chevron pointing right that turns to point down
 * as its section opens, 180 ms, no motion under reduced motion. Styled by .accordion-arrow
 * (card-chrome.css). It turns when it sits in the <summary> of an open <details>, or inside an
 * element with aria-expanded="true". Used by each release in Updates and by Welcome's Credits
 * and licences.
 */
export const ACCORDION_ARROW = '<svg class="accordion-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5L10.5 8L6 12.5"/></svg>'

/** A small double chevron pointing right, drawn before a link that leads on (Updates' full notes). */
export const LEADS_ON = '<svg class="leads-on" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 4L7.5 8L3.5 12M8.5 4L12.5 8L8.5 12"/></svg>'
