/**
 * The procedural world as a `Terrain`: generation, the Rapier heightfield, the chunked
 * mesh, and in-place regeneration when the seed or a terrain parameter changes.
 */
import * as THREE from 'three/webgpu'
import { params, worldLavaAltitude, worldSeed } from '../../../shared/params'
import type { Game } from '../../core/Game'
import type { RAPIER } from '../../core/physics'
import type { SpawnPoint, Terrain } from '../Terrain'
import { createTerrainCollider } from './collider'
import { lavaSurfaceAt } from './lava'
import { type TerrainData, coneProfile, generateTerrain } from './generate'
import { type TerrainMaterial, createTerrainMaterial } from './material'
import { type TerrainMeshes, createTerrainMeshes } from './mesh'
import { HeightSampler } from './sampler'
import { TERRAIN_PARAM_IDS, currentTerrainSettings } from './settings'
import { spawnPointAt } from './spawn'

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

  constructor(private readonly game: Game, private seed: number) {
    this.data = this.generate()
    this.size = this.data.size
    this.sampler = new HeightSampler(this.data)
    this.look = createTerrainMaterial()
    this.look.setSummit(this.summitHeight())
    this.meshes = createTerrainMeshes(this.data, this.look.material)
    game.scene.add(this.meshes.group)
    this.collider = createTerrainCollider(game.world, this.data)

    this.unsubscribe = params.onChange((id) => {
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
    const v = this.data.layout.volcano
    return v.height * coneProfile(v.calderaRadius / v.radius)
  }

  /** Rebuild heights, mesh and collider in place, then notify listeners. */
  regenerate(): void {
    this.data = this.generate()
    this.sampler.data = this.data
    this.meshes.update(this.data)
    this.look.setSummit(this.summitHeight())
    this.game.world.removeCollider(this.collider, true)
    this.collider = createTerrainCollider(this.game.world, this.data)
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

  spawnPoint(index: number): SpawnPoint {
    const s = spawnPointAt(this.sampler, index)
    return { position: new THREE.Vector3(s.x, s.y, s.z), heading: s.heading }
  }

  onRegenerate(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
    this.game.scene.remove(this.meshes.group)
    this.meshes.dispose()
    this.look.material.dispose()
    this.game.world.removeCollider(this.collider, false)
  }
}
