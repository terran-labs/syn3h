/**
 * The lobby's planet captions take no layout: each sits under its own planet (Shell.ts), and
 * captions may overlap. What remains here is depth. Captions are page elements over the
 * canvas, so they cannot be tucked behind a world; a planet mostly hidden behind a nearer one,
 * or behind the sun, has its caption faded instead of written over what is in front.
 */
/** A planet on screen. depth: distance from the eye along the view; smaller is nearer. */
export interface LabelPlace { id: string; x: number; y: number; radius: number; visible: boolean; depth: number }

/** How much of disc a is covered by disc b, 0 to 1. */
export function covered(a: { x: number; y: number; radius: number }, b: { x: number; y: number; radius: number }): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y), r = a.radius, s = b.radius
  if (r <= 0 || d >= r + s) return 0
  if (d <= Math.abs(s - r)) return s >= r ? 1 : (s * s) / (r * r)
  // The lens where two circles cross, as a share of the first circle's area.
  const lens = r * r * Math.acos((d * d + r * r - s * s) / (2 * d * r)) + s * s * Math.acos((d * d + s * s - r * r) / (2 * d * s))
    - 0.5 * Math.sqrt((-d + r + s) * (d + r - s) * (d - r + s) * (d + r + s))
  return lens / (Math.PI * r * r)
}

/**
 * Whether a planet's caption should be faded: more than half of it lies behind a nearer
 * planet, or it sits behind the sun's core (the sun is drawn over a far planet). `sun` is the
 * sun's disc on screen with its depth, when known.
 */
export function captionHidden(place: LabelPlace, places: readonly LabelPlace[], sun?: { x: number; y: number; radius: number; depth?: number }): boolean {
  if (places.some(other => other.id !== place.id && other.visible && other.depth < place.depth && covered(place, other) > 0.5)) return true
  return !!sun && sun.depth !== undefined && sun.depth < place.depth && covered(place, sun) > 0.5
}

/**
 * The mask that cuts a caption where nearer bodies cover it: one transparent disc per planet
 * nearer the eye than the caption's own (and the sun, when nearer), in the caption's own box.
 * Positions are given from the box's top centre (`calc(50% + dx)`), since the caption is
 * centred on its planet, so nothing has to be measured. The disc edge is a one pixel ramp
 * at the planet's limb, crisp and antialiased. 'none' when nothing nearer touches it.
 */
export function captionMask(place: LabelPlace, places: readonly LabelPlace[], sun: { x: number; y: number; radius: number; depth?: number } | undefined, top: number, scale = 1): string {
  const nearer = places.filter(other => other.id !== place.id && other.visible && other.depth < place.depth)
  const bodies: { x: number; y: number; radius: number }[] = [...nearer]
  if (sun && sun.depth !== undefined && sun.depth < place.depth) bodies.push(sun)
  // Only bodies that can reach the caption: within a generous box under the planet, as large as the caption is drawn.
  const reach = bodies.filter(b => Math.abs(b.x - place.x) < b.radius + 160 * scale && b.y + b.radius > top - 2 && b.y - b.radius < top + 40 * scale)
  if (!reach.length) return 'none'
  return reach.map(b => {
    const dx = (b.x - place.x).toFixed(1), dy = (b.y - top).toFixed(1), r = b.radius
    return `radial-gradient(circle at calc(50% + ${dx}px) ${dy}px, transparent ${Math.max(0, r - 0.5).toFixed(1)}px, #000 ${(r + 0.5).toFixed(1)}px)`
  }).join(', ')
}

/** A rectangle on screen, in CSS pixels. */
export interface ScreenBox { left: number; top: number; right: number; bottom: number }

/**
 * Whether a caption's box comes within `margin` of any of the lobby's own controls (the buttons
 * in the lower right, the settings card, the version): such a caption fades out and takes no
 * taps, so it never draws over a control or reads through the card (the owner's iPad mini, 21
 * November 2026). The planet itself stays.
 */
export function captionBlocked(box: ScreenBox, blockers: readonly ScreenBox[], margin = 8): boolean {
  return blockers.some(b => box.left < b.right + margin && box.right > b.left - margin && box.top < b.bottom + margin && box.bottom > b.top - margin)
}
