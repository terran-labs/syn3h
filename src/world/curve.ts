/**
 * Round planet: draws the flat, wrapping world as the sphere it would be, without touching
 * physics.
 *
 * The world is a square tile `size` metres across that wraps, so travelling `size` metres
 * in a straight line brings you home. A planet you can circle in `size` metres has radius
 * R = size / 2 pi, and that is the radius used: nothing is tuned by eye.
 *
 * Every vertex is placed where it would be on that sphere, seen from the camera. For a
 * point at ground distance d from the camera's ground point and height h above the sea:
 *
 *   angle round the planet   t = d / R
 *   along the ground         (R + h) * sin t
 *   up                       (R + h) * cos t - R
 *
 * So the horizon is where a real one would be (about sqrt(2 R eye) away), mountains rise
 * over it as you approach, and from high up the world is a ball. Points further than half
 * way round (t > pi) are gathered at the far pole, behind the planet. The wrapping tile
 * is a torus, not a sphere, so the far side cannot match exactly; it is always hidden by
 * the planet itself.
 *
 * Where it happens: in the material's `setupPositionView`, after the world position is
 * known, and only for the position that is projected to the screen. `positionWorld` is NOT
 * moved, so everything that colours by world position (terrain palette, snow, shore, roads)
 * and the shadow lookup stay put as the camera moves. Lighting is the flat world's: the
 * sun is in the same direction everywhere. Hooking `setupPositionView` rather than
 * `positionNode` means one call works for ordinary meshes, instanced meshes, skinned
 * meshes, sprites and materials that already have a `positionNode`.
 *
 * Every drawn object must be bent or it will float off the ground. The sky must not be.
 */
import { Vector3, type Material } from 'three/webgpu'
import { cameraViewMatrix, cos, float, modelWorldMatrix, positionLocal, renderGroup, select, sin, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { defineParam } from '../../shared/params'

/**
 * 1 is the true planet: the sphere whose circumference is the world tile. Lower values draw
 * a larger, flatter planet than the world really is (0.5 is twice the true radius), and 0
 * is flat. Only 1 is geometrically honest; the rest are for taste and for comparison.
 */
export const curveParam = defineParam<number>({
  id: 'world.curve', label: 'Planet roundness (1 true, 0 flat)', group: 'World', scope: 'world',
  default: 1, min: 0, max: 1, step: 0.01,
})

/** The radius of the planet whose circumference is a tile `size` metres across. */
export function planetRadius(size: number): number {
  return size / (2 * Math.PI)
}

/** The radius drawn for a roundness setting: the true radius at 1, larger below, Infinity at 0. */
export function curveRadius(size: number, curve: number): number {
  if (!(curve > 0)) return Infinity
  return planetRadius(size) / (curve > 1 ? 1 : curve)
}

/** Camera x, camera z and 1 / R (0 when flat). Written by updateCurve. */
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
  state.set(cameraPosition.x, cameraPosition.z, Number.isFinite(R) ? 1 / R : 0)
  // How far round the planet the camera can see ground at sea level: the horizon.
  const eye = cameraPosition.y > 1 ? cameraPosition.y : 1
  eyeAngle = Number.isFinite(R) ? Math.acos(R / (R + eye)) : 0
}

let eyeAngle = 0

/**
 * Is something entirely behind the planet? On a round world most of the map is over the
 * horizon, so this replaces frustum culling as the main way of not drawing things.
 *
 * The thing is given by a circle on the ground that contains it (centre and radius, at the
 * image it is drawn at) and the height of its top above the sea. It is hidden when even
 * its nearest edge is further round the planet than the camera's horizon plus the extra
 * distance at which something that tall still pokes over it:
 *
 *   d / R  >  acos(R / (R + eye))  +  acos(R / (R + top))
 *
 * Exact for a sphere, and conservative: it never hides something that could be seen.
 * Always false on a flat world.
 */
export function overHorizon(x: number, z: number, radius: number, top: number): boolean {
  const invR = state.z
  if (!(invR > 0)) return false
  const dx = x - state.x
  const dz = z - state.y
  const d = Math.sqrt(dx * dx + dz * dz) - radius
  if (d <= 0) return false
  const R = 1 / invR
  const t = top > 0 ? top + 2 : 2
  return d * invR > eyeAngle + Math.acos(R / (R + t)) + 0.02
}

/** 1 / R in use, 0 when flat. For tests and tools. */
export function curveFactor(): number {
  return state.z
}

/**
 * Where a world point is drawn, relative to where it really is: the same mapping the
 * shader applies. For anything placed by hand in world space (labels, markers).
 */
export function curveOffset(x: number, y: number, z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const invR = state.z
  const dx = x - state.x
  const dz = z - state.y
  const d = Math.sqrt(dx * dx + dz * dz)
  if (!(invR > 0) || d < 1e-6) { out.x = 0; out.y = 0; out.z = 0; return out }
  const t = Math.min(d * invR, Math.PI)
  const along = (1 / invR + y) * Math.sin(t)
  const k = along / d - 1
  out.x = dx * k
  out.z = dz * k
  out.y = (1 / invR + y) * Math.cos(t) - 1 / invR - y
  return out
}

/** How far below its true height a point on the sea surface at (x, z) is drawn, in metres. */
export function curveDrop(x: number, z: number): number {
  return -curveOffset(x, 0, z, { x: 0, y: 0, z: 0 }).y
}

/**
 * The move from the flat position to the position on the sphere, as a view-space offset.
 * `worldPoint` is the flat world position the mapping is measured from.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function viewDrop(worldPoint: any) {
  const invR = curveState.z
  const flat = invR.lessThanEqual(0)
  const safeInv = invR.max(1e-9)
  const delta = vec2(worldPoint.x, worldPoint.z).sub(curveState.xy)
  const d = delta.length()
  const dir = delta.div(d.max(1e-4))
  // Angle round the planet, stopped at the far pole.
  const t = d.mul(invR).min(Math.PI)
  const r = float(1).div(safeInv).add(worldPoint.y)
  const along = select(flat, d, r.mul(sin(t)))
  const up = select(flat, worldPoint.y, r.mul(cos(t)).sub(float(1).div(safeInv)))
  const move = vec3(dir.x.mul(along.sub(d)), up.sub(worldPoint.y), dir.y.mul(along.sub(d)))
  // A direction (w = 0), so only the camera's rotation applies.
  return cameraViewMatrix.mul(vec4(move, 0)).xyz
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
  Object.assign(window, { __syn3hCurve: { applyCurve, updateCurve, curveRadius, planetRadius, curveFactor, curveDrop, curveOffset, param: curveParam } })
}

/** The `world.curve` slider under the name the interface stub used. */
export const worldCurve = curveParam
