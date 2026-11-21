import { clamp, rtt, uv, vec2, vec3, vec4 } from 'three/tsl'

import { glassBlurTaps } from './gaussianKernel'

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
    return rtt(vec4(value, 1), 1, 1, { depthBuffer: false })
  }
  const horizontal = pass(source, vec2(1, 0))
  const vertical = pass(at => horizontal.sample(at).rgb, vec2(0, 1))
  horizontal.name = 'Glass horizontal blur'
  vertical.name = 'Glass vertical blur'
  let width = 0, height = 0
  return {
    passes: [horizontal, vertical],
    sample: (at: N) => vertical.sample(at).rgb,
    update(w: number, h: number, active: boolean) {
      horizontal.autoUpdate = vertical.autoUpdate = active
      if (w === width && h === height) return
      width = w
      height = h
      horizontal.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)))
      vertical.setSize(Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)))
    },
    dispose() { horizontal.dispose(); vertical.dispose() },
  }
}
