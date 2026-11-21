// Truncate the measured 15.5-point Gaussian at three standard deviations.
// Combine neighbouring taps using bilinear interpolation. The vertical
// intermediate has one texel per four points. A two-point source footprint
// keeps the fine grid from acquiring a left-to-right colour bias.
const pitch = 4
const sigma = 15.5
const reach = Math.ceil(3 * sigma / pitch)
const weights = Array.from({ length: 2 * reach + 1 }, (_, i) => Math.exp(-.5 * ((i - reach) * pitch / sigma) ** 2))
const total = weights.reduce((a, b) => a + b, 0)
export const glassBlurTaps: { offset: number; weight: number }[] = []
for (let i = 0; i < weights.length; i += 2) {
  const a = weights[i], b = weights[i + 1] ?? 0
  glassBlurTaps.push({ offset: (i - reach + b / (a + b)) * pitch, weight: (a + b) / total })
}
