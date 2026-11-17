/**
 * Preetham sky with clouds, adapted from three/examples/jsm/objects/SkyMesh.js (r187, MIT).
 *
 * Changes from the original:
 *  - Rayleigh scattering is a per channel colour instead of Earth's fixed wavelengths, so a
 *    sky can be butterscotch with a blue sunset, green or violet.
 *  - The per sky terms (betaR, betaM, sun intensity) are computed once per frame on the CPU
 *    by skyMath.ts and arrive as uniforms. The vertex stage used to compute them per vertex;
 *    moving them out means the CPU lighting and the GPU sky share one implementation.
 *  - The original's "sunfade" term divided a unit sun vector by 450000 and so did nothing;
 *    it is dropped.
 *  - A moonlit night (sky tint, moon disc opposite the sun, hashed stars) and a twilight
 *    glow, because Preetham's sky goes black two degrees after sunset.
 *  - The ratio betaTheta / beta is guarded so zeroing every channel cannot produce NaN.
 */
import { BackSide, BoxGeometry, Mesh, NodeMaterial, Vector2, Vector3, type Camera } from 'three/webgpu'
import {
  Fn, If, acos, add, cameraPosition, clamp, cos, dot, exp, float, floor, fract, length, max, min, mix,
  modelViewProjection, mul, normalize, positionWorld, pow, renderGroup, smoothstep, sub, time, uniform, vec2, vec3, vec4,
} from 'three/tsl'
import { BETA_EPSILON, GLOW_DESAT, GLOW_KNEE, GLOW_POWER, MIE_ZENITH_LENGTH, SAT_LEAN, SUN_DESAT, RAYLEIGH_ZENITH_LENGTH, SKY_FLOOR, SKY_SCALE } from './skyMath'

type N = any // TSL node; the published types are too strict for shader code written like this

// Gradient noise with a sinless hash, as in SkyMesh. Plain functions inline the code.
const gradient = (i: N): N => {
  const p = fract(i.xyx.mul(vec3(0.1031, 0.103, 0.0973))).toVar() as N
  p.addAssign(dot(p, p.yzx.add(33.33)))
  return fract(p.xx.add(p.yz).mul(p.zy)).mul(2.0).sub(1.0)
}
const noise = (p: N): N => {
  const i = floor(p) as N
  const f = fract(p) as N
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)) as N
  const a = dot(gradient(i), f)
  const b = dot(gradient(i.add(vec2(1.0, 0.0))), f.sub(vec2(1.0, 0.0)))
  const cc = dot(gradient(i.add(vec2(0.0, 1.0))), f.sub(vec2(0.0, 1.0)))
  const d = dot(gradient(i.add(vec2(1.0, 1.0))), f.sub(vec2(1.0, 1.0)))
  return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y).mul(1.6)
}
// Per octave drift makes clouds billow instead of scrolling as a rigid stamp.
const fbm = (position: N, drift: N): N => {
  const p = vec2(position).toVar() as N
  const result = float(0.0).toVar() as N
  let amplitude = 1.0
  for (let o = 0; o < 4; o++) {
    result.addAssign(noise(p).mul(amplitude))
    amplitude *= 0.5
    p.assign(p.mul(2.0).add(drift))
  }
  return result
}


/** The sky's cloud layer settings, as nodes. AlienSkyMesh passes its uniforms. */
export interface SkyCloudInputs { coverage: N; density: N; scale: N; elevation: N; speed: N; offset: N }
/**
 * The sky's cloud layer toward a unit world direction: its noise, the coverage threshold,
 * the soft mask and its opacity. One definition for the sky shader that draws the clouds and
 * the sun shaft mask that lets them block the sun (src/fx/post/PostChain.ts), so beams fall
 * through the gaps the player sees. Opacity is 0 below the horizon and with no cover.
 */
export function skyCloudField(direction: N, c: SkyCloudInputs): { noise: N; threshold: N; mask: N; fade: N; opacity: N } {
  const elevation = mix(1.0, 0.1, c.elevation)
  const cloudUV = direction.xz.div(max(direction.y, 1e-4).mul(elevation)).mul(c.scale).add(c.offset).toVar() as N
  const evolve = time.mul(c.speed).mul(300.0)
  const cloudNoise = fbm(cloudUV.mul(1000.0), evolve).mul(0.7).add(0.5).clamp(0.0, 1.0).toVar() as N
  const region = noise(cloudUV.mul(300.0)).mul(0.37).add(0.5)
  const cov = clamp(c.coverage.add(region.sub(0.5).mul(0.6)), 0.0, 1.0)
  const threshold = sub(1.0, cov).toVar() as N
  const fade = smoothstep(0.0, add(0.03, mul(0.06, c.elevation)), direction.y)
  const mask = smoothstep(threshold, threshold.add(0.3), cloudNoise).mul(fade).toVar() as N
  const depth = max(0.0, cloudNoise.sub(threshold))
  const opacity = sub(1.0, exp(depth.mul(c.density).mul(-12.0))).mul(fade).mul(c.coverage.greaterThan(0.0).select(1.0, 0.0)).toVar() as N
  return { noise: cloudNoise, threshold, mask, fade, opacity }
}

export class AlienSkyMesh extends Mesh {
  /** Unit vector toward the sun. */
  readonly sunDirection = uniform(new Vector3(0, 1, 0))
  /** Rayleigh extinction per metre per channel, from skyMath.betaR. */
  readonly betaR = uniform(new Vector3(5.8e-6, 13.5e-6, 30.2e-6))
  /** Mie extinction per metre per channel, from skyMath.betaM. */
  readonly betaM = uniform(new Vector3(0, 0, 0))
  /** Preetham sun intensity, from skyMath.sunE. */
  readonly sunE = uniform(0)
  readonly mieDirectionalG = uniform(0.8)
  /** What the low sun's glow leans toward, luminance 1 (skyMath.glowTint). */
  readonly glowTint = uniform(new Vector3(1.229, 0.958, 0.737))
  readonly showSunDisc = uniform(1)
  /** Night sky radiance (already scaled by night amount). */
  readonly nightColor = uniform(new Vector3(0, 0, 0))
  /** Twilight glow colour (already scaled by twilight amount), see skyMath.twilightShape. */
  readonly twilightColor = uniform(new Vector3(0, 0, 0))
  /** Star and moon brightness (already scaled by night amount). */
  readonly starBrightness = uniform(0)
  readonly cloudScale = uniform(0.0002)
  readonly cloudSpeed = uniform(0.00002)
  /** Cloud pattern offset, advanced each frame downwind by src/world/weather/clouds.ts. */
  readonly cloudOffset = uniform(new Vector2(0, 0))
  readonly cloudCoverage = uniform(0.4)
  readonly cloudDensity = uniform(0.4)
  readonly cloudElevation = uniform(0.5)
  /** Camera fallback only. Reflection captures temporarily enable this layer. */
  cloudLayerVisible = true
  private readonly cloudVisibility = uniform(1).setGroup(renderGroup).onRenderUpdate(() => this.cloudLayerVisible ? 1 : 0)

  /** Camera-only water attenuation. The shared PMREM proxy uses other cameras. */
  underwaterCamera: Camera | null = null
  underwaterAmount = 0
  private readonly underwaterColor = new Vector3(.018, .16, .21)
  readonly underwaterTint = uniform(this.underwaterColor).setGroup(renderGroup).onRenderUpdate(() => this.underwaterColor)
  private readonly underwaterMix = uniform(0).setGroup(renderGroup).onRenderUpdate(frame =>
    frame.camera === this.underwaterCamera ? this.underwaterAmount : 0)

  constructor() {
    const material = new NodeMaterial()
    super(new BoxGeometry(1, 1, 1), material)

    const sunDir = this.sunDirection as N
    const vBetaR = this.betaR as N
    const vBetaM = this.betaM as N
    const vSunE = this.sunE as N
    const g = this.mieDirectionalG as N

    const vertexNode = Fn(() => {
      const position = modelViewProjection as N
      position.z.assign(position.w) // pin to the far plane
      return position
    })()

    const colorNode = Fn(() => {
      const pi = float(Math.PI)
      const sunAngularDiameterCos = float(0.9999566769464484)
      const THREE_OVER_SIXTEENPI = float(0.05968310365946075)
      const ONE_OVER_FOURPI = float(0.07957747154594767)

      const direction = normalize((positionWorld as N).sub(cameraPosition)) as N

      // Optical length; the cutoff at 90 degrees avoids the formula's singularity.
      const zenithAngle = acos(max(0.0, direction.y)) as N
      const inverse = float(1.0).div(cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(180.0).div(pi)), -1.253))))
      const sR = float(RAYLEIGH_ZENITH_LENGTH).mul(inverse)
      const sM = float(MIE_ZENITH_LENGTH).mul(inverse)
      const Fex = exp(mul(vBetaR, sR).add(mul(vBetaM, sM)).negate()) as N

      const cosTheta = dot(direction, sunDir) as N
      const c = cosTheta.mul(0.5).add(0.5)
      const rPhase = THREE_OVER_SIXTEENPI.mul(float(1.0).add(pow(c, 2.0)))
      const betaRTheta = vBetaR.mul(rPhase)
      const g2 = pow(g, 2.0)
      const inv = float(1.0).div(pow(max(1e-6, float(1.0).sub(float(2.0).mul(g).mul(cosTheta)).add(g2)), 1.5))
      const mPhase = ONE_OVER_FOURPI.mul(float(1.0).sub(g2)).mul(inv)
      const betaMTheta = vBetaM.mul(mPhase)

      const ratio = add(betaRTheta, betaMTheta).div(max(add(vBetaR, vBetaM), vec3(BETA_EPSILON))) as N
      const Lin = pow(vSunE.mul(ratio).mul(sub(1.0, Fex)), vec3(1.5)).toVar() as N
      Lin.mulAssign(mix(vec3(1.0), pow(vSunE.mul(ratio).mul(Fex), vec3(0.5)), clamp(pow(sub(1.0, sunDir.y), 5.0), 0.0, 1.0)))

      const L0 = vec3(0.1).mul(Fex)

      const sundisc = clamp(cosTheta.sub(sunAngularDiameterCos).mul(50000.0), 0.0, 1.0).mul(this.showSunDisc)
      const sundiscColor = min(vSunE.mul(Fex), 80.0).mul(760.0).mul(sundisc)

      // Moonlit night: brighter toward the horizon, matching skyMath.skyRadiance.
      const nightShape = float(0.6).add(float(0.4).mul(sub(1.0, clamp(direction.y, 0.0, 1.0))))
      const night = (this.nightColor as N).mul(nightShape)
        .add((this.twilightColor as N).mul(pow(c, 3.0).mul(exp(max(direction.y, 0.0).mul(-6.0)))))

      // The low sun grade, as skyMath.gradeGlow: a shoulder on the glow and a warm lean.
      const base = add(Lin, L0).mul(SKY_SCALE).add(vec3(...SKY_FLOOR)) as N
      const grade = float(1.0).sub(smoothstep(0.02, 0.45, sunDir.y))
      const lum = max(dot(base, vec3(0.2126, 0.7152, 0.0722)), 1e-9) as N
      const above = max(lum.div(GLOW_KNEE), 1.0)
      const gradedLum = float(GLOW_KNEE).mul(min(lum.div(GLOW_KNEE), 1.0)).mul(pow(above, float(1.0).sub(grade.mul(1.0 - GLOW_POWER))))
      const hi = max(base.x, max(base.y, base.z)), lo = min(base.x, min(base.y, base.z))
      const sat = hi.sub(lo).div(max(hi, 1e-9))
      // skyMath.coolness: only cold hues (green or blue over red) take the saturation lean.
      const cool = smoothstep(0.0, 0.25, max(base.y, base.z).sub(base.x).div(max(hi, 1e-9)))
      const lean = min(grade.mul(1.5), 1.0).mul(max(float(GLOW_DESAT).mul(smoothstep(GLOW_KNEE, 6 * GLOW_KNEE, lum)), smoothstep(0.15, 0.6, sat).mul(SAT_LEAN).mul(cool)))
      const graded = mix(base.div(lum), this.glowTint as N, lean).mul(gradedLum)
      const texColor = graded.add(sundiscColor).add(night).toVar() as N

      // Stars: one candidate per cell of a 3D grid over the view direction. Sinless hash so
      // every GPU agrees; the cell jitter hides the grid. Extinction dims them at the horizon.
      const hash3 = (q: N): N => {
        const p = fract(q.mul(vec3(0.1031, 0.103, 0.0973))).toVar() as N
        p.addAssign(dot(p, p.yxz.add(33.33)))
        return fract(p.xxy.add(p.yxx).mul(p.zyx))
      }
      const stars = this.starBrightness as N
      If(stars.greaterThan(0.0).and(direction.y.greaterThan(-0.05)), () => {
        const sp = direction.mul(220.0) as N
        const cell = floor(sp)
        const h = hash3(cell)
        const offset = fract(sp).sub(0.5).sub(h.sub(0.5).mul(0.6))
        const core = smoothstep(0.12, 0.0, length(offset))
        const present = smoothstep(0.93, 0.98, h.x)
        const twinkle = float(0.7).add(float(0.3).mul(fract(h.y.mul(91.0).add(time.mul(h.z.add(0.3))))))
        const tint = mix(vec3(1.0, 0.8, 0.65), vec3(0.7, 0.85, 1.0), h.z)
        texColor.addAssign(tint.mul(core.mul(present).mul(twinkle).mul(stars).mul(0.6).mul(Fex)))
        // Moon disc opposite the sun, so the moonlight direction has a visible source.
        const moonCos = dot(direction, sunDir.negate())
        const moon = smoothstep(0.99985, 0.99992, moonCos)
        texColor.addAssign(vec3(0.75, 0.8, 0.9).mul(moon).mul(stars).mul(0.5).mul(Fex))
      })

      const coverage = this.cloudCoverage as N
      const elevationU = this.cloudElevation as N
      If(direction.y.greaterThan(0.0).and(coverage.greaterThan(0.0)).and(this.cloudVisibility.greaterThan(0)), () => {
        const field = skyCloudField(direction, { coverage, density: this.cloudDensity, scale: this.cloudScale, elevation: elevationU, speed: this.cloudSpeed, offset: this.cloudOffset })
        const cloudNoise = field.noise, threshold = field.threshold, cloudMask = field.mask

        // Clouds are lit by the same scattering, so they turn the sky's colours at dusk.
        const dayFactor = smoothstep(-0.08, 0.3, sunDir.y)
        // Sunlit cloud takes the graded sun and sky too (skyMath.sunlightColor, gradeGlow).
        const rawSun = vSunE.mul(Fex).mul(0.22).mul(0.04) as N
        const sunLum = dot(rawSun, vec3(0.2126, 0.7152, 0.0722))
        const sunHi = max(rawSun.x, max(rawSun.y, rawSun.z))
        const sunCool = smoothstep(0.0, 0.25, max(rawSun.y, rawSun.z).sub(rawSun.x).div(max(sunHi, 1e-9)))
        const sunColor = mix(rawSun, (this.glowTint as N).mul(sunLum), grade.mul(SUN_DESAT).mul(sunCool)).toVar() as N
        const skyAmbient = graded.add(night)

        const depth = max(0.0, cloudNoise.sub(threshold)).toVar() as N
        const beer = exp(depth.mul(-4.0)).toVar() as N
        const powder = sub(1.0, beer.mul(beer))
        const shade = mix(0.45, 1.0, beer.mul(powder).mul(2.6).clamp(0.0, 1.0))
        const silver = float(0.51).div(pow(sub(1.49, cosTheta.mul(1.4)), 1.5)).clamp(0.0, 3.0)
        const edge = cloudMask.mul(sub(1.0, cloudMask)).mul(4.0)

        const cloudColor = skyAmbient.add(sunColor.mul(shade)).toVar() as N
        cloudColor.addAssign(sunColor.mul(silver).mul(edge).mul(0.6))
        cloudColor.mulAssign(max(dayFactor, 0.03))

        const alpha = field.opacity
        texColor.subAssign(L0.mul(0.04).add(sundiscColor).mul(alpha))
        const cloudAerial = mix(texColor, cloudColor, Fex)
        texColor.assign(mix(texColor, cloudAerial, alpha))
      })

      return vec4(mix(max(texColor, vec3(0.0)), this.underwaterTint, this.underwaterMix), 1.0)
    })()

    material.side = BackSide
    material.depthWrite = false
    material.fog = false
    material.vertexNode = vertexNode
    material.colorNode = colorNode
    this.frustumCulled = false
    this.renderOrder = -1000
  }
}
