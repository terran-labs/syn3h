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
 *     at each vertex) and bent with the planet like everything else drawn (applyCurve);
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
 * place and axis, its spread with an even fall from the axis, no fall with distance within its
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

// The patch: from POOL_NEAR metres behind the lamps to the lamp's reach ahead, along the ground
// under its axis, as wide as the spread there. ACROSS by ALONG vertices: enough to follow rolling
// ground; the light itself is computed per pixel.
export const POOL_NEAR = -0.6
const ACROSS = 9, ALONG = 16
const VERTS = ACROSS * ALONG, INDICES = (ACROSS - 1) * (ALONG - 1) * 6
/** Metres above the ground the patch is laid, against flicker with the terrain's own surface. */
const LIFT = 0.06
/** Pools beyond this distance from the camera are not drawn; they fade over the last FADE_FAR m. */
export const POOL_RANGE = 220
const FADE_FAR = 40
/** Light added at the pool's brightest point at strength 1, times the ground's colour. Tuned by frames. */
export const POOL_PEAK = 10
/** The spot equation's value (spread fall times the ground facing the lamp) that POOL_PEAK is for. */
export const POOL_REFERENCE = .2
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

const local = new T.Vector3(), world = new T.Vector3(), lamp = new T.Vector3(), axis = new T.Vector3(), lower = new T.Vector3(), along = new T.Vector3(), across = new T.Vector3(), q = new T.Quaternion()

export class GroundPools {
  readonly mesh: T.Mesh
  readonly capacity: number
  private readonly positions: Float32Array
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
    this.strengths = new Float32Array(capacity * VERTS)
    this.tints = new Float32Array(capacity * VERTS * 3)
    // Per vertex, its pool's lamp: place and the cosine of its spread; axis and reach.
    this.lamps = new Float32Array(capacity * VERTS * 4)
    this.axes = new Float32Array(capacity * VERTS * 4)
    // Each vertex's place in its patch, fixed: x across (-1 to 1), y along (0 near, 1 far).
    const place = new Float32Array(capacity * VERTS * 2)
    const index = new Uint32Array(capacity * INDICES)
    for (let c = 0, k = 0; c < capacity; c++) {
      for (let j = 0; j < ALONG; j++) for (let i = 0; i < ACROSS; i++) {
        const v = c * VERTS + j * ACROSS + i
        place[v * 2] = (i / (ACROSS - 1)) * 2 - 1; place[v * 2 + 1] = j / (ALONG - 1)
      }
      for (let j = 0; j < ALONG - 1; j++) for (let i = 0; i < ACROSS - 1; i++) {
        const a = c * VERTS + j * ACROSS + i
        // Wound to face up (the patch runs ahead along -z): the ground's side is never seen.
        index[k++] = a; index[k++] = a + 1; index[k++] = a + ACROSS
        index[k++] = a + 1; index[k++] = a + ACROSS + 1; index[k++] = a + ACROSS
      }
    }
    geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolPlace', new T.BufferAttribute(place, 2))
    geometry.setAttribute('poolStrength', new T.BufferAttribute(this.strengths, 1).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolTint', new T.BufferAttribute(this.tints, 3).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolLamp', new T.BufferAttribute(this.lamps, 4).setUsage(T.DynamicDrawUsage))
    geometry.setAttribute('poolAxis', new T.BufferAttribute(this.axes, 4).setUsage(T.DynamicDrawUsage))
    geometry.setIndex(new T.BufferAttribute(index, 1))
    // Never culled by bounds: the positions move every frame.
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), Infinity)
    this.mesh = new T.Mesh(geometry, poolMaterial())
    this.mesh.name = "Other vehicles' headlight pools"
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    // One patch always submitted (at strength 0 it changes nothing), so the pipeline is built by
    // the covered preparation draw and never during play.
    geometry.setDrawRange(0, INDICES)
  }

  /**
   * Lay this frame's pools. `heightAt` is the surface under a world point (the ground, or water
   * over it); `tintAt` its colour; `camera` is where the view is. Allocates nothing.
   */
  update(sources: readonly PoolSource[], camera: T.Vector3, heightAt: (x: number, z: number) => number, tintAt: TintAt): void {
    let n = 0
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
      along.normalize(); across.set(-along.z, 0, along.x)
      const reach = pose.reach, spreadTan = Math.tan(pose.spread) * 1.15, halfLamps = Math.abs(pose.x * s.size)
      // One colour for the pool, from the ground 8 m ahead of the lamps.
      tintAt(lamp.x + along.x * 8, lamp.z + along.z * 8, this.tint)
      const cosSpread = Math.cos(pose.spread)
      for (let j = 0; j < ALONG; j++) {
        const t = j / (ALONG - 1), d = POOL_NEAR + (reach - POOL_NEAR) * t
        const half = halfLamps + Math.max(.5, d) * spreadTan
        for (let i = 0; i < ACROSS; i++) {
          const u = ((i / (ACROSS - 1)) * 2 - 1) * half
          world.set(lamp.x + along.x * d + across.x * u, 0, lamp.z + along.z * d + across.z * u)
          world.y = heightAt(world.x, world.z) + LIFT
          const v = n * VERTS + j * ACROSS + i
          this.positions[v * 3] = world.x; this.positions[v * 3 + 1] = world.y; this.positions[v * 3 + 2] = world.z
          this.strengths[v] = strength
          this.tints[v * 3] = this.tint.r; this.tints[v * 3 + 1] = this.tint.g; this.tints[v * 3 + 2] = this.tint.b
          this.lamps[v * 4] = lamp.x; this.lamps[v * 4 + 1] = lamp.y; this.lamps[v * 4 + 2] = lamp.z; this.lamps[v * 4 + 3] = cosSpread
          this.axes[v * 4] = axis.x; this.axes[v * 4 + 1] = axis.y; this.axes[v * 4 + 2] = axis.z; this.axes[v * 4 + 3] = reach
        }
      }
      n++
    }
    // With no pool to draw, the first patch stays submitted at strength 0 (see the constructor).
    if (n === 0) this.strengths.fill(0, 0, VERTS)
    this.drawn = n
    const geometry = this.mesh.geometry
    geometry.setDrawRange(0, Math.max(1, n) * INDICES)
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.poolStrength.needsUpdate = true
    geometry.attributes.poolTint.needsUpdate = true
    geometry.attributes.poolLamp.needsUpdate = true
    geometry.attributes.poolAxis.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as T.Material).dispose()
  }
}

/**
 * The pool's light: the spot equation the player's own lamps use (lamps.ts poseSpot), evaluated
 * at each pixel from its pool's lamp: an even fall from the axis to nothing at the spread
 * (penumbra 1), no fall with distance within the reach (decay 0, three.js's cutoff at the
 * reach), times the ground facing the lamp. Tinted by the ground's colour and added.
 */
function poolMaterial(): T.MeshBasicNodeMaterial {
  const material = new T.MeshBasicNodeMaterial()
  const strength = attribute('poolStrength', 'float') as N, tint = attribute('poolTint', 'vec3') as N
  const lampA = attribute('poolLamp', 'vec4') as N, axisA = attribute('poolAxis', 'vec4') as N
  // The patch's own vertices are world positions (the mesh is not moved), before the planet's curve.
  const toLamp = lampA.xyz.sub(positionGeometry) as N, distance = toLamp.length() as N
  const l = normalize(toLamp) as N
  const spot = smoothstep(lampA.w, float(1), dot(l.negate(), axisA.xyz)) as N
  const facing = max(l.y, float(0)) as N
  const cutoff = pow(clamp(float(1).sub(pow(distance.div(axisA.w), 4)), 0, 1), 2) as N
  const shape = clamp(spot.mul(facing).mul(cutoff).div(POOL_REFERENCE), 0, 1.5) as N
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
