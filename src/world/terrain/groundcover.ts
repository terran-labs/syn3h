/**
 * Ground cover: grass and small flowers round the camera, different on each kind of world.
 * What grows on each world is in `flora.ts`; this file draws it.
 *
 * How it is drawn. Each layer is one mesh of N x N instances laid on a grid of cells that
 * scrolls with the camera, like a treadmill: a slot always shows the cell nearest the camera
 * whose index matches it, so when the camera moves only the rows that scrolled are
 * recomputed. What grows in a cell is decided by an integer hash of the cell, so it is the
 * same for every player and repeats exactly at the world's edge. Blades are placed, turned,
 * swayed by the wind and thinned out with distance in the vertex shader. Purely visual: no
 * collision, and vehicles drive through it.
 *
 * How plants are made to grow out of the ground rather than sit on it:
 *  - each plant fades from the ground's own colour at its root (the terrain material's
 *    `groundColour`, evaluated at the plant's foot) to its own colour at the tip
 *  - it is lit with the ground's normal, so a tuft on a shaded slope is as dark as the slope
 *  - its base is darkened, and the ground under dense growth is darkened and tinted
 *    toward the plants (a coverage map the terrain material samples through `setCoverShade`)
 *  - far away, plants thin out one by one and their colour sinks back toward the ground's,
 *    so no ring shows where they stop
 *  - glow is confined to hearts and tips, faint by day and stronger at night
 */
import * as THREE from 'three/webgpu'
import {
  attribute, cameraPosition, cameraViewMatrix, cos, float, fract, mix, normalize, sin, smoothstep, texture, time, uniform,
  varying, vec2, vec3,
} from 'three/tsl'
import { defineParam, worldLavaAltitude } from '../../../shared/params'
import { wrapCoord } from '../../../shared/wrap'
import type { System } from '../../core/Game'
import { FLORA, type Ground, type LayerSpec, type Plant, unit } from './flora'
import { lavaSurfaceAt } from './lava'
import type { GroundNode, TerrainMaterial } from './material'
import { phash2, pperlin } from './noise'
import { distanceToPolyline } from './raster'
import type { HeightSampler } from './sampler'

// Registered in settings.ts, which has no renderer imports, so planet recipes, tests and
// the server can set it without loading this file.
import { paletteFor } from './palettes'
import { terrainGroundCover, terrainRoadStyle } from './settings'
export const groundCover = terrainGroundCover

export const groundCoverShade = defineParam({
  id: 'terrain.groundCoverShade', label: 'Ground darkened under grass', group: 'Terrain', scope: 'world', default: 1, min: 0, max: 1, step: 0.05,
})

/**
 * No plant on any world stands taller than this, in metres, whatever its shape or scale:
 * the owner's rule is grass and small flowers only, nothing that reads as a tree, palm,
 * shrub or cactus. Enforced where plants are placed, so a new shape cannot break it.
 */
export const MAX_PLANT_HEIGHT = 0.6

/** The highest point of a plant shape at scale 1, in metres. */
export function plantTop(geometry: THREE.BufferGeometry): number {
  const p = geometry.getAttribute('position')
  let top = 0
  for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i))
  return top
}

/**
 * For each ground cover layer on a planet (by its look): its tallest plant before and after
 * the height cap, sampled over many cells. For tests and reports.
 */
export function coverHeights(look: number, treeLine = 100): { top: number; tallest: number; capped: number }[] {
  const layers = (FLORA[look] ?? FLORA[0]).layers(treeLine)
  return layers.map((spec) => {
    const top = plantTop(spec.geometry)
    const cap = MAX_PLANT_HEIGHT / top
    let most = 0
    const out: Plant = { scale: 0, r: 1, g: 1, b: 1, lx: 0, lz: 0 }
    for (let h = 0; h < 30000; h++) {
      for (const patch of [0.2, 0.5, 0.7, 0.9]) {
        out.scale = 0
        spec.grow({
          x: 0, z: 0, y: 1, patch, region: patch, rock: 0, flow: patch > 0.6 ? 1 : 0,
          clumpD: 0.2, clump: patch, outX: 1, outZ: 0, treeLine,
        }, (h * 2654435761) >>> 0, out)
        most = Math.max(most, out.scale)
      }
    }
    // The soft cap in Layer.plantCell never exceeds the hard one used here.
    return { top, tallest: top * most, capped: top * Math.min(most, cap) }
  })
}

/** Nothing grows within this height of the sea level: the largest wave crest plus 0.3 m. */
const SHORE_MARGIN = 1.8

/** Beside a made road nothing grows within this distance of its centreline, in metres. */
const ROAD_CLEAR = 7.5

/**
 * Beside a worn track (two wheel ruts about 1.3 m either side of the centreline, worn
 * ground fading out by 3.6 to 5 m): short grass on the crown between the ruts, bare ruts,
 * and growth thinning back in from TRACK_RUTS to TRACK_CLEAR.
 */
const TRACK_CROWN = 0.6
const TRACK_RUTS = 2.2
const TRACK_CLEAR = 4.5

/** Whether this planet's roads are drawn as worn tracks: its palette, unless the shared slider overrides it. */
export function roadsAreTracks(look: number): boolean {
  const style = Math.round(terrainRoadStyle.value)
  return style === 2 || (style === 0 && paletteFor(look).track > 0)
}

/** Distance to the nearest road centreline at a wrapped world point, interpolated between grid points. */
function roadDistAt(data: HeightSampler['data'], wx: number, wz: number): number {
  const half = data.size / 2, n = data.resolution
  const fx = Math.max(0, Math.min(n - 1.001, (wx + half) / data.cell))
  const fz = Math.max(0, Math.min(n - 1.001, (wz + half) / data.cell))
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz
  const r = data.roadDist, i = iz * n + ix
  const a = r[i] + (r[i + 1] - r[i]) * tx
  const b = r[i + n] + (r[i + n + 1] - r[i + n]) * tx
  return a + (b - a) * tz
}

/** Plants count as near a river, pool or shore within this many metres of its edge. */
const FLOW_REACH = 35

/** Grass clumps: one per cell of this size, its centre jittered inside the cell. Divides every tile size. */
const CLUMP = 3.2

/**
 * The coverage map: one texel per cell of the shading layer (the main grass), indexed the
 * same way as its treadmill slots, so the terrain can sample it with world position and
 * repeat wrapping. Every world's shading layer must use this grid.
 */
const SHADE_N = 176
const SHADE_SPACING = 0.8
const SHADE_REACH = SHADE_N * SHADE_SPACING * 0.5

const UP = new THREE.Vector3()

// ---------------------------------------------------------------------------------------
// One scrolling layer
// ---------------------------------------------------------------------------------------

/** Camera cells are snapped to blocks this size, so rows are recomputed a few times a second, not every frame. */
const BLOCK = 8

/**
 * Replanting is spread over frames: all layers together spend about this long on it each
 * frame, in milliseconds. Measured on a desktop, replanting every row a block crossing
 * scrolled in one frame took 3 ms often and 45 to 54 ms when the layers' blocks lined
 * up, which is a visible hitch at driving speed. The rows that scroll in are at the far edge,
 * where plants have already thinned to nothing, so arriving a few frames late does not show.
 */
const SLICE_MS = 1.2
/** Cells replanted between looks at the clock. */
const SLICE_CELLS = 48

/**
 * What each graphics level grows. `density` is the share of the main grass that is
 * planted and `reach` the share of the full distance plants are drawn to; flowers keep
 * their numbers, being few and cheap. Level 0 (safe) grows nothing. Level 1 (phones and
 * tablets) draws about a sixth of the desktop's plants: see COVER_TIERS in the tests.
 */
export const COVER_TIERS: readonly ({ density: number; reach: number } | null)[] = [
  null,
  { density: 0.5, reach: 0.6 },
  { density: 1, reach: 1 },
]

/**
 * A layer with a cheaper far shape (LayerSpec.far) draws the full one out to about this
 * distance, in metres. Each plant changes at its own distance within a fifth of it, so no
 * line shows. Measured in an alpine meadow on a desktop, grass was 960 thousand triangles
 * a frame before this.
 */
const LOD_NEAR = 24

/** The share of each treadmill's reach that plants are drawn to, by graphics level. Read by the shaders. */
const reachScale = uniform(1)

/** One shape drawn many times: its mesh and the per-plant values the shader reads. */
class Batch {
  readonly mesh: THREE.Mesh
  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly origin: THREE.InstancedBufferAttribute
  private readonly param: THREE.InstancedBufferAttribute
  private readonly tint: THREE.InstancedBufferAttribute
  private readonly ground: THREE.InstancedBufferAttribute
  /** Plants written so far in this pass. */
  private k = 0

  constructor(shape: THREE.BufferGeometry, count: number, material: THREE.Material) {
    const g = shape as THREE.InstancedBufferGeometry
    g.instanceCount = 0
    this.geometry = g
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    this.param = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    this.ground = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    g.setAttribute('aOrigin', this.origin)
    g.setAttribute('aParam', this.param)
    g.setAttribute('aPlantTint', this.tint)
    g.setAttribute('aGround', this.ground)
    this.mesh = new THREE.Mesh(g, material)
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
  }

  begin(): void { this.k = 0 }

  /** Add the plant in slot `s` of the layer's slot arrays. */
  add(sO: Float32Array, sP: Float32Array, sT: Float32Array, sG: Float32Array, s: number): void {
    const k = this.k++
    const O = this.origin.array as Float32Array, P = this.param.array as Float32Array
    const T = this.tint.array as Float32Array, G = this.ground.array as Float32Array
    O[k * 3] = sO[s * 3]; O[k * 3 + 1] = sO[s * 3 + 1]; O[k * 3 + 2] = sO[s * 3 + 2]
    P[k * 4] = sP[s * 4]; P[k * 4 + 1] = sP[s * 4 + 1]; P[k * 4 + 2] = sP[s * 4 + 2]; P[k * 4 + 3] = sP[s * 4 + 3]
    T[k * 3] = sT[s * 3]; T[k * 3 + 1] = sT[s * 3 + 1]; T[k * 3 + 2] = sT[s * 3 + 2]
    G[k * 4] = sG[s * 4]; G[k * 4 + 1] = sG[s * 4 + 1]; G[k * 4 + 2] = sG[s * 4 + 2]; G[k * 4 + 3] = sG[s * 4 + 3]
  }

  /** Draw what was added, uploading only that much. */
  end(): void {
    this.geometry.instanceCount = this.k
    for (const a of [this.origin, this.param, this.tint, this.ground]) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, Math.max(1, this.k) * a.itemSize)
      a.needsUpdate = true
    }
  }

  get drawn(): number { return this.geometry.instanceCount }

  dispose(): void { this.geometry.dispose() }
}

class Layer {
  /** The full shape, and the cheaper one for distant plants where the layer has one. */
  private readonly near: Batch
  private readonly far: Batch | null
  // What each slot holds, by slot. Only slots where something grows are copied to the
  // instance attributes, so empty cells cost nothing to draw: most layers are sparse.
  private readonly slotOrigin: Float32Array
  private readonly slotParam: Float32Array
  private readonly slotTint: Float32Array
  private readonly slotGround: Float32Array
  private readonly cellX: Int32Array
  private readonly cellZ: Int32Array
  private readonly plant: Plant = { scale: 0, r: 1, g: 1, b: 1, lx: 0, lz: 0 }
  private readonly ground: Ground = {
    x: 0, z: 0, y: 0, patch: 0, region: 0, rock: 0, flow: 0, clumpD: 0, clump: 0, outX: 0, outZ: 0, treeLine: 0,
  }
  private filled = false
  /** The block-snapped corner of the cells the slots stand for now. */
  private lowX = 0
  private lowZ = 0
  /** Slots still to be checked against that corner, and where the check has got to. */
  private left = 0
  private cursor = 0
  /** Some slot was replanted since the instances were last written. */
  private dirty = false
  /** Where the camera was when the instances were last written. */
  private drawnX = 0
  private drawnZ = 0
  /** The largest scale this layer's shape may take and stay under MAX_PLANT_HEIGHT. */
  private readonly maxScale: number

  constructor(
    private readonly spec: LayerSpec, private readonly sampler: HeightSampler, private readonly seed: number,
    material: THREE.Material,
    /** Coverage per slot, written when this is the shading layer. */
    private readonly cover: Uint8Array | null,
    /** Roads on this planet are worn tracks, so growth comes up to them. */
    private readonly tracks = false,
  ) {
    const count = spec.n * spec.n
    this.maxScale = MAX_PLANT_HEIGHT / Math.max(1e-3, plantTop(spec.geometry))
    this.slotOrigin = new Float32Array(count * 3)
    this.slotParam = new Float32Array(count * 4)
    this.slotTint = new Float32Array(count * 3)
    this.slotGround = new Float32Array(count * 4)
    this.near = new Batch(spec.geometry, count, material)
    this.far = spec.far ? new Batch(spec.far, count, material) : null
    this.cellX = new Int32Array(count)
    this.cellZ = new Int32Array(count)
  }

  get meshes(): THREE.Mesh[] { return this.far ? [this.near.mesh, this.far.mesh] : [this.near.mesh] }

  /**
   * Bring the slots toward the cells nearest the camera that they stand for, replanting
   * until `deadline` (a performance.now() time; the first fill ignores it, so a new world
   * starts fully planted). Slots are checked in a lap that carries on where it stopped, so
   * a camera that outruns the budget still reaches every slot in turn. Returns whether the
   * drawn plants changed.
   */
  follow(camX: number, camZ: number, amount: number, treeLine: number, deadline: number): boolean {
    const { n, spacing } = this.spec
    const count = n * n
    const lowX = Math.floor(camX / spacing / BLOCK) * BLOCK - n / 2
    const lowZ = Math.floor(camZ / spacing / BLOCK) * BLOCK - n / 2
    if (!this.filled || lowX !== this.lowX || lowZ !== this.lowZ) {
      this.lowX = lowX
      this.lowZ = lowZ
      this.left = count
    }
    let sinceClock = 0
    while (this.left > 0) {
      const s = this.cursor
      this.cursor = s + 1 === count ? 0 : s + 1
      this.left--
      const i = s % n, j = (s - i) / n
      const cx = lowX + ((((i - lowX) % n) + n) % n)
      const cz = lowZ + ((((j - lowZ) % n) + n) % n)
      if (this.filled && this.cellX[s] === cx && this.cellZ[s] === cz) continue
      this.cellX[s] = cx
      this.cellZ[s] = cz
      this.plantCell(s, cx, cz, amount, treeLine)
      this.dirty = true
      if (this.filled && ++sinceClock >= SLICE_CELLS) {
        sinceClock = 0
        if (performance.now() >= deadline) break
      }
    }
    const done = this.left === 0
    if (done) this.filled = true
    // The instances are written when a lap that replanted something finishes. They are also
    // written once the camera has moved a margin from where they were last written: plants
    // left out as too far away may have come into reach, and a camera faster than the
    // budget (a low jet) never finishes a lap but still sees what has been replanted.
    const moved = Math.hypot(camX - this.drawnX, camZ - this.drawnZ)
    // A layer with a far shape rewrites twice as often, so plants change shape close to
    // their own distance and not a block late.
    if (!(done && this.dirty) && moved < (this.far ? this.margin * 0.5 : this.margin)) return false
    const changed = this.dirty
    this.dirty = false
    this.compact(camX, camZ)
    return changed
  }

  /** Whether every slot shows the cell it stands for. */
  get settled(): boolean { return this.filled && this.left === 0 }

  /** Plants further than the drawn reach plus this, in metres, are not sent to the GPU. */
  private get margin(): number { return BLOCK * this.spec.spacing }

  /** Copy the slots where something grows into the instance attributes, and draw only those. */
  private compact(camX: number, camZ: number): void {
    this.drawnX = camX
    this.drawnZ = camZ
    // No plant is drawn past 0.95 of the reach (see coverMaterial), so those beyond it are
    // left out: the corners of the square treadmill on every device, and the outer ring
    // on the levels that draw a shorter distance.
    const far = this.spec.n * this.spec.spacing * 0.5 * 0.95 * reachScale.value + this.margin
    const far2 = far * far
    const sP = this.slotParam, sO = this.slotOrigin, sT = this.slotTint, sG = this.slotGround
    const { near, far: distant } = this
    near.begin()
    distant?.begin()
    for (let s = 0, n = sP.length / 4; s < n; s++) {
      if (!(sP[s * 4 + 1] > 0)) continue
      const dx = sO[s * 3] - camX, dz = sO[s * 3 + 2] - camZ
      const d2 = dx * dx + dz * dz
      if (d2 > far2) continue
      if (distant) {
        // Each plant changes shape at its own distance, picked by its random turn.
        const at = LOD_NEAR * (0.8 + 0.4 * ((sP[s * 4] * 2.17) % 1))
        if (d2 > at * at) { distant.add(sO, sP, sT, sG, s); continue }
      }
      near.add(sO, sP, sT, sG, s)
    }
    near.end()
    distant?.end()
  }

  /** This layer's plants shade the ground, and are the ones a lower graphics level thins. */
  get shading(): boolean { return !!this.cover }

  /** How many plants this layer draws now. */
  get drawn(): number { return this.near.drawn + (this.far?.drawn ?? 0) }

  /** How many of them are drawn with the full shape. */
  get drawnNear(): number { return this.near.drawn }

  private plantCell(s: number, cx: number, cz: number, amount: number, treeLine: number): void {
    const data = this.sampler.data
    const { spacing } = this.spec
    const cells = Math.round(data.size / spacing)
    const h = phash2(cx, cz, this.seed, cells)
    const x = (cx + 0.1 + 0.8 * unit(h, 0)) * spacing
    const z = (cz + 0.1 + 0.8 * unit(h, 10)) * spacing
    const P = this.slotParam
    P[s * 4] = unit(h, 5) * Math.PI * 2
    P[s * 4 + 1] = 0
    P[s * 4 + 2] = 0
    P[s * 4 + 3] = 0
    if (this.cover) this.cover[s] = 0
    const O = this.slotOrigin
    O[s * 3] = x
    O[s * 3 + 2] = z
    if (unit(phash2(cx, cz, this.seed + 3, cells), 3) > amount) return
    const y = this.sampler.heightAt(x, z)
    O[s * 3 + 1] = y
    // Dry, gentle ground, off the roads.
    const wx = wrapCoord(x, data.size), wz = wrapCoord(z, data.size)
    // Clear of the sea by the tallest wave the Water Lab's waves can raise (1.5 m, its
    // WAVE_MAX_AMPLITUDE in shared/water/waves.ts) plus a little.
    const sea = worldLavaAltitude.value
    if (y < sea + SHORE_MARGIN || lavaSurfaceAt(data.lava, wx, wz, -1e9) > y - 0.3) return
    const nrm = this.sampler.normalAt(x, z, UP)
    if (nrm.y < 0.84) return
    const half = data.size / 2
    const gi = Math.min(data.resolution - 1, Math.round((wz + half) / data.cell)) * data.resolution +
      Math.min(data.resolution - 1, Math.round((wx + half) / data.cell))
    const road = roadDistAt(data, wx, wz)
    let roadScale = 1
    if (!this.tracks) {
      if (road < ROAD_CLEAR) return
    } else if (road < TRACK_CROWN) {
      // Only short grass on the crown between the ruts.
      if (!this.cover) return
      roadScale = 0.45
    } else if (road < TRACK_CLEAR) {
      if (road < TRACK_RUTS) return
      // Thinning back in from the worn edge of the track, shorter nearer it.
      const t = (road - TRACK_RUTS) / (TRACK_CLEAR - TRACK_RUTS)
      if (unit(phash2(cx, cz, this.seed + 5, cells), 7) > t * t * (3 - 2 * t)) return
      roadScale = 0.55 + 0.45 * t
    }
    const g = this.ground
    g.x = x; g.z = z; g.y = y
    g.treeLine = treeLine
    g.rock = data.volcanic[gi]
    const pc = Math.max(1, Math.round(data.size * 0.012))
    g.patch = 0.5 + 0.5 * pperlin((x / data.size) * pc, (z / data.size) * pc, this.seed + 9, pc, pc)
    const rc = Math.max(1, Math.round(data.size * 0.004))
    g.region = 0.5 + 0.5 * pperlin((x / data.size) * rc, (z / data.size) * rc, 4242, rc, rc)
    g.flow = flowAt(this.sampler, wx, wz, y - sea)
    clumpAt(g, x, z, Math.round(data.size / CLUMP), (data.seed * 7 + 5) | 0)
    const p = this.plant
    p.scale = 0; p.lx = 0; p.lz = 0
    this.spec.grow(g, h, p)
    if (!(p.scale > 0)) return
    p.scale *= roadScale
    // Soft cap: small plants keep their size, tall ones are pressed under the limit
    // gradually, so a layer near the cap keeps its variety instead of all stopping at it.
    P[s * 4 + 1] = this.maxScale * Math.tanh(p.scale / this.maxScale)
    P[s * 4 + 2] = p.lx
    P[s * 4 + 3] = p.lz
    const T = this.slotTint
    T[s * 3] = p.r; T[s * 3 + 1] = p.g; T[s * 3 + 2] = p.b
    const G = this.slotGround
    G[s * 4] = nrm.x; G[s * 4 + 1] = nrm.y; G[s * 4 + 2] = nrm.z; G[s * 4 + 3] = g.rock
    if (this.cover) this.cover[s] = Math.min(255, Math.round(180 * Math.min(1.4, p.scale)))
  }

  dispose(): void {
    this.near.dispose()
    this.far?.dispose()
  }
}

/**
 * How close the nearest river, pool or shore is: 1 at its edge, falling to 0 FLOW_REACH
 * metres away. On volcanic worlds that is lava, on the others water. `aboveSea` is the
 * ground's height over the sea.
 */
export function flowAt(sampler: HeightSampler, x: number, z: number, aboveSea: number): number {
  const lava = sampler.data.lava
  let best = Math.max(0, aboveSea - SHORE_MARGIN) * 2.5
  for (const p of lava.pools) {
    const d = Math.hypot(p.x - x, p.z - z) - p.radius
    if (d < best) best = d
  }
  for (const r of lava.rivers) {
    const b = r.bounds
    if (x < b.minX - FLOW_REACH || x > b.maxX + FLOW_REACH || z < b.minZ - FLOW_REACH || z > b.maxZ + FLOW_REACH) continue
    const d = distanceToPolyline(r.points, false, x, z) - r.width / 2
    if (d < best) best = d
  }
  const t = Math.max(0, Math.min(1, 1 - best / FLOW_REACH))
  return t * t
}

/**
 * The nearest grass clump to (x, z): its distance, a hash shared by its blades, and the
 * direction from its centre. Clumps sit one per CLUMP cell, jittered, and repeat with the
 * world (`period` clump cells across it).
 */
function clumpAt(g: Ground, x: number, z: number, period: number, seed: number): void {
  const ix = Math.floor(x / CLUMP), iz = Math.floor(z / CLUMP)
  let best = Infinity, bh = 0, bx = 0, bz = 0
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const h = phash2(ix + dx, iz + dz, seed, period)
      const px = (ix + dx + 0.15 + 0.7 * unit(h, 0)) * CLUMP
      const pz = (iz + dz + 0.15 + 0.7 * unit(h, 10)) * CLUMP
      const d = Math.hypot(x - px, z - pz)
      if (d < best) { best = d; bh = h; bx = px; bz = pz }
    }
  }
  g.clumpD = best
  g.clump = unit(bh, 20)
  const inv = best > 1e-4 ? 1 / best : 0
  g.outX = (x - bx) * inv
  g.outZ = (z - bz) * inv
}

// ---------------------------------------------------------------------------------------
// The shared material
// ---------------------------------------------------------------------------------------

/**
 * How bright glow is: faint by day, full at night, and divided by how far the camera's
 * exposure has risen so glowing plants keep their colour instead of burning out to white.
 * Set each frame by GroundCover.
 */
const glowScale = uniform(1)

/** Placement, wind and distance thinning in the vertex stage; colour, light and glow after. */
function coverMaterial(reach: number, look: TerrainMaterial | null): THREE.MeshStandardNodeMaterial {
  const origin = attribute<'vec3'>('aOrigin', 'vec3')
  const param = attribute<'vec4'>('aParam', 'vec4')
  const plantTint = attribute<'vec3'>('aPlantTint', 'vec3')
  const groundAttr = attribute<'vec4'>('aGround', 'vec4')
  const local = attribute<'vec3'>('position', 'vec3')
  const baseColor = attribute<'vec3'>('color', 'vec3')
  const shape = attribute<'vec4'>('aShape', 'vec4')
  const sway = shape.x
  const tintMix = shape.y
  const glow = shape.z
  const own = shape.w

  const c = cos(param.x)
  const s = sin(param.x)
  // Thin out with distance plant by plant: each one (picked by its random turn) vanishes
  // at its own distance between half the treadmill's reach and its edge, so the edge of
  // the cover is a gradual thinning, not a ring.
  const pick = fract(param.x.mul(1.37))
  const dist = vec2(origin.x, origin.z).sub(vec2(cameraPosition.x, cameraPosition.z)).length()
  const drawnReach = reachScale.mul(reach)
  const goneAt = pick.mul(0.45).add(0.5).mul(drawnReach)
  const size = param.y.mul(smoothstep(goneAt, goneAt.sub(drawnReach.mul(0.06)), dist))
  const turned = vec3(local.x.mul(c).add(local.z.mul(s)), local.y, local.z.mul(c).sub(local.x.mul(s))).mul(size)
  // Clump lean: the whole plant shears sideways with height.
  const lean = vec3(param.z, 0, param.w).mul(local.y.mul(size))
  // Wind: a slow gust front crossing the world plus each plant's own flutter, bending the
  // tips and leaving the roots still. Plumes (sway above 1) bob a little more.
  const tipness = sway.min(1)
  const gust = sin(origin.x.mul(0.07).add(origin.z.mul(0.05)).add(time.mul(1.3))).mul(0.5).add(0.5)
  const flutter = sin(time.mul(2.6).add(origin.x.mul(1.7)).add(origin.z.mul(2.3)))
  const bend = tipness.mul(tipness).mul(size).mul(gust.mul(0.16).add(flutter.mul(0.035)))
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
  material.positionNode = origin.add(turned).add(lean).add(vec3(bend, 0, bend.mul(0.6)))

  // Lit with the ground's normal at the plant's foot, tipped a little toward straight up
  // for the upper parts so tall stems catch some sky.
  const groundN = vec3(groundAttr.x, groundAttr.y, groundAttr.z)
  const n = normalize(mix(groundN, vec3(0, 1, 0), tipness.mul(0.25)))
  material.normalNode = normalize(cameraViewMatrix.transformDirection(n))

  // The ground's own colour at the plant's foot, once per vertex (constant across a plant).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const soil: any = look
    ? varying(look.groundColour(origin, groundAttr.y, groundAttr.w) as GroundNode)
    : vec3(0.35, 0.3, 0.25)
  const mine = baseColor.mul(mix(vec3(1), plantTint, tintMix))
  // Far plants sink back toward the ground's colour before they vanish.
  const far = smoothstep(drawnReach.mul(0.45), drawnReach.mul(0.92), dist)
  const showMine = own.mul(float(1).sub(far.mul(0.55)))
  // The base is darkened: a contact shadow where the plant meets the soil.
  const contact = smoothstep(0, 0.22, local.y.mul(size)).mul(0.45).add(0.55)
  material.colorNode = mix(soil, mine, showMine).mul(contact)
  // Glow only where the geometry asks for it (hearts and tips), in the plant's own colour.
  // Pulses in slow waves that travel across the ground, so a grove breathes together.
  const pulse = sin(time.mul(1.6).sub(origin.x.mul(0.11)).sub(origin.z.mul(0.08))).mul(0.3).add(0.8)
  material.emissiveNode = mine.mul(glow).mul(pulse).mul(glowScale).mul(float(1).sub(far))
  return material
}

/** The ground's tint under dense growth, and how strongly it is applied. */
const shadeTint = uniform(new THREE.Color(1, 1, 1))
const shadeStrength = uniform(1)

// ---------------------------------------------------------------------------------------

export class GroundCover implements System {
  private readonly group = new THREE.Group()
  private layers: Layer[] = []
  private material: THREE.MeshStandardNodeMaterial[] = []
  private amount = -1
  private roadStyle = -1
  private tier = COVER_TIERS[2]
  /** How long replanting may take each frame, in milliseconds. Tests set it to finish at once or to crawl. */
  sliceMs = SLICE_MS
  private treeLine = 0
  /** Coverage of the shading layer, one byte per slot; see SHADE_N. */
  private readonly cover = new Uint8Array(SHADE_N * SHADE_N)
  private readonly coverTex = new THREE.DataTexture(this.cover, SHADE_N, SHADE_N, THREE.RedFormat, THREE.UnsignedByteType)

  /**
   * `exposureOver` reports how many times its daytime value the camera exposure is now.
   * `look` is the terrain's material: plants take their roots' colour from it and it
   * darkens the ground under dense growth.
   */
  constructor(
    private readonly scene: THREE.Scene, private readonly sampler: HeightSampler, private readonly camera: THREE.Camera,
    private readonly exposureOver: () => number = () => 1,
    private readonly look: TerrainMaterial | null = null,
  ) {
    this.group.name = 'groundcover'
    scene.add(this.group)
    const t = this.coverTex
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.magFilter = t.minFilter = THREE.LinearFilter
    t.generateMipmaps = false
    t.needsUpdate = true
    look?.setCoverShade((at: GroundNode, col: GroundNode) => {
      // Five taps spread over about three cells: the shade follows the density of the
      // growth, not each tuft, so it reads as a damp, shaded meadow floor, not as spots.
      const uv = vec2(at.x, at.z).div(SHADE_N * SHADE_SPACING)
      const o = 1.6 / SHADE_N
      const d = texture(t, uv).r.add(texture(t, uv.add(vec2(o, o))).r).add(texture(t, uv.add(vec2(-o, o))).r)
        .add(texture(t, uv.add(vec2(o, -o))).r).add(texture(t, uv.add(vec2(-o, -o))).r).mul(0.2)
      const shadeReach = reachScale.mul(SHADE_REACH)
      const near = smoothstep(shadeReach.mul(0.95), shadeReach.mul(0.5), vec2(at.x, at.z).sub(vec2(cameraPosition.x, cameraPosition.z)).length())
      return mix(col, col.mul(shadeTint), smoothstep(0.1, 0.8, d).mul(near).mul(shadeStrength).mul(0.75))
    })
    this.rebuild()
  }

  /**
   * The graphics level: 2 grows everything, 1 a thinner, nearer cover for phones and
   * tablets, 0 nothing. See COVER_TIERS.
   */
  setLevel(level: number): void {
    const tier = COVER_TIERS[Math.max(0, Math.min(2, Math.round(level)))]
    if (tier === this.tier) return
    this.tier = tier
    this.group.visible = !!tier
    reachScale.value = tier?.reach ?? 1
    // The density differs, so replant; with nothing growing, clear the ground's shade too.
    this.rebuild()
  }

  /** How many plants each layer draws now, and whether every layer has caught up with the camera. */
  stats(): { drawn: number[]; near: number[]; settled: boolean } {
    return {
      drawn: this.layers.map((l) => l.drawn), near: this.layers.map((l) => l.drawnNear),
      settled: this.layers.every((l) => l.settled),
    }
  }

  private clearCover(): void {
    this.cover.fill(0)
    this.coverTex.needsUpdate = true
  }

  /** The terrain changed: replant for the new world. */
  rebuild(): void {
    this.disposeLayers()
    this.clearCover()
    const data = this.sampler.data
    const flora = FLORA[data.settings.look] ?? { layers: () => [], shade: 0xffffff }
    this.treeLine = data.layout.summitHeight * 0.3
    shadeTint.value.setHex(flora.shade)
    // A level that grows nothing builds no layers and leaves the ground unshaded.
    const specs = this.tier ? flora.layers(this.treeLine) : []
    const tracks = roadsAreTracks(data.settings.look)
    this.roadStyle = terrainRoadStyle.value
    this.layers = specs.map((spec, i) => {
      // Layers on the same grid share a material: it depends only on the treadmill's reach.
      const reach = spec.n * spec.spacing * 0.5
      let m = this.material.find((x) => x.userData.reach === reach)
      if (!m) {
        m = coverMaterial(reach, this.look)
        m.userData.reach = reach
        this.material.push(m)
      }
      const shading = !!spec.shade
      if (shading && (spec.n !== SHADE_N || spec.spacing !== SHADE_SPACING)) throw new Error('the shading layer must use the coverage grid')
      const layer = new Layer(spec, this.sampler, (data.seed * 31 + 77 + i * 1013) | 0, m, shading ? this.cover : null, tracks)
      this.group.add(...layer.meshes)
      return layer
    })
    this.amount = groundCover.value
  }

  update(): void {
    if (!this.tier) return
    // The road style is a look only, so the terrain does not regenerate: replant here.
    if (groundCover.value !== this.amount || terrainRoadStyle.value !== this.roadStyle) this.rebuild()
    // At zero nothing is drawn at all.
    this.group.visible = this.amount > 0
    shadeStrength.value = this.amount > 0 ? groundCoverShade.value : 0
    if (this.amount <= 0) return
    const over = this.exposureOver()
    // Night is when the exposure has been raised well above its daytime value: measured,
    // it is about 1.9 by day and 7.6 at night on a volcanic world.
    const night = Math.max(0, Math.min(1, (over - 2.5) / 3.5))
    glowScale.value = (0.3 + 3.7 * night) / Math.max(1, over)
    const p = this.camera.position
    let changed = false
    // One deadline for all layers, so the frame's replanting is bounded however many
    // layers scrolled at once.
    const deadline = performance.now() + this.sliceMs
    for (const l of this.layers) {
      const amount = l.shading ? this.amount * this.tier.density : this.amount
      changed = l.follow(p.x, p.z, amount, this.treeLine, deadline) || changed
    }
    // The coverage map is 31 kB: re-uploading it when any row scrolled is cheap.
    if (changed) this.coverTex.needsUpdate = true
  }

  private disposeLayers(): void {
    for (const l of this.layers) { this.group.remove(...l.meshes); l.dispose() }
    this.layers = []
  }

  dispose(): void {
    this.disposeLayers()
    for (const m of this.material) m.dispose()
    this.material = []
    this.look?.setCoverShade(null)
    this.coverTex.dispose()
    this.scene.remove(this.group)
  }
}
