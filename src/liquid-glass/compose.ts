import { Fn, If, Loop, abs, float, length, max, min, mix, smoothstep, step, uv, vec2, vec3, vec4 } from 'three/tsl'
import { glassOptics } from './optics'
import { regularGlass } from './regular'

type N = any // TSL expression with a shader-dependent node type.

export interface GlassSurfaces {
  capacity: number
  viewport: N
  boxes: N // Centre and half-size in CSS pixels, origin at top left.
  radii: N // Top left, top right, bottom left, bottom right.
  filters: N
  bodies: N
}

/** Compose over display-encoded RGB. Sample and original must use the same colour space. */
export function composeGlass(original: N, sample: (at: N) => N, glass: GlassSurfaces, material: N, filtered?: (uv: N, width: N) => N): N {
  return Fn(() => {
    const result = original.toVar()
    const size = glass.viewport.xy.max(vec2(1))
    const pixel = uv().mul(size)
    Loop(glass.capacity, ({ i }: { i: N }) => {
      const box: N = glass.boxes.element(i)
      const local = pixel.sub(box.xy)
      If(box.z.greaterThan(0).and(abs(local.x).lessThanEqual(box.z)).and(abs(local.y).lessThanEqual(box.w)), () => {
        const corners: N = glass.radii.element(i)
        const top = mix(corners.x, corners.y, step(0, local.x))
        const bottom = mix(corners.z, corners.w, step(0, local.x))
        const radius = mix(top, bottom, step(0, local.y))
        const q = vec2(abs(local).sub(box.zw).add(radius) as N)
        const outer = max(q, vec2(0))
        const distance = length(outer).add(min(max(q.x, q.y), 0)).sub(radius)
        const side = step(q.y, q.x)
        const gradient = mix(vec2(side, float(1).sub(side)), outer.div(max(length(outer), 0.001)), step(0.001, length(outer))).mul(local.sign())
        const body = vec3(0).toVar()
        If(glass.viewport.w.greaterThan(0.5), () => {
          body.assign(glassOptics(box.zw, distance, gradient, uv(), size, material, glass.filters.element(i), glass.bodies.element(i), sample))
        }).Else(() => {
          body.assign(regularGlass(box.zw, distance, gradient, uv(), size, glass.viewport.z, sample, filtered))
        })
        result.assign(vec4(mix(vec3(original.rgb), vec3(body), float(1).sub(smoothstep(-0.5, 0.5, distance))), 1))
      })
    })
    return result
  })()
}
