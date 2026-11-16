/**
 * Where the galaxy's world labels go. With ten worlds on a phone they would pile up, so each
 * label tries a few spots round its world (under, over, right, left, then the four corners)
 * and takes the first that is on the screen and clear of the labels and worlds already
 * placed. The world in play goes first, then the nearer worlds. A label keeps last frame's
 * spot while it still fits, so labels do not hop as the worlds move. One that fits nowhere
 * is marked crowded: the caller fades it, and its world can still be tapped.
 *
 * Labels are page elements over the canvas, so they cannot be tucked behind a world. Depth
 * is kept by where they go instead: a label never covers a world nearer the eye than its
 * own, and a world mostly hidden behind a nearer one has its label faded, not drawn over
 * the world in front. That holds for the world in play too.
 */
/** depth: distance from the eye along the view; smaller is nearer. Without it, no depth rule applies. */
export interface LabelPlace { id: string; x: number; y: number; radius: number; visible: boolean; depth?: number }
/**
 * spot is the side chosen, -1 when crowded. A crowded label is still given a position clear of
 * nearer worlds, since a focused one is shown; blocked means no such position exists and the
 * caller must keep it out of sight even when focused.
 */
export interface LabelSpot { id: string; x: number; y: number; spot: number; crowded: boolean; blocked?: boolean }
type Box = { left: number; top: number; right: number; bottom: number }
/** The plate itself, without the spacing pad: the sun's core is kept off the plate, not off its pad. */
const unpad = (b: Box): Box => ({ left: b.left + 4, top: b.top + 4, right: b.right - 4, bottom: b.bottom - 4 })
const overlapping = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
/** How much of disc a is covered by disc b, 0 to 1. */
function covered(a: LabelPlace, b: LabelPlace): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y), r = a.radius, s = b.radius
  if (r <= 0 || d >= r + s) return 0
  if (d <= Math.abs(s - r)) return s >= r ? 1 : (s * s) / (r * r)
  // The lens where two circles cross, as a share of the first circle's area.
  const lens = r * r * Math.acos((d * d + r * r - s * s) / (2 * d * r)) + s * s * Math.acos((d * d + s * s - r * r) / (2 * d * s))
    - 0.5 * Math.sqrt((-d + r + s) * (d + r - s) * (d - r + s) * (d + r + s))
  return lens / (Math.PI * r * r)
}
const touches = (box: Box, disc: LabelPlace) => {
  const nx = Math.min(box.right, Math.max(box.left, disc.x)), ny = Math.min(box.bottom, Math.max(box.top, disc.y))
  return Math.hypot(nx - disc.x, ny - disc.y) < disc.radius
}
/** x is the label's centre, y its top edge: the way the stylesheet anchors `.galaxy-label`. */
type Options = { first?: string; previous?: ReadonlyMap<string, number>; avoid?: readonly { x: number; y: number; radius: number }[] }
/**
 * Every world should be named; the labels are the lobby's navigation. Nearer worlds are placed
 * first, which can leave a farther one boxed in. Then place again with the unnamed ones first
 * (after the world in play), at most three rounds, and keep the round naming the most.
 */
export function placeLabels(
  places: readonly LabelPlace[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  bounds: { width: number; height: number; bottom: number; top?: number },
  options: Options = {},
): LabelSpot[] {
  let best = placeOnce(places, sizes, bounds, options, new Set()), promoted = new Set<string>()
  for (let round = 0; round < 3; round++) {
    const unnamed = best.filter(spot => spot.crowded).map(spot => spot.id).filter(id => !promoted.has(id))
    if (!unnamed.length) break
    promoted = new Set([...unnamed, ...promoted])
    const next = placeOnce(places, sizes, bounds, options, promoted)
    if (next.filter(spot => spot.crowded).length < best.filter(spot => spot.crowded).length) best = next
  }
  return best
}
function placeOnce(
  places: readonly LabelPlace[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  bounds: { width: number; height: number; bottom: number; top?: number },
  options: Options, promoted: ReadonlySet<string>,
): LabelSpot[] {
  const margin = 8, pad = 4
  /** A label is adjacent to its world: its leader, plate edge to limb, is never longer. */
  const LEADER_MAX = 40
  // Discs no label may cover besides the worlds, such as the sun's core.
  const avoid = (options.avoid ?? []).map(a => ({ id: '', x: a.x, y: a.y, radius: a.radius, visible: true }))
  const taken: Box[] = []
  const discs = places.filter(place => place.visible), top = Math.max(margin, bounds.top ?? 0)
  // Nearer first; without depths, the bigger disc, which is usually the nearer.
  const depth = (place: LabelPlace) => place.depth ?? -place.radius
  // A world off the screen keeps no label pinned to the edge. One behind the links or the
  // wordmark is still on the screen: its label is held clear of them.
  const onScreen = (place: LabelPlace) => place.x >= 0 && place.x <= bounds.width && place.y >= 0 && place.y <= bounds.height
  const order = [...discs].sort((a, b) => (b.id === options.first ? 1 : 0) - (a.id === options.first ? 1 : 0) || (promoted.has(b.id) ? 1 : 0) - (promoted.has(a.id) ? 1 : 0) || depth(a) - depth(b))
  const result: LabelSpot[] = []
  type Placed = { id: string; box: Box; spot: LabelSpot; retry(arriving: readonly Box[], depth: number): boolean }
  const placedLabels: Placed[] = []
  for (const place of order) {
    const size = sizes.get(place.id) ?? { width: 90, height: 24 }, w = size.width, h = size.height
    const gap = place.radius + 6, slant = gap * 0.72 + 2
    const nearer = place.depth === undefined ? [] : discs.filter(disc => disc.id !== place.id && disc.depth !== undefined && disc.depth < place.depth!)
    // Spots 0 to 3 keep their old numbers, so a held spot means the same side as before.
    const spots = [
      [place.x, place.y + gap], [place.x, place.y - gap - h],
      [place.x + gap + 2 + w / 2, place.y - h / 2], [place.x - gap - 2 - w / 2, place.y - h / 2],
      [place.x + slant + w / 2, place.y + slant - h / 2], [place.x - slant - w / 2, place.y + slant - h / 2],
      [place.x + slant + w / 2, place.y - slant - h / 2], [place.x - slant - w / 2, place.y - slant - h / 2],
    ]
    // Spots 8 to 23 are the same sides further out, for when all eight near ones are taken.
    for (const reach of [1.6, 2.4]) for (let i = 0; i < 8; i++) {
      const [sx, sy] = spots[i]
      spots.push([place.x + (sx - place.x) * reach, place.y + (sy + h / 2 - place.y) * reach - h / 2])
    }
    for (const s of spots) { s[0] = Math.min(bounds.width - margin - w / 2, Math.max(margin + w / 2, s[0])); s[1] = Math.min(bounds.bottom - h, Math.max(top, s[1])) }
    const boxAt = (i: number): Box => { const [x, y] = spots[i]; return { left: x - w / 2 - pad, top: y - pad, right: x + w / 2 + pad, bottom: y + h + pad } }
    // Never over a world in front of this one: the one rule nothing overrides.
    const behindNothing = (box: Box) => !nearer.some(disc => touches(box, disc))
    // From the plate's nearest point to the limb: after clamping to the screen this can grow.
    const leader = (i: number) => {
      const [x, y] = spots[i], nx = Math.min(x + w / 2, Math.max(x - w / 2, place.x)), ny = Math.min(y + h, Math.max(y, place.y))
      return Math.hypot(nx - place.x, ny - place.y) - place.radius
    }
    // `ignore` is a label about to move away and `extra` one about to arrive (see below).
    const fits = (i: number, ignore?: Box, extra?: Box) => {
      const box = boxAt(i)
      if (leader(i) > LEADER_MAX) return null
      if (taken.some(t => t !== ignore && overlapping(box, t)) || (extra && overlapping(box, extra))) return null
      // Clear of every world's disc, its own included, nearer or farther, and of the sun.
      for (const disc of discs) if (touches(box, disc)) return null
      for (const disc of avoid) if (touches(unpad(box), disc)) return null
      return box
    }
    const before = options.previous?.get(place.id)
    const tries = spots.map((_, i) => i)
    if (before !== undefined && before >= 0 && before < spots.length) tries.unshift(before)
    // A world mostly behind a nearer one is not named over it. Two thresholds, keyed on last
    // frame, so a pair resting near half cover does not blink the label every frame.
    const threshold = before !== undefined && before < 0 ? 0.45 : 0.55
    const hidden = nearer.some(disc => covered(place, disc) > threshold)
    let chosen = -1, box: Box | null = null
    if (onScreen(place) && !hidden) for (const i of tries) { box = fits(i); if (box) { chosen = i; break } }
    // The world in play is named even over other labels, under it by preference, but never
    // over a world: first clear of every world and the sun, failing that of nearer worlds.
    const clearOfAll = (b: Box) => !discs.some(disc => touches(b, disc)) && !avoid.some(disc => touches(unpad(b), disc))
    if (!box && place.id === options.first && !hidden) for (const i of tries) if (leader(i) <= LEADER_MAX && clearOfAll(boxAt(i))) { chosen = i; box = boxAt(i); break }
    if (!box && place.id === options.first && !hidden) for (const i of tries) if (behindNothing(boxAt(i))) { chosen = i; box = boxAt(i); break }
    const settle = (i: number, b: Box) => {
      taken.push(b); const [x, y] = spots[i], spot: LabelSpot = { id: place.id, x, y, spot: i, crowded: false }
      result.push(spot)
      // Move this label to another legal spot clear of `arriving`. With depth left, that spot
      // may be blocked by one other label, if that one can move in turn.
      const entry: Placed = { id: place.id, box: b, spot, retry: (arriving, depth) => {
        for (const j of tries) {
          if (j === entry.spot.spot) continue
          const moved = boxAt(j)
          if (leader(j) > LEADER_MAX || !clearOfAll(moved) || arriving.some(a => overlapping(moved, a))) continue
          const blockers = placedLabels.filter(other => other !== entry && overlapping(moved, other.box))
          if (blockers.length > 1 || blockers.length === 1 && (depth <= 0 || blockers[0].id === options.first || !blockers[0].retry([...arriving, moved], depth - 1))) continue
          taken[taken.indexOf(entry.box)] = moved; entry.box = moved
          const [mx, my] = spots[j]; Object.assign(entry.spot, { x: mx, y: my, spot: j })
          return true
        }
        return false
      } }
      placedLabels.push(entry)
    }
    if (box) { settle(chosen, box); continue }
    // Every world is named: no spot of its own is free, so take one that a single placed label
    // blocks, if that label can move to another free spot of its own.
    if (onScreen(place) && !hidden) {
      let moved = false
      for (const i of tries) {
        const b = boxAt(i)
        if (leader(i) > LEADER_MAX || discs.some(disc => touches(b, disc)) || avoid.some(disc => touches(unpad(b), disc))) continue
        const blockers = placedLabels.filter(other => overlapping(b, other.box))
        if (blockers.length !== 1 || blockers[0].id === options.first || !blockers[0].retry([b], 1)) continue
        settle(i, b); moved = true; break
      }
      if (moved) continue
    }
    // Crowded, it fades, but a focused one still shows: put it where it cannot cover a nearer
    // world, further out if the sides are all taken. Nowhere at all, and it is blocked.
    let rest: number[] | undefined
    for (const reach of [1, 1.6, 2.4]) {
      for (let i = 0; i < 8 && !rest; i++) {
        const [sx, sy] = spots[i]
        const x = Math.min(bounds.width - margin - w / 2, Math.max(margin + w / 2, place.x + (sx - place.x) * reach))
        const y = Math.min(bounds.bottom - h, Math.max(top, place.y + (sy + h / 2 - place.y) * reach - h / 2))
        if (behindNothing({ left: x - w / 2 - pad, top: y - pad, right: x + w / 2 + pad, bottom: y + h + pad })) rest = [x, y]
      }
      if (rest) break
    }
    const [x, y] = rest ?? spots[0]
    result.push({ id: place.id, x, y, spot: -1, crowded: true, ...(rest ? {} : { blocked: true }) })
  }
  return result
}
