/**
 * Ground pools: the light other vehicles' headlights throw on the ground ahead of them. The
 * owner, 24 November 2026: "if the frame rate can be supported, bot headlights should
 * illuminate the ground."
 *
 * No light is added for them. A real light per bot would rebuild every lit shader when one
 * arrives and costs every lit pixel on screen; only your own vehicle has real spot lights
 * (effects/index.ts). Instead each other vehicle with its lamps on gets a patch of mesh laid on
 * the ground ahead of it:
 *
 *   - one mesh for every pool, one draw call, one material, built under cover with the rest
 *     (EffectWorld.registerWarm), so nothing is built when a bot arrives or leaves;
 *   - each patch is a small grid draped over the terrain on the CPU each frame (terrain.heightAt
 *     at each vertex of the visible terrain grid) and bent with the planet like everything else drawn (applyCurve);
 *   - the shape of the light is computed per pixel in the shader from each vertex's place in its
 *     patch: brightest just ahead of the lamps, widening and fading down the road, soft at the
 *     sides. Nothing is loaded;
 *   - it adds light tinted by the colour of the ground under it (groundTone.ts groundColour, the
 *     colour the terrain itself is drawn from), plus the lamp's own warm white in its hot centre
 *     (POOL_CORE), as a strongly lit patch of ground saturates toward the beam's colour. So the
 *     core is pale, the edges red on red sand and dark rock stays dark,
 *     and the amount added does not depend on how much moon or dusk light is already there, as
 *     with a real lamp. (A first version multiplied the ground instead; at dusk the ground is
 *     darker than under the moon and the pools nearly vanished.) No depth or colour copy is
 *     read, and the shadow pass is not involved.
 *
 * Where the light falls is not drawn by hand: each pixel of the patch evaluates the same spot
 * equation as the player's own lamps, from the vehicle's one lamp pose (lamps.ts): the lamp's
 * place and axis, its spread with an even fall from the axis, a linear fall with distance to its
 * reach, and the ground facing the lamp. So a pool is exactly where the beam in mist (cones.ts)
 * lands, bright centre and soft skirt out to the full spread. A lamp too high for its lower
 * edge to reach the ground throws no pool at all.
 *
 * Strength per vehicle follows its lamps as the beams in mist do (cones.ts): the dusk-to-dawn
 * ramp of the real spot lights, the room's buggy headlight setting (light.buggyHeadlights) for
 * buggies, and each kind's beam factor (light.buggyBeams, light.hovercraftBeams, light.jetBeams),
 * all in the Game card's Vehicle looks. Then light.groundPools, each player's own: 0 is off,
 * and the quality level sets it (core/quality.ts PRESET_TABLE).
 */
import * as T from 'three/webgpu'
import { attribute, clamp, dot, float, max, normalize, pow, positionGeometry, smoothstep, vec3 } from 'three/tsl'
import { defineParam } from '../../../shared/params'
import { applyCurve } from '../../world/curve'
import { groundHit, lampAxis, type LampPose } from './lamps'

type N = any // TSL node

/**
 * Other vehicles' headlight pools on the ground: 0 off, 1 the strength matched to your own
 * vehicle's real beam on the same ground (tuned by night frames). Each player's own setting,
 * set by the quality level.
 */
export const groundPools = defineParam({
  id: 'light.groundPools', label: "Other vehicles' headlights on the ground", group: 'Light', scope: 'client',
  default: 1, min: 0, max: 2, step: 0.05,
})

// A 60 m lamp with a 30 degree spread fits within 24 cells of the usual 4 m lattice.
// Finer worlds use a power-of-two multiple of their cell pitch to bound the work per pool.
const MAX_CELLS = 24
const VERTS = (MAX_CELLS + 1) ** 2, INDICES = MAX_CELLS ** 2 * 6
/** Metres above the ground the patch is laid, against flicker with the terrain's own surface. */
const LIFT = 0.06
/** Pools beyond this distance from the camera are not drawn; they fade over the last FADE_FAR m. */
export const POOL_RANGE = 220
const FADE_FAR = 40
/** Light added at the pool's brightest point at strength 1, times the ground's colour. Tuned by frames. */
export const POOL_PEAK = 5
/** The spot equation's value (spread fall times the ground facing the lamp over distance) that POOL_PEAK is for: 3 m ahead. */
export const POOL_REFERENCE = .067
/**
 * The lamp's own colour added in the hot centre, as a share of POOL_PEAK: where a real beam is
 * strong the lit ground saturates toward the beam's warm white; the edges keep the ground's
 * colour. Applied to the pool's shape raised to POOL_CORE_POWER, so it stays in the core.
 */
export const POOL_CORE = 0.6, POOL_CORE_POWER = 2
/** The beam's warm white, as the real spot lights use. */
const BEAM = new T.Color(1, 0.9965517, 0.875)

/** One vehicle's pool to draw this frame. */
export interface PoolSource {
  readonly object: T.Object3D
  /** The vehicle's one lamp pose (lamps.ts), and the scale its lamp points are drawn at. */
  readonly pose: LampPose
  readonly size: number
  /** 0 to 1 and beyond: night ramp times the lamp's and the kind's factors times groundPools. */
  readonly strength: number
}

/** Linear colour of the ground (or water) at a point, written into `out`. */
export type TintAt = (x: number, z: number, out: { r: number; g: number; b: number }) => void

const local = new T.Vector3(), lamp = new T.Vector3(), axis = new T.Vector3(), lower = new T.Vector3(), along = new T.Vector3(), q = new T.Quaternion()

export class GroundPools {
  readonly mesh: T.Mesh
  readonly capacity: number
  private readonly positions: Float32Array
  private readonly slopes: Float32Array
  private readonly indices: Uint32Array
  private readonly strengths: Float32Array
  private readonly tints: Float32Array
  private readonly lamps: Float32Array
  private readonly axes: Float32Array
  private readonly tint = { r: 0, g: 0, b: 0 }
  /** Pools drawn last frame, for checks. */
  drawn = 0

  constructor(capacity = 24) {
    this.capacity = capacity
    const geometry = new T.BufferGeometry()
    this.positions = new Float32Array(capacity * VERTS * 3)
    this.slopes = new Float32Array(capacity * VERTS * 2)
    this.indices = new Uint32Array(capacity * INDICES)
    this.strengths = new Float32Array(capacity * VERTS)
    this.tints = new Float32Array(capacity * VERTS * 3)
    // Per vertex, its pool's lamp: place and the cosine of its spread; axis and reach.
    this.lamps = new Float32Array(capacity * VERTS * 4)
    this.axes = new Float32Array(capacity * VERTS * 4)
    geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolSlope', new T.BufferAttribute(this.slopes, 2).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolStrength', new T.BufferAttribute(this.strengths, 1).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolTint', new T.BufferAttribute(this.tints, 3).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolLamp', new T.BufferAttribute(this.lamps, 4).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolAxis', new T.BufferAttribute(this.axes, 4).setUsage(T.DynamicDrawUsage))
    geometry.setIndex(new T.BufferAttribute(this.indices, 1).setUsage(T.DynamicDrawUsage))
    // Never culled by bounds: the positions move every frame.
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), Infinity)
    this.mesh = new T.Mesh(geometry, poolMaterial())
    this.mesh.name = "Other vehicles' headlight pools"
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    // One patch always submitted (at strength 0 it changes nothing), so the pipeline is built by
    // the covered preparation draw and never during play.
    geometry.setDrawRange(0, 3)
  }

  /**
   * Lay this frame's pools. `heightAt` is the surface under a world point (the ground, or water
   * over it); `tintAt` its colour; `camera` is where the view is. Allocates nothing.
   */
  update(sources: readonly PoolSource[], camera: T.Vector3, heightAt: (x: number, z: number) => number, tintAt: TintAt, cell = 4, origin = 0): void {
    let n = 0, vertexCount = 0, indexCount = 0
    for (const s of sources) {
      if (n >= this.capacity) break
      if (!(s.strength > 0) || !s.object.visible) continue
      const o = s.object
      const distance = camera.distanceTo(o.position)
      if (distance > POOL_RANGE) continue
      // The lamp's place and axis in the world, from its one pose.
      const pose = s.pose
      lamp.set(0, pose.y * s.size, pose.z * s.size).applyQuaternion(o.quaternion).add(o.position)
      axis.copy(lampAxis(pose, axis)).applyQuaternion(o.quaternion).normalize()
      // No pool unless the lower edge of the light reaches the ground within the reach.
      local.set(1, 0, 0).applyQuaternion(o.quaternion)
      lower.copy(axis).applyQuaternion(q.setFromAxisAngle(local, -pose.spread)).normalize()
      if (groundHit(lamp, lower, pose.reach, heightAt) === null) continue
      const strength = s.strength * Math.min(1, (POOL_RANGE - distance) / FADE_FAR)
      if (!(strength > 0.002)) continue
      // The patch runs along the ground under the axis (or the vehicle's nose, if the axis is
      // nearly straight down), as wide as the spread at each distance.
      along.set(axis.x, 0, axis.z)
      if (along.lengthSq() < .04) along.set(0, 0, -1).applyQuaternion(o.quaternion).setY(0)
      along.normalize()
      // Bound the cone projected onto the horizontal plane, including a lamp aimed down.
      const reach = pose.reach, radius = reach * Math.tan(pose.spread)
      const endX = lamp.x + axis.x * reach, endZ = lamp.z + axis.z * reach
      const rx = radius * Math.sqrt(Math.max(0, 1 - axis.x * axis.x))
      const rz = radius * Math.sqrt(Math.max(0, 1 - axis.z * axis.z))
      const minX = Math.min(lamp.x, endX - rx), maxX = Math.max(lamp.x, endX + rx)
      const minZ = Math.min(lamp.z, endZ - rz), maxZ = Math.max(lamp.z, endZ + rz)
      const minPitch = Math.max(maxX - minX, maxZ - minZ) / (MAX_CELLS - 1)
      const pitch = cell * 2 ** Math.max(0, Math.ceil(Math.log2(minPitch / cell)))
      const left = origin + pitch * Math.floor((minX - origin) / pitch)
      const back = origin + pitch * Math.floor((minZ - origin) / pitch)
      const cols = Math.ceil((maxX - left) / pitch) + 1, rows = Math.ceil((maxZ - back) / pitch) + 1
      tintAt(lamp.x + along.x * 8, lamp.z + along.z * 8, this.tint)
      const cosSpread = Math.cos(pose.spread)
      const first = vertexCount
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = left + i * pitch, z = back + j * pitch
          const v = vertexCount++
          this.positions[v * 3] = x; this.positions[v * 3 + 1] = heightAt(x, z) + LIFT; this.positions[v * 3 + 2] = z
          this.strengths[v] = strength
          this.tints[v * 3] = this.tint.r; this.tints[v * 3 + 1] = this.tint.g; this.tints[v * 3 + 2] = this.tint.b
          this.lamps[v * 4] = lamp.x; this.lamps[v * 4 + 1] = lamp.y; this.lamps[v * 4 + 2] = lamp.z; this.lamps[v * 4 + 3] = cosSpread
          this.axes[v * 4] = axis.x; this.axes[v * 4 + 1] = axis.y; this.axes[v * 4 + 2] = axis.z; this.axes[v * 4 + 3] = reach
        }
      }
      // Match the terrain's anti-diagonal. Interpolate the slope between vertices so the
      // falloff of a grazing light is continuous across each shared triangle edge.
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const v = first + j * cols + i
        const west = v - Number(i > 0), east = v + Number(i + 1 < cols)
        const north = v - (j > 0 ? cols : 0), south = v + (j + 1 < rows ? cols : 0)
        this.slopes[v * 2] = (this.positions[east * 3 + 1] - this.positions[west * 3 + 1]) / ((east - west) * pitch)
        this.slopes[v * 2 + 1] = (this.positions[south * 3 + 1] - this.positions[north * 3 + 1]) / ((south - north) / cols * pitch)
        if (i + 1 === cols || j + 1 === rows) continue
        this.indices[indexCount++] = v; this.indices[indexCount++] = v + cols; this.indices[indexCount++] = v + 1
        this.indices[indexCount++] = v + 1; this.indices[indexCount++] = v + cols; this.indices[indexCount++] = v + cols + 1
      }
      n++
    }
    if (!n) {
      this.indices.fill(0, 0, 3)
      this.strengths[0] = 0
      vertexCount = 1; indexCount = 3
    }
    this.drawn = n
    const geometry = this.mesh.geometry
    geometry.setDrawRange(0, indexCount)
    for (const buffer of Object.values(geometry.attributes) as T.BufferAttribute[]) {
      buffer.clearUpdateRanges()
      buffer.addUpdateRange(0, vertexCount * buffer.itemSize)
      buffer.needsUpdate = true
    }
    const index = geometry.index!
    index.clearUpdateRanges()
    index.addUpdateRange(0, indexCount)
    index.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as T.Material).dispose()
  }
}

/**
 * The pool's light: the spot equation the player's own lamps use (lamps.ts poseSpot), evaluated
 * at each pixel from its pool's lamp: an even fall from the axis to nothing at the spread
 * (penumbra 1), a linear fall with distance (decay 1, with three.js's cutoff at the reach),
 * times the ground facing the lamp. Tinted by the ground's colour and added.
 */
function poolMaterial(): T.MeshBasicNodeMaterial {
  const material = new T.MeshBasicNodeMaterial()
  const strength = attribute('poolStrength', 'float') as N, tint = attribute('poolTint', 'vec3') as N
  const lampA = attribute('poolLamp', 'vec4') as N, axisA = attribute('poolAxis', 'vec4') as N
  // The patch's own vertices are world positions (the mesh is not moved), before the planet's curve.
  const toLamp = lampA.xyz.sub(positionGeometry) as N, distance = toLamp.length() as N
  const l = normalize(toLamp) as N
  const spot = smoothstep(lampA.w, float(1), dot(l.negate(), axisA.xyz)) as N
  // A rising slope can face the lamp even above its elevation.
  const slope = attribute('poolSlope', 'vec2') as N
  const upward = normalize(vec3(slope.x.negate(), 1, slope.y.negate()))
  const facing = max(dot(l, upward), float(0)) as N
  const cutoff = pow(clamp(float(1).sub(pow(distance.div(axisA.w), 4)), 0, 1), 2) as N
  // decay 1, as the player's own spots: a linear fall with distance.
  const shape = clamp(spot.mul(facing).mul(cutoff).div(max(distance, float(.5))).div(POOL_REFERENCE), 0, 1.5) as N
  const lamp = vec3(BEAM.r, BEAM.g, BEAM.b) as N
  material.colorNode = lamp.mul(tint).mul(shape).add(lamp.mul(pow(shape, POOL_CORE_POWER).mul(POOL_CORE))).mul(strength.mul(POOL_PEAK)) as N
  material.transparent = true
  material.depthWrite = false
  material.fog = false
  material.toneMapped = false
  material.blending = T.AdditiveBlending
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2
  applyCurve(material)
  return material
}
