import { clamp, dot, mix, rtt, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'

import { glassBlurTaps } from './gaussianKernel'

import { tintAdaptation } from './tintAdaptation'

type N = any

/** Display-space backdrop. The host supplies the scene colour at a two-point
 * footprint. Both partial-resolution targets are reused until the viewport changes. */
export function createGlassGaussian(source: (at: N) => N, viewport: N, widthScale?: N) {
  const points = viewport.xy.max(vec2(1))
  const size = widthScale ? points.div(widthScale) : points
  function pass(sample: (at: N) => N, axis: N) {
    let value: N = vec3(0)
    for (const tap of glassBlurTaps) {
      const at = clamp(uv().add(axis.mul(tap.offset).div(size)), 0, 1)
      value = value.add(sample(at).mul(tap.weight))
    }
    return value
  }
  const horizontalRgb = pass(source, vec2(1, 0))
  const horizontal = rtt(vec4(horizontalRgb, 1), 1, 1, { depthBuffer: false })
  const verticalRgb = pass(at => horizontal.sample(at).rgb, vec2(0, 1))
  const luma = vec3(.2126, .7152, .0722)
  const step = uniform(1)
  const vertical = rtt(vec4(verticalRgb, mix(horizontal.sample(uv()).a, dot(verticalRgb, luma), step)), 1, 1, { depthBuffer: false })
  // Carry the preceding frame through the horizontal target. Only its alpha
  // has memory. RGB still follows the live scene on both blur draws.
  horizontal.node = vec4(horizontalRgb, texture(vertical.value, uv()).a)
  let last = 0
  horizontal.name = 'Glass horizontal blur'
  vertical.name = 'Glass vertical blur'
  let width = 0, height = 0
  return {
    passes: [horizontal, vertical],
    sample: (at: N) => vertical.sample(at).rgb,
    exposure(at: N) {
      const sample = vertical.sample(at)
      return vec2(sample.a, dot(sample.rgb, luma))
    },
    update(w: number, h: number, active: boolean) {
      horizontal.autoUpdate = vertical.autoUpdate = active
      const now = performance.now()
      step.value = last && w === width && h === height ? tintAdaptation(now - last) : 1
      last = active ? now : 0
      if (w === width && h === height) return
      width = w
      height = h
      horizontal.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)))
      vertical.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)))
    },
    dispose() { horizontal.dispose(); vertical.dispose() },
  }
}
