import { Vector3, type PerspectiveCamera } from 'three/webgpu'
import { curveOffsetAt } from '../../world/curve'
import { wrappedOccluded, type Point } from './occlusion'
import type { Disc } from './layout'

/** The exact CPU counterpart of applyCurve, using the snapshot the render uses. */
export function bendPoint(point: Point, bend: Vector3, out: Vector3): Vector3 {
  const x = point.x, y = point.y, z = point.z
  curveOffsetAt(bend, x, y, z, out)
  out.x += x; out.y += y; out.z += z
  return out
}
/** Inverse on the visible sphere branch. The collapsed far pole has no unique inverse. */
export function unbendPoint(point: Point, bend: Vector3, out: Point): boolean {
  if (!(bend.z > 0)) { Object.assign(out, point); return true }
  const R = 1 / bend.z, x = point.x - bend.x, z = point.z - bend.y, y = point.y + R
  const along = Math.hypot(x, z), radial = Math.hypot(along, y)
  if (radial < 1e-7 || along < 1e-7 && y < 0) return false
  const angle = Math.atan2(along, y)
  if (angle >= Math.PI - 1e-6) return false
  const scale = along > 1e-7 ? R * angle / along : 1
  out.x = bend.x + x * scale; out.z = bend.y + z * scale; out.y = radial - R
  return Number.isFinite(out.x + out.y + out.z)
}

/** Pooled scratch for curved center, anchor and conservative hull-disc projection. */
export class CurvedProjection {
  private readonly point = new Vector3()
  private readonly sample = new Vector3()
  private readonly projected = new Vector3()
  private readonly view = new Vector3()
  project(point: Point, bend: Vector3, camera: PerspectiveCamera, width: number, height: number, out: Point): Point {
    bendPoint(point, bend, this.point)
    this.view.copy(this.point).applyMatrix4(camera.matrixWorldInverse)
    this.projected.copy(this.point).project(camera)
    out.x = (this.projected.x + 1) * width / 2; out.y = (1 - this.projected.y) * height / 2; out.z = -this.view.z
    return out
  }
  envelope(center: Point, radius: number, bend: Vector3, camera: PerspectiveCamera, width: number, height: number, out: Disc): void {
    const screen = this.project(center, bend, camera, width, height, this.sample)
    out.x = screen.x; out.y = screen.y; out.depth = screen.z; out.radius = 0
    // Corners and face centres enclose the rough hull. Bending changes both its apparent
    // height and scale; radius*focal/flatDepth is wrong at distance on a curved planet.
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue
      this.sample.set(center.x + x * radius, center.y + y * radius, center.z + z * radius)
      this.project(this.sample, bend, camera, width, height, this.sample)
      out.depth = Math.min(out.depth, this.sample.z)
      out.radius = Math.max(out.radius, this.sample.z <= camera.near ? Math.hypot(width, height) : Math.hypot(this.sample.x - out.x, this.sample.y - out.y))
    }
    out.radius += 2
  }
}

/**
 * A straight visual ray becomes a curved path in flat physics space. Approximate that path
 * with short chords, then split each chord at wrap seams before the terrain-only ray query.
 * Do NOT pass bent screen points directly into the flat Rapier world.
 *
 * This is bounded CPU visibility, not a depth-buffer read: midpoint deviation <=0.10 m,
 * visual segments <=32 m, maximum 128 segments. Failure to resolve hides the label. Narrow
 * terrain features between chords and unsampled plate pixels remain a documented limitation.
 */
export function curvedTerrainOccluded(from: Point, to: Point, bend: Vector3, size: number,
  hit: (a: Point, b: Point) => boolean): boolean {
  if (!(bend.z > 0)) return wrappedOccluded(from, to, size, hit)
  const flatA = { x: 0, y: 0, z: 0 }, flatB = { x: 0, y: 0, z: 0 }
  if (!unbendPoint(from, bend, flatA) || !unbendPoint(to, bend, flatB)) return true
  let segments = 0
  const trace = (a: Point, b: Point, fa: Point, fb: Point, level: number): boolean => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, fm = { x: 0, y: 0, z: 0 }
    if (!unbendPoint(mid, bend, fm)) return true
    const error = Math.hypot(fm.x - (fa.x + fb.x) / 2, fm.y - (fa.y + fb.y) / 2, fm.z - (fa.z + fb.z) / 2)
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    if (error > .10 || length > 32) {
      if (level >= 7) return true
      return trace(a, mid, fa, fm, level + 1) || trace(mid, b, fm, fb, level + 1)
    }
    if (++segments > 128) return true
    return wrappedOccluded(fa, fb, size, hit)
  }
  return trace(from, to, flatA, flatB, 0)
}
