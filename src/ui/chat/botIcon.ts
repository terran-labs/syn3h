/**
 * The bot mark before a bot's name in chat: a small robot head drawn as one vector path, in the
 * name's own colour (currentColor). No image file (AGENTS.md: generate it, do not ship it).
 *
 * On a 16 unit grid: a ball antenna on a short stem, a rounded head with side ears, and two eyes
 * and a mouth cut out of the head by the even-odd fill rule, so the bubble shows through them.
 * Screen readers hear "Bot" before the name; the word is not drawn.
 */
const SVG = 'http://www.w3.org/2000/svg'
const HEAD =
  'M8 .4a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 1 1 0-2.6Z' + // antenna ball
  'M7.4 2.8h1.2V4H7.4Z' + // stem
  'M5 4h6a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z' + // head
  'M5.8 6.9a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8Z' + // left eye (cut)
  'M10.2 6.9a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8Z' + // right eye (cut)
  'M6.2 10.6h3.6v.9H6.2Z' + // mouth (cut)
  'M.6 7.2h1v2.6h-1ZM14.4 7.2h1v2.6h-1Z' // ears

export function botIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'chat-bot')
  svg.setAttribute('viewBox', '0 0 16 14')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Bot')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', HEAD)
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('fill-rule', 'evenodd')
  svg.append(path)
  return svg
}
