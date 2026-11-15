/**
 * Draws the liquids and fire the generator planned: the sea out to the horizon, the lake at
 * the centre, the rivers and their pools, and the flame, ember and smoke vents.
 *
 * Everything is read from `data.lava` and `data.vents`, so what is drawn is exactly what
 * `liquidHeightAt` reports and what vehicles float in. Rebuilt whenever the terrain
 * regenerates. The sea is lava or water by `world.seaKind`; the lake and rivers are lava on
 * volcanic worlds and water elsewhere. The lava look and the particles live in src/fx.
 */
import * as THREE from 'three/webgpu'
import { attribute, cameraPosition, cameraViewMatrix, normalize, color, float, mix, mx_noise_float, positionWorld, smoothstep, time, uniform, vec3 } from 'three/tsl'
import { worldLavaAltitude } from '../../../shared/params'
import type { System } from '../../core/Game'
import { Emitters } from '../../fx/Emitters'
import { buildRibbonGeometry } from '../../fx/LavaFlow'
import { createLavaMaterial } from '../../fx/material'
import type { TerrainData } from './generate'
import type { HeightSampler } from './sampler'
import { KIND_VOLCANIC, worldSeaKind } from './settings'

interface Liquid {
  material: THREE.Material
  update(dt: number, level?: number, exposureDim?: number): void
}

/**
 * Water. Lit by the sun and sky like the ground, so it darkens at night. With `shore`, the
 * mesh carries the ground height under each vertex: shallows are turquoise, deep water is
 * navy, and a line of foam follows the coast.
 */
function createWaterMaterial(shore: boolean): Liquid {
  const level = uniform(0)
  const p = positionWorld
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.14, metalness: 0, side: THREE.DoubleSide })
  // The surface is flat: light it as facing straight up, whatever the mesh winding.
  material.normalNode = normalize(cameraViewMatrix.transformDirection(vec3(0, 1, 0)))
  const drift = time.mul(0.25)
  const swell = mx_noise_float(vec3(p.x.mul(0.035), p.z.mul(0.035), drift))
  const ripple = mx_noise_float(vec3(p.x.mul(0.22), p.z.mul(0.22), drift.mul(2.2)))
  // Ripples fade with distance, where they would shimmer.
  const near = smoothstep(500, 60, p.sub(cameraPosition).length())
  const shade = swell.mul(0.1).add(ripple.mul(0.08).mul(near)).add(1)
  if (shore) {
    const depth = level.sub(attribute<'float'>('groundHeight', 'float'))
    const water = mix(color(0x2fc4bd), color(0x0a3562), smoothstep(0.5, 22, depth))
    const foam = smoothstep(1.3, 0.15, depth.add(ripple.mul(0.5))).mul(smoothstep(-0.6, 0.1, depth))
    material.colorNode = mix(water.mul(shade), color(0xf4fbff), foam.mul(0.85))
  } else {
    material.colorNode = mix(color(0x1f8fa6), color(0x135f86), swell.mul(0.5).add(0.5)).mul(shade)
  }
  material.roughnessNode = float(0.14).add(ripple.mul(0.05))
  return { material, update(_dt, l = 0) { level.value = l } }
}

/** How far past the simulated square the sea is drawn. Beyond the fog in every direction. */
const SEA_REACH = 24000
/** Sea grid resolution over the island: fine enough for the glowing shoreline to follow the coast. */
const SEA_SEGMENTS = 192

type Ground = { size: number; heightAt(x: number, z: number): number }

/**
 * The sea: a grid over the simulated square carrying the ground height under each vertex
 * (the lava material brightens where the two meet, which draws the glowing shoreline), with
 * a wide apron round it that reaches the horizon.
 */
function seaGeometry(ground: Ground): THREE.BufferGeometry {
  const half = ground.size / 2
  const n = SEA_SEGMENTS
  const positions: number[] = []
  const uvs: number[] = []
  const depth: number[] = []
  const index: number[] = []
  const push = (x: number, z: number, g: number) => {
    positions.push(x, 0, z)
    // The lava pattern is in world metres, so it does not swim when the sea level moves.
    uvs.push(x, z)
    depth.push(g)
    return positions.length / 3 - 1
  }
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const x = -half + (ix / n) * ground.size
      const z = -half + (iz / n) * ground.size
      push(x, z, ground.heightAt(x, z))
    }
  }
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * (n + 1) + ix
      index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2)
    }
  }
  // Apron: four trapezoids from the edge of the grid out to the horizon. Deep everywhere.
  const far = half + SEA_REACH
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k]
    const [bx, bz] = corners[(k + 1) % 4]
    const a = push(ax * half, az * half, -100)
    const b = push(bx * half, bz * half, -100)
    const c = push(bx * far, bz * far, -100)
    const d = push(ax * far, az * far, -100)
    index.push(a, d, b, b, d, c)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('groundHeight', new THREE.Float32BufferAttribute(depth, 1))
  geometry.setIndex(index)
  return geometry
}

/** A flat disc of lava with its pattern in world metres. */
function discGeometry(x: number, y: number, z: number, radius: number): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(radius, 40)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(x, y, z)
  const pos = geometry.attributes.position
  const uv = geometry.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i))
  return geometry
}

export class Volcanics implements System {
  private readonly group = new THREE.Group()
  // Both looks of the sea are built once and swapped, so changing the sea is instant.
  private readonly lavaSea: Liquid = createLavaMaterial(false, true, true)
  private readonly waterSea: Liquid = createWaterMaterial(true)
  private readonly lavaStill: Liquid = createLavaMaterial(false, false)
  private readonly lavaRiver: Liquid = createLavaMaterial(true)
  private readonly waterStill: Liquid = createWaterMaterial(false)
  private seaMesh: THREE.Mesh | null = null
  private readonly meshes: THREE.Mesh[] = []
  private readonly emitters: Emitters

  /**
   * `exposure` reports the camera exposure in use (it rises at night) and `dayExposure` the
   * daytime value, so the lava can hold its brightness on screen as the exposure climbs.
   */
  constructor(
    private readonly scene: THREE.Scene, private readonly sampler: HeightSampler,
    private readonly exposure: () => number = () => 1, private readonly dayExposure: () => number = () => 1,
  ) {
    this.group.name = 'volcanics'
    scene.add(this.group)
    this.emitters = new Emitters(scene)
    this.rebuild()
  }

  /** True when the sea is lava (world.seaKind 0). */
  get seaIsLava(): boolean {
    return worldSeaKind.value === 0
  }

  /** True when the lake, rivers and pools are lava: only on volcanic worlds. */
  get flowsAreLava(): boolean {
    return this.sampler.data.settings.kind === KIND_VOLCANIC
  }

  /** Throw away and rebuild everything for the terrain data the sampler now holds. */
  rebuild(): void {
    this.clear()
    const data: TerrainData = this.sampler.data
    const ground: Ground = { size: data.size, heightAt: (x, z) => this.sampler.heightAt(x, z) }

    this.seaMesh = new THREE.Mesh(seaGeometry(ground), (this.seaIsLava ? this.lavaSea : this.waterSea).material)
    this.seaMesh.frustumCulled = false
    this.group.add(this.seaMesh)

    const lava = data.lava
    const hot = this.flowsAreLava
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry, material)
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    const still = (hot ? this.lavaStill : this.waterStill).material
    if (lava.lake) add(discGeometry(lava.lake.x, lava.lake.surface, lava.lake.z, lava.lake.radius), still)
    for (const p of lava.pools) add(discGeometry(p.x, p.surface, p.z, p.radius), still)
    for (const r of lava.rivers) {
      if (r.points.length < 2) continue
      // A little wider than the planned surface so the ribbon tucks into the channel banks.
      add(buildRibbonGeometry(ground, r.points, r.width + 1.5), (hot ? this.lavaRiver : this.waterStill).material)
    }
    for (const v of data.vents) {
      this.emitters.addVent(
        { x: v.x, y: v.y + 0.3, z: v.z },
        {
          kind: v.kind,
          radius: v.kind === 'embers' ? Math.max(0.6, v.size * 0.4) : v.size * 0.5,
          height: v.kind === 'smoke' ? 14 + v.size * 3 : 6 + v.size * 1.5,
          intensity: 1,
        },
      )
    }
  }

  update(dt: number): void {
    const level = worldLavaAltitude.value
    if (this.seaMesh) {
      this.seaMesh.position.y = level
      // The sea kind is a live slider: swap the look the moment it changes.
      const want = (this.seaIsLava ? this.lavaSea : this.waterSea).material
      if (this.seaMesh.material !== want) this.seaMesh.material = want
    }
    // Hold lava at roughly its daytime brightness on screen, letting a little of the extra
    // exposure through so it still reads as the brightest thing at night.
    const over = this.exposure() / Math.max(1e-3, this.dayExposure())
    const dim = over > 1 ? 1 / (over * 0.8 + 0.2) : 1
    this.lavaSea.update(dt, level, dim)
    this.waterSea.update(dt, level)
    this.lavaStill.update(dt, 0, dim)
    this.lavaRiver.update(dt, 0, dim)
    this.emitters.update(dt)
  }

  private clear(): void {
    if (this.seaMesh) {
      this.group.remove(this.seaMesh)
      this.seaMesh.geometry.dispose()
      this.seaMesh = null
    }
    for (const m of this.meshes) {
      this.group.remove(m)
      m.geometry.dispose()
    }
    this.meshes.length = 0
    this.emitters.clear()
  }

  dispose(): void {
    this.clear()
    this.emitters.dispose()
    this.scene.remove(this.group)
    for (const l of [this.lavaSea, this.waterSea, this.lavaStill, this.lavaRiver, this.waterStill]) l.material.dispose()
  }
}
