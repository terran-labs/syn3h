/** Visual ground contact only. The spring still connects its two original endpoints. */
import { curveFactor } from '../../world/curve'

export interface CordSurface {
  heightAt(x: number, z: number): number
  /** Base terrain grid, including its origin. Coarser LOD edges lie on the same lattice. */
  cellSize(): number
  origin(): number
}
interface Point { x: number; y: number; z: number }
export const CORD_CLEARANCE = 0.16

/**
 * Lift existing vertices, never add any. Checking grid/diagonal crossings catches crests
 * between ribbon vertices, including coarse terrain triangles and the wrapped tile edge.
 * Extra metre samples cover liquid waves. Lift interior vertices enough for the whole
 * intervening segment to clear. Valid endpoints stay at their original positions;
 * clearance ramps from their available clearance to the interior clearance.
 * Returns false for buried endpoints or two-point spans: these use the prior
 * visual-clearance fallback, which may lift DRAWN endpoints. Physical attachments
 * are not inputs here and never move; exact attachment is not certified in fallback.
 * The GPU bends vertices into planet chords, so include their sagitta in the clearance.
 */
export function drapeCord(points: readonly Point[], count: number, surface: CordSurface): boolean {
  if (count < 2) return false
  const first = points[0], last = points[count - 1]
  const firstGap = first.y - surface.heightAt(first.x, first.z)
  const lastGap = last.y - surface.heightAt(last.x, last.z)
  // Callers draw the returned points even if they ignore the boolean. Never leave
  // raw sag below terrain on incompatibility: retain the earlier visual fallback.
  // Only supported spans promise both clearance and unchanged drawn attachments.
  const preserveContacts = count > 2 && firstGap >= 0 && lastGap >= 0
  const firstClearance = preserveContacts ? Math.min(CORD_CLEARANCE, firstGap) : CORD_CLEARANCE
  const lastClearance = preserveContacts ? Math.min(CORD_CLEARANCE, lastGap) : CORD_CLEARANCE
  const clearanceAt = (i: number) => i === 0 ? firstClearance : i === count - 1 ? lastClearance : CORD_CLEARANCE
  let supported = preserveContacts
  const cell = Math.max(0.01, surface.cellSize())
  const origin = surface.origin()
  for (let i = preserveContacts ? 1 : 0; i < (preserveContacts ? count - 1 : count); i++) {
    const p = points[i]
    p.y = Math.max(p.y, surface.heightAt(p.x, p.z) + clearanceAt(i))
  }
  for (let i = 1; i < count; i++) {
    const a = points[i - 1], b = points[i]
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y
    let lift = 0
    const invR = curveFactor()
    const bend = (dx * dx + dz * dz) * invR * (1 + Math.max(0, a.y, b.y) * invR) / 8
    const pinA = i === 1 && count > 2
    const pinB = i === count - 1 && count > 2
    const ca = clearanceAt(i - 1), cb = clearanceAt(i)
    const check = (t: number) => {
      // Exactly the same linear clearance profile as at the vertices. A fixed
      // clearance beside a zero-clearance contact would create deficit/share spikes.
      const floor = surface.heightAt(a.x + dx * t, a.z + dz * t) + ca + (cb - ca) * t
      const deficit = floor + 4 * t * (1 - t) * bend - (a.y + dy * t)
      // Keep a clear hitch/anchor connected. Lift its neighboring interior vertex instead.
      const share = pinA && pinB ? 0 : pinA ? t : pinB ? 1 - t : 1
      if (share > 1e-8) lift = Math.max(lift, deficit / share)
      else if (deficit > 1e-8) supported = false
    }
    const crossings = (start: number, end: number, offset: number) => {
      if (Math.abs(end - start) < 1e-8) return
      const first = Math.ceil((Math.min(start, end) - offset) / cell)
      const last = Math.floor((Math.max(start, end) - offset) / cell)
      for (let k = first; k <= last; k++) {
        const t = (offset + k * cell - start) / (end - start)
        check(t)
        // Two adjacent chunks can choose different LODs and meet with a height step.
        check(Math.max(0, t - 1e-7)); check(Math.min(1, t + 1e-7))
      }
    }
    check(0); check(1)
    crossings(a.x, b.x, origin)
    crossings(a.z, b.z, origin)
    crossings(a.x + a.z, b.x + b.z, 2 * origin)
    const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz)))
    for (let k = 1; k < samples; k++) check(k / samples)
    if (!pinA) a.y += lift
    if (!pinB) b.y += lift
  }
  return supported
}
