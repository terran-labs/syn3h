import { cleanRecipeId } from '../../../shared/recipes'
import { captionHidden, insideDisc, type LabelPlace, type ScreenDisc } from './labels'

export type TwinAction = 'public' | 'private' | 'choose'
export interface TwinPlace extends LabelPlace {
  /** Where the connecting band meets the public rim, in CSS pixels. */
  rimX: number
}

export function projectTwins(
  places: readonly LabelPlace[], sun: ScreenDisc, width: number, height: number,
  eligible: (id: string) => boolean,
): TwinPlace[] {
  return places.filter(place => cleanRecipeId(place.id) && eligible(place.id)).map(place => {
    const radius = Math.max(5, place.radius * 0.64)
    const offset = place.radius + 6 + radius
    const side = place.x + offset + radius <= width || place.x - offset - radius < 0 ? 1 : -1
    const x = place.x + side * offset
    const twin = { ...place, x, radius, rimX: place.x + side * place.radius }
    twin.visible = place.visible && x - radius >= 0 && x + radius <= width &&
      place.y - radius >= 0 && place.y + radius <= height && !captionHidden(twin, places, sun)
    return twin
  })
}

export function pickTwin(
  places: readonly LabelPlace[], twins: readonly TwinPlace[], sun: ScreenDisc,
  x: number, y: number, margin: number, touch: boolean,
): { id: string; action: TwinAction } | undefined {
  const cutoff = insideDisc(sun, x, y) ? sun.depth ?? Infinity : Infinity
  const shown = (place: LabelPlace) => place.visible && place.depth < cutoff
  const pub = (id: string) => ({ id, action: 'public' as const })
  const priv = (id: string) => ({ id, action: 'private' as const })
  const edge = (place: ScreenDisc) => Math.hypot(place.x - x, place.y - y) - place.radius
  const hits = [
    ...places.filter(shown).map(place => ({ place, target: pub(place.id), edge: edge(place) })),
    ...twins.filter(shown).map(place => ({ place, target: priv(place.id), edge: edge(place) })),
  ]
  const direct = hits.filter(hit => hit.edge < 0).sort((a, b) => a.place.depth - b.place.depth)[0]
  if (direct) return direct.target
  if (cutoff !== Infinity) return undefined
  const padded = hits.filter(hit => hit.edge < margin).sort((a, b) => a.edge - b.edge)
  const first = padded[0]
  if (touch && first && padded.some(hit => hit.target.id === first.target.id && hit.target.action !== first.target.action)) {
    return { id: first.target.id, action: 'choose' }
  }
  return first?.target
}
