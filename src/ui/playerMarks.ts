/**
 * A player's name with its marks: the one way any surface draws who someone is, so the marks
 * cannot drift between the chat log, the Players & session rows, the scoreboard, the match
 * board, vehicle labels and toasts (the owner, 22 November 2026: "Anywhere we have a player
 * name, they need to use a bot icon rather than the text of bot, and they need to use that icon
 * consistently anywhere their name is shown").
 *
 * The bot mark is a small robot head, one vector path in the player's colour (currentColor),
 * no image file (AGENTS.md: generate it, do not ship it). On a 16 unit grid: a ball antenna on a
 * short stem, a rounded head with side ears, and two eyes and a mouth cut out by the even-odd
 * fill rule, so whatever is behind shows through them. Screen readers hear "Bot" before the
 * name; the word is never drawn.
 *
 * The creator mark takes the same slot for the player the room vouches for as the creator
 * (PlayerInfo.role, server/creator.ts): a line-art Mira icon (brand/creatorMarkPath.ts) in the
 * player's colour through the same legibleTint, heard as "Creator". It comes only from the
 * room's role, never from a name: the room strips typed lookalikes, and a bot never has a role.
 */
import './player-marks.css'
import { CREATOR_MARK_STROKE_PX, CREATOR_MARK_VIEWBOX, creatorMarkShape } from './brand/creatorMarkPath'

const SVG = 'http://www.w3.org/2000/svg'
const HEAD =
  'M8 .4a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 1 1 0-2.6Z' + // antenna ball
  'M7.4 2.8h1.2V4H7.4Z' + // stem
  'M5 4h6a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z' + // head
  'M5.8 6.9a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8Z' + // left eye (cut)
  'M10.2 6.9a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8Z' + // right eye (cut)
  'M6.2 10.6h3.6v.9H6.2Z' + // mouth (cut)
  'M.6 7.2h1v2.6h-1ZM14.4 7.2h1v2.6h-1Z' // ears

/** Who a name belongs to, as far as its marks need to know. */
export interface MarkedPlayer {
  name: string
  bot: boolean
  /** The player's vehicle colour, #rrggbb; the bot mark takes it, lifted to stay legible. */
  color?: string
  /** What the room vouches for (PlayerInfo.role). Never set from anything a player typed. */
  role?: 'creator'
}

/** The bot mark alone. Without a colour it takes the text colour around it. */
export function botMark(color?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'bot-mark')
  svg.setAttribute('viewBox', '0 0 16 14')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Bot')
  if (color) svg.style.color = legibleTint(color)
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', HEAD)
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('fill-rule', 'evenodd')
  svg.append(path)
  return svg
}

let creatorShape: ReturnType<typeof creatorMarkShape> | null = null

/** The creator mark alone, in the bot mark's slot and colour rule. */
export function creatorMark(color?: string): SVGSVGElement {
  creatorShape ??= creatorMarkShape()
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'bot-mark creator-mark')
  svg.setAttribute('viewBox', CREATOR_MARK_VIEWBOX)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Creator')
  if (color) svg.style.color = legibleTint(color)
  const orbits = document.createElementNS(SVG, 'path')
  orbits.setAttribute('d', creatorShape.orbits)
  orbits.setAttribute('fill', 'none')
  orbits.setAttribute('stroke', 'currentColor')
  orbits.setAttribute('stroke-width', String(CREATOR_MARK_STROKE_PX))
  orbits.setAttribute('stroke-linecap', 'round')
  orbits.setAttribute('vector-effect', 'non-scaling-stroke')
  const solids = document.createElementNS(SVG, 'path')
  solids.setAttribute('d', creatorShape.solids)
  solids.setAttribute('fill', 'currentColor')
  svg.append(orbits, solids)
  return svg
}

/** The mark a player's name carries, or null. A bot is never the creator. */
function markFor(player: MarkedPlayer): SVGSVGElement | null {
  if (player.bot) return botMark(player.color)
  if (player.role === 'creator') return creatorMark(player.color)
  return null
}

/** True when this player's name is drawn with a mark before it. */
export const hasMark = (player: MarkedPlayer): boolean => player.bot || player.role === 'creator'

/**
 * The nodes for a name with its marks, to append where the name goes: the bot or creator mark
 * first, then the name as text (never markup). `shown` replaces the visible text ("You").
 */
export function markedName(player: MarkedPlayer, shown = player.name): Node[] {
  const text = document.createTextNode(shown)
  const mark = markFor(player)
  return mark ? [mark, text] : [text]
}

/**
 * A line of text that may name players (a toast: "Zepy tagged you"), with each bot's or the
 * creator's mark set before its name. Names are matched whole and longest first, so "Ann" never
 * marks "Annika".
 */
export function markedText(text: string, players: readonly MarkedPlayer[]): Node[] {
  const bots = players.filter(p => hasMark(p) && p.name).sort((a, b) => b.name.length - a.name.length)
  if (!bots.length) return [document.createTextNode(text)]
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${bots.map(b => escape(b.name)).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  const out: Node[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) out.push(document.createTextNode(text.slice(at, match.index)))
    out.push(...markedName(bots.find(b => b.name === match[0])!))
    at = match.index + match[0].length
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)))
  return out
}

/**
 * The surface a name must read on: a chat bubble (chat.css) over a bright daytime sky, the
 * lightest place a name usually sits. Cards are darker, so a tint that passes here passes there.
 */
export const CHAT_NAME_SURFACE: readonly [number, number, number] = [66, 80, 95]
/** WCAG AA for normal text. */
export const CHAT_NAME_CONTRAST = 4.5

const channel = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const luminance = ([r, g, b]: readonly number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
/** WCAG contrast ratio between two sRGB colours. */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * Make a player's tint readable as a name or mark: keep its hue and lift it towards white just
 * far enough to reach AA contrast on CHAT_NAME_SURFACE. Light tints pass unchanged.
 */
export function legibleTint(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const n = parseInt(m[1], 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const mix = (t: number) => rgb.map((v) => Math.round(v + (255 - v) * t))
  if (contrastRatio(rgb, CHAT_NAME_SURFACE) >= CHAT_NAME_CONTRAST) return color
  // The least lift that passes, by bisection (white always passes, at about 8:1).
  let lo = 0, hi = 1
  for (let i = 0; i < 12; i++) { const t = (lo + hi) / 2; if (contrastRatio(mix(t), CHAT_NAME_SURFACE) >= CHAT_NAME_CONTRAST) hi = t; else lo = t }
  const [r, g, b] = mix(hi)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}
