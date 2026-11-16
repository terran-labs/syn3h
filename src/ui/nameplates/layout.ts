/** Pure screen-space rules. Rectangles include the leader line as well as the plate. */
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Disc { id: string; x: number; y: number; radius: number; depth: number }
export interface Candidate {
  id: string; bot: boolean; x: number; y: number; depth: number
  width: number; height: number; opacity: number; tick: boolean
  previous?: number
}
export interface Placement extends Rect { id: string; x: number; y: number; spot: number; opacity: number; tick: boolean }
export const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
export function touchesDisc(box: Rect, disc: Disc): boolean {
  const x = Math.max(box.left, Math.min(box.right, disc.x)), y = Math.max(box.top, Math.min(box.bottom, disc.y))
  return Math.hypot(x - disc.x, y - disc.y) < disc.radius + 3
}
export function appearance(distance: number, bot: boolean, presentation: boolean) {
  const far = bot ? 180 : 650, full = bot ? 45 : 140
  const fade = Math.max(0, Math.min(1, (far - distance) / (far - full)))
  return { opacity: fade * (bot ? .58 : .96), scale: (presentation ? 1.25 : 1) * (bot ? .66 : 1), tick: bot && distance > 100, visible: distance >= 0 && distance < far }
}
/** People are allocated first regardless of depth; bots yield every contested spot. */
export function placeNameplates(candidates: readonly Candidate[], discs: readonly Disc[], exclusions: readonly Rect[], width: number, height: number,
  terrainClear: (box: Rect, depth: number) => boolean = () => true): Placement[] {
  const result: Placement[] = []
  const order = [...candidates].sort((a, b) => Number(a.bot) - Number(b.bot) || a.depth - b.depth || a.id.localeCompare(b.id))
  for (const c of order) {
    if (c.opacity <= 0 || c.depth <= 0 || !Number.isFinite(c.x + c.y + c.depth)) continue
    // Anchors behind HUD never send leaders across it. Leaders stay inside the reserved box.
    const spots = [[0, -12], [0, -32], [-c.width / 2 - 12, -12], [c.width / 2 + 12, -12]]
    const tries = [0, 1, 2, 3]
    if (c.previous !== undefined && c.previous >= 0 && c.previous < 4) tries.unshift(c.previous)
    for (const spot of tries) {
      const [dx, dy] = spots[spot], x = c.x + dx, y = c.y + dy - c.height
      const plate = { left: x - c.width / 2, top: y, right: x + c.width / 2, bottom: y + c.height }
      const bounds = { left: Math.min(plate.left, c.x) - 3, top: plate.top - 3, right: Math.max(plate.right, c.x) + 3, bottom: c.y + 3 }
      if (bounds.left < 8 || bounds.right > width - 8 || bounds.top < 8 || bounds.bottom > height - 8) continue
      if (exclusions.some(b => overlaps(bounds, b)) || result.some(b => overlaps(bounds, b))) continue
      if (discs.some(d => d.id !== c.id && d.depth < c.depth && touchesDisc(bounds, d))) continue
      if (!terrainClear(plate, c.depth)) continue
      result.push({ ...bounds, id: c.id, x, y, spot, opacity: c.opacity, tick: c.tick }); break
    }
  }
  return result
}
