import * as THREE from 'three/webgpu'
import {
  cameraPosition, cameraProjectionMatrixInverse, cameraViewMatrix, cameraWorldMatrix, clamp, faceDirection, float,
  getViewPosition, max, positionWorld, renderGroup, screenUV, select, uniform, vec3, vec4,
} from 'three/tsl'
import { defineParam } from '../../../shared/params'
import { levelNumber, qualityLevel } from '../../core/quality'

/**
 * Refraction: what lies under the water, seen from above, wobbles with the surface.
 *
 * The water is otherwise a plain blended sheet (surface.ts waterOpacityNode): what shows behind
 * it is the scene as drawn, straight through. Here the water takes a copy of the frame as it
 * stands when the water draws (the opaque world, and the transparent parts sorted below the
 * surface by acrossSurface.ts) and composites it itself, read a little to one side along the
 * wave's tilt. The bed, a submerged vehicle and its force fields all wobble together.
 *
 * WebGPU at Medium and above only, and only inside the post chain's scene pass (a render target,
 * linear colour). One shader at every level and on both backends: on WebGL 2, below Medium, or
 * in any other pass (the reflection capture, the canvas at Low), the gate is off, the copies are
 * skipped and the water's output is exactly what it was before. A quality change therefore never
 * builds a shader, and the governor's drop from Medium to Low turns refraction off with it.
 *
 * Why not WebGL 2 (measured 22 November 2026, 390x844 at Medium, GPU timer queries): +1.5 ms a
 * frame. Not the bytes copied: skipping either copy alone left the cost, skipping both removed
 * it. Three's WebGL backend copies with copyTexSubImage2D or a blit in the middle of the scene
 * pass, which on a tiled GPU (ANGLE on Metal) ends and restarts the pass, storing and reloading
 * every attachment. Do not retry it without one copy at the end of the opaque pass instead.
 * On WebGPU three does the same in its own terms: each copy ends the render pass, encodes a
 * texture copy and begins a new pass that loads every attachment (two breaks a frame here, the
 * colour and the depth). On this Mac that measured within noise; a phone's tiled GPU has not
 * been measured, so the state is in the copied diagnostics report (refractionState).
 *
 * Two guards. The offset fades to nothing at the shore and grows with depth to REFRACT_DEPTH.
 * And a sample that lands on something above the water (a hull at the waterline, a low jet,
 * the bank) is not used: the frame's depth at the offset gives that point's height, and if it
 * is not below this pixel of the surface the straight-through sample is used instead.
 */
export const waterRefraction = defineParam<number>({
  id: 'water.refraction', label: 'Refraction (wobble under the surface)', group: 'Water', scope: 'client',
  default: 1, min: 0, max: 3, step: 0.05,
})

/** Lowest quality level that refracts (Medium). */
export const REFRACT_FROM_LEVEL = 2
/** Metres of water over which the offset grows from nothing at the shore to whole. */
export const REFRACT_DEPTH = 3
/** Screen offset for a unit slope at one metre, before the strength. */
const REFRACT_SCALE = 0.25
/** A sample point counts as under the water only this far (m) below the surface pixel. */
const LEAK_MARGIN = 0.05

interface GateRenderer { getRenderTarget(): unknown; backend?: object }

/** Whether refraction is on for this renderer at all, and if not, why. For diagnostics. */
export function refractionState(renderer: GateRenderer | null | undefined): 'on' | 'off: WebGL 2' | 'off: below Medium' | 'off: turned off' | 'off: no renderer' {
  if (!renderer) return 'off: no renderer'
  if ((renderer.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend !== true) return 'off: WebGL 2'
  if (levelNumber(qualityLevel.value) < REFRACT_FROM_LEVEL) return 'off: below Medium'
  if (!(waterRefraction.value > 0)) return 'off: turned off'
  return 'on'
}

/** Whether this render call refracts: refraction is on and the call draws into a render target. */
export function refractionOn(renderer: GateRenderer): boolean {
  return refractionState(renderer) === 'on' && renderer.getRenderTarget() !== null
}

/** The frame copy, made only when the render call refracts. */
class GatedViewportTexture extends THREE.ViewportTextureNode {
  updateBefore(frame: THREE.NodeFrame): boolean | undefined { return refractionOn(frame.renderer!) ? super.updateBefore(frame) : undefined }
}
/** The depth copy, likewise. */
class GatedViewportDepthTexture extends THREE.ViewportDepthTextureNode {
  updateBefore(frame: THREE.NodeFrame): boolean | undefined { return refractionOn(frame.renderer!) ? super.updateBefore(frame) : undefined }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/**
 * Make `material` composite the scene behind it itself, refracted, when the gate is on.
 * `slope` is the surface's world slope (sx, sz), `depth` the water depth at this pixel in
 * metres. Wraps setupOutput, after the fog, so the water's own colour is fogged as before.
 */
export function refractThrough(material: THREE.NodeMaterial, slope: { x: N; z: N }, depth: N): void {
  const on = uniform(0).setGroup(renderGroup).onRenderUpdate(({ renderer }) => refractionOn(renderer as never) ? 1 : 0)
  const strength = uniform(waterRefraction.value).setGroup(renderGroup).onRenderUpdate(() => waterRefraction.value)
  const colour = new GatedViewportTexture()
  const sceneDepth = new GatedViewportDepthTexture()

  // The tilt of the surface, as seen on screen, smaller with distance; nothing at the shore.
  const tilt = cameraViewMatrix.transformDirection(vec3(slope.x.negate(), 0, slope.z.negate())).xy
  const distance = max(positionWorld.sub(cameraPosition).length(), 2)
  const deep = clamp(depth.div(REFRACT_DEPTH), 0, 1)
  const offset = tilt.mul(strength.mul(REFRACT_SCALE).mul(deep).div(distance))
  const bent = screenUV.add(offset)
  // The height of whatever the bent sample shows: under this pixel of the surface, or not.
  const view = getViewPosition(bent, sceneDepth.sample(bent).r, cameraProjectionMatrixInverse)
  const sampleY = cameraWorldMatrix.mul(vec4(view, 1)).y
  const under = sampleY.lessThan(positionWorld.y.sub(LEAK_MARGIN))
  const behind = colour.sample(select(under, bent, screenUV)).rgb
  // Seen from above only; from below the surface keeps its Snell's window as it is.
  const use = on.mul(faceDirection.greaterThan(0).select(float(1), float(0)))

  type Setup = (this: unknown, builder: unknown, output: THREE.Node) => THREE.Node
  const m = material as unknown as { setupOutput: Setup }
  const base = Object.getPrototypeOf(material).setupOutput as Setup
  m.setupOutput = function refractingOutput(builder, output) {
    const out = base.call(this, builder, output) as N
    // What blending did, done here with the bent sample instead, and drawn whole.
    const composed = vec4(out.rgb.mul(out.a).add(behind.mul(float(1).sub(out.a))), 1)
    return select(use.greaterThan(0.5), composed, out)
  }
}
