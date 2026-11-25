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
 *     colour the terrain itself is drawn from), so red sand glows red and dark rock stays dark,
 *     and the amount added does not depend on how much moon or dusk light is already there, as
 *     with a real lamp. (A first version multiplied the ground instead; at dusk the ground is
 *     darker than under the moon and the pools nearly vanished.) No depth or colour copy is
 *     read, and the shadow pass is not involved.
 *
 * Strength per vehicle follows its lamps as the beams in mist do (cones.ts): the dusk-to-dawn
 * ramp of the real spot lights, the room's buggy headlight setting (light.buggyHeadlights) for
 * buggies, and each kind's beam factor (light.buggyBeams, light.hovercraftBeams, light.jetBeams),
 * all in the Game card's Vehicle looks. Then light.groundPools, each player's own: 0 is off,
 * and the quality level sets it (core/quality.ts PRESET_TABLE). The pool fades out as the lamps
 * rise off the ground, so a jet in flight casts none.
 */
import * as T from 'three/webgpu'
import { abs, attribute, exp, float, pow, smoothstep, vec3 } from 'three/tsl'
import { defineParam } from '../../../shared/params'
import { applyCurve } from '../../world/curve'

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

// The patch in the vehicle's frame: from NEAR metres behind the lamps to FAR ahead, widening from
// NEAR_W to FAR_W either side. ACROSS by ALONG vertices: enough to follow rolling ground.
export const POOL_NEAR = -0.6, POOL_FAR = 24, POOL_NEAR_W = 1.6, POOL_FAR_W = 9.5
const ACROSS = 7, ALONG = 12
const VERTS = ACROSS * ALONG, INDICES = (ACROSS - 1) * (ALONG - 1) * 6
/** Metres above the ground the patch is laid, against flicker with the terrain's own surface. */
const LIFT = 0.06
/** The pool fades out as the lamps rise from FADE_LOW to FADE_HIGH metres above the ground. */
const FADE_LOW = 3, FADE_HIGH = 12
/** Pools beyond this distance from the camera are not drawn; they fade over the last FADE_FAR m. */
export const POOL_RANGE = 220
const FADE_FAR = 40
/** Light added at the pool's brightest point at strength 1, times the ground's colour. Tuned by frames. */
export const POOL_PEAK = 12
/** The beam's warm white, as the real spot lights use. */
const BEAM = new T.Color(1, 0.9965517, 0.875)

/** One vehicle's pool to draw this frame. */
export interface PoolSource {
  readonly object: T.Object3D
  /** Lamp centre in the vehicle's frame: height and how far ahead (negative z is ahead). */
  readonly lampY: number
  readonly lampZ: number
  /** 0 to 1 and beyond: night ramp times the lamp's and the kind's factors times groundPools. */
  readonly strength: number
}

/** Linear colour of the ground (or water) at a point, written into `out`. */
export type TintAt = (x: number, z: number, out: { r: number; g: number; b: number }) => void

const local = new T.Vector3(), world = new T.Vector3(), lamp = new T.Vector3()

export class GroundPools {
  readonly mesh: T.Mesh
  readonly capacity: number
  private readonly positions: Float32Array
  private readonly strengths: Float32Array
  private readonly tints: Float32Array
  private readonly tint = { r: 0, g: 0, b: 0 }
  /** Pools drawn last frame, for checks. */
  drawn = 0

  constructor(capacity = 24) {
    this.capacity = capacity
    const geometry = new T.BufferGeometry()
    this.positions = new Float32Array(capacity * VERTS * 3)
    this.strengths = new Float32Array(capacity * VERTS)
    this.tints = new Float32Array(capacity * VERTS * 3)
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
      // The lamps' height above the ground: a pool needs its beam to reach the ground.
      lamp.set(0, s.lampY, s.lampZ).applyQuaternion(o.quaternion).add(o.position)
      const above = lamp.y - heightAt(lamp.x, lamp.z)
      const strength = s.strength * (1 - T.MathUtils.smoothstep(above, FADE_LOW, FADE_HIGH))
        * Math.min(1, (POOL_RANGE - distance) / FADE_FAR)
      if (!(strength > 0.002)) continue
      // One colour for the pool, from the ground 8 m ahead of the lamps.
      world.set(0, 0, s.lampZ - 8).applyQuaternion(o.quaternion)
      tintAt(o.position.x + world.x, o.position.z + world.z, this.tint)
      for (let j = 0; j < ALONG; j++) {
        const t = j / (ALONG - 1), z = s.lampZ - (POOL_NEAR + (POOL_FAR - POOL_NEAR) * t)
        const half = POOL_NEAR_W + (POOL_FAR_W - POOL_NEAR_W) * t
        for (let i = 0; i < ACROSS; i++) {
          world.copy(local.set(((i / (ACROSS - 1)) * 2 - 1) * half, 0, z)).applyQuaternion(o.quaternion)
          world.x += o.position.x; world.z += o.position.z
          world.y = heightAt(world.x, world.z) + LIFT
          const v = n * VERTS + j * ACROSS + i
          this.positions[v * 3] = world.x; this.positions[v * 3 + 1] = world.y; this.positions[v * 3 + 2] = world.z
          this.strengths[v] = strength
          this.tints[v * 3] = this.tint.r; this.tints[v * 3 + 1] = this.tint.g; this.tints[v * 3 + 2] = this.tint.b
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
  }

  dispose(): void {
    this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as T.Material).dispose()
  }
}

/**
 * The pool's light: brightest just ahead of the lamps, falling off down the road, soft at the
 * sides, tinted by the ground's colour and added to what is there.
 */
function poolMaterial(): T.MeshBasicNodeMaterial {
  const material = new T.MeshBasicNodeMaterial()
  const place = attribute('poolPlace', 'vec2') as N, strength = attribute('poolStrength', 'float') as N, tint = attribute('poolTint', 'vec3') as N
  // Across: a soft bell, no edge. Along: up over the first metre, then falling away down the
  // road roughly as a beam spreads, to nothing at the far end.
  const u = abs(place.x) as N
  const across = pow(float(1).sub(u.mul(u)), 1.5) as N
  const along = smoothstep(0, 0.04, place.y).mul(exp(place.y.mul(-4.5))).mul(float(1).sub(smoothstep(0.75, 1, place.y))) as N
  material.colorNode = vec3(BEAM.r, BEAM.g, BEAM.b).mul(tint).mul(strength.mul(across).mul(along).mul(POOL_PEAK)) as N
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
