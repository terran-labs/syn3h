import * as THREE from 'three/webgpu'
import { float, materialColor, mix, sin, smoothstep, time, uv, vec3 } from 'three/tsl'

type Point = { x: number; y: number; z: number }

/** A horizontal launch under gravity, joining the lip to the receiving stream.
 * Reject shallow runs, impossible launch speeds and arcs that cut through a bank.
 * Terrain and liquid queries remain unchanged: this is a thin visual sheet above a cascade.
 */
export function buildFallSheet(
  ground: { heightAt(x: number, z: number): number },
  lip: Point, foot: Point, width: number, gravity: number, maxSpeed: number,
): THREE.BufferGeometry | null {
  const dx = foot.x - lip.x, dz = foot.z - lip.z
  const run = Math.hypot(dx, dz), drop = lip.y - foot.y
  if (![run, drop, width, gravity, maxSpeed].every(Number.isFinite) ||
      run < .1 || drop < 2 || drop / run < .8 || width <= 0 || gravity <= 0) return null
  const duration = Math.sqrt(2 * drop / gravity)
  if (run / duration > maxSpeed) return null
  const sx = -dz / run, sz = dx / run
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  const segments = Math.min(32, Math.max(8, Math.ceil(drop)))
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const x = lip.x + dx * t, z = lip.z + dz * t, y = lip.y - drop * t * t
    // A slight narrowing suggests acceleration without opening holes at either end.
    const half = width * .5 * (1 - .2 * Math.sin(Math.PI * t))
    for (const sign of [-1, 1]) {
      const px = x + sx * half * sign, pz = z + sz * half * sign
      if (i > 0 && i < segments && ground.heightAt(px, pz) > y - .05) return null
      positions.push(px, y + .04, pz)
      uvs.push((sign + 1) / 2, t * duration)
    }
    if (i < segments) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.name = 'waterfall-sheet'
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Procedural streaks move in flight-time coordinates, accelerating as the sheet falls. */
export function createFallMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: .3 })
  const p = uv(), travel = p.y.sub(time)
  const streak = sin(p.x.mul(75).add(sin(travel.mul(13)))).mul(.5).add(.5)
  const foam = smoothstep(.35, .85, streak.add(sin(travel.mul(24).add(p.x.mul(17))).mul(.15)))
  material.colorNode = mix(materialColor.rgb, vec3(.86, .96, 1), foam)
  const edge = smoothstep(0, .12, p.x).mul(float(1).sub(smoothstep(.88, 1, p.x)))
  material.opacityNode = edge.mul(foam.mul(.35).add(.5))
  return material
}
