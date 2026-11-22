// Adapted from Shayan's liquidglass (Apache-2.0). See NOTICE.md for provenance.
// This TSL implementation and its control-size calibration differ from the SkSL original.
import { sRGBTransferEOTF, sRGBTransferOETF, clamp, dot, float, max, min, mix, vec2, vec3 } from 'three/tsl'

type N = any

// Equal-weight samples of a 2D Gaussian, fixed in control space to avoid temporal noise.
const wideOffsets = Array.from({ length: 32 }, (_, i) => {
  const radius = Math.sqrt(-2 * Math.log(1 - (i + 0.5) / 32))
  const angle = i * Math.PI * (3 - Math.sqrt(5))
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
})

// White labels on small lenses need 3:1. Card text needs 4.5:1. Leave
// quantization headroom, and a little more for controls inside large panels.
// Scale in linear light so bright saturated backdrops retain their hue.
export function whiteInkFace(rgb: N, distance: N, smallControl: N, tuning: RegularUniforms, at: N): N {
  const linear = sRGBTransferEOTF(rgb)
  let adapted = linear
  if (tuning.exposure) {
    const pair = tuning.exposure(at)
    const delta = pair.x.sub(pair.y)
    // f(history) - f(now) for the measured quadratic button transfer.
    const slope = pair.x.add(pair.y).mul(tuning.face.x).add(tuning.face.y)
    adapted = sRGBTransferEOTF(clamp(rgb.add(delta.mul(slope)), 0, 1))
  }
  const luminance = dot(adapted, vec3(.2126, .7152, .0722))
  const limit = mix(.18, .296, smallControl)
  const safe = sRGBTransferOETF(linear.mul(limit.div(max(limit, luminance))))
  return mix(rgb, safe, clamp(distance.negate().sub(1), 0, 1).mul(float(luminance.greaterThan(limit))))
}

export interface RegularUniforms {
  exposure?: (at: N) => N // Smoothed and current backdrop luminance
  face: N // Quadratic transfer, linear term, offset and saturation
  panel: N // Panel slope and offset
  edges: N // Rim, hairline and pressed brightness
}

export function regularGlass(halfSize: N, distance: N, normal: N, screen: N, size: N, dark: N, sample: (uv: N) => N, filtered?: (uv: N, width: N) => N, blurred?: (uv: N) => N, panel?: N, tuning?: RegularUniforms): N {
  const radius = min(halfSize.x, halfSize.y)
  const depth = max(distance.negate(), 0)
  // Phase of the 32-point native grating, unwrapped from the undistorted centre.
  const small = clamp(float(30).sub(radius).div(6), 0, 1)
  const amplitude = mix(.743, float(.832).add(normal.y.abs().mul(.044)), small)
  const reach = radius.mul(mix(.767, 1.4, small))
  const power = mix(4.28, float(8.75).sub(normal.y.abs().mul(.34)), small)
  const shift = radius.mul(amplitude).mul(clamp(float(1).sub(depth.div(reach)), 0, 1).pow(power))
  const at = screen.sub(normal.mul(shift).div(size))
  const detail = filtered ? filtered(clamp(at, 0, 1), float(1.15)) : sample(clamp(at, 0, 1))
  const wide = vec3(0).toVar()
  if (blurred) {
    wide.assign(blurred(screen))
  } else if (filtered) {
    // Four broad footprint samples approximate the second moment of the native
    // 15.5 point Gaussian. Width describes one mip texel in logical pixels.
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      wide.addAssign(filtered(clamp(screen.add(vec2(x, y).mul(11).div(size)), 0, 1), float(24)))
    }
    wide.divAssign(4)
  } else {
    for (const [x, y] of wideOffsets) {
      wide.addAssign(sample(clamp(screen.add(vec2(x, y).mul(15.5).div(size)), 0, 1)))
    }
    wide.divAssign(wideOffsets.length)
  }
  const { tone, chroma } = regularResponse(detail, wide, dark, panel, tuning)
  const vertical = normal.y.abs()
  const narrow = max(float(1).sub(depth.div(1.17)), 0)
  const contour = max(float(1).sub(depth.div(.48)), 0)
  // Measured on neutral fields. The narrow peak sits on both vertical normals;
  // the weaker shoulder decays into the face. Bright faces reflect less light.
  const response = (light: number, lightSlope: number, night: number, nightSlope: number) =>
    mix(light, night, dark).add(tone.mul(mix(lightSlope, nightSlope, dark)))
  const rim = narrow.mul(vertical.pow(2)).mul(response(.1225, -.0184, .1478, -.069))
    .add(narrow.mul(vertical.pow(8)).mul(response(.0442, -.087, .019, .0065)))
    .add(depth.mul(-.5).exp().mul(vertical.pow(4)).mul(response(.101, -.0911, .0909, -.0779)))
    .add(depth.mul(-.2).exp().mul(float(1).sub(vertical.pow(2))).mul(response(.0007, -.028, .0031, -.0344)))
    .add(contour.mul(response(-.1476, .0954, -.0743, .0941)))
  return clamp(vec3(tone.add(tuning ? rim.mul(tuning.edges.x) : rim)).add(chroma), 0, 1)
}

// Shared by the folded edge and the flat interior of a card.
export function regularResponse(detail: N, wide: N, dark: N, panel?: N, tuning?: RegularUniforms): { tone: N; chroma: N } {
  const delta = detail.sub(wide)
  const body = wide.add(delta.mul(0.275)).add(delta.abs().mul(mix(0.22, -0.22, dark)))
  const luma = dot(body, vec3(.2126, .7152, .0722))
  const gain = mix(vec3(.988, .952, .979).add(vec3(-.076, .028, -.045).mul(luma)),
    vec3(1.317, 1.256, 1.314).add(vec3(-.427, -.351, -.429).mul(luma)), dark)
  const chroma = body.sub(luma).mul(gain)
  if (tuning) {
    const f = tuning.face
    const button = luma.mul(luma).mul(f.x).add(luma.mul(f.y)).add(f.z)
    return { tone: panel ? mix(button, luma.mul(tuning.panel.x).add(tuning.panel.y), panel) : button, chroma: chroma.mul(f.w) }
  }
  // Native neutral fields from RGB 0 to 255, captured in both appearances.
  const lightTone = luma.mul(luma).mul(-.034).add(luma.mul(.506)).add(133 / 255)
  const darkTone = luma.mul(luma).mul(-.39).add(luma.mul(.99)).add(32 / 255)
  const controlTone = mix(lightTone, darkTone, dark)
  // Large Regular panel over native black and white fields, in both appearances.
  const panelTone = mix(luma.mul(118 / 255).add(136 / 255), luma.mul(90 / 255).add(32 / 255), dark)
  const tone = panel ? mix(controlTone, panelTone, panel) : controlTone
  return { tone, chroma }
}
