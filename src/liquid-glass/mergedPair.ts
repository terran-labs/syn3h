import type { Node } from 'three/webgpu'
import { Fn, If, abs, clamp, dot, float, length, max, min, mix, step, uv, vec2, vec3, vec4 } from 'three/tsl'
import { regularGlass, type RegularUniforms } from './regular'

type N = any

/** A horizontally aligned circle and capsule in one container, in CSS points. */
export function mergedGlassPair(original: N, circle: Node<'vec4'>, pill: Node<'vec4'>, viewport: N, ratio: N,
  sample: (p: N) => N, filtered: (p: N, width: N) => N, blurred: (p: N) => N, pressLift?: Node<'float'>, strength?: Node<'float'>, tuning?: RegularUniforms) {
  return Fn(() => {
    const size = viewport.xy as Node<'vec2'>
    const point = uv().mul(size)
    const dark = viewport.z
    const result = original.toVar()
    If(abs(point.y.sub(circle.y)).lessThan(circle.w.max(pill.w).add(15))
      .and(point.x.greaterThan(min(circle.x.sub(circle.z), pill.x.sub(pill.z)).sub(15)))
      .and(point.x.lessThan(max(circle.x.add(circle.z), pill.x.add(pill.z)).add(15))), () => {
      const a = point.sub(circle.xy)
      const local = point.sub(pill.xy)
      const spine = pill.z.sub(pill.w)
      const b = vec2(local.x.sub(clamp(local.x, spine.negate(), spine)), local.y)
      const da = length(a).sub(circle.w), db = length(b).sub(pill.w)
      // Fitted to both sides of the native contour across eight gaps.
      // The compact blend leaves the remote cap unchanged. At its centre
      // it lowers the field by the measured depression in points.
      const separation = pill.x.sub(circle.x)
      const gap = abs(separation).sub(pill.z).sub(circle.w)
      const depression = clamp(gap, 2, 11).sub(9).mul(.108).add(4.502).mul(strength ?? 1).max(.0001)
      const power = 1.61
      const delta = da.sub(db)
      const overlap = max(float(1).sub(abs(delta).div(depression.mul(2 * power))), 0)
      const blendWeight = overlap.pow(power - 1)
      const weight = blendWeight.mul(.5)
      const fraction = mix(float(1).sub(weight), weight, step(0, delta))
      const distance = min(da, db).sub(depression.mul(overlap).mul(blendWeight))
      const gradient = mix(b.div(max(length(b), .001)), a.div(max(length(a), .001)), fraction)
      // At the saddle the derivative goes continuously to zero. Normalizing
      // it there would turn an arbitrarily small tilt into a full lens fold.
      // The smooth minimum is an implicit field. Convert its value to
      // contour-normal points before antialiasing or drawing a hairline.
      const slope = max(length(gradient), .012)
      const contourDistance = distance.div(slope)
      const coverage = clamp(float(.5).sub(contourDistance.mul(ratio)), 0, 1)
      const exterior = max(contourDistance, 0)
      const bg = result.rgb.toVar()
      const luma = dot(bg, vec3(.2126, .7152, .0722))
      const light = float(.9).sub(luma.mul(.59))
      const opacity = light.add(dark.mul(max(luma.sub(.5), 0).pow(2)).mul(1.22).div(max(luma,.001)))
      // Facing tips lose most of the isolated cap's dark hairline.
      // Native open-gap captures show a weaker, broader exterior falloff.
      const hairWidth = float(.5).add(float(1).sub(slope).mul(.75))
      const hair = clamp(hairWidth.sub(exterior).mul(ratio).add(.5), 0, 1)
        .mul(slope.pow(1.7))
      const direction = float(1).sub(gradient.y.abs().div(slope).pow(2).mul(mix(.69, 1, dark)))
      const halo = max(gradient.y.add(.2).div(1.2), 0).mul(.014)
        .mul(clamp(float(1).sub(exterior.div(14)), 0, 1))
      bg.mulAssign(float(1).sub(halo).mul(float(1).sub(opacity.mul(hair).mul(direction).mul(tuning?.edges.y ?? 1).min(1))))
      If(coverage.greaterThan(0), () => {
        const radius = mix(pill.w, circle.w, fraction)
        // A 32-point native phase grating measures a shallower fold in
        // the neck. Keep the direction of the single surface gradient;
        // attenuate the optical offset independently of the rim and tint.
        const midpoint = circle.x.add(separation.sign().mul(circle.w.add(gap.mul(.5))))
        const offset = point.x.sub(midpoint).div(14)
        const squared = offset.mul(offset)
        const neck = squared.mul(squared).negate().exp().mul(strength ?? 1)
        const reach = radius.mul(mix(1.4, .767, fraction))
        const exponent = mix(float(8.75).sub(gradient.y.abs().mul(.34)), 4.28, fraction)
        // The native optical depth decays faster on the 30-point cap
        // than on the 24-point cap. The two weights share one gradient.
        const decay = mix(.24, .94, fraction)
        const gain = clamp(float(1).add(distance.div(reach)), .0001, 1)
          .pow(exponent.mul(neck).mul(decay)).mul(float(1).sub(neck.mul(.11)))
        // The native seven-point phase capture has 7.7% more horizontal
        // travel and 3% more transmitted contrast through the facing tips.
        const travel = vec2(float(1).add(neck.mul(.077)), 1)
        const folded = (at: N, footprint: N) => {
          const ray = uv().add(at.sub(uv()).mul(gain).mul(travel))
          const detail = filtered(ray, footprint)
          return detail.add(detail.sub(blurred(uv())).mul(neck.mul(.03)))
        }
        const face = regularGlass(vec2(radius), distance, gradient, uv(), size, dark, sample, folded, blurred, undefined, tuning)
        const lifted = pressLift ? mix(face, vec3(1), pressLift.mul(tuning?.edges.z ?? .405).mul(float(1).sub(fraction))) : face
        bg.assign(mix(bg, lifted, coverage))
      })
      result.assign(vec4(bg, 1))
    })
    return result
  })()
}
