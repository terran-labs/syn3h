import type * as THREE from 'three/webgpu'
import { WATER_RENDER_ORDER } from '../terrain/volcanics'

/**
 * Transparent things on the far side of the water from the camera, drawn before the water.
 *
 * The water is a transparent sheet that writes no depth, sorted first among transparent
 * things (WATER_RENDER_ORDER). Everything transparent with a higher render order draws after
 * it, so a force field canopy or wing four metres down was painted on top of the surface,
 * crisp and untinted, while the opaque body beside it was seen through the water (the owner
 * on v26.11.2201: "the wings and cockpit are drawing as though they were on top of the water").
 *
 * A part whose centre is on the far side of the surface from the camera has its render order
 * lowered below the water's, keeping its order relative to the vehicle's other parts. It then
 * draws first and the water is blended over it, from above or from below. A part on the
 * camera's side keeps its order and draws over the water as before. A part straddling the
 * surface goes by its centre; each of the buggy's wings, its canopy and the zorb shield are
 * separate meshes, so a vehicle at the waterline splits by part. Render order only changes
 * the sort: no material, shader or pipeline is touched.
 */
/**
 * Vehicle parts use render orders from -1 (the wing's tint under its glow) up to about 10, so
 * lowered by this they sit from -33 to about -22: all below the water (WATER_RENDER_ORDER, -2)
 * and above the sky (-1000), in their own order.
 */
export const BELOW_WATER_SHIFT = 32
/** Metres a part's centre must cross the surface before it changes side: no flicker on a swell. */
export const SIDE_HYSTERESIS = 0.15

/**
 * Whether a part is drawn as on the far side of the surface. `wasFar` is its last answer,
 * kept while the centre is within the hysteresis band.
 */
export function farSide(partY: number, surface: number, cameraBelow: boolean, wasFar: boolean): boolean {
  if (!Number.isFinite(surface)) return false
  const above = partY - surface
  const far = cameraBelow ? above > SIDE_HYSTERESIS : above < -SIDE_HYSTERESIS
  const near = cameraBelow ? above < -SIDE_HYSTERESIS : above > SIDE_HYSTERESIS
  return far ? true : near ? false : wasFar
}

/** Render order for a part: its own, or lowered below the water's. */
export function orderFor(base: number, far: boolean): number {
  return far ? base - BELOW_WATER_SHIFT : base
}

interface Part { base: number; applied: number; far: boolean }

type Surface = (x: number, z: number) => number

/** Applies the rule each frame to the objects it is given. Allocates only for a part seen first. */
/**
 * Each part's own order and what was last applied, shared by every AcrossSurface: a vehicle
 * outlives the world's water effects (a rebuilt world makes new ones), and a second instance
 * meeting a part the first had lowered must not take the lowered order as the part's own.
 */
const parts = new WeakMap<THREE.Object3D, Part>()

export class AcrossSurface {
  private surface: Surface = () => -Infinity
  private cameraBelow = false
  private readonly centre = { x: 0, y: 0, z: 0 }

  /** Start a frame: where the camera is, and the liquid height (water only; -Infinity for none). */
  begin(cameraBelow: boolean, surface: Surface): void {
    this.cameraBelow = cameraBelow
    this.surface = surface
  }

  /** Every transparent mesh under `root`, sorted by its own centre. */
  tree(root: THREE.Object3D): void { root.traverse(this.visit) }

  /** One mesh, by its world bounding-sphere centre. */
  readonly visit = (object: THREE.Object3D): void => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !transparent(mesh.material)) return
    const geometry = mesh.geometry
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    const c = geometry.boundingSphere!.center, e = mesh.matrixWorld.elements
    this.centre.x = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12]
    this.centre.y = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13]
    this.centre.z = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14]
    this.place(mesh, this.centre.y, this.surface(this.centre.x, this.centre.z))
  }

  /** One object whose height is known, against the surface given. */
  place(object: THREE.Object3D, y: number, surface: number): void {
    let part = parts.get(object)
    if (!part) { part = { base: object.renderOrder, applied: object.renderOrder, far: false }; parts.set(object, part) }
    // Someone else set the order since (a tier change, a skin rebuild): that is the new base.
    else if (object.renderOrder !== part.applied) part.base = object.renderOrder
    part.far = farSide(y, surface, this.cameraBelow, part.far)
    object.renderOrder = part.applied = orderFor(part.base, part.far)
  }
}

function transparent(material: THREE.Material | THREE.Material[]): boolean {
  if (!Array.isArray(material)) return material.transparent
  for (const m of material) if (m.transparent) return true
  return false
}
