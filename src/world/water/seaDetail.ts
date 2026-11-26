/**
 * The sea's visual detail, shared: the chop table, the calm and rough patches and the visual-only
 * vertex detail, with the sliders that scale them. The sea material (surface.ts) draws with these,
 * and the drawn surface's height (drawnSurface.ts) evaluates the very same nodes, so the waterline
 * on the lens and the underwater look meet the water exactly where it is drawn.
 */
import * as THREE from 'three/webgpu'
import { cameraPosition, float, mix, mx_noise_float, renderGroup, sin, smoothstep, time, uniform, vec3 } from 'three/tsl'
import { waterChop, waterDetail, waterGusts, waterWaveVisual } from './params'
import { prevailingWindStrength } from '../weather'

/** A float node that sums are folded into. TSL's operator typings do not narrow through a loop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sum = any

/**
 * Wind chop and fine ripples: short waves the sea mesh cannot carry as geometry, so they only
 * tilt the light. Each is [wavelength m, heading radians, steepness].
 *
 * Built so that no two of them, nor any with the swell, can beat into a lattice:
 *  - wavelengths step by irregular ratios (0.58 to 0.66), never a simple fraction of each other;
 *  - headings are scattered unevenly round most of the compass, not a narrow fan;
 *  - steepness (amplitude times wavenumber) falls from the long chop to the short and then holds:
 *    the ripples near the camera stay steep enough to give crisp small highlights (the Foreman,
 *    on the first frames: the near field must be as crisp as before, not soft streaks);
 *  - each one's phase is bent by noise with its own pair of weights (WARP), so their crests
 *    wander independently instead of all bending together.
 * Those under RIPPLE_LENGTH are the fine ripples: water.ripple scales them, they grow only near
 * the camera, and the calm and rough patches act on them twice as hard. Speeds follow deep water
 * dispersion, like the swell.
 */
export const CHOP: readonly [number, number, number][] = [
  [9.1, 0.25, 0.12], [5.3, -0.7, 0.10], [3.4, 1.15, 0.085], [2.05, -1.6, 0.075],
  [1.33, 0.6, 0.075], [0.81, 2.3, 0.07], [0.52, -0.2, 0.065], [0.33, -2.6, 0.06],
]
/** Phase warp weights per CHOP component, on the two ripple noises. */
export const WARP: readonly [number, number][] = [[1.1, 0.6], [0.7, 1.6], [2.1, -0.9], [-1.4, 1.9], [2.4, 1.2], [-0.8, 2.6], [1.7, -2.2], [-2.5, -1.1]]

/** Chop longer than this also moves the vertices near the camera (visual only). */
export const DETAIL_GEOMETRY_LENGTH = 2
/**
 * The most the visual-only vertex detail can lift or lower the drawn sea from the surface the
 * physics floats on, metres, at any slider setting: the bound tests/world/water-look.test.ts holds.
 */
export const VISUAL_DETAIL_MAX = 0.15
/** Calm and rough patches: noise frequency (1 / metres) and how fast they change (per second). */
const PATCH_FREQUENCY = 0.0065
const PATCH_RATE = 0.012

/**
 * Visual-only vertex detail at (x, z) and time t, metres: the CPU twin of the shader's, for the
 * bound test. `warpX`, `warpZ` are the two noises there (each within -1..1), `strength` the
 * chop slider times wind times water.waveVisual, `patch` the calm (0) to rough (1) share.
 * Normalised by the sum of the amplitudes, so it never exceeds VISUAL_DETAIL_MAX in size.
 */
export function visualDetailHeight(x: number, z: number, t: number, warpX: number, warpZ: number, strength: number, patch: number, near: number): number {
  let d = 0, total = 0
  CHOP.forEach(([length, heading, steepness], i) => {
    if (length < DETAIL_GEOMETRY_LENGTH) return
    const k = (Math.PI * 2) / length, a = steepness / k
    total += a
    d += a * Math.sin(k * (x * Math.cos(heading) + z * Math.sin(heading)) + t * Math.sqrt(9.81 * k) + warpX * WARP[i][0] + warpZ * WARP[i][1])
  })
  const unit = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
  const scale = unit(strength) * (0.35 + 0.65 * unit(patch)) * unit(near)
  return total > 0 ? (d / total) * VISUAL_DETAIL_MAX * scale : 0
}


/** Chop strength: the slider times the wind (a calm still ruffles, a gale roughens). */
export const chop = uniform(1).setGroup(renderGroup).onRenderUpdate(() => waterChop.value * (0.55 + 0.9 * prevailingWindStrength()))
/** water.waveVisual: scales the visual-only detail and how strongly crests are picked out. */
export const visual = uniform(waterWaveVisual.value).setGroup(renderGroup).onRenderUpdate(() => waterWaveVisual.value)
/** 1 where the detail layer runs (water.detail, owned by the quality level); the shader branches on it. */
export const detailOn = uniform(1).setGroup(renderGroup).onRenderUpdate(() => (waterDetail.value ? 1 : 0))
export const patchiness = uniform(waterGusts.value).setGroup(renderGroup).onRenderUpdate(() => waterGusts.value)
/**
 * Calm (0) to rough (1) patches about 150 m across that slowly change in place (they do not
 * slide, so nothing reads as a pattern moving over the water). water.gusts 0 is rough everywhere.
 */
export const patchAt = (xz: THREE.Node<'vec2'>) => {
  const n = mx_noise_float(vec3(xz.x.mul(PATCH_FREQUENCY), xz.y.mul(PATCH_FREQUENCY), time.mul(PATCH_RATE)))
  return mix(float(1), smoothstep(-0.55, 0.3, n), patchiness)
}

/**
 * Visual-only detail near the camera: the longer chop as real ripples (visualDetailHeight is
 * its CPU twin). Normalised so it can never move the drawn sea more than VISUAL_DETAIL_MAX from
 * the surface the physics floats on. Phase-warped by the same noise as the chop's normals, so
 * the shapes you see are the ones the light picks out. Nothing at the levels without detail.
 */
export const detailHeight = (w: THREE.Node<'vec2'>, cell: THREE.Node<'float'>, patchHere: THREE.Node<'float'> = patchAt(w)) => {
  const near = smoothstep(80, 20, w.sub(cameraPosition.xz).length())
  const strength = chop.mul(visual).clamp(0, 1).mul(detailOn)
  const q = vec3(w.x.mul(0.3), w.y.mul(0.3), time.mul(0.6))
  const wx = mx_noise_float(q)
  const wz = mx_noise_float(q.add(vec3(17.3, 5.1, 0)))
  let d: Sum = float(0)
  let total = 0
  CHOP.forEach(([length, heading, steepness], i) => {
    if (length < DETAIL_GEOMETRY_LENGTH) return
    const k = (Math.PI * 2) / length, a = steepness / k
    total += a
    const arg = w.x.mul(k * Math.cos(heading)).add(w.y.mul(k * Math.sin(heading))).add(time.mul(Math.sqrt(9.81 * k))).add(wx.mul(WARP[i][0])).add(wz.mul(WARP[i][1]))
    // Too short for the mesh here: left to the normals (the shape stays bounded either way).
    d = d.add(sin(arg).mul(a).mul(smoothstep(cell.mul(3), cell.mul(5), float(length))))
  })
  const patch = float(0.35).add(patchHere.mul(0.65))
  return d.mul(VISUAL_DETAIL_MAX / total).mul(strength).mul(patch).mul(near)
}

