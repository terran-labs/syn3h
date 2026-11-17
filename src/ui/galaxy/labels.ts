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
