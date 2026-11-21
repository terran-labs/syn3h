import { Fn, If, Loop, Continue, abs, dot, float, length, max, min, mix, clamp, screenSize, step, uv, vec2, vec3, vec4 } from 'three/tsl'
import { mergedGlassPair } from './mergedPair'
import { glassOptics } from './optics'
import { regularGlass, regularResponse, type RegularUniforms } from './regular'

type N = any // TSL expression with a shader-dependent node type.

export interface GlassSurfaces {
  pairSlots?: N
  pressState?: N
  surfaceCount?: N
  capacity: number
  viewport: N
  clips?: N // Visible scrollport in canvas coordinates.
  presentation?: N // Effective DOM opacity and card flag.
  boxes: N // Centre and half-size in CSS pixels, origin at top left.
  radii: N // Top left, top right, bottom left, bottom right.
  filters: N
  bodies: N
}

/** Compose over display-encoded RGB. Sample and original must use the same colour space. */
export function composeGlass(original: N, sample: (at: N) => N, glass: GlassSurfaces, material: N, filtered?: (uv: N, width: N) => N, blurred?: (uv: N) => N, mergePair = true, tuning?: RegularUniforms): N {
  return Fn(() => {
    const result = original.toVar()
    const size = glass.viewport.xy.max(vec2(1))
    const pixel = uv().mul(size)
    const pixelsPerPoint = screenSize.x.div(size.x)
    const pair = mergePair && filtered && blurred ? glass.pairSlots : undefined
    Loop(glass.surfaceCount ?? glass.capacity, ({ i }: { i: N }) => {
      const box: N = glass.boxes.element(i)
      const local = pixel.sub(box.xy)
      const visible = box.z.greaterThan(0)
      const single = pair ? visible.and(pair.z.lessThanEqual(0).or(i.notEqual(pair.x).and(i.notEqual(pair.y)))) : visible
      const clip = glass.clips?.element(i)
      const inside = clip ? single.and(pixel.x.greaterThanEqual(clip.x)).and(pixel.y.greaterThanEqual(clip.y))
        .and(pixel.x.lessThan(clip.z)).and(pixel.y.lessThan(clip.w)) : single
      If(inside.and(abs(local.x).lessThanEqual(box.z.add(14))).and(abs(local.y).lessThanEqual(box.w.add(14))), () => {
        const corners: N = glass.radii.element(i)
        const top = mix(corners.x, corners.y, step(0, local.x))
        const bottom = mix(corners.z, corners.w, step(0, local.x))
        const radius = mix(top, bottom, step(0, local.y))
        const q = vec2(abs(local).sub(box.zw).add(radius) as N)
        const outer = max(q, vec2(0))
        const roundDistance = length(outer).add(min(max(q.x, q.y), 0)).sub(radius)
        const presentation = glass.presentation?.element(i)
        const opacity = presentation?.x ?? float(1)
        if (presentation && blurred) {
          // At this depth the 16 pt card corner has no displaced sample.
          // The scene composite already contains the fine backdrop at this pixel.
          If(presentation.y.greaterThan(.5).and(glass.viewport.w.lessThan(.5)).and(roundDistance.lessThan(-24)), () => {
            const { tone, chroma } = regularResponse(original.rgb, blurred(uv()), glass.viewport.z, presentation.y, tuning)
            const face = clamp(vec3(tone).add(chroma), 0, 1)
            result.assign(vec4(mix(result.rgb, face, opacity), 1))
            Continue()
          })
        }
        const side = step(q.y, q.x)
        const gradient = mix(vec2(side, float(1).sub(side)), outer.div(max(length(outer), 0.001)), step(0.001, length(outer))).mul(local.sign())
        const clear = glass.viewport.w.greaterThan(.5)
        const dark = glass.viewport.z
        // SwiftUI's continuous capsule rolls into the cap a fraction of a
        // point before a circular arc would. Its extrema and centre coincide.
        const short = min(box.z, box.w)
        const horizontal = step(box.w, box.z)
        const along = mix(local.y.abs(), local.x.abs(), horizontal)
        const acrossNormal = mix(gradient.x.abs(), gradient.y.abs(), horizontal)
        const spine = max(box.z, box.w).sub(short)
        const capPosition = along.sub(spine).sub(short.mul(.12)).div(max(short.mul(.28), .01))
        const join = capPosition.mul(capPosition).negate().exp().mul(short.mul(.017))
          .mul(acrossNormal.mul(acrossNormal)).mul(clamp(spine.div(short), 0, 1))
          .mul(clamp(radius.div(short).sub(.9).mul(10), 0, 1))
        const distance = roundDistance.add(join)
        const d = max(distance, 0)
        const under = result.rgb.toVar()
        If(clear.not(), () => {
          const luma = dot(under, vec3(.2126, .7152, .0722))
          const lightOpacity = float(.90).sub(luma.mul(.59))
          const darkOpacity = lightOpacity.add(max(luma.sub(.5), 0).pow(2).mul(1.22).div(max(luma, .001)))
          // The half-point contour ends at half coverage. Its antialiasing
          // footprint is one backing pixel, including at fractional scale.
          const hair = clamp(float(.5).sub(d).mul(pixelsPerPoint).add(.5), 0, 1)
          const pole = gradient.y.abs().pow(2)
          const direction = float(1).sub(pole.mul(mix(.69, 1, dark)))
          const halo = float(.014).mul(max(gradient.y.add(.2).div(1.2), 0))
            .mul(clamp(float(1).sub(d.div(14)), 0, 1))
          const opacity = mix(lightOpacity, darkOpacity, dark).mul(hair).mul(direction).mul(tuning?.edges.y ?? 1).min(1)
          under.assign(under.mul(float(1).sub(halo)).mul(float(1).sub(opacity)))
        })
        const coverage = clamp(float(.5).sub(distance.mul(pixelsPerPoint)), 0, 1)
        If(coverage.greaterThan(0), () => {
          const body = vec3(0).toVar()
          If(clear, () => {
            body.assign(glassOptics(box.zw, distance, gradient, uv(), size, material, glass.filters.element(i), glass.bodies.element(i), sample))
          }).Else(() => {
            const opticalSize = presentation ? mix(box.zw, vec2(radius.max(1)), presentation.y) : box.zw
            body.assign(regularGlass(opticalSize, distance, gradient, uv(), size, dark, sample, filtered, blurred, presentation?.y, tuning))
          })
          if (glass.pressState) {
            const lift = glass.pressState.y.mul(tuning?.edges.z ?? .405).mul(float(i.equal(glass.pressState.x)))
            body.assign(mix(body, vec3(1), lift))
          }
          if (presentation) {
            body.assign(mix(body, vec3(1), presentation.w.mul(tuning?.edges.z ?? .405)))
            // A single delayed frost sample cannot predict every pixel under a
            // gear label during a burst. Bound the face for the ink being painted.
            If(presentation.z.greaterThan(0), () => {
              const mean = dot(body, vec3(.2126, .7152, .0722))
              // Convex sRGB decoding makes decoded mean a lower bound on luminance.
              const lift = max(float(.47).sub(mean), 0).div(max(float(1).sub(mean), .001))
              body.assign(mix(body, vec3(1), lift))
            }).ElseIf(presentation.z.lessThan(0), () => {
              // Squared display RGB bounds linear light to within .002. Leave
              // room for output quantization and preserve the hue of bright pixels.
              const energy = dot(body.mul(body), vec3(.2126, .7152, .0722))
              body.mulAssign(float(.174).div(max(energy, .174)).sqrt())
            })
          }
          under.assign(mix(under, body, coverage))
        })
        result.assign(vec4(mix(result.rgb, under, opacity) as N, 1))
      })
    })
    if (pair && filtered && blurred) {
      If(pair.z.greaterThan(0), () => {
        const merged = mergedGlassPair(result, glass.boxes.element(pair.x.toInt()), glass.boxes.element(pair.y.toInt()),
          glass.viewport, pixelsPerPoint, sample, filtered, blurred, glass.pressState?.y, pair.z, tuning)
        result.assign(glass.presentation ? mix(result, merged, glass.presentation.element(pair.x.toInt()).x) : merged)
      })
    }
    return result
  })()
}
