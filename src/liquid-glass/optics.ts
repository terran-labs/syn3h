import { clamp, dot, float, max, min, mix, reflect, refract, smoothstep, vec2, vec3 } from 'three/tsl'

type N = any // Composable TSL expression, as in PostChain.

/** Orthographic view ray through a flat-backed slab. All lengths are CSS pixels
 * and the sampled scene is on the rear plane. The curved part of the front
 * surface is a quarter ellipse tangent to the flat central face. */
export function glassOptics(localHalf: N, distance: N, gradient: N, screen: N, size: N, material: N, state: N, tint: N, sample: (uv: N) => N): N {
  const half = min(localHalf.x, localHalf.y)
  const thickness = half.mul(material.x).mul(float(1).add(state.z.mul(0.08)).sub(state.w.mul(0.23)))
  const width = max(half.mul(material.y).mul(float(1).add(state.w.mul(0.24))), 0.5)
  const u = clamp(float(1).add(distance.div(width)), 0, 1)
  const arc = max(float(1).sub(u.mul(u)), 0).sqrt()
  const rise = thickness.mul(0.48)
  const height = thickness.sub(rise).add(rise.mul(arc))
  // dz/dd = -rise*u/(width*arc). Multiply the normal through by the
  // denominator so the vertical tangent at the edge remains finite.
  const normal = vec3(vec2(gradient.mul(rise.mul(u))), float(width.mul(arc) as N)).normalize()
  const incident = vec3(0, 0, -1)
  const exit = (index: N) => {
    const ray = refract(incident, normal, float(1).div(index))
    return clamp(screen.add(ray.xy.mul(height).div(max(ray.z.negate(), 0.001)).div(size)), 0, 1)
  }
  const ior = material.z
  const halfSpread = material.w.mul(0.5)
  const green = exit(ior)
  const through = vec3(sample(exit(ior.sub(halfSpread))).r, sample(green).g, sample(exit(ior.add(halfSpread))).b)
  // A small scatter around the green ray supplies frost without blurring away
  // the image folded through the bevel.
  const scatter = vec2(0.16, -0.16).mul(state.x).div(size)
  const frost = sample(clamp(green.add(scatter), 0, 1)).add(sample(clamp(green.sub(scatter), 0, 1))).mul(0.5)
  const transmitted = mix(mix(through, frost, 0.065), tint.rgb, tint.a)
  const r = ior.sub(1).div(ior.add(1))
  const f0 = r.mul(r)
  const fresnel = f0.add(float(1).sub(f0).mul(float(1).sub(normal.z).pow(5)))
  // A broad window and a dark surround, reflected by the very same surface.
  const reflected = reflect(incident, normal)
  const window = smoothstep(-0.15, 0.8, dot(reflected, vec3(-0.62, -0.70, 0.35).normalize()))
  const environment = mix(vec3(0.12, 0.13, 0.15), vec3(1.12, 1.15, 1.18), window)
  return mix(transmitted, environment, fresnel)
}
