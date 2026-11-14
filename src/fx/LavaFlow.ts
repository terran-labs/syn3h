import { BufferGeometry, Float32BufferAttribute, Mesh, Scene, Vector3 } from 'three/webgpu'
import type { System } from '../core/Game'
import type { Terrain } from '../world/Terrain'
import { createLavaMaterial } from './material'
type Ground = Pick<Terrain, 'heightAt' | 'size'>
export interface TraceOptions { step?: number; maxSteps?: number; stopHeight?: number }
/** Gradient descent with backtracking never climbs or leaves the terrain. No random tie breaks. */
export function traceDownhill(terrain: Ground, start: { x: number; z: number }, options: TraceOptions = {}): Vector3[] {
  const step = options.step ?? 2, count = options.maxSteps ?? 256
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(count) || count < 0) throw new Error('Invalid trace options')
  const half = terrain.size / 2
  let x = Math.max(-half, Math.min(half, start.x)), z = Math.max(-half, Math.min(half, start.z))
  const path = [new Vector3(x, terrain.heightAt(x, z), z)]
  for (let i = 0; i < count; i++) {
    const h = terrain.heightAt(x, z)
    if (h <= (options.stopHeight ?? -Infinity)) break
    const e = step / 4
    const dx = terrain.heightAt(Math.max(-half, x - e), z) - terrain.heightAt(Math.min(half, x + e), z)
    const dz = terrain.heightAt(x, Math.max(-half, z - e)) - terrain.heightAt(x, Math.min(half, z + e))
    const length = Math.hypot(dx, dz)
    if (length < 1e-8) break
    let accepted = false
    for (let s = step; s >= step / 64; s /= 2) {
      const nx = Math.max(-half, Math.min(half, x + dx / length * s))
      const nz = Math.max(-half, Math.min(half, z + dz / length * s))
      const nh = terrain.heightAt(nx, nz)
      if (nh < h - 1e-7) { x = nx; z = nz; path.push(new Vector3(x, nh, z)); accepted = true; break }
    }
    if (!accepted) break
  }
  return path
}
/** Two vertices per input point. UV metres follow the path so flow always travels downstream. */
export function buildRibbonGeometry(terrain: Ground, path: readonly { x: number; z: number }[], width: number, lift = 0.15): BufferGeometry {
  if (path.length < 2 || !Number.isFinite(width) || width <= 0) throw new Error('Ribbon needs two points and positive width')
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  let distance = 0
  path.forEach((p, i) => {
    const previous = path[Math.max(0, i - 1)], next = path[Math.min(path.length - 1, i + 1)]
    const dx = next.x - previous.x, dz = next.z - previous.z, length = Math.hypot(dx, dz) || 1
    if (i) distance += Math.hypot(p.x - previous.x, p.z - previous.z)
    for (const side of [-1, 1]) {
      const x = p.x - dz / length * width / 2 * side, z = p.z + dx / length * width / 2 * side
      positions.push(x, terrain.heightAt(x, z) + lift, z); uvs.push(side * width / 2, distance)
    }
    if (i) { const a = (i - 1) * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices)
  geometry.computeVertexNormals(); geometry.computeBoundingSphere()
  return geometry
}
export class LavaFlow implements System {
  readonly mesh: Mesh
  private readonly shader = createLavaMaterial(true)
  constructor(private readonly scene: Scene, terrain: Ground, path: readonly { x: number; z: number }[], width: number) {
    this.mesh = new Mesh(buildRibbonGeometry(terrain, path, width), this.shader.material); scene.add(this.mesh)
  }
  update(dt: number) { this.shader.update(dt) }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.shader.material.dispose() }
}
