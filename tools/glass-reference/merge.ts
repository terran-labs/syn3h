import { Fn, If, abs, clamp, dot, float, length, max, min, mix, uv, vec2, vec3, vec4 } from 'three/tsl'
import { regularGlass } from '../../src/liquid-glass/regular'

type N = any

/** Laboratory circle and capsule in one container. All distances are points. */
export function mergeReferencePair(separate: N, group: N, glass: N, sample: (p: N) => N,
  filtered: (p: N, width: N) => N, blurred: (p: N) => N) {
  return Fn(() => {
    const size = glass.viewport.xy
    const point = uv().mul(size)
    const circle = glass.boxes.element(0)
    const pill = glass.boxes.element(1)
    const dark = glass.viewport.z
    const result = vec4(sample(uv()), 1).toVar()
    If(group.greaterThan(0), () => {
      If(abs(point.y.sub(circle.y)).lessThan(circle.w.max(pill.w).add(15))
        .and(point.x.greaterThan(circle.x.sub(circle.z).sub(15)))
        .and(point.x.lessThan(pill.x.add(pill.z).add(15))), () => {
        const a = point.sub(circle.xy)
        const local = point.sub(pill.xy)
        const spine = pill.z.sub(pill.w)
        const b = vec2(local.x.sub(clamp(local.x, spine.negate(), spine)), local.y)
        const da = length(a).sub(circle.w), db = length(b).sub(pill.w)
        // An exponential smooth minimum attracts both tips before contact.
        // Subtract the nearest distance before exponentiation for stability.
        const nearest = min(da, db)
        const width = float(5.5)
        const wa = nearest.sub(da).div(width).exp(), wb = nearest.sub(db).div(width).exp()
        const sum = wa.add(wb), fraction = wa.div(sum)
        const distance = nearest.sub(width.mul(sum.log()))
        const gradient = mix(b.div(max(length(b), .001)), a.div(max(length(a), .001)), fraction)
        // At the saddle the derivative goes continuously to zero. Normalizing
        // it there would turn an arbitrarily small tilt into a full lens fold.
        const coverage = clamp(float(.5).sub(distance.mul(group)), 0, 1)
        const exterior = max(distance, 0)
        const bg = result.rgb.toVar()
        const luma = dot(bg, vec3(.2126, .7152, .0722))
        const light = float(.9).sub(luma.mul(.59))
        const opacity = light.add(dark.mul(max(luma.sub(.5), 0).pow(2)).mul(1.22).div(max(luma,.001)))
        const hair = clamp(float(.5).sub(exterior).mul(group).add(.5), 0, 1)
        const direction = float(1).sub(gradient.y.mul(gradient.y).mul(mix(.69, 1, dark)))
        const halo = max(gradient.y.add(.2).div(1.2), 0).mul(.014)
          .mul(clamp(float(1).sub(exterior.div(14)), 0, 1))
        bg.mulAssign(float(1).sub(halo).mul(float(1).sub(opacity.mul(hair).mul(direction))))
        If(coverage.greaterThan(0), () => {
          const radius = mix(pill.w, circle.w, fraction)
          const face = regularGlass(vec2(radius), distance, gradient, uv(), size, dark, sample, filtered, blurred)
          bg.assign(mix(bg, face, coverage))
        })
        result.assign(vec4(bg, 1))
      })
    }).Else(() => { result.assign(separate) })
    return result
  })()
}
