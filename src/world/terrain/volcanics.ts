/**
 * Draws the liquids and fire the generator planned: the sea out to the horizon, the lake in
 * the caldera, the lava rivers and their pools, and the flame, ember and smoke vents.
 *
 * Everything is read from `data.lava` and `data.vents`, so what is drawn is exactly what
 * `liquidHeightAt` reports and what vehicles float in. Rebuilt whenever the terrain
 * regenerates. The effects themselves live in src/fx.
 */
import * as THREE from 'three/webgpu'
import { worldLavaAltitude } from '../../../shared/params'
import type { System } from '../../core/Game'
import { Emitters } from '../../fx/Emitters'
import { LavaFlow } from '../../fx/LavaFlow'
import { createLavaMaterial } from '../../fx/material'
import type { TerrainData } from './generate'
import type { HeightSampler } from './sampler'

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
  private readonly sea = createLavaMaterial(false, true, true)
  private readonly still = createLavaMaterial(false, false)
  private seaMesh: THREE.Mesh | null = null
  private readonly discs: THREE.Mesh[] = []
  private readonly rivers: LavaFlow[] = []
  private readonly emitters: Emitters

  constructor(private readonly scene: THREE.Scene, private readonly sampler: HeightSampler) {
    this.group.name = 'volcanics'
    scene.add(this.group)
    this.emitters = new Emitters(scene)
    this.rebuild()
  }

  /** Throw away and rebuild everything for the terrain data the sampler now holds. */
  rebuild(): void {
    this.clear()
    const data: TerrainData = this.sampler.data
    const ground: Ground = { size: data.size, heightAt: (x, z) => this.sampler.heightAt(x, z) }

    this.seaMesh = new THREE.Mesh(seaGeometry(ground), this.sea.material)
    this.seaMesh.frustumCulled = false
    this.group.add(this.seaMesh)

    const lava = data.lava
    const disc = (x: number, y: number, z: number, radius: number) => {
      const mesh = new THREE.Mesh(discGeometry(x, y, z, radius), this.still.material)
      this.discs.push(mesh)
      this.group.add(mesh)
    }
    if (lava.lake) disc(lava.lake.x, lava.lake.surface, lava.lake.z, lava.lake.radius)
    for (const p of lava.pools) disc(p.x, p.surface, p.z, p.radius)
    for (const r of lava.rivers) {
      if (r.points.length < 2) continue
      // A little wider than the planned surface so the ribbon tucks into the channel banks.
      this.rivers.push(new LavaFlow(this.scene, ground, r.points, r.width + 1.5))
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
    if (this.seaMesh) this.seaMesh.position.y = level
    this.sea.update(dt, level)
    this.still.update(dt)
    for (const r of this.rivers) r.update(dt)
    this.emitters.update(dt)
  }

  private clear(): void {
    if (this.seaMesh) {
      this.group.remove(this.seaMesh)
      this.seaMesh.geometry.dispose()
      this.seaMesh = null
    }
    for (const m of this.discs) {
      this.group.remove(m)
      m.geometry.dispose()
    }
    this.discs.length = 0
    for (const r of this.rivers) r.dispose()
    this.rivers.length = 0
    this.emitters.clear()
  }

  dispose(): void {
    this.clear()
    this.emitters.dispose()
    this.scene.remove(this.group)
    this.sea.material.dispose()
    this.still.material.dispose()
  }
}
