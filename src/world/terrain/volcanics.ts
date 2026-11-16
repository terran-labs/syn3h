/**
 * Draws the liquids and fire the generator planned: the sea out to the horizon, the lake at
 * the centre, the rivers and their pools, and the flame, ember and smoke vents.
 *
 * Everything is read from `data.lava` and `data.vents`, so what is drawn is exactly what
 * `liquidHeightAt` reports and what vehicles float in. Rebuilt whenever the terrain
 * regenerates. The sea is lava or water by `world.seaKind`; the lake and rivers are lava on
 * volcanic worlds and water elsewhere. The lava look and the particles live in src/fx.
 *
 * The world wraps. Like the terrain chunks, each sea chunk, lake, pool and river is drawn at
 * the image of it nearest the camera, and the apron to the horizon follows the window those
 * chunks make, so the sea never ends. Vents are re-placed at their nearest images whenever
 * the camera has moved an eighth of a tile.
 */
import * as THREE from 'three/webgpu'
import { attribute, cameraPosition, cameraViewMatrix, normalize, color, float, mix, mx_noise_float, positionWorld, positionGeometry, smoothstep, time, uniform, vec3 } from 'three/tsl'
import { worldGravity, worldLavaAltitude } from '../../../shared/params'
import { nearestImage } from '../../../shared/wrap'
import { overHorizon } from '../curve'
import type { System } from '../../core/Game'
import { Emitters } from '../../fx/Emitters'
import { buildRibbonGeometry } from '../../fx/LavaFlow'
import { createLavaMaterial } from '../../fx/material'
import type { TerrainData } from './generate'
import { CHUNK_CELLS } from './mesh'
import type { HeightSampler } from './sampler'
import { KIND_VOLCANIC, worldSeaKind } from './settings'
import { type RiverDrop, riverSpeed } from './lava'
import { waterRiverMaxSpeed, waterWaves } from '../water/params'
import { SEA_GRID } from '../water/seaWaves'
import { CLIPMAP_LAYOUTS, Clipmap, clipmapReach } from '../water/clipmap'
import { qualityLevel } from '../../core/quality'
import { buildBedTexture, buildRiverSurface, buildStillSurface, createWaterSurface, configureWaterBlending, waterOpacityNode, type WaterBed } from '../water/surface'
import { WaterfallMist, fallsFromRivers } from '../water/mist'
import { createFallMaterial, riverPieces } from '../water/falls'
import { paletteFor } from './palettes'

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
  configureWaterBlending(material)
  const depth = (shore ? level : positionGeometry.y).sub(attribute<'float'>('groundHeight', 'float'))
  material.opacityNode = waterOpacityNode(depth, float(0))
  // The surface is flat: light it as facing straight up, whatever the mesh winding.
  material.normalNode = normalize(cameraViewMatrix.transformDirection(vec3(0, 1, 0)))
  const drift = time.mul(0.25)
  const swell = mx_noise_float(vec3(p.x.mul(0.035), p.z.mul(0.035), drift))
  const ripple = mx_noise_float(vec3(p.x.mul(0.22), p.z.mul(0.22), drift.mul(2.2)))
  // Ripples fade with distance, where they would shimmer.
  const near = smoothstep(500, 60, p.sub(cameraPosition).length())
  const shade = swell.mul(0.1).add(ripple.mul(0.08).mul(near)).add(1)
  if (shore) {
    const water = mix(color(0x2fc4bd), color(0x0a3562), smoothstep(0.5, 22, depth))
    const foam = smoothstep(1.3, 0.15, depth.add(ripple.mul(0.5))).mul(smoothstep(-0.6, 0.1, depth))
    material.opacityNode = waterOpacityNode(depth, foam)
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
const SEA_SEGMENTS = SEA_GRID
/**
 * Sea chunks per side: the terrain's chunk count (one per 64 cells) so both wrap in step, but
 * at most 8, so the 4 km tile does not spend 256 draws on the sea. There the sea's window
 * snaps to 512 m instead of 256 m, and a sliver at its far edge (over 1.7 km from the camera,
 * inside the fog) is apron without the shoreline glow.
 */
const seaChunks = (data: TerrainData) => Math.min(8, Math.max(1, Math.round((data.resolution - 1) / CHUNK_CELLS)))

type Ground = { size: number; heightAt(x: number, z: number): number }

/**
 * One square of the sea grid in canonical tile coordinates, carrying the ground height
 * under each vertex (the lava material brightens where the two meet, which draws the
 * glowing shoreline). `uv` is world metres and is rewritten when the chunk moves.
 */
function seaChunkGeometry(ground: Ground, cx: number, cz: number, chunks: number): THREE.BufferGeometry {
  const half = ground.size / 2
  const segs = Math.max(1, Math.round(SEA_SEGMENTS / chunks))
  const step = ground.size / (segs * chunks)
  const positions: number[] = []
  const depth: number[] = []
  const index: number[] = []
  for (let iz = 0; iz <= segs; iz++) {
    for (let ix = 0; ix <= segs; ix++) {
      const x = -half + (cx * segs + ix) * step
      const z = -half + (cz * segs + iz) * step
      positions.push(x, 0, z)
      // The height field is periodic, so this is the ground under every image of the vertex.
      depth.push(ground.heightAt(x, z))
    }
  }
  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * (segs + 1) + ix
      index.push(a, a + segs + 1, a + 1, a + 1, a + segs + 1, a + segs + 2)
    }
  }
  return finishSea(positions, depth, index)
}

/**
 * Apron: a square ring from the edge of a hole (tile-sized, or the clipmap's reach) out to the
 * horizon. Deep everywhere.
 */
export function apronGeometry(ground: Ground, hole = ground.size / 2): THREE.BufferGeometry {
  const half = hole
  const far = half + SEA_REACH
  const positions: number[] = []
  const depth: number[] = []
  const index: number[] = []
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k]
    const [bx, bz] = corners[(k + 1) % 4]
    const base = positions.length / 3
    positions.push(ax * half, 0, az * half, bx * half, 0, bz * half, bx * far, 0, bz * far, ax * far, 0, az * far)
    depth.push(-100, -100, -100, -100)
    const [a, b, c, d] = [base, base + 1, base + 2, base + 3]
    // Match the upward-facing sea tiles. Reversed winding gives the underwater apron
    // top-side sky reflection and culls the horizon on front-sided lava materials.
    index.push(a, b, d, b, c, d)
  }
  return finishSea(positions, depth, index)
}

function finishSea(positions: number[], depth: number[], index: number[]): THREE.BufferGeometry {
  const uvs: number[] = []
  // The lava pattern is in world metres, so it does not swim when the sea level moves.
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i], positions[i + 2])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('groundHeight', new THREE.Float32BufferAttribute(depth, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

/** Shift a mesh by whole tiles in x and z, keeping its world-metre uvs continuous. */
function shiftTo(mesh: THREE.Mesh, ox: number, oz: number, worldUv: boolean): void {
  const dx = ox - mesh.position.x
  const dz = oz - mesh.position.z
  if (dx === 0 && dz === 0) return
  mesh.position.x = ox
  mesh.position.z = oz
  if (!worldUv) return
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
  const a = uv.array as Float32Array
  for (let i = 0; i < a.length; i += 2) {
    a[i] += dx
    a[i + 1] += dz
  }
  uv.needsUpdate = true
}

export class Volcanics implements System {
  private readonly group = new THREE.Group()
  // Both looks of the sea are built once and swapped, so changing the sea is instant.
  private readonly lavaSea = createLavaMaterial({ shoreline: true, far: true, clipmap: true })
  private readonly waterSea: Liquid = createWaterMaterial(true)
  private readonly lavaStill = createLavaMaterial({ shoreline: true })
  private readonly lavaRiver = createLavaMaterial({ river: true, shoreline: true })
  private readonly waterStill: Liquid = createWaterMaterial(false)
  // The Water Lab's surface (water.waves): one material in three modes.
  private readonly newSea = createWaterSurface('sea')
  private readonly newStill = createWaterSurface('still')
  private readonly newRiver = createWaterSurface('river')
  /** The height field under every water surface, rebuilt with the terrain. */
  private bed: WaterBed | null = null
  /** Whether the current meshes were built for the new water. */
  private builtNew = false
  private builtGravity = worldGravity.value
  private builtLavaSea = false
  /** Quality level the clipmap and the lake, pool and river meshes were built for. */
  private bodyLevel = -1
  private builtRiverSpeed = waterRiverMaxSpeed.value
  private readonly mist = new WaterfallMist(this.group)
  private readonly fallMaterial = createFallMaterial()
  /** Sea grid chunks and the apron round them, all sharing the sea material. Only the old water look uses chunks. */
  private sea: { mesh: THREE.Mesh; cx: number; cz: number }[] = []
  /** The sea near the camera for lava and the new water: rings that follow the camera (clipmap.ts). */
  private clip: Clipmap | null = null
  private clipLevel = -1
  private apron: THREE.Mesh | null = null
  /** Lake, pools and rivers, with their canonical centres and whether their uvs are world metres. */
  private readonly meshes: { mesh: THREE.Mesh; x: number; z: number; worldUv: boolean }[] = []
  private readonly emitters: Emitters
  /** Where each vent is drawn now; empty forces a placement. */
  private placedVents: { x: number; z: number }[] = []

  /**
   * `exposure` reports the camera exposure in use (it rises at night) and `dayExposure` the
   * daytime value, so the lava can hold its brightness on screen as the exposure climbs.
   */
  constructor(
    private readonly scene: THREE.Scene, private readonly sampler: HeightSampler,
    private readonly exposure: () => number = () => 1, private readonly dayExposure: () => number = () => 1,
    /** Wrapping follows this camera; without one everything stays in the canonical tile. */
    private readonly camera?: THREE.Camera,
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

    this.builtNew = waterWaves.value
    this.builtGravity = worldGravity.value
    this.builtRiverSpeed = waterRiverMaxSpeed.value
    const palette = paletteFor(data.settings.look)
    this.fallMaterial.color.set(palette.seaShallow)
    this.bed?.texture.dispose()
    this.bed = buildBedTexture(data, worldLavaAltitude.value)
    for (const w of [this.newSea, this.newStill, this.newRiver]) { w.setColours(palette.seaShallow, palette.seaDeep); w.setBed(this.bed) }
    for (const l of [this.lavaSea, this.lavaStill, this.lavaRiver]) l.setBed(this.bed)
    const seaMaterial = this.seaMaterial()
    // A dry world (the Moon) drains its sea below every valley: draw none of it.
    const useClip = !data.settings.dry && (this.seaIsLava || this.builtNew)
    this.builtLavaSea = this.seaIsLava
    if (useClip) {
      this.clipLevel = Math.round(qualityLevel.value)
      const layout = CLIPMAP_LAYOUTS[Math.max(0, Math.min(5, this.clipLevel))]
      this.clip = new Clipmap(layout, seaMaterial)
      this.group.add(this.clip.group)
      this.apron = new THREE.Mesh(apronGeometry(ground, clipmapReach(layout)), seaMaterial)
      this.apron.frustumCulled = false
      this.group.add(this.apron)
    }
    const chunks = data.settings.dry || useClip ? 0 : seaChunks(data)
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) {
        const mesh = new THREE.Mesh(seaChunkGeometry(ground, cx, cz, chunks), seaMaterial)
        this.sea.push({ mesh, cx, cz })
        this.group.add(mesh)
      }
    }
    if (!data.settings.dry && !useClip) {
      this.apron = new THREE.Mesh(apronGeometry(ground), seaMaterial)
      this.apron.frustumCulled = false
      this.group.add(this.apron)
    }

    const lava = data.lava
    const hot = this.flowsAreLava
    // Mesh spacing for lakes, pools and rivers: fine enough near the player's level of detail to
    // carry their waves (see surface.ts WaveSource). Quality 0 Minimal .. 5 Cinematic.
    const level = Math.max(0, Math.min(5, Math.round(qualityLevel.value)))
    const stillSpacing = [4, 3, 2, 1.5, 1, 0.75][level]
    const riverStep = [4, 3, 2.5, 2, 1.5, 1][level]
    this.bodyLevel = level
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, worldUv: boolean, spacing = stillSpacing) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.userData.spacing = spacing
      geometry.computeBoundingSphere()
      const c = geometry.boundingSphere!.center
      this.meshes.push({ mesh, x: c.x, z: c.z, worldUv })
      this.group.add(mesh)
    }
    if (!hot && this.builtNew) {
      // New water: still surfaces with the bed under them, rivers at their true surface.
      const still = this.newStill.material
      if (lava.lake) add(buildStillSurface(ground, lava.lake.x, lava.lake.surface, lava.lake.z, lava.lake.radius, stillSpacing), still, true)
      for (const p of lava.pools) add(buildStillSurface(ground, p.x, p.surface, p.z, p.radius, stillSpacing), still, true)
      // Receiving water for a river's mouth: the lake, a pool or the sea, never a river.
      const seaLevel = data.settings.dry ? -Infinity : worldLavaAltitude.value
      const waterAt = (x: number, z: number) => {
        let y = seaLevel
        for (const b of lava.lake ? [lava.lake, ...lava.pools] : lava.pools) {
          if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.radius ** 2) y = Math.max(y, b.surface)
        }
        return y
      }
      const drawn: { points: { x: number; y: number; z: number }[]; drops: RiverDrop[] }[] = []
      for (const r of lava.rivers) {
        if (r.points.length < 2) continue
        // Drawn where the water is held up; off a lip it falls (falls.ts drapeRiver).
        const pieces = riverPieces(ground, r.points, r.width, waterAt, worldGravity.value, waterRiverMaxSpeed.value)
        if (pieces.points.length < 2) continue
        add(buildRiverSurface(ground, pieces.points, r.width + 1.5, (slope) => riverSpeed(slope, waterRiverMaxSpeed.value), riverStep), this.newRiver.material, false, riverStep)
        for (const sheet of pieces.sheets) add(sheet, this.fallMaterial, false)
        drawn.push(pieces)
      }
      this.mist.set(fallsFromRivers(drawn), data.size)
      this.placedVents = []
      this.place()
      return
    }
    const still = (hot ? this.lavaStill : this.waterStill).material
    // Lava lakes and pools use the same rings as water, so they can carry a slow swell too.
    if (lava.lake) add(buildStillSurface(ground, lava.lake.x, lava.lake.surface, lava.lake.z, lava.lake.radius, stillSpacing * 1.5), still, true, stillSpacing * 1.5)
    for (const p of lava.pools) add(buildStillSurface(ground, p.x, p.surface, p.z, p.radius, stillSpacing * 1.5), still, true, stillSpacing * 1.5)
    for (const r of lava.rivers) {
      if (r.points.length < 2) continue
      // A little wider than the planned surface so the ribbon tucks into the channel banks.
      add(hot ? buildRibbonGeometry(ground, r.points, r.width + 1.5) : buildRiverSurface(ground, r.points, r.width + 1.5, (slope) => riverSpeed(slope, waterRiverMaxSpeed.value)), (hot ? this.lavaRiver : this.waterStill).material, false)
    }
    this.placedVents = []
    this.place()
  }

  /** Move everything to the images nearest the camera. Cheap when nothing changes. */
  private place(): void {
    const size = this.sampler.data.size
    const half = size / 2
    const cam = this.camera?.position
    const camX = cam?.x ?? 0
    const camZ = cam?.z ?? 0
    const near = (v: number, ref: number) => size * Math.round((ref - v) / size)
    const chunk = size / seaChunks(this.sampler.data)
    // The chunks form a tile-sized window round the camera; the apron's hole follows it.
    let lowX = Infinity
    let lowZ = Infinity
    for (const s of this.sea) {
      const x0 = -half + s.cx * chunk
      const z0 = -half + s.cz * chunk
      const ox = near(x0 + chunk / 2, camX)
      const oz = near(z0 + chunk / 2, camZ)
      shiftTo(s.mesh, ox, oz, true)
      // The sea is flat, so on a round world it is the first thing to drop behind the horizon.
      s.mesh.visible = !overHorizon(x0 + ox + chunk / 2, z0 + oz + chunk / 2, chunk * 0.7072, 0)
      lowX = Math.min(lowX, x0 + ox)
      lowZ = Math.min(lowZ, z0 + oz)
    }
    if (this.clip) {
      const outer = this.clip.update(camX, camZ, worldLavaAltitude.value)
      this.apron!.position.set(outer.x, worldLavaAltitude.value, outer.z)
    } else if (this.apron) {
      shiftTo(this.apron, lowX + half, lowZ + half, true)
      // The apron starts half a world away: the far side of a round planet.
      this.apron.visible = !overHorizon(camX + half, camZ, 0, 0)
    }
    for (const m of this.meshes) shiftTo(m.mesh, near(m.x, camX), near(m.z, camZ), m.worldUv)
    // Re-adding restarts every vent's particles, so only do it once some vent is an eighth
    // of a tile past its nearest image: the restart then happens rarely and the vent that
    // forced it is far away.
    const limit = half + size / 8
    const vents = this.sampler.data.vents
    let stale = this.placedVents.length !== vents.length
    for (const v of this.placedVents) {
      if (Math.abs(v.x - camX) > limit || Math.abs(v.z - camZ) > limit) stale = true
    }
    if (stale) this.placeVents(camX, camZ)
  }

  /** Re-add every vent at its image nearest (x, z). */
  private placeVents(camX: number, camZ: number): void {
    this.emitters.clear()
    this.placedVents = []
    const size = this.sampler.data.size
    for (const v of this.sampler.data.vents) {
      const x = nearestImage(v.x, camX, size)
      const z = nearestImage(v.z, camZ, size)
      this.placedVents.push({ x, z })
      this.emitters.addVent(
        { x, y: v.y + 0.3, z },
        {
          kind: v.kind,
          radius: v.kind === 'embers' ? Math.max(0.6, v.size * 0.4) : v.size * 0.5,
          height: v.kind === 'smoke' ? 14 + v.size * 3 : 6 + v.size * 1.5,
          intensity: 1,
        },
      )
    }
  }

  /** The sea's material for the current sliders. */
  private seaMaterial(): THREE.Material {
    if (this.seaIsLava) return this.lavaSea.material
    return waterWaves.value ? this.newSea.material : this.waterSea.material
  }

  update(dt: number): void {
    const level = worldLavaAltitude.value
    // The new water rebuilds the rivers and pools, so switching it rebuilds everything.
    if (waterWaves.value !== this.builtNew || (this.builtNew &&
      (worldGravity.value !== this.builtGravity || waterRiverMaxSpeed.value !== this.builtRiverSpeed)) ||
      // The clipmap's layout follows the quality level; the old water uses chunks, lava does not.
      (Math.round(qualityLevel.value) !== this.bodyLevel) || (!this.builtNew && this.seaIsLava !== this.builtLavaSea)) this.rebuild()
    this.place()
    // The sea kind is a live slider: swap the look the moment it changes.
    const want = this.seaMaterial()
    for (const s of this.sea) {
      s.mesh.position.y = level
      if (s.mesh.material !== want) s.mesh.material = want
    }
    if (this.clip) this.clip.material = want
    if (this.apron) {
      this.apron.position.y = level
      if (this.apron.material !== want) this.apron.material = want
    }
    // Hold lava at roughly its daytime brightness on screen, letting a little of the extra
    // exposure through so it still reads as the brightest thing at night.
    const over = this.exposure() / Math.max(1e-3, this.dayExposure())
    const dim = over > 1 ? 1 / (over * 0.8 + 0.2) : 1
    this.lavaSea.update(dt, level, dim)
    this.waterSea.update(dt, level)
    if (this.builtNew) {
      this.mist.update(dt, this.camera?.position.x ?? 0, this.camera?.position.z ?? 0, this.camera?.position.y ?? 0)
      for (const w of [this.newSea, this.newStill, this.newRiver]) w.setEnvironment(this.scene.environment)
      this.newSea.update(level)
      this.newStill.update(0)
      this.newRiver.update(0)
    }
    this.lavaStill.update(dt, 0, dim)
    this.lavaRiver.update(dt, 0, dim)
    if (this.camera) { this.emitters.listener.x = this.camera.position.x; this.emitters.listener.y = this.camera.position.y; this.emitters.listener.z = this.camera.position.z }
    this.emitters.update(dt)
  }

  private clear(): void {
    for (const s of this.sea) {
      this.group.remove(s.mesh)
      s.mesh.geometry.dispose()
    }
    this.sea = []
    this.clip?.dispose()
    this.clip = null
    if (this.apron) {
      this.group.remove(this.apron)
      this.apron.geometry.dispose()
      this.apron = null
    }
    for (const { mesh } of this.meshes) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    this.meshes.length = 0
    this.emitters.clear()
    this.mist.clear()
  }

  dispose(): void {
    this.clear()
    this.fallMaterial.dispose()
    this.bed?.texture.dispose()
    this.emitters.dispose()
    this.scene.remove(this.group)
    for (const l of [this.lavaSea, this.waterSea, this.lavaStill, this.lavaRiver, this.waterStill, this.newSea, this.newStill, this.newRiver]) l.material.dispose()
  }
}
