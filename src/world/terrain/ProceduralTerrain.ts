/**
 * The procedural world as a `Terrain`: generation, the Rapier heightfield, the chunked
 * mesh, and in-place regeneration when the seed or a terrain parameter changes.
 */
import * as THREE from 'three/webgpu'
import { params, worldLavaAltitude, worldSeed } from '../../../shared/params'
import { nearestImage, wrapCoord } from '../../../shared/wrap'
import type { Game, System } from '../../core/Game'
import type { RAPIER } from '../../core/physics'
import { applyCurve, curveParam, updateCurve } from '../curve'
import { AlienSkyMesh } from '../sky/AlienSkyMesh'
import type { SpawnPoint, Terrain, TerrainRenderQuality, TerrainRoadPath, TerrainSummit, TerrainVent } from '../Terrain'
import { createTerrainCollider } from './collider'
import { lavaSurfaceAt, liquidFlowAt } from './lava'
import { seaWaves, setWaterClock } from '../water/seaWaves'
import { waterRiverMaxSpeed } from '../water/params'
import { type TerrainData, generateTerrain } from './generate'
import { type TerrainMaterial, createTerrainMaterial } from './material'
import { LOD_FAR, LOD_NEAR, type TerrainMeshes, type TriangleStats, createTerrainMeshes } from './mesh'
import { rimRoadRadius } from './roads'
import { HeightSampler, sealSeam } from './sampler'
import { KIND_VOLCANIC, TERRAIN_PARAM_IDS, currentTerrainSettings, terrainRoadStyle, worldSeaKind } from './settings'
import { paletteFor } from './palettes'
import { type SurfaceKind, classifySurface, sampleGrid } from './surface'
import { spawnPointAt } from './spawn'
import { GroundCover } from './groundcover'
import { Trees } from './trees'
import { Volcanics } from './volcanics'

/** A vehicle the seam can move: the game's Vehicle satisfies this. */
export interface SeamVehicle {
  body: RAPIER.RigidBody
  shiftBy(dx: number, dz: number): void
}

export interface SeamFollowers {
  player: SeamVehicle
  camera?: { shift(dx: number, dz: number): void }
  others(): readonly SeamVehicle[]
}

export class ProceduralTerrain implements Terrain {
  /** Side of the current tile in metres. Changes with the planet size setting. */
  get size(): number {
    return this.data.size
  }
  /** The world is one tile of a torus this many metres on a side: the current size. */
  get wrapSize(): number {
    return this.data.size
  }
  /** Largest height change (m) sealing the tile's seam made on the last generation. */
  lastSeamCorrection = 0
  /** Increments on every regeneration. */
  version = 0
  data: TerrainData
  /** Milliseconds the last generation took (generation only, not upload). */
  lastGenerateMs = 0
  private readonly sampler: HeightSampler
  private readonly surfaceNormal = { x: 0, y: 1, z: 0 }
  private meshes: TerrainMeshes
  /** The last render quality request, re-applied when the meshes are rebuilt. */
  private lod: [number, number] | null = null
  private readonly look: TerrainMaterial
  private collider: RAPIER.Collider
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private pending = false
  private readonly lodSystem: System
  private wasRound = false
  private cameraLed = false
  private followCamera: () => void = () => {}

  /**
   * Call once per frame after the camera has moved (register a system after the camera's).
   * The round planet, levels of detail and horizon culling are all measured from the
   * camera, so doing them before it moves would draw the world one frame behind it.
   */
  afterCamera(): void {
    this.cameraLed = true
    this.followCamera()
  }
  /** The sea, lava lake, rivers and vents drawn from the generated data. */
  private readonly volcanics: Volcanics
  private readonly trees: Trees
  private readonly cover: GroundCover

  constructor(private readonly game: Game, private seed: number) {
    // Single player: waves follow simulated time. Networking may swap in the server clock.
    setWaterClock(() => game.time)
    this.data = this.generate()
    this.sampler = new HeightSampler(this.data)
    this.look = createTerrainMaterial()
    this.look.setSummit(this.summitHeight())
    this.lightLake()
    this.meshes = createTerrainMeshes(this.data, this.look.material)
    game.scene.add(this.meshes.group)
    this.collider = createTerrainCollider(game.world, this.data)
    // Level of detail follows the camera once per frame, after the camera has moved.
    this.lodSystem = game.add({
      // Before each physics step, and before the vehicles' own steps: carry things across
      // the seam and keep the ground under them.
      fixedUpdate: () => this.keepSeam(),
      // Until something calls afterCamera() itself, do the camera-dependent work here.
      update: () => { if (!this.cameraLed) this.followCamera() },
    })
    this.followCamera = () => {
      {
        // Curved horizon. Every material in the scene must take the same bend or its objects
        // float against the ground, so while the curve is on, the scene is walked every frame
        // (a few hundred objects) and anything new (a joined vehicle, rebuilt particles) is
        // bent too. The sky is left alone. Nothing is touched while the curve is 0.
        updateCurve(game.camera.position, this.size)
        // After the curve: level of detail also hides chunks that are over the horizon.
        this.meshes.updateLod(game.camera.position)
        this.look.setSea(worldLavaAltitude.value)
        const round = curveParam.value > 0
        if (round || this.wasRound) {
          game.scene.traverse((o) => {
            const m = (o as THREE.Mesh).material
            if (!m || o instanceof AlienSkyMesh) return
            if (round) {
              if (Array.isArray(m)) for (const x of m) applyCurve(x)
              else applyCurve(m)
            }
            // On a sphere, ground that is off screen on the flat world can be in view (the
            // far limb from high up), so the flat world's culling boxes are wrong.
            const u = o.userData as { flatCulled?: boolean }
            if (round && o.frustumCulled) { u.flatCulled = true; o.frustumCulled = false }
            else if (!round && u.flatCulled) { u.flatCulled = false; o.frustumCulled = true }
          })
          this.wasRound = round
        }
      }
    }
    this.volcanics = game.add(new Volcanics(
      game.scene, this.sampler,
      () => game.renderer.toneMappingExposure,
      () => Number(params.get('sky.exposure')?.value ?? game.renderer.toneMappingExposure),
      game.camera,
    ))
    this.trees = game.add(new Trees(game.scene, this.sampler, game.camera))
    this.cover = game.add(new GroundCover(
      game.scene, this.sampler, game.camera,
      () => game.renderer.toneMappingExposure / Math.max(1e-3, Number(params.get('sky.exposure')?.value ?? game.renderer.toneMappingExposure)),
      this.look,
    ))
    // Every vehicle in the scene (the player, bots and other players) marks its object
    // with its heat state; the grass bends under those.
    const scene = game.scene
    this.cover.setVehicles(function* () {
      for (const o of scene.children) if (o.userData.vehicleHeat) yield o
    })

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
    seaWaves.configure(data.size, this.seed)
    // The far row and column are the image of the first: make them identical so the
    // height field, mesh and collider are exactly periodic.
    this.lastSeamCorrection = sealSeam(data)
    this.lastGenerateMs = performance.now() - t
    return data
  }

  private summitHeight(): number {
    return this.data.layout.summitHeight
  }

  private colliderX = 0
  private colliderZ = 0
  private seam: SeamFollowers | null = null

  /**
   * Tell the terrain who lives on it, so a wrapping world can carry them across its seam.
   * `player` is the vehicle this client drives; `camera` follows it; `others` are every
   * other vehicle simulated here (bots, and remote players near enough to be physical).
   */
  followSeam(followers: SeamFollowers): void {
    this.seam = followers
  }

  /**
   * The wrapping world, each physics step.
   *
   *  1. The player stays inside the tile. A few metres past an edge they are moved a whole
   *     tile back, with the camera, keeping velocity: the ground there is the same ground,
   *     so nothing is seen or felt.
   *  2. Every other vehicle is kept at its image nearest the player, so a bot chasing across
   *     the seam, or a friend just over it, is beside the player and can be rammed.
   *  3. The collider is a window of ground centred near the player (the tile plus a margin),
   *     rebuilt when the player has moved about 100 m, so those others have ground too.
   */
  private keepSeam(): void {
    const f = this.seam
    const size = this.data.size
    if (!f) return
    const half = size / 2
    const p = f.player.body.translation()
    // Hysteresis: 4 m past the edge, so a vehicle driving along the seam is not flipped
    // back and forth every step.
    const dx = p.x > half + 4 ? -size : p.x < -half - 4 ? size : 0
    const dz = p.z > half + 4 ? -size : p.z < -half - 4 ? size : 0
    if (dx || dz) {
      f.player.shiftBy(dx, dz)
      f.camera?.shift(dx, dz)
    }
    const px = p.x + dx
    const pz = p.z + dz
    for (const v of f.others()) {
      if (v === f.player || !v.body.isValid()) continue
      const t = v.body.translation()
      const ox = nearestImage(t.x, px, size) - t.x
      const oz = nearestImage(t.z, pz, size) - t.z
      if (ox || oz) v.shiftBy(ox, oz)
    }
    if (Math.abs(px - this.colliderX) > 96 || Math.abs(pz - this.colliderZ) > 96) this.moveCollider(px, pz)
  }

  private moveCollider(x: number, z: number): void {
    const cell = this.data.cell
    this.colliderX = Math.round(x / cell) * cell
    this.colliderZ = Math.round(z / cell) * cell
    this.game.world.removeCollider(this.collider, true)
    this.collider = createTerrainCollider(this.game.world, this.data, this.colliderX, this.colliderZ)
  }

  /** Colours, snow and glow for this kind of world and its sea. */
  private lightLake(): void {
    const lake = this.data.lava.lake
    const kind = this.data.settings.kind
    const hot = kind === KIND_VOLCANIC
    if (lake && hot) this.look.setLake(lake.x, lake.z, lake.radius, lake.surface)
    else this.look.setLake(0, 0, 0, -1000)
    // Snow starts at a share of the summit's height set by the recipe: alpine worlds carry
    // it from a third of the way up, an ice moon from the shore, most worlds not at all.
    this.look.setLook(this.data.settings.look, worldSeaKind.value === 0, hot && !!lake, this.snowHeight())
  }

  /** Height where snow starts, or a huge number on a world with none. */
  private snowHeight(): number {
    const line = this.data.settings.snowLine
    return line >= 2 ? 1e6 : this.data.layout.summitHeight * line
  }

  /**
   * What the ground is made of at (x, z): the CPU's reading of the rules the material draws
   * with (see surface.ts). Two grid reads, a height and a normal; no allocation.
   */
  surfaceAt(x: number, z: number): SurfaceKind {
    const look = this.data.settings.look
    const style = terrainRoadStyle.value as number
    return classifySurface({
      look,
      slope: 1 - this.sampler.normalAt(x, z, this.surfaceNormal).y,
      height: this.sampler.heightAt(x, z),
      sea: worldLavaAltitude.value,
      lavaSea: worldSeaKind.value === 0,
      snowHeight: this.snowHeight(),
      volcanic: sampleGrid(this.data, this.data.volcanic, x, z),
      roadDist: sampleGrid(this.data, this.data.roadDist, x, z),
      // Same rule as the material's applyRoadStyle: 1 forces made roads, 2 forces tracks.
      madeRoad: style === 1 || (style === 0 && paletteFor(look).track === 0),
    })
  }

  /** Rebuild heights, mesh and collider in place, then notify listeners. */
  regenerate(): void {
    const old = this.data
    this.data = this.generate()
    this.sampler.data = this.data
    if (this.data.size === old.size && this.data.resolution === old.resolution) {
      this.meshes.update(this.data)
    } else {
      // A new planet size: the chunk grid is sized from the tile, so build it afresh.
      this.game.scene.remove(this.meshes.group)
      this.meshes.dispose()
      this.meshes = createTerrainMeshes(this.data, this.look.material)
      if (this.lod) this.meshes.setLodDistances(this.lod[0], this.lod[1])
      this.game.scene.add(this.meshes.group)
    }
    this.look.setSummit(this.summitHeight())
    this.lightLake()
    this.game.world.removeCollider(this.collider, true)
    this.colliderX = 0
    this.colliderZ = 0
    this.collider = createTerrainCollider(this.game.world, this.data)
    this.volcanics.rebuild()
    this.trees.rebuild()
    this.cover.rebuild()
    this.version++
    console.info(`terrain regenerated: seed ${this.seed}, ${this.lastGenerateMs.toFixed(0)} ms`)
    for (const l of this.listeners) l()
  }

  wrapPosition(p: { x: number; z: number }): boolean {
    const x = wrapCoord(p.x, this.data.size)
    const z = wrapCoord(p.z, this.data.size)
    if (x === p.x && z === p.z) return false
    p.x = x
    p.z = z
    return true
  }

  nearestTo(x: number, z: number, refX: number, refZ: number, out: { x: number; z: number }): { x: number; z: number } {
    out.x = nearestImage(x, refX, this.data.size)
    out.z = nearestImage(z, refZ, this.data.size)
    return out
  }

  heightAt(x: number, z: number): number {
    return this.sampler.heightAt(x, z)
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.sampler.normalAt(x, z, out)
  }

  /**
   * Caldera lake, pools and rivers where present, else the global lava plane. A water sea
   * carries the shared waves when they are on (`water.waves`), shrunk in the shallows exactly
   * as the sea material draws them.
   */
  liquidHeightAt(x: number, z: number): number {
    const sea = worldLavaAltitude.value
    x = wrapCoord(x, this.data.size)
    z = wrapCoord(z, this.data.size)
    const surface = lavaSurfaceAt(this.data.lava, x, z, sea)
    if (surface !== sea || !seaWaves.enabled || (worldSeaKind.value as number) !== 1) return surface
    return surface + seaWaves.offsetAt(x, z, this.sampler.heightAt(x, z), sea)
  }

  /** Velocity of the water or lava at (x, z), m/s: rivers flow, the sea, lake and pools do not. */
  liquidFlowAt(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    return liquidFlowAt(this.data.lava, wrapCoord(x, this.data.size), wrapCoord(z, this.data.size), waterRiverMaxSpeed.value, out)
  }

  /**
   * What the liquid at (x, z) is, or null where the ground is dry. The sea and everything
   * that flows from the volcano are lava on this world.
   */
  liquidKindAt(x: number, z: number): 'lava' | 'water' | null {
    const sea = worldLavaAltitude.value
    x = wrapCoord(x, this.data.size)
    z = wrapCoord(z, this.data.size)
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
    this.lod = [near, far]
    this.meshes.setLodDistances(near, far)
    // Forest out to the level's draw distance: 700 m on the weakest phones.
    this.trees.setDrawDistance(Math.min(1800, quality.drawDistance))
    // The ground shader sheds its close-up grain and glitter first, then its colour extras.
    this.look.setDetail(quality.detail)
    // Grass and flowers: everything on desktop, a thinner and nearer cover on phones and
    // tablets, nothing at the safe level.
    // `quality` is the six-step level where the caller has one; `level` the older three.
    // Once the level's own preset table lists the cover.* settings, this call can go.
    const six = (quality as { quality?: number }).quality
    if (six === undefined) this.cover.setLevel(quality.level)
    else this.cover.setLevel(six, 6)
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
    this.game.remove(this.cover)
    this.listeners.clear()
    this.game.scene.remove(this.meshes.group)
    this.meshes.dispose()
    this.look.material.dispose()
    this.game.world.removeCollider(this.collider, false)
  }
}
