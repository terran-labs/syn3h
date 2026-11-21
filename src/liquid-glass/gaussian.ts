import { clamp, rtt, uv, vec2, vec3, vec4 } from 'three/tsl'

type N = any

// Truncate the measured 15.5-point Gaussian at three standard deviations.
// Combine neighbouring taps using bilinear interpolation. The vertical
// intermediate has one texel per four points. A two-point source footprint
// keeps the fine grid from acquiring a left-to-right colour bias.
const pitch = 4
const sigma = 15.5
const reach = Math.ceil(3 * sigma / pitch)
const weights = Array.from({ length: 2 * reach + 1 }, (_, i) => Math.exp(-.5 * ((i - reach) * pitch / sigma) ** 2))
const total = weights.reduce((a, b) => a + b, 0)
const taps: { offset: number; weight: number }[] = []
for (let i = 0; i < weights.length; i += 2) {
  const a = weights[i], b = weights[i + 1] ?? 0
  taps.push({ offset: (i - reach + b / (a + b)) * pitch, weight: (a + b) / total })
}

/** Display-space backdrop. The host supplies the scene colour at a two-point
 * footprint. Both partial-resolution targets are reused until the viewport changes. */
export function createGlassGaussian(source: (at: N) => N, viewport: N) {
  const size = viewport.xy.max(vec2(1))
  function pass(sample: (at: N) => N, axis: N) {
    let value: N = vec3(0)
    for (const tap of taps) {
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
