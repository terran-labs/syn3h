// Adapted from Shayan's liquidglass (Apache-2.0). See NOTICE.md for provenance.
// This TSL implementation and its control-size calibration differ from the SkSL original.
import { clamp, dot, float, max, min, mix, vec2, vec3 } from 'three/tsl'

type N = any

// Equal-weight samples of a 2D Gaussian, fixed in control space to avoid temporal noise.
const wideOffsets = Array.from({ length: 32 }, (_, i) => {
  const radius = Math.sqrt(-2 * Math.log(1 - (i + 0.5) / 32))
  const angle = i * Math.PI * (3 - Math.sqrt(5))
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
})

export function regularGlass(halfSize: N, distance: N, normal: N, screen: N, size: N, dark: N, sample: (uv: N) => N): N {
  const radius = min(halfSize.x, halfSize.y)
  const depth = max(distance.negate(), 0)
  // Phase of the 32-point native grating, unwrapped from the undistorted centre.
  const reach = radius.mul(0.58)
  const shift = radius.mul(0.73).mul(clamp(float(1).sub(depth.div(reach)), 0, 1).pow(2.5))
  const at = screen.sub(normal.mul(shift).div(size))
  const detail = sample(clamp(at, 0, 1))
  const wide = vec3(0).toVar()
  for (const [x, y] of wideOffsets) {
    wide.addAssign(sample(clamp(screen.add(vec2(x, y).mul(15.5).div(size)), 0, 1)))
  }
  wide.divAssign(wideOffsets.length)
  const delta = detail.sub(wide)
  const body = wide.add(delta.mul(0.275)).add(delta.abs().mul(mix(0.22, -0.22, dark)))
  const luma = dot(body, vec3(.2126, .7152, .0722))
  // Native neutral fields from RGB 0 to 255, captured in both appearances.
  const lightTone = luma.mul(luma).mul(-.034).add(luma.mul(.506)).add(133 / 255)
  const darkTone = luma.mul(luma).mul(-.39).add(luma.mul(.99)).add(32 / 255)
  const chroma = body.sub(luma).mul(mix(.49, float(.9).sub(luma.mul(.28)), dark))
  return clamp(vec3(mix(lightTone, darkTone, dark)).add(chroma), 0, 1)
}
