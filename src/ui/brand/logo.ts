import { WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from './activeWordmark'

/**
 * The Syn3h logo as inline SVG markup. One path, coloured and lit in CSS (`.wordmark`), so
 * it needs no image request, scales to any screen and can change colour with a variable.
 * It replaces a 1.5 MB bitmap that every screen used to load.
 */
export function wordmarkSvg(className = ''): string {
  return `<svg class="wordmark ${className}" viewBox="0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}" role="img" aria-label="Syn3h" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${WORDMARK_PATH}"/></svg>`
}
