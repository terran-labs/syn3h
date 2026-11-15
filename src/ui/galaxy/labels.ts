/**
 * Where the galaxy's world labels go. With ten worlds on a phone they would pile up, so each
 * label tries a few spots round its world (under, over, right, left) and takes the first
 * that is on the screen and clear of the labels and worlds already placed. The world in play
 * goes first, then the nearer worlds. A label keeps last frame's spot while it still fits,
 * so labels do not hop as the worlds move. One that fits nowhere is marked crowded: the
 * caller fades it, and its world can still be tapped.
 */
export interface LabelPlace { id: string; x: number; y: number; radius: number; visible: boolean }
export interface LabelSpot { id: string; x: number; y: number; spot: number; crowded: boolean }
/** x is the label's centre, y its top edge: the way the stylesheet anchors `.galaxy-label`. */
export function placeLabels(
  places: readonly LabelPlace[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  bounds: { width: number; height: number; bottom: number; top?: number },
  options: { first?: string; previous?: ReadonlyMap<string, number> } = {},
): LabelSpot[] {
  const margin = 8, pad = 4
  const taken: { left: number; top: number; right: number; bottom: number }[] = []
  const discs = places.filter(place => place.visible), top = Math.max(margin, bounds.top ?? 0)
  // A world off the screen keeps no label pinned to the edge. One behind the links or the
  // wordmark is still on the screen: its label is held clear of them.
  const onScreen = (place: LabelPlace) => place.x >= 0 && place.x <= bounds.width && place.y >= 0 && place.y <= bounds.height
  const order = [...discs].sort((a, b) => (b.id === options.first ? 1 : 0) - (a.id === options.first ? 1 : 0) || b.radius - a.radius)
  const result: LabelSpot[] = []
  for (const place of order) {
    const size = sizes.get(place.id) ?? { width: 90, height: 24 }, w = size.width, h = size.height
    const gap = place.radius + 6
    const spots = [
      [place.x, place.y + gap], [place.x, place.y - gap - h],
      [place.x + gap + 2 + w / 2, place.y - h / 2], [place.x - gap - 2 - w / 2, place.y - h / 2],
    ].map(([x, y]) => [Math.min(bounds.width - margin - w / 2, Math.max(margin + w / 2, x)), Math.min(bounds.bottom - h, Math.max(top, y))])
    const fits = (i: number) => {
      const [x, y] = spots[i], box = { left: x - w / 2 - pad, top: y - pad, right: x + w / 2 + pad, bottom: y + h + pad }
      if (taken.some(t => box.left < t.right && box.right > t.left && box.top < t.bottom && box.bottom > t.top)) return null
      // Clear of every other world's disc.
      for (const disc of discs) {
        if (disc.id === place.id) continue
        const nx = Math.min(box.right, Math.max(box.left, disc.x)), ny = Math.min(box.bottom, Math.max(box.top, disc.y))
        if (Math.hypot(nx - disc.x, ny - disc.y) < disc.radius) return null
      }
      return box
    }
    const before = options.previous?.get(place.id)
    const tries = before !== undefined && before >= 0 ? [before, 0, 1, 2, 3] : [0, 1, 2, 3]
    let chosen = -1, box = null
    if (onScreen(place)) for (const i of tries) { box = fits(i); if (box) { chosen = i; break } }
    // The world in play is always named, under it if nowhere is clear.
    if (!box && place.id === options.first) { chosen = 0; const [x, y] = spots[0]; box = { left: x - w / 2 - pad, top: y - pad, right: x + w / 2 + pad, bottom: y + h + pad } }
    if (box) taken.push(box)
    const [x, y] = spots[Math.max(0, chosen)]
    result.push({ id: place.id, x, y, spot: chosen, crowded: chosen < 0 })
  }
  return result
}
