/**
 * Which side of the sea's surface a fragment is on, as seen from the camera: for transparent
 * things that must be drawn in two halves, the half beyond the surface before the water (so the
 * water's refraction and its depth tint apply to it, as to the sea bed it lights) and the half on
 * the camera's side after it (crisp, as now).
 *
 * The owner, on v26.11.2405: a submerged vehicle's headlight beams were "not being distorted"
 * while "the actual illuminated terrain is refracted perfectly". The beams are additive and drawn
 * after the water; the bed is opaque and drawn before it. acrossSurface.ts moves whole vehicle
 * parts across the water's render order by their centres, but one instanced batch holds every
 * vehicle's beams and one beam can be half in and half out, so the split is made per fragment.
 *
 * The surface is the sea's swell exactly as the physics floats on it (liquidWaves.ts, the same
 * ten sines at the same phases), in deep water: near a shore the drawn swell shoals away, and
 * there the split can sit up to the swell's height off the drawn surface. Inland water (lakes,
 * pools, rivers) is not covered: a beam under a lake stays as it was. The two halves' weights
 * add to one at every fragment, so drawing both is drawing the thing once.
 */
import * as THREE from 'three/webgpu'
import { float, mix, renderGroup, sin, smoothstep, uniform, vec2 } from 'three/tsl'
import { liquidWaves, type LiquidBody } from './liquidWaves'
import { SEA_COMPONENTS } from './seaWaves'
import { cameraInWaterNode } from './daylight'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

const SEA: LiquidBody = { kind: 'sea', liquid: 'water', frozen: false }
/** Half width of the soft band at the surface, metres: no hard seam between the halves. */
export const SIDE_BAND = 0.1

/** The sea's swell components now, one vec4 (kx, kz, phase, amplitude) each, refreshed per render. */
const swell = Array.from({ length: SEA_COMPONENTS }, (_, i) => {
  const v = new THREE.Vector4()
  return uniform(v).setGroup(renderGroup).onRenderUpdate(() => {
    const c = liquidWaves(SEA).components[i]
    return c ? v.set(c.kx, c.kz, c.phase, c.amplitude) : v.set(0, 0, 0, 0)
  })
})

/** Height of the sea's surface over (x, z) for a sea at rest height `level`: the deep-water swell. */
export function seaSurfaceNode(xz: N, level: N): N {
  let h: N = level
  for (const u of swell) h = h.add(u.w.mul(sin(u.x.mul(xz.x).add(u.y.mul(xz.y)).add(u.z))))
  return h
}

/**
 * Weight of a fragment at world position `world` in the half beyond the sea surface from the
 * camera: 1 below the surface seen from above, or above it seen from below; 0 on the camera's
 * side; eased across SIDE_BAND. `level` is the sea's rest height. The near half takes 1 minus it.
 */
export function beyondSurfaceNode(world: N, level: N): N {
  const surface = seaSurfaceNode(vec2(world.x, world.z), level)
  const below = smoothstep(SIDE_BAND, -SIDE_BAND, world.y.sub(surface))
  return mix(below, float(1).sub(below), cameraInWaterNode)
}

/** CPU twin of the half weight, for tests: `cameraBelow` 0 or 1, `surface` the sea surface there. */
export function beyondSurface(y: number, surface: number, cameraBelow: number): number {
  const u = Math.min(1, Math.max(0, (SIDE_BAND - (y - surface)) / (2 * SIDE_BAND)))
  const below = u * u * (3 - 2 * u)
  return below + (1 - 2 * below) * cameraBelow
}
