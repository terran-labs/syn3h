/**
 * Mist at the foot of every waterfall: one instanced sprite batch, one draw, animated wholly
 * on the GPU (no per particle work on the CPU). Each fall is drawn at its image nearest the
 * camera, worked out in the shader, so the batch needs no moving as the world wraps.
 *
 * The amount of mist follows the energy of the fall: particle count and plume size grow
 * with the square root of the drop height (the speed water reaches falling h metres is
 * sqrt(2 g h)).
 */
import * as THREE from 'three/webgpu'
import { attribute, float, fract, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl'
import { windDrift } from '../weather'

export interface Fall {
  /** Canonical tile position of the plunge pool. */
  x: number
  y: number
  z: number
  /** Height of the fall, metres. */
  height: number
}

/** Stable hash to [0, 1). */
function hash(i: number): number {
  let n = Math.imul(i + 1, 0x45d9f3b)
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

const LIFETIME = 5

export class WaterfallMist {
  private mesh: THREE.Mesh | null = null
  private falls: readonly Fall[] = []
  private readonly clock = uniform(0)
  private readonly wind = uniform(new THREE.Vector2())
  private readonly camera = uniform(new THREE.Vector2())
  private readonly tile = uniform(1)

  constructor(private readonly parent: THREE.Object3D) {}

  /** Replace the falls. `tileSize` is the world's wrap width. */
  set(falls: readonly Fall[], tileSize: number): void {
    this.tile.value = tileSize
    // A quality change retessellates the river but usually leaves its plunge pools
    // exactly where they were. Keep their submitted mesh and material on that path.
    if (falls.length === this.falls.length && falls.every((fall, i) => {
      const old = this.falls[i]
      return fall.x === old.x && fall.y === old.y && fall.z === old.z && fall.height === old.height
    })) return
    this.clear()
    this.falls = falls.map(fall => ({ ...fall }))
    const origins: number[] = []
    const settings: number[] = []
    const seeds: number[] = []
    falls.forEach((f, index) => {
      const energy = Math.sqrt(Math.max(1, f.height))
      const count = Math.min(64, Math.round(10 + energy * 6))
      for (let i = 0; i < count; i++) {
        origins.push(f.x, f.y, f.z)
        // Plume radius, rise height, opacity.
        settings.push(1.2 + energy * 0.7, 2 + energy * 1.2, Math.min(1, 0.25 + energy * 0.08))
        seeds.push(hash(index * 97 + i), hash(index * 97 + i + 50021))
      }
    })
    const count = seeds.length / 2
    if (!count) return
    const plane = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry().copy(plane as unknown as THREE.InstancedBufferGeometry)
    plane.dispose()
    geometry.instanceCount = count
    geometry.setAttribute('mistOrigin', new THREE.InstancedBufferAttribute(new Float32Array(origins), 3))
    geometry.setAttribute('mistSettings', new THREE.InstancedBufferAttribute(new Float32Array(settings), 3))
    geometry.setAttribute('mistSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2))
    const origin = attribute('mistOrigin', 'vec3')
    const config = attribute('mistSettings', 'vec3')
    const random = attribute('mistSeed', 'vec2')

    // The image of the fall nearest the camera.
    const shift = this.camera.sub(origin.xz).div(this.tile).round().mul(this.tile)
    const age = fract(this.clock.div(LIFETIME).add(random.x))
    const angle = random.y.mul(Math.PI * 2)
    // Billows out fast, then slows: radius grows as the square root of age.
    const radius = config.x.mul(age.sqrt()).mul(random.y.mul(0.6).add(0.4))
    const drift = this.wind.mul(age).mul(LIFETIME * 0.5)
    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
    material.positionNode = vec3(
      origin.x.add(shift.x).add(angle.cos().mul(radius)).add(drift.x),
      origin.y.add(age.mul(config.y)).add(0.4),
      origin.z.add(shift.y).add(angle.sin().mul(radius)).add(drift.y),
    )
    const size = config.x.mul(age.mul(1.4).add(0.6))
    material.scaleNode = vec2(size, size)
    const disc = float(1).sub(smoothstep(0.05, 0.5, uv().sub(0.5).length()))
    const fade = smoothstep(0, 0.15, age).mul(float(1).sub(smoothstep(0.4, 1, age)))
    material.opacityNode = disc.mul(fade).mul(config.z).mul(0.32)
    material.colorNode = vec3(0.93, 0.97, 1)
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    this.mesh.name = 'waterfall-mist'
    this.parent.add(this.mesh)
  }

  private readonly drift = { x: 0, y: 0, z: 0 }

  update(dt: number, cameraX: number, cameraZ: number, cameraY = 0): void {
    this.clock.value += dt
    // The wind where the camera is: mist is only seen nearby, and one sample keeps it one draw.
    windDrift(cameraX, cameraY, cameraZ, this.drift)
    this.wind.value.set(this.drift.x, this.drift.z)
    this.camera.value.set(cameraX, cameraZ)
  }

  clear(): void {
    this.falls = []
    if (!this.mesh) return
    this.parent.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh = null
  }
}

/** Falls from the river data: the foot of the steepest stretch of every drop. */
export function fallsFromRivers(rivers: readonly { points: readonly { x: number; y: number; z: number }[]; drops?: readonly { height: number; steepest?: { start: number; end: number; height: number } }[] }[]): Fall[] {
  const falls: Fall[] = []
  for (const r of rivers) {
    for (const d of r.drops ?? []) {
      const s = d.steepest
      if (!s) continue
      const foot = r.points[Math.min(r.points.length - 1, s.end)]
      falls.push({ x: foot.x, y: foot.y, z: foot.z, height: s.height })
    }
  }
  return falls
}
