/**
 * Vehicle tints: pleasing random pairs and smooth changes between them, worked in OKLab and
 * OKLCH (Björn Ottosson's perceptual colour space) rather than in RGB. A blend in RGB from
 * blue to orange passes through grey-brown mud; in OKLCH it travels round the hue wheel at a
 * steady lightness and colourfulness. Pure maths, no DOM and no Three.js, so the interface,
 * the local vehicle and networking (remote vehicles) share it.
 */

export interface TintPair { body: string; accent: string }
type Lab = [number, number, number]

const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const linearToSrgb = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

/** #rrggbb to OKLab. */
export function hexToOklab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16)
  const r = srgbToLinear((n >> 16 & 255) / 255), g = srgbToLinear((n >> 8 & 255) / 255), b = srgbToLinear((n & 255) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}

/** OKLab to linear sRGB, unclamped: a component outside 0 to 1 means out of gamut. */
function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
}

/** OKLab to #rrggbb, clamped into sRGB. */
export function oklabToHex(lab: Lab): string {
  return '#' + oklabToLinear(lab).map(c => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, '0')).join('')
}

const lch = (L: number, C: number, h: number): Lab => [L, C * Math.cos(h), C * Math.sin(h)]
const inGamut = (lab: Lab) => oklabToLinear(lab).every(c => c >= -1e-4 && c <= 1 + 1e-4)

/**
 * The colour a fraction `t` of the way from `from` to `to`, through OKLCH: lightness and
 * colourfulness move straight, hue takes the short way round. When either end is nearly grey
 * its hue means nothing, so the blend borrows the other end's hue rather than swinging.
 */
export function mixTint(from: string, to: string, t: number): string {
  if (t <= 0) return from
  if (t >= 1) return to
  const [L1, a1, b1] = hexToOklab(from), [L2, a2, b2] = hexToOklab(to)
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2)
  let h1 = Math.atan2(b1, a1), h2 = Math.atan2(b2, a2)
  if (C1 < 0.02) h1 = h2
  if (C2 < 0.02) h2 = h1
  let dh = h2 - h1
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI
  return oklabToHex(lch(L1 + (L2 - L1) * t, C1 + (C2 - C1) * t, h1 + dh * t))
}

/** Ease in and out (cubic): starts and ends at rest. */
export const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

/** How long a tint change takes, seconds. */
export const TINT_SECONDS = 1

/**
 * A pair of colours easing towards a target. A new target starts from the colour showing
 * now, so pressing Randomize again mid-change turns smoothly instead of jumping or queueing.
 */
export class TintTransition {
  private from: TintPair
  private to: TintPair
  private elapsed = 0
  private duration = 0
  /** The colours showing now. */
  current: TintPair
  constructor(start: TintPair) { this.from = { ...start }; this.to = { ...start }; this.current = { ...start } }
  get active(): boolean { return this.elapsed < this.duration }
  get target(): TintPair { return this.to }
  /** Ease to `target` over `seconds`, from wherever the colours are now. */
  set(target: TintPair, seconds = TINT_SECONDS): void {
    if (target.body === this.to.body && target.accent === this.to.accent && this.active) return
    this.from = { ...this.current }; this.to = { ...target }; this.elapsed = 0; this.duration = seconds
    if (seconds <= 0) this.current = { ...target }
  }
  /** Show `target` at once (a colour picker being dragged). */
  jump(target: TintPair): void { this.set(target, 0) }
  /** Advance; true when the showing colours changed. */
  update(dt: number): boolean {
    if (!this.active) return false
    this.elapsed = Math.min(this.duration, this.elapsed + dt)
    const t = easeInOut(this.elapsed / this.duration)
    this.current = { body: mixTint(this.from.body, this.to.body, t), accent: mixTint(this.from.accent, this.to.accent, t) }
    return true
  }
}

// ---------------------------------------------------------------------------------------
// Randomize
// ---------------------------------------------------------------------------------------

/**
 * The rules a random pair keeps. Lightness is OKLab L (0 black, 1 white). The body is the
 * larger area, so it stays mid-light: readable against dark rock and bright snow alike.
 */
export const TINT_RULES = {
  bodyLightness: [0.5, 0.78] as const,
  accentLightness: [0.45, 0.9] as const,
  /** Neither colour washes out to grey. */
  minChroma: 0.06,
  /** The two must read as two colours: apart in lightness, and apart overall. */
  minLightnessGap: 0.12,
  minDistance: 0.18,
}

/** Hue relationships a pair is drawn from, as offsets of the accent's hue from the body's (radians). */
const SCHEMES: Record<string, readonly number[]> = {
  complementary: [Math.PI],
  split: [Math.PI * 5 / 6, Math.PI * 7 / 6],
  triadic: [Math.PI * 2 / 3, Math.PI * 4 / 3],
  analogous: [Math.PI / 6, -Math.PI / 6],
  monochrome: [0],
}
export const TINT_SCHEMES = Object.keys(SCHEMES)

/** True when a pair keeps TINT_RULES. */
export function tintPairOk(pair: TintPair): boolean {
  const a = hexToOklab(pair.body), b = hexToOklab(pair.accent), R = TINT_RULES
  const chroma = (x: Lab) => Math.hypot(x[1], x[2])
  return a[0] >= R.bodyLightness[0] - 0.01 && a[0] <= R.bodyLightness[1] + 0.01 && b[0] >= R.accentLightness[0] - 0.01 && b[0] <= R.accentLightness[1] + 0.01 &&
    chroma(a) >= R.minChroma - 0.005 && chroma(b) >= R.minChroma - 0.005 &&
    Math.abs(a[0] - b[0]) >= R.minLightnessGap - 0.005 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= R.minDistance - 0.005
}

/** The most colourful in-gamut chroma at lightness L and hue h, up to `want`. */
function fitChroma(L: number, h: number, want: number): number {
  let C = want
  while (C > 0 && !inGamut(lch(L, C, h))) C -= 0.005
  return Math.max(0, C)
}

/**
 * A pleasing body and accent pair from `seed`: a hue scheme picked at random, lightness and
 * colourfulness inside TINT_RULES, the most colourful each can be in sRGB. The same seed
 * always gives the same pair.
 */
export function randomTintPair(seed: number): TintPair & { scheme: string } {
  let s = seed >>> 0
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  const R = TINT_RULES
  for (let attempt = 0; attempt < 50; attempt++) {
    const scheme = TINT_SCHEMES[Math.floor(rand() * TINT_SCHEMES.length)]
    const offsets = SCHEMES[scheme]
    const h1 = rand() * 2 * Math.PI, h2 = h1 + offsets[Math.floor(rand() * offsets.length)]
    const L1 = R.bodyLightness[0] + rand() * (R.bodyLightness[1] - R.bodyLightness[0])
    // The accent sits clearly lighter or darker; monochrome needs a wider gap to read.
    const gap = (scheme === 'monochrome' ? 0.24 : R.minLightnessGap + 0.04) + rand() * 0.12
    const up = L1 + gap <= R.accentLightness[1], down = L1 - gap >= R.accentLightness[0]
    if (!up && !down) continue
    const L2 = up && (!down || rand() < 0.6) ? L1 + gap : L1 - gap
    const C1 = fitChroma(L1, h1, 0.09 + rand() * 0.09), C2 = fitChroma(L2, h2, 0.11 + rand() * 0.1)
    const pair = { body: oklabToHex(lch(L1, C1, h1)), accent: oklabToHex(lch(L2, C2, h2)), scheme }
    if (tintPairOk(pair)) return pair
  }
  return { body: '#1768b4', accent: '#49e6ff', scheme: 'analogous' }
}
