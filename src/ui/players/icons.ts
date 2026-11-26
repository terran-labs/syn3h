/**
 * The Players card's small vector icons, generated, never images (AGENTS.md: generate it, do
 * not ship it). Vehicles reuse the side-view glyphs the vehicle switch already draws
 * (VehicleChoice.ts), as plain white silhouettes; the speaker is one path on a 16 unit grid.
 */
import { VEHICLE_GLYPHS } from '../VehicleChoice'
import { legibleTint, markedName, type MarkedPlayer } from '../playerMarks'

const SVG = 'http://www.w3.org/2000/svg'

/** Wire vehicle kinds that share another kind's glyph (older buggies draw as the Buggy). */
const SAME_AS: Record<string, string> = { buggy: 'buggy-syn3h', 'buggy-classic': 'buggy-syn3h' }

/** The glyph and display name for a vehicle kind, or null for a kind with no drawing. */
export function vehicleGlyph(kind: string | undefined): { label: string; glyph: string } | null {
  if (!kind) return null
  const id = SAME_AS[kind] ?? kind
  return VEHICLE_GLYPHS.find(vehicle => vehicle.id === id) ?? null
}

/** A vehicle's white silhouette, labelled for screen readers by its name. */
export function vehicleIcon(kind: string | undefined, className = 'vehicle-mark'): SVGSVGElement | null {
  const vehicle = vehicleGlyph(kind)
  if (!vehicle) return null
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', className)
  svg.setAttribute('viewBox', '0 0 24 14')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', vehicle.label)
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', vehicle.glyph)
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

/** A speaker crossed out: the cone filled, the cross stroked. */
const SPEAKER = 'M1.5 5.5h3L8.5 2v12l-4-3.5h-3Z'
const CROSS = 'M10.5 5.5l4.5 5M15 5.5l-4.5 5'

/** The crossed-out speaker. `label` is its accessible name ("Muted for everyone"); none hides it from readers. */
export function mutedIcon(label?: string, className = 'muted-mark'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', className)
  svg.setAttribute('viewBox', '0 0 16 16')
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label) } else svg.setAttribute('aria-hidden', 'true')
  const cone = document.createElementNS(SVG, 'path')
  cone.setAttribute('d', SPEAKER); cone.setAttribute('fill', 'currentColor')
  const cross = document.createElementNS(SVG, 'path')
  cross.setAttribute('d', CROSS); cross.setAttribute('fill', 'none'); cross.setAttribute('stroke', 'currentColor')
  cross.setAttribute('stroke-width', '1.6'); cross.setAttribute('stroke-linecap', 'round')
  svg.append(cone, cross)
  return svg
}

/**
 * A person's mark in the Players card (the owner, 25 November 2026: "a circle in front of each
 * player ... colored according to their primary tint, just like the bot icon is"): a filled
 * circle in their vehicle tint, lifted to stay legible the same way the bot mark is.
 */
export function tintDot(color?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'tint-dot')
  svg.setAttribute('viewBox', '0 0 10 10')
  svg.setAttribute('aria-hidden', 'true')
  if (color) svg.style.color = legibleTint(color)
  const dot = document.createElementNS(SVG, 'circle')
  dot.setAttribute('cx', '5'); dot.setAttribute('cy', '5'); dot.setAttribute('r', '5'); dot.setAttribute('fill', 'currentColor')
  svg.append(dot)
  return svg
}

/**
 * A name with its mark in a fixed-width slot, so every name in a list starts at the same x:
 * the bot or creator mark from markedName when there is one, otherwise the tint circle.
 */
export function slottedName(player: MarkedPlayer, shown = player.name): Node[] {
  const nodes = markedName(player, shown)
  const slot = document.createElement('span'); slot.className = 'mark-slot'
  const first = nodes[0]
  if (first instanceof SVGElement) { slot.append(first); nodes.shift() } else slot.append(tintDot(player.color))
  const text = document.createElement('span'); text.className = 'mark-name'; text.append(...nodes)
  return [slot, text]
}
