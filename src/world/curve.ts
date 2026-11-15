/**
 * Planet curve: make the flat, wrapping world look like a small round planet (The Little
 * Prince) without touching physics.
 *
 * Every bent vertex drops by `d² / 2R`, where d is its horizontal distance from the camera
 * and R the planet radius. That is the curved-world vertex bend: a parabola that matches a
 * sphere of radius R near the camera, so the horizon falls away and distant land sinks
 * behind it.
 *
 * Where the bend happens: in the material's `setupPositionView`, after the world position
 * is known, and only for the position that is projected to the screen. `positionWorld` is
 * NOT bent, so everything that colours by world position (terrain palette, snow, shore,
 * roads) and the shadow-map lookup stay put as the camera moves. Shadows are
 * rendered by three's shadow pass material, which does not call this hook, so casters and
 * receivers both stay flat in the shadow map and the shadow lands where it would on flat
 * ground, then is drawn bent with the ground. Hooking `setupPositionView` rather than
 * `positionNode` means one call works for ordinary meshes, instanced meshes, skinned
 * meshes, sprites and materials that already have a `positionNode`.
 *
 * Every drawn object must be bent or it will float above the sinking ground. The sky must
 * not be bent.
 */
import { Vector3, type Material } from 'three/webgpu'
import { cameraViewMatrix, float, modelWorldMatrix, positionLocal, renderGroup, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { defineParam } from '../../shared/params'

export const curveParam = defineParam<number>({
  id: 'world.curve', label: 'Planet curve', group: 'World', scope: 'world',
  default: 0, min: 0, max: 1, step: 0.01,
})

/**
 * Map the slider to a planet radius in metres for a world tile `size` metres across.
 *
 * Curvature (1/R) grows with the square of the slider: R = R1 / curve², where
 * R1 = size / 2π is the radius whose circumference is the tile itself. So 0 is flat
 * (Infinity), 1 is a true Little Prince ball (about 326 m for 2048 m), 0.3 is a gentle
 * planet about 11 times that (about 3.6 km) and 0.6 is about 2.8 times. Strictly
 * decreasing in `curve` on (0, 1].
 */
export function curveRadius(size: number, curve: number): number {
  if (!(curve > 0)) return Infinity
  return size / (2 * Math.PI) / (curve * curve)
}

/** Camera x, camera z and 1 / 2R (0 when flat). Written by updateCurve. */
const state = new Vector3(0, 0, 0)
/**
 * The same, as one uniform shared by every bent material. A plain object-group uniform
 * stayed frozen at its first upload on static instanced meshes (the trees) in r187, so this
 * is a render-group uniform refreshed on every render, the pattern Environment.ts uses for
 * the fog. One upload per render, not per object.
 */
const curveState = uniform(new Vector3(0, 0, 0)).setGroup(renderGroup).onRenderUpdate(() => state)

/** Call once per frame before rendering, with the camera's world position. */
export function updateCurve(cameraPosition: Vector3, size: number): void {
  const R = curveRadius(size, curveParam.value)
  state.set(cameraPosition.x, cameraPosition.z, Number.isFinite(R) ? 1 / (2 * R) : 0)
}

/** The current bend factor, 1 / 2R, for tests and tools. */
export function curveFactor(): number {
  return state.z
}

/** How far a point at world (x, z) is drawn below where it really is, in metres. */
export function curveDrop(x: number, z: number): number {
  const s = state
  const dx = x - s.x
  const dz = z - s.y
  return (dx * dx + dz * dz) * s.z
}

/**
 * The bend as a view-space offset: the world-space drop (0, -drop, 0) turned into the
 * camera's frame. `worldPoint` decides where the drop is measured.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function viewDrop(worldPoint: any) {
  const d = vec2(worldPoint.x, worldPoint.z).sub(curveState.xy)
  const drop = d.dot(d).mul(curveState.z)
  // A direction (w = 0), so only the camera's rotation applies.
  return cameraViewMatrix.mul(vec4(0, drop.negate(), 0, 0)).xyz
}

type Hooked = Material & {
  setupPositionView?: (builder: unknown) => unknown
  isSpriteNodeMaterial?: boolean
  positionNode?: unknown
  curved?: boolean
}

/**
 * Bend a material with the planet curve. One call, idempotent. Works for node materials and
 * for classic materials (MeshStandardMaterial and friends): WebGPURenderer converts those by
 * copying their own properties, which carries the hook across. Meshes, instanced meshes and
 * sprites (bent by the sprite's centre, so particles do not shear) are all handled.
 */
export function applyCurve(material: Material): void {
  const m = material as Hooked
  if (m.curved) return
  // An own property: it is part of the render object's cache key (so a bent and an unbent
  // material never share a pipeline) and survives the classic-to-node material copy.
  m.curved = true
  m.setupPositionView = function curvedPositionView(this: Hooked, builder: unknown) {
    const base = Object.getPrototypeOf(this).setupPositionView.call(this, builder)
    if (this.isSpriteNodeMaterial) {
      // Sprites return a vec4 in view space; the quad is built round the centre.
      const centre = modelWorldMatrix.mul(vec4(this.positionNode ? vec3(this.positionNode as never) : vec3(0), float(1)))
      return vec4(base.xyz.add(viewDrop(centre)), base.w)
    }
    // positionLocal already includes skinning, morphs, instancing and positionNode here.
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1))
    return base.add(viewDrop(world))
  }
  m.needsUpdate = true
}

// Debug handle for tools/terrainlab/curve-shots.mjs: bend materials owned by other lanes at
// run time without editing them.
if (typeof window !== 'undefined') {
  Object.assign(window, { __syn3hCurve: { applyCurve, updateCurve, curveRadius, curveFactor, curveDrop, param: curveParam } })
}

/** The `world.curve` slider under the name the interface stub used. */
export const worldCurve = curveParam
