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
  /** Shown last frame, in slot `previous`. */
  held?: boolean
}
export interface Placement extends Rect { id: string; x: number; y: number; leadX: number; leadY: number; spot: number; opacity: number; tick: boolean }
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
/** A HUD area. Soft areas are passive readouts a label may cover when nothing else is free. */
export interface Exclusion extends Rect { soft?: boolean }
/** The longest leader drawn, in pixels. A long diagonal reads worse than a tight side label. */
export const LEADER_MAX = 60
/** A label shown last frame keeps its slot until a blocker is this many pixels inside it. */
export const HOLD_SLACK = 4
/** Where a plate sits in slot `spot` (0 above, 1 higher above, 2 left, 3 right), and where its leader leaves it. */
export interface Slot { x: number; y: number; leadX: number; leadY: number }
export function slotAt(c: Candidate, spot: number, out: Slot): Slot {
  const dx = spot === 2 ? -c.width / 2 - 12 : spot === 3 ? c.width / 2 + 12 : 0, dy = spot === 1 ? -32 : -12
  out.x = c.x + dx; out.y = c.y + dy - c.height
  // The leader leaves the point of the plate's lower edge nearest the anchor.
  out.leadX = Math.max(out.x - c.width / 2 + 6, Math.min(out.x + c.width / 2 - 6, c.x)); out.leadY = out.y + c.height
  return out
}
const inset = (r: Rect, by: number): Rect => ({ left: r.left + by, top: r.top + by, right: r.right - by, bottom: r.bottom - by })
/**
 * People are allocated first regardless of depth; bots yield every contested spot. Slots, in
 * order of leader length: directly above, beside (the leader leaves the plate's near corner),
 * then higher above. The slot held last frame is tried first. A label never covers a hard HUD
 * area; it covers a soft one only when every slot clear of soft areas is taken.
 */
const scratch: Slot = { x: 0, y: 0, leadX: 0, leadY: 0 }
export function placeNameplates(candidates: readonly Candidate[], discs: readonly Disc[], exclusions: readonly Exclusion[], width: number, height: number,
  terrainClear: (box: Rect, depth: number, candidate: Candidate) => boolean = () => true): Placement[] {
  const result: Placement[] = []
  const order = [...candidates].sort((a, b) => Number(a.bot) - Number(b.bot) || a.depth - b.depth || a.id.localeCompare(b.id))
  for (const c of order) {
    if (c.opacity <= 0 || c.depth <= 0 || !Number.isFinite(c.x + c.y + c.depth)) continue
    // Slots, tried in order of leader length: above, left, right, higher above.
    let tries = [0, 2, 3, 1]
    if (c.previous !== undefined && Number.isInteger(c.previous) && c.previous >= 0 && c.previous < 4) {
      tries.splice(tries.indexOf(c.previous), 1)
      tries.unshift(c.previous)
    }
    let placed: Placement | undefined
    for (const avoidSoft of [true, false]) {
      // The second pass retries only slots that a soft area alone ruled out.
      const softOnly: number[] = []
      for (const spot of tries) {
        const { x, y, leadX, leadY } = slotAt(c, spot, scratch)
        const plate = { left: x - c.width / 2, top: y, right: x + c.width / 2, bottom: y + c.height }
        if (Math.hypot(c.x - leadX, c.y - leadY) > LEADER_MAX) continue
        const bounds = { left: Math.min(plate.left, c.x) - 3, top: plate.top - 3, right: Math.max(plate.right, c.x) + 3, bottom: c.y + 3 }
        if (bounds.left < 8 || bounds.right > width - 8 || bounds.top < 8 || bounds.bottom > height - 8) continue
        if (result.some(b => overlaps(bounds, b))) continue
        // HUD and nearer vehicles are tested against what is drawn: the plate and the leader's
        // own strip. A label already holding this slot gets HOLD_SLACK so it does not flicker.
        const slack = spot === c.previous && c.held ? HOLD_SLACK : 0
        const pad = inset({ left: plate.left - 3, top: plate.top - 3, right: plate.right + 3, bottom: plate.bottom + 3 }, slack)
        const leader = inset({ left: Math.min(leadX, c.x) - 3, top: leadY, right: Math.max(leadX, c.x) + 3, bottom: c.y + 3 }, slack)
        const covers = (b: Rect) => overlaps(pad, b) || overlaps(leader, b)
        if (exclusions.some(b => !b.soft && covers(b))) continue
        if (avoidSoft && exclusions.some(b => b.soft && covers(b))) { softOnly.push(spot); continue }
        if (discs.some(d => d.id !== c.id && d.depth < c.depth && (touchesDisc(pad, d) || touchesDisc(leader, d)))) continue
        if (!terrainClear(plate, c.depth, c)) continue
        placed = { ...bounds, id: c.id, x, y, leadX, leadY, spot, opacity: c.opacity, tick: c.tick }; break
      }
      if (placed || !softOnly.length) break
      tries = softOnly
    }
    if (placed) result.push(placed)
  }
  return result
}
