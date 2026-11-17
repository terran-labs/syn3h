/**
 * The sunburst: stylised radial streaks round a low sun, the in-world sibling of the lobby
 * galaxy's sun shafts (src/ui/galaxy/Galaxy.ts, `shafts`). The galaxy's shader is GLSL, so this
 * is a port, not a share: the same value noise and hash, the same three octaves (frequencies
 * 2.4, 6.5 and 17 round the circle, powers 2, 3 and 4, weights 0.9, 0.8 and 0.6) and the same
 * shape of drift, so the lobby's sun and a planet's sunrise are one star. The drift here is
 * ten times slower than the lobby's: a sunrise is watched for minutes, and a streak should take
 * tens of seconds to change.
 *
 * The pattern is a function of a direction round the sun (a unit 2D vector in the plane
 * square to the sun, fixed in the world) and of time, which drifts it: a noticeable change
 * takes tens of seconds. The lobby draws its streaks over black space, so its gaps are
 * empty; here they sit over a bright sky, so the pattern is cubed (SUNBURST_GAMMA) to give
 * gaps as deep, its brightest streaks are held under a soft ceiling (SUNBURST_CEILING, about
 * 3.8 times the mean at most) so no moment of the drift throws a logo, then it is divided by
 * its mean, so over a full turn and over time it averages 1 and
 * open sky keeps its brightness on average.
 *
 * `sunburstPatternCpu` is the same maths in plain numbers, for the mean and for tests.
 */
import { float, floor, fract, mix, pow, vec3 } from 'three/tsl'

type N = any // TSL node

/** Octaves as the galaxy draws them: frequency round the circle, offset, drift rate, power, weight. */
const OCTAVES = [
  { freq: 2.4, offset: 0, rate: 0.009, power: 2, weight: 0.9 },
  { freq: 6.5, offset: 3, rate: 0.015, power: 3, weight: 0.8 },
  { freq: 17, offset: 9, rate: 0.024, power: 4, weight: 0.6 },
] as const

// ---- CPU ------------------------------------------------------------------------------
const fr = (x: number) => x - Math.floor(x)
function hashCpu(x: number, y: number, z: number): number {
  x = fr(x * 0.3183099 + 0.1) * 17; y = fr(y * 0.3183099 + 0.1) * 17; z = fr(z * 0.3183099 + 0.1) * 17
  return fr(x * y * z * (x + y + z))
}
function noiseCpu(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  let fx = x - ix, fy = y - iy, fz = z - iz
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  const h = (dx: number, dy: number, dz: number) => hashCpu(ix + dx, iy + dy, iz + dz)
  return l(l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
    l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz)
}
/** The raw pattern (not divided by its mean) at a direction round the sun, time and seed phase. */
export function rawSunburstCpu(x: number, y: number, time: number, phase: number, octaves: number): number {
  let sum = 0
  for (let o = 0; o < octaves; o++) {
    const k = OCTAVES[o]
    sum += Math.pow(noiseCpu(x * k.freq + k.offset + phase, y * k.freq + k.offset, time * k.rate + phase * 1.7), k.power) * k.weight
  }
  return sum
}
/** The pattern is raised to this power: deep gaps between the streaks. */
export const SUNBURST_GAMMA = 3
/** Soft ceiling on the cubed pattern: x / (1 + x / ceiling). */
export const SUNBURST_CEILING = 0.4
const shapeCpu = (raw: number) => { const x = Math.pow(raw, SUNBURST_GAMMA); return x / (1 + x / SUNBURST_CEILING) }
/** Mean of the shaped pattern over every direction and a long stretch of time. */
function meanOf(octaves: number): number {
  let sum = 0, n = 0
  for (let t = 0; t < 4000; t += 37) for (let a = 0; a < 256; a++) {
    const angle = (a / 256) * Math.PI * 2
    sum += shapeCpu(rawSunburstCpu(Math.cos(angle), Math.sin(angle), t, 0, octaves)); n++
  }
  return sum / n
}
/** Means for the full burst (three octaves) and the simpler one (two: no fine streaks). */
export const SUNBURST_MEAN = { 3: meanOf(3), 2: meanOf(2) } as const
export function sunburstPatternCpu(x: number, y: number, time: number, phase: number, octaves: 2 | 3): number {
  return shapeCpu(rawSunburstCpu(x, y, time, phase, octaves)) / SUNBURST_MEAN[octaves]
}

// ---- GPU ------------------------------------------------------------------------------
const hash = (p: N): N => {
  const q = fract(p.mul(0.3183099).add(0.1)).mul(17.0).toVar() as N
  return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)))
}
const noise = (x: N): N => {
  const i = floor(x).toVar() as N
  const f0 = fract(x)
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar() as N
  const h = (dx: number, dy: number, dz: number) => hash(i.add(vec3(dx, dy, dz)))
  return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y), f.z)
}
/**
 * The burst toward `around` (unit 2D, round the sun), mean 1. `octaves` 3 is the full burst,
 * 2 drops the fine streaks for cheaper tiers.
 */
export function sunburstPattern(around: N, time: N, phase: N, octaves: 2 | 3): N {
  let sum: N = float(0)
  for (let o = 0; o < octaves; o++) {
    const k = OCTAVES[o]
    const p = vec3(around.x.mul(k.freq).add(k.offset).add(phase), around.y.mul(k.freq).add(k.offset), time.mul(k.rate).add(phase.mul(1.7)))
    sum = sum.add(pow(noise(p), k.power).mul(k.weight))
  }
  const cubed = pow(sum, SUNBURST_GAMMA)
  return cubed.div(cubed.div(SUNBURST_CEILING).add(1)).div(SUNBURST_MEAN[octaves])
}
