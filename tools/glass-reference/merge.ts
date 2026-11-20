import { Fn, If, abs, clamp, float, length, max, mix, smoothstep, uv, vec2, vec3, vec4 } from 'three/tsl'
import { regularGlass } from '../../src/liquid-glass/regular'

type N = any

/** Laboratory pair only. Restrict the union to the two facing circular caps.
 * Outside this region the two registered controls keep their usual surface. */
export function mergeReferencePair(separate: N, group: N, glass: N, sample: (p: N) => N,
  filtered: (p: N, width: N) => N, blurred: (p: N) => N) {
  return Fn(() => {
    const result = separate.toVar()
    const size = glass.viewport.xy
    const point = uv().mul(size)
    const circle = glass.boxes.element(0)
    const pill = glass.boxes.element(1)
    const cap = vec2(pill.x.sub(pill.z).add(pill.w), pill.y)
    const gap = cap.x.sub(circle.x).sub(circle.z).sub(pill.w)
    const midpoint = circle.x.add(circle.z).add(gap.mul(.5))
    If(group.greaterThan(0).and(gap.lessThan(11)).and(abs(point.x.sub(midpoint)).lessThan(22))
      .and(abs(point.y.sub(cap.y)).lessThan(29)), () => {
      const ca = point.sub(circle.xy), cb = point.sub(cap)
      const da = length(ca).sub(circle.z), db = length(cb).sub(pill.w)
      const k = float(18).sub(gap.mul(.4)).mul(float(1).sub(smoothstep(6, 11, gap))).max(.001)
      const fraction = clamp(float(.5).add(db.sub(da).div(k).mul(.5)), 0, 1)
      If(fraction.greaterThan(0).and(fraction.lessThan(1)), () => {
        const d = mix(db, da, fraction).sub(k.mul(fraction).mul(float(1).sub(fraction)))
        const grad = mix(cb.div(max(length(cb), .001)), ca.div(max(length(ca), .001)), fraction)
        const normal = grad.div(max(length(grad), .001))
        const radius = mix(pill.w, circle.z, fraction)
        const coverage = clamp(float(.5).sub(d.mul(group)), 0, 1)
        const face = regularGlass(vec2(radius), d, normal, uv(), size, glass.viewport.z, sample, filtered, blurred)
        // Keep the old exterior for a partial coverage sample. Inside, one
        // layer replaces both independent rims, including in the overlap.
        result.assign(vec4(mix(result.rgb, face, coverage), 1))
      })
    })
    return result
  })()
}
