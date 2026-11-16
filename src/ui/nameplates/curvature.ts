import { Vector3, Vector4, WebGLCoordinateSystem, WebGPUCoordinateSystem, type PerspectiveCamera } from 'three/webgpu'
import { curveOffsetAt } from '../../world/curve'
import { wrappedOccluded, type Point } from './occlusion'
import { createScreenProxy, type Disc } from './layout'

/** CPU curve mapping using the snapshot the render uses; not a GPU raster certificate. */
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

// Module-static topology:26 boundary grid points, six2x2 faces, two triangles per cell.
const GRID: readonly [number, number, number][] = (() => {
  const points: [number, number, number][] = []
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) points.push([x, y, z])
  return points
})()
const FACES: readonly number[] = (() => {
  const triangles: number[] = []
  for (let axis = 0; axis < 3; axis++) for (const side of [-1, 1]) for (let u = -1; u < 1; u++) for (let v = -1; v < 1; v++) {
    const index = (a: number, b: number) => GRID.findIndex(p => p[axis] === side && p[(axis + 1) % 3] === a && p[(axis + 2) % 3] === b)
    const a = index(u, v), b = index(u + 1, v), c = index(u + 1, v + 1), d = index(u, v + 1)
    triangles.push(a, b, c, a, c, d)
  }
  return triangles
})()
/** A declared triangulated cube proxy, not exact rendered hull occupancy or universal curve containment. */
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
  private readonly clipPoints = Array.from({ length: 26 }, () => new Vector4())
  // A triangle clipped by six halfspaces has at most9 vertices. One spare avoids writes past a cap.
  private readonly clipA = Array.from({ length: 10 }, () => new Vector4())
  private readonly clipB = Array.from({ length: 10 }, () => new Vector4())
  private block(out: Disc): void { out.proxy!.count = 0; out.proxy!.blocked = true; out.depth = 0 }
  private plane(p: Vector4, plane: number, negativeOneToOne: boolean): number {
    switch (plane) {
      case 0: return p.w + p.x
      case 1: return p.w - p.x
      case 2: return p.w + p.y
      case 3: return p.w - p.y
      case 4: return negativeOneToOne ? p.w + p.z : p.z
      default: return p.w - p.z
    }
  }
  envelope(center: Point, radius: number, bend: Vector3, camera: PerspectiveCamera, width: number, height: number, out: Disc): void {
    const proxy = out.proxy ??= createScreenProxy()
    proxy.count = 0; proxy.blocked = false
    const screen = this.project(center, bend, camera, width, height, this.sample)
    out.x = Number.isFinite(screen.x) ? screen.x : 0; out.y = Number.isFinite(screen.y) ? screen.y : 0
    out.depth = 0; out.radius = 2 // Diagnostic only; placement consumes proxy polygons.
    if (!Number.isFinite(center.x + center.y + center.z + radius + bend.x + bend.y + bend.z + width + height) || radius < 0 || width <= 0 || height <= 0 ||
      camera.coordinateSystem !== WebGLCoordinateSystem && camera.coordinateSystem !== WebGPUCoordinateSystem) { this.block(out); return }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minDepth = Infinity, maxDepth = -Infinity
    for (let i = 0; i < GRID.length; i++) {
      const g = GRID[i]
      this.sample.set(center.x + g[0] * radius, center.y + g[1] * radius, center.z + g[2] * radius)
      bendPoint(this.sample, bend, this.point)
      this.view.copy(this.point).applyMatrix4(camera.matrixWorldInverse)
      const depth = -this.view.z
      minX = Math.min(minX, this.view.x); maxX = Math.max(maxX, this.view.x)
      minY = Math.min(minY, this.view.y); maxY = Math.max(maxY, this.view.y)
      minDepth = Math.min(minDepth, depth); maxDepth = Math.max(maxDepth, depth)
      const clip = this.clipPoints[i].set(this.view.x, this.view.y, this.view.z, 1).applyMatrix4(camera.projectionMatrix)
      if (!Number.isFinite(clip.x) || !Number.isFinite(clip.y) || !Number.isFinite(clip.z) || !Number.isFinite(clip.w) || !Number.isFinite(depth)) { this.block(out); return }
    }
    out.depth = minDepth
    if (maxDepth <= 0) return
    // A camera within the proxy's view-space AABB is ambiguous: keep conservative blocking.
    // This includes genuine enclosed cameras without requiring fragile boundary parity tests.
    if (minX <= 0 && maxX >= 0 && minY <= 0 && maxY >= 0 && minDepth <= 0 && maxDepth >= 0) { this.block(out); return }
    const negativeOneToOne = camera.coordinateSystem === WebGLCoordinateSystem && !camera.reversedDepth
    for (let t = 0; t < FACES.length; t += 3) {
      let input = this.clipA, output = this.clipB, n = 3
      for (let k = 0; k < 3; k++) input[k].copy(this.clipPoints[FACES[t + k]])
      for (let plane = 0; plane < 6 && n; plane++) {
        let count = 0
        for (let i = 0; i < n; i++) {
          const a = input[i], b = input[(i + 1) % n], da = this.plane(a, plane, negativeOneToOne), db = this.plane(b, plane, negativeOneToOne)
          if (da >= 0) { if (count >= 9) { this.block(out); return }; output[count++].copy(a) }
          if (da > 0 && db < 0 || da < 0 && db > 0) {
            const alpha = da / (da - db)
            if (!Number.isFinite(alpha) || count >= 9) { this.block(out); return }
            output[count++].copy(a).lerp(b, alpha)
          }
        }
        n = count; const swap = input; input = output; output = swap
      }
      if (!n) continue
      if (proxy.count >= 48) { this.block(out); return }
      const start = proxy.count * 18
      for (let i = 0; i < n; i++) {
        const p = input[i]
        if (!(p.w > 0)) { this.block(out); return }
        const x = (p.x / p.w + 1) * width / 2, y = (1 - p.y / p.w) * height / 2
        if (!Number.isFinite(x + y)) { this.block(out); return }
        proxy.points[start + i * 2] = x; proxy.points[start + i * 2 + 1] = y
        out.radius = Math.max(out.radius, Math.hypot(x - out.x, y - out.y) + 2)
      }
      proxy.sizes[proxy.count++] = n
    }
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
