/** Pure screen-space rules. Placed rectangles span the plate and its leader. */
export interface Rect { left: number; top: number; right: number; bottom: number }
/** Union of at most48 clipped face polygons, at most9 vertices each. Reused per vehicle. */
export interface ScreenProxy { points: Float64Array; sizes: Uint8Array; count: number; blocked: boolean }
export interface Disc { id: string; x: number; y: number; radius: number; depth: number; proxy?: ScreenProxy }
export function createScreenProxy(): ScreenProxy {
  return { points: new Float64Array(48 * 9 * 2), sizes: new Uint8Array(48), count: 0, blocked: false }
}
function pointSegmentDistance2(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
}
/** Plate AND leader bounds against the clipped union, with2px proxy plus3px layout margin. */
function touchesProxy(box: Rect, proxy: ScreenProxy): boolean {
  if (proxy.blocked) return true
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2
  const hx = (box.right - box.left) / 2, hy = (box.bottom - box.top) / 2
  for (let p = 0; p < proxy.count; p++) {
    const n = proxy.sizes[p], start = p * 18, a = proxy.points
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, distance2 = Infinity
    for (let i = 0; i < n; i++) {
      const x = a[start + i * 2], y = a[start + i * 2 + 1]
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    let separated = maxX < box.left || minX > box.right || maxY < box.top || minY > box.bottom
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = a[start + i * 2], ay = a[start + i * 2 + 1], bx = a[start + j * 2], by = a[start + j * 2 + 1]
      const nx = -(by - ay), ny = bx - ax
      let lo = Infinity, hi = -Infinity
      for (let k = 0; k < n; k++) { const v = nx * a[start + k * 2] + ny * a[start + k * 2 + 1]; lo = Math.min(lo, v); hi = Math.max(hi, v) }
      const mid = nx * cx + ny * cy, extent = Math.abs(nx) * hx + Math.abs(ny) * hy
      if (hi < mid - extent || lo > mid + extent) separated = true
      const dx = Math.max(box.left - ax, 0, ax - box.right), dy = Math.max(box.top - ay, 0, ay - box.bottom)
      distance2 = Math.min(distance2, dx * dx + dy * dy)
      for (let corner = 0; corner < 4; corner++) distance2 = Math.min(distance2,
        pointSegmentDistance2(corner & 1 ? box.right : box.left, corner & 2 ? box.bottom : box.top, ax, ay, bx, by))
    }
    if (!separated || distance2 < 25) return true
  }
  return false
}
export interface Candidate {
  id: string; bot: boolean; x: number; y: number; depth: number
  width: number; height: number; opacity: number; tick: boolean
  previous?: number
}
export interface Placement extends Rect { id: string; x: number; y: number; spot: number; opacity: number; tick: boolean }
export const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
export function touchesDisc(box: Rect, disc: Disc): boolean {
  if (disc.proxy) return touchesProxy(box, disc.proxy)
  const x = Math.max(box.left, Math.min(box.right, disc.x)), y = Math.max(box.top, Math.min(box.bottom, disc.y))
  return Math.hypot(x - disc.x, y - disc.y) < disc.radius + 3
}
export function appearance(distance: number, bot: boolean, presentation: boolean) {
  const far = bot ? 180 : 650, full = bot ? 45 : 140
  const fade = Math.max(0, Math.min(1, (far - distance) / (far - full)))
  return { opacity: fade * (bot ? .9 : .96), scale: presentation ? 1.25 : 1, tick: bot && distance > 100, visible: distance >= 0 && distance < far }
}
/** People are allocated first regardless of depth; bots yield every contested spot. */
export function placeNameplates(candidates: readonly Candidate[], discs: readonly Disc[], exclusions: readonly Rect[], width: number, height: number,
  terrainClear: (box: Rect, depth: number, candidate: Candidate) => boolean = () => true): Placement[] {
  const result: Placement[] = []
  const order = [...candidates].sort((a, b) => Number(a.bot) - Number(b.bot) || a.depth - b.depth || a.id.localeCompare(b.id))
  for (const c of order) {
    if (c.opacity <= 0 || c.depth <= 0 || !Number.isFinite(c.x + c.y + c.depth)) continue
    // Anchors behind HUD never send leaders across it. Leaders stay inside the reserved box.
    const spots = [[0, -12], [0, -32], [-c.width / 2 - 12, -12], [c.width / 2 + 12, -12]]
    const tries = [0, 1, 2, 3]
    if (c.previous !== undefined && Number.isInteger(c.previous) && c.previous >= 0 && c.previous < spots.length) {
      tries.splice(c.previous, 1)
      tries.unshift(c.previous)
    }
    for (const spot of tries) {
      const [dx, dy] = spots[spot], x = c.x + dx, y = c.y + dy - c.height
      const plate = { left: x - c.width / 2, top: y, right: x + c.width / 2, bottom: y + c.height }
      const bounds = { left: Math.min(plate.left, c.x) - 3, top: plate.top - 3, right: Math.max(plate.right, c.x) + 3, bottom: c.y + 3 }
      if (bounds.left < 8 || bounds.right > width - 8 || bounds.top < 8 || bounds.bottom > height - 8) continue
      if (result.some(b => overlaps(bounds, b))) continue
      // HUD and nearer vehicles are tested against what is drawn: the plate, and the leader's
      // own strip from the plate down to the anchor, not the empty corner beside the leader.
      const pad = { left: plate.left - 3, top: plate.top - 3, right: plate.right + 3, bottom: plate.bottom + 3 }
      const leader = { left: Math.min(x, c.x) - 3, top: plate.bottom, right: Math.max(x, c.x) + 3, bottom: c.y + 3 }
      if (exclusions.some(b => overlaps(pad, b) || overlaps(leader, b))) continue
      if (discs.some(d => d.id !== c.id && d.depth < c.depth && (touchesDisc(pad, d) || touchesDisc(leader, d)))) continue
      if (!terrainClear(plate, c.depth, c)) continue
      result.push({ ...bounds, id: c.id, x, y, spot, opacity: c.opacity, tick: c.tick }); break
    }
  }
  return result
}
