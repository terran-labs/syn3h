/**
 * The procedural world as a `Terrain`: generation, the Rapier heightfield, the chunked
 * mesh, and in-place regeneration when the seed or a terrain parameter changes.
 */
import * as THREE from 'three/webgpu'
import { params, worldLavaAltitude, worldSeed } from '../../../shared/params'
import type { Game, System } from '../../core/Game'
import type { RAPIER } from '../../core/physics'
import type { SpawnPoint, Terrain, TerrainRenderQuality, TerrainRoadPath, TerrainSummit, TerrainVent } from '../Terrain'
import { createTerrainCollider } from './collider'
import { lavaSurfaceAt } from './lava'
import { type TerrainData, generateTerrain } from './generate'
import { type TerrainMaterial, createTerrainMaterial } from './material'
import { LOD_FAR, LOD_NEAR, type TerrainMeshes, type TriangleStats, createTerrainMeshes } from './mesh'
import { rimRoadRadius } from './roads'
import { HeightSampler } from './sampler'
import { KIND_ALPINE, KIND_VOLCANIC, TERRAIN_PARAM_IDS, currentTerrainSettings, worldSeaKind } from './settings'
import { spawnPointAt } from './spawn'
import { Trees } from './trees'
import { Volcanics } from './volcanics'

export class ProceduralTerrain implements Terrain {
  readonly size: number
  /** Increments on every regeneration. */
  version = 0
  data: TerrainData
  /** Milliseconds the last generation took (generation only, not upload). */
  lastGenerateMs = 0
  private readonly sampler: HeightSampler
  private readonly meshes: TerrainMeshes
  private readonly look: TerrainMaterial
  private collider: RAPIER.Collider
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private pending = false
  private readonly lodSystem: System
  /** The sea, lava lake, rivers and vents drawn from the generated data. */
  private readonly volcanics: Volcanics
  private readonly trees: Trees

  constructor(private readonly game: Game, private seed: number) {
    this.data = this.generate()
    this.size = this.data.size
    this.sampler = new HeightSampler(this.data)
    this.look = createTerrainMaterial()
    this.look.setSummit(this.summitHeight())
    this.lightLake()
    this.meshes = createTerrainMeshes(this.data, this.look.material)
    game.scene.add(this.meshes.group)
    this.collider = createTerrainCollider(game.world, this.data)
    // Level of detail follows the camera once per frame, after the camera has moved.
    this.lodSystem = game.add({
      update: () => {
        this.meshes.updateLod(game.camera.position)
        this.look.setSea(worldLavaAltitude.value)
      },
    })
    this.volcanics = game.add(new Volcanics(game.scene, this.sampler))
    this.trees = game.add(new Trees(game.scene, this.sampler, game.camera))

    this.unsubscribe = params.onChange((id) => {
      // The sea kind only recolours: no regeneration.
      if (id === worldSeaKind.def.id) this.lightLake()
      if (!TERRAIN_PARAM_IDS.has(id)) return
      if (id === worldSeed.def.id) this.seed = worldSeed.value
      // A preset or a late-join snapshot sets several values at once: regenerate once.
      if (this.pending) return
      this.pending = true
      queueMicrotask(() => {
        this.pending = false
        this.regenerate()
      })
    })
  }

  private generate(): TerrainData {
    const t = performance.now()
    const data = generateTerrain(this.seed, currentTerrainSettings())
    this.lastGenerateMs = performance.now() - t
    return data
  }

  private summitHeight(): number {
    return this.data.layout.summitHeight
  }

  /** Colours, snow and glow for this kind of world and its sea. */
  private lightLake(): void {
    const lake = this.data.lava.lake
    const kind = this.data.settings.kind
    const hot = kind === KIND_VOLCANIC
    if (lake && hot) this.look.setLake(lake.x, lake.z, lake.radius, lake.surface)
    else this.look.setLake(0, 0, 0, -1000)
    // Alpine worlds carry snow on the upper half of the peak.
    const snow = kind === KIND_ALPINE ? this.data.layout.summitHeight * 0.5 : 1e6
    this.look.setLook(kind, worldSeaKind.value === 0, hot, snow)
  }

  /** Rebuild heights, mesh and collider in place, then notify listeners. */
  regenerate(): void {
    this.data = this.generate()
    this.sampler.data = this.data
    this.meshes.update(this.data)
    this.look.setSummit(this.summitHeight())
    this.lightLake()
    this.game.world.removeCollider(this.collider, true)
    this.collider = createTerrainCollider(this.game.world, this.data)
    this.volcanics.rebuild()
    this.trees.rebuild()
    this.version++
    console.info(`terrain regenerated: seed ${this.seed}, ${this.lastGenerateMs.toFixed(0)} ms`)
    for (const l of this.listeners) l()
  }

  heightAt(x: number, z: number): number {
    return this.sampler.heightAt(x, z)
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.sampler.normalAt(x, z, out)
  }

  /** Caldera lake, pools and rivers where present, else the global lava plane. */
  liquidHeightAt(x: number, z: number): number {
    return lavaSurfaceAt(this.data.lava, x, z, worldLavaAltitude.value)
  }

  /**
   * What the liquid at (x, z) is, or null where the ground is dry. The sea and everything
   * that flows from the volcano are lava on this world.
   */
  liquidKindAt(x: number, z: number): 'lava' | 'water' | null {
    const sea = worldLavaAltitude.value
    const surface = lavaSurfaceAt(this.data.lava, x, z, sea)
    if (surface <= this.sampler.heightAt(x, z)) return null
    // Above the sea level it is the lake, a river or a pool; otherwise it is the sea.
    const lava = surface > sea ? this.data.settings.kind === KIND_VOLCANIC : worldSeaKind.value === 0
    return lava ? 'lava' : 'water'
  }

  spawnPoint(index: number): SpawnPoint {
    const s = spawnPointAt(this.sampler, index)
    return { position: new THREE.Vector3(s.x, s.y, s.z), heading: s.heading }
  }

  /** Road centrelines from the roads pass: the volcano road, the rim ring, plain roads. */
  roadPaths(): readonly TerrainRoadPath[] {
    return this.data.roads
  }

  /** Emitter anchors from the vents pass: in the lake, at river sources, along rivers, at pools. */
  vents(): readonly TerrainVent[] {
    return this.data.vents
  }

  /** Caldera centre, the rim ring road (radius and mean height) and the lava lake. */
  summit(): TerrainSummit | null {
    const v = this.data.layout.volcano
    const rim = this.data.roads.find((r) => r.kind === 'rim')
    let rimHeight = 0
    if (rim && rim.points.length > 0) {
      for (const p of rim.points) rimHeight += p.y
      rimHeight /= rim.points.length
    } else {
      rimHeight = this.sampler.heightAt(v.x + rimRoadRadius(this.data), v.z)
    }
    const lake = this.data.lava.lake
    return {
      x: v.x, z: v.z, rimRadius: rimRoadRadius(this.data), rimHeight,
      lake: lake ? { radius: lake.radius, surface: lake.surface } : null,
    }
  }

  /**
   * Graphics level hook: weaker devices switch to coarser chunks sooner. Nothing is hidden,
   * because the volcano has to stay visible from everywhere, and physics is untouched.
   */
  setRenderQuality(quality: TerrainRenderQuality): void {
    const detail = Math.max(0.25, Math.min(1, quality.detail))
    // Full detail shrinks with the square of the detail share: 250 m, 140 m, 62 m.
    const near = LOD_NEAR * detail * detail
    const far = Math.max(near, Math.min(LOD_FAR * detail, quality.drawDistance * 0.6))
    this.meshes.setLodDistances(near, far)
    // Forest out to the level's draw distance: 700 m on the weakest phones.
    this.trees.setDrawDistance(Math.min(1800, quality.drawDistance))
  }

  /** Terrain triangles in view at the current levels of detail, versus at full detail. */
  triangleStats(): TriangleStats {
    this.meshes.updateLod(this.game.camera.position)
    return this.meshes.stats(this.game.camera)
  }

  onRegenerate(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.unsubscribe()
    this.game.remove(this.lodSystem)
    this.game.remove(this.volcanics)
    this.game.remove(this.trees)
    this.listeners.clear()
    this.game.scene.remove(this.meshes.group)
    this.meshes.dispose()
    this.look.material.dispose()
    this.game.world.removeCollider(this.collider, false)
  }
}
