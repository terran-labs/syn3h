/**
 * Seam: sky, sun, shadows and fog. Nothing is baked: everything follows one sun direction.
 *
 * Each frame the clock gives a sun direction. skyMath evaluates the same Preetham
 * scattering the sky shader draws at a handful of directions (zenith, horizon toward and
 * away from the sun, along the sun ray) and those few numbers colour the sunlight, the
 * hemisphere ambient and the fog. Sliders write uniforms and plain fields only, so dragging
 * one never replaces a scene light. Higher cascade counts require a different shadow graph.
 */
import * as THREE from 'three/webgpu'
import { Fn, If, vec4, cameraPosition, dot, float, max, mix, normalWorld, normalize, positionWorld, pow, renderGroup, smoothstep as smoothNode, uniform, vec2, vec3 } from 'three/tsl'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { flashSwitches } from '../core/flashSwitches'
import { params } from '../../shared/params'
import type { Game, System } from '../core/Game'
import type { Terrain } from './Terrain'
import { SkyEnvironmentMap } from './sky/SkyEnvironmentMap'
import { AlienSkyMesh } from './sky/AlienSkyMesh'
import { SKY_PRESET_NAMES, applySkyPreset } from './sky/presets'
import {
  NIGHT_LEVEL, TWILIGHT_LEVEL, autoExposure, luminance, twilightAmount, twilightTint, betaM, betaR, horizonColors, moonAmount, nightAmount, nightTint, sanitizeRGB, sunDirection as sunDirectionAt,
  sunE, sunlightColor, lowSunGrade, glowTint, smoothstep, type RGB, type Vec3,
} from './sky/skyMath'
import * as P from './sky/skyParams'
import { bindDayClock, currentHour, followHour } from './sky/dayCycle'
import { type FogBanks, createFogBanks } from './weather/fogBanks'
import { applyBounce, lightSkyReflection, shadowSoftness, shadowStrength } from './lightRig'
import { AERIAL_HEIGHT, hazeNow, hazeTintAmount, hazeTintB, hazeTintG, hazeTintR, heightFog, weatherFog } from './weather/fog'
import { horizonHaze } from './weather/haze'
import { curveFactor } from './curve'
import { advanceCloudDrift } from './weather/clouds'
import { atmosphereValue } from './weather/params'

/** Live sky settings. Offset is locally accumulated wind drift, not a shared room phase. */
export interface CloudInputs {
  readonly coverage: number
  readonly density: number
  readonly scale: number
  readonly elevation: number
  readonly speed: number
  readonly offset: { readonly x: number; readonly y: number }
  readonly atmosphere: number
  readonly worldSize: number
}

export interface Environment extends System {
  /** Unit vector pointing from the ground toward the sun. Other systems may read it. */
  readonly sunDirection: THREE.Vector3
  /** Linear colour times intensity of the direct light (sun by day, moon by night). */
  readonly sunColor: THREE.Color
  /** Direction toward whichever light supplies sunColor: sun by day, moon by night. */
  readonly lightDirection: THREE.Vector3
  readonly clouds: CloudInputs
  /** Hide only the camera's flat cloud layer while a working volume replaces it. */
  setVolumetricCloudsActive(active: boolean): void
  /** Linear sky colour at the horizon, averaged around the compass. Matches the fog. */
  readonly horizonColor: THREE.Color
  /** The hour on screen, 0 to 24: the room clock's hour (dayCycle.ts), eased across steps. */
  readonly hour: number
  /** The world's fog banks (src/world/weather/fogBanks.ts), for tools and for local haze. */
  readonly fogBanks: FogBanks
}

type N = any // TSL node

/**
 * ?shadowColor=0 (core/flashSwitches.ts): depth-only shadow maps for this visit. three's shadow
 * node always gives each cascade an rgba8 colour target beside its depth (8 MB and a colour
 * attachment per cascade pass at Medium); only transmitted shadows read it, and we draw none. A
 * depth-only render target (count 0) is what WebGPURenderer offers for this. Set before any
 * shadow node is built, so every cascade takes it; the shadow pipelines are then built for it
 * once, at world entry, like any other.
 */
if (flashSwitches.shadowColor0) {
  type ShadowSetup = { setupRenderTarget(shadow: THREE.LightShadow, builder: THREE.NodeBuilder): { shadowMap: THREE.RenderTarget; depthTexture: THREE.DepthTexture } }
  const proto = (THREE as unknown as { ShadowNode: { prototype: ShadowSetup } }).ShadowNode.prototype
  proto.setupRenderTarget = function (shadow, builder) {
    const depthTexture = new THREE.DepthTexture(shadow.mapSize.width, shadow.mapSize.height)
    depthTexture.name = 'ShadowDepthTexture'
    depthTexture.compareFunction = (builder.renderer as unknown as { reversedDepthBuffer?: boolean }).reversedDepthBuffer ? THREE.GreaterEqualCompare : THREE.LessEqualCompare
    const shadowMap = new THREE.RenderTarget(shadow.mapSize.width, shadow.mapSize.height, { count: 0 })
    shadowMap.depthTexture = depthTexture
    return { shadowMap, depthTexture }
  }
}

/** Shadow settings per quality level: [cascades, map size]. Level 0 has no shadows. */
const QUALITY: Record<number, [number, number]> = { 1: [2, 1024], 2: [3, 2048], 3: [4, 2048] }
/** A sleeping cascade keeps its shader and bindings but samples and draws no shadows. */
class QualitySunShadow extends CSMShadowNode {
  readonly enabled = uniform(true)

  override setup(builder: THREE.NodeBuilder) {
    const sampled = super.setup(builder) as N
    return Fn(() => {
      const value = vec4(1).toVar()
      If(this.enabled, () => { value.assign(sampled) })
      return value
    })()
  }

  override updateBefore(frame: THREE.NodeFrame) {
    if (this.enabled.value) return super.updateBefore(frame)
  }
}

/** Shadows reach this far from the camera, in metres. */
const SHADOW_FAR = 1000
/** Moonlight is sunlight off grey rock; it reads as blue to dark adapted eyes. */
const MOON_TINT: RGB = [0.55, 0.65, 1.0]
/** Fog colours are clamped so the Mie glow around a low sun does not flood the terrain. */
const FOG_MAX = 8
/** The sunward fog's cap with the sun on the horizon, and the glow's share of eye adaptation. */
const SUNWARD_ADAPT = 0.1
/**
 * Low sun fill. A sun a few degrees up lights the ground with almost nothing, and the sky
 * overhead is dark, so sunrise and sunset left the foreground near black. Sunlight keeps at
 * least LOW_SUN_LIGHT of luminance (its colour unchanged) until it sets, and the sky light
 * takes LOW_SUN_FILL of the horizon's glow. Both fade out with the low-sun grade.
 */
const LOW_SUN_LIGHT = 0.22, LOW_SUN_FILL = 0.45
/** How tightly the sunward fog glow hugs the sun's bearing: broad by day, as narrow as the sky's glow at a low sun. */
const FOG_LOBE_DAY = 4, FOG_LOBE_LOW_SUN = 48
/**
 * Surface sun angle (cosine of the normal to the sun) over which the air in front of it goes
 * from the surface's shadow to sunlight, for the sun-ward fog glow. Open ground under a low
 * sun sits inside the ramp, so it keeps a soft glow; a face turned from the sun keeps none.
 */
const FOG_AIR_SHADE_FROM = -0.1, FOG_AIR_SHADE_TO = 0.25
/** Scale a colour down so its brightest channel is at most `max`, keeping its hue. */
function capRGB(c: RGB, max: number): RGB {
  const m = Math.max(c[0], c[1], c[2])
  if (m > max) for (let i = 0; i < 3; i++) c[i] *= max / m
  return c
}

export function createEnvironment(game: Game, _terrain: Terrain): Environment {
  const scene = game.scene

  // Sky ---------------------------------------------------------------------------------
  const sky = new AlienSkyMesh()
  // The box corners must stay inside the camera far plane (20 km).
  sky.scale.setScalar(10000)
  scene.add(sky)
  const reflections = new SkyEnvironmentMap(scene, game.renderer, sky)

  // Sun or moon: one directional light with cascaded shadows -----------------------------
  const light = new THREE.DirectionalLight(0xffffff, 1)
  scene.add(light, light.target)
  let csm: QualitySunShadow | null = null
  let csmAspect = 0
  let csmFov = 0
  let cascadeCount = 0
  const buildLight = (quality: number) => {
    const enabled = quality > 0
    const [levelCascades, levelSize] = QUALITY[Math.max(1, Math.round(quality))]
    // ?shadowCascades=1 and ?shadowMap= (core/flashSwitches.ts) override the level for the visit.
    const cascades = flashSwitches.shadowCascades ?? levelCascades, size = flashSwitches.shadowMap ?? levelSize
    const setMap = (shadow: THREE.DirectionalLightShadow) => {
      shadow.autoUpdate = enabled
      shadow.needsUpdate = enabled
      const side = enabled ? size : 1
      shadow.mapSize.set(side, side)
      shadow.map?.setSize(side, side)
    }
    setMap(light.shadow)
    csmAspect = 0
    if (csm && cascades === cascadeCount) {
      csm.enabled.value = enabled
      for (const cascade of csm.lights) if (cascade.shadow) setMap(cascade.shadow)
      return
    }
    // Three listens for disposal on this light to invalidate its old shadow node.
    if (csm) light.dispose()
    cascadeCount = cascades
    light.castShadow = true
    light.shadow.camera.near = 1
    light.shadow.camera.far = 3000
    // Bias is in normalised depth over the 3 km shadow range, so this is about 6 cm.
    // CSM multiplies it by the cascade number, matching the coarser far texels.
    light.shadow.bias = -0.00002
    light.shadow.normalBias = 0.06
    csm = new QualitySunShadow(light, {
      cascades, maxFar: SHADOW_FAR, lightMargin: 600, mode: 'custom',
      // Practical split leaning hard toward logarithmic: a near cascade of about 20 m
      // gives centimetre texels around the vehicle, the last one reaches a kilometre.
      customSplitsCallback(n, near, far, breaks) {
        for (let i = 1; i < n; i++) {
          const log = near * (far / near) ** (i / n)
          const lin = near + ((far - near) * i) / n
          breaks.push((0.93 * log + 0.07 * lin) / far)
        }
        breaks.push(1)
      },
    })
    csm.enabled.value = enabled
    csm.fade = !flashSwitches.shadowFade0
    ;(light.shadow as unknown as { shadowNode: unknown }).shadowNode = csm
  }
  buildLight(P.shadowQuality.value)

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1)
  scene.add(hemi)
  const skyGround = new THREE.Color()
  let reflectionSet = lightSkyReflection.value

  // Fog: coloured by the horizon in the direction you look ----------------------------------
  // Uniforms in the scene fog node stayed frozen at their first upload in r187 when left in
  // the default object group, so these use the render group with a per render callback, the
  // same pattern CSMShadowNode uses for its live values.
  const skyHazeState = { density: 0, height: 70, sea: 0 }
  const fogState = {
    toward: new THREE.Vector3(), away: new THREE.Vector3(), side: new THREE.Vector3(),
    sunXZ: new THREE.Vector2(1, 0), density: P.fogDensity.value, lobe: FOG_LOBE_DAY,
  }
  const live = <T,>(initial: T, read: () => T) => (uniform(initial as never) as N).setGroup(renderGroup).onRenderUpdate(read)
  const fogToward = live(new THREE.Vector3(), () => fogState.toward)
  const fogAway = live(new THREE.Vector3(), () => fogState.away)
  const fogSide = live(new THREE.Vector3(), () => fogState.side)
  const fogSunXZ = live(new THREE.Vector2(1, 0), () => fogState.sunXZ)
  const fogDensityU = live(fogState.density, () => fogState.density)
  const fogLobe = live(FOG_LOBE_DAY, () => fogState.lobe)
  const view = normalize((positionWorld as N).sub(cameraPosition)) as N
  // How far the view ray points toward the sun's bearing. The horizontal part of the unit
  // view ray is used as it is, not normalised: a ray looking down at the ground near the
  // camera points nowhere near the sun, so it takes the neutral side colour. Normalising it
  // gave every pixel the full glow of its compass bearing, which from above drew a bright
  // wedge on the ground with its point under the camera. Level views are unchanged.
  const cosA = vec2(view.x, view.z).dot(fogSunXZ) as N
  // The glow toward the sun is narrow, the darkening away from it broad. At a low sun the
  // glow narrows to the sky's own, so the far sea and land under it match the sky above.
  // Haze in front of a surface that faces away from the sun lies in that surface's own
  // shadow along a sun-ward view: it scatters the sky's light, not the sun's. Without this a
  // hill with a low sun behind it took the bright sun-ward fog colour across its face, a glow
  // that followed the sun (the owner, v26.11.1801, Alpine at sunrise). Sunlit faces and open
  // ground keep the glow; the sky draws no fog, so the sky round the sun is unchanged.
  const fogSunDir = live(new THREE.Vector3(0, 1, 0), () => sunDirection)
  // Only while the sun is up: after sunset every surface faces from it, and the twilight in
  // the far haze is the sky's light, which stays.
  const sunUp = smoothNode(-0.05, 0.02, (fogSunDir as N).y)
  const airLit = mix(float(1), smoothNode(FOG_AIR_SHADE_FROM, FOG_AIR_SHADE_TO, dot(normalWorld, fogSunDir as N)), sunUp) as N
  const towardW = pow(max(cosA, 0.0), fogLobe as N).mul(airLit)
  const awayW = max(cosA.negate(), 0.0)
  const side = fogSide as N
  const fogColor = side.add((fogToward as N).sub(side).mul(towardW)).add((fogAway as N).sub(side).mul(awayW))
  const previousFog = scene.fog
  scene.fog = null
  // Height fog (src/world/weather/fog.ts): per planet haze that thins with altitude, plus the
  // uniform fog density above.
  // The sun is read at render time, after the state below exists.
  // Fog banks (src/world/weather/fogMap.ts): built from the terrain and seed, rebuilt with it.
  const banks = createFogBanks(_terrain)
  const haze = heightFog(max(fogColor, vec3(0.0)), fogDensityU, { direction: () => sunDirection, color: () => sunColor, lit: airLit, sky: () => hemi.color }, banks.input)
  ;(scene as unknown as { fogNode: unknown }).fogNode = weatherFog(haze)

  // State ---------------------------------------------------------------------------------
  const unbindDay = bindDayClock()
  let hour = currentHour()
  const sun: Vec3 = [0, 1, 0]
  const sunDirection = new THREE.Vector3()
  const lightDirection = new THREE.Vector3()
  const sunColor = new THREE.Color()
  const horizonColor = new THREE.Color()
  const rgb: RGB = [0, 0, 0]
  const tint: RGB = [0, 0, 0]
  const avgSky: RGB = [0, 0, 0]
  let adapted = Number.NaN
  const hc = horizonColors(sun, P.currentSkyParams())

  const applyUniforms = () => {
    sky.mieDirectionalG.value = P.skyMieDirectionalG.value
    sky.showSunDisc.value = P.skySunDisc.value ? 1 : 0
    sky.cloudCoverage.value = atmosphereValue() > 0 ? P.cloudCoverage.value : 0
    sky.cloudDensity.value = P.cloudDensity.value
    sky.cloudScale.value = P.cloudScale.value
    sky.cloudSpeed.value = P.cloudSpeed.value
    sky.cloudElevation.value = P.cloudElevation.value
    fogState.density = P.fogDensity.value
  }
  applyUniforms()
  const clouds: CloudInputs = {
    get coverage() { return sky.cloudCoverage.value },
    get density() { return sky.cloudDensity.value },
    get scale() { return sky.cloudScale.value },
    get elevation() { return sky.cloudElevation.value },
    get speed() { return sky.cloudSpeed.value },
    offset: { get x() { return sky.cloudOffset.value.x }, get y() { return sky.cloudOffset.value.y } },
    get atmosphere() { return Math.max(0, Math.min(1, atmosphereValue())) },
    get worldSize() { return _terrain.size },
  }

  const unlisten = params.onChange((id, value) => {
    if (/^(sky|sun|weather)\./.test(id) || id === 'world.atmosphere') reflections.invalidate()
    if (id === P.shadowQuality.def.id) buildLight(value as number)
    else if (id === P.skyPresetPicker.def.id) {
      const name = SKY_PRESET_NAMES[(value as number) - 1]
      if (name) {
        applySkyPreset(name, 'preset')
        // Snap the picker back so choosing the same preset again still fires.
        params.set(id, 0, 'preset')
      }
    } else applyUniforms()
  })

  const update = (dt: number) => {
    // Clouds drift downwind (src/world/weather/clouds.ts).
    advanceCloudDrift(sky.cloudOffset.value, P.cloudSpeed.value, dt, _terrain)
    hour = followHour(hour, currentHour(), dt)
    sunDirectionAt(hour, P.sunTilt.value, P.sunAzimuth.value, sun)
    sunDirection.set(sun[0], sun[1], sun[2])
    const sp = P.currentSkyParams()

    // Sky uniforms: the per sky terms the shader used to compute per vertex.
    betaR(sp, rgb)
    sky.betaR.value.set(rgb[0], rgb[1], rgb[2])
    betaM(sp, rgb)
    sky.betaM.value.set(rgb[0], rgb[1], rgb[2])
    sky.sunE.value = sunE(sun[1])
    sky.sunDirection.value.copy(sunDirection)
    glowTint(sp, rgb)
    sky.glowTint.value.set(rgb[0], rgb[1], rgb[2])
    const night = nightAmount(sun[1])
    nightTint(sp, tint)
    const nightLevel = night * Math.max(0, sp.nightBrightness) * NIGHT_LEVEL
    sky.nightColor.value.set(tint[0] * nightLevel, tint[1] * nightLevel, tint[2] * nightLevel)
    const tw = twilightAmount(sun[1]) * TWILIGHT_LEVEL
    twilightTint(sp, tint)
    sky.twilightColor.value.set(tint[0] * tw, tint[1] * tw, tint[2] * tw)
    sky.starBrightness.value = night * P.skyStars.value
    sky.position.copy(game.camera.position)

    // Direct light: the sun until it stops lighting the sky, then the moon opposite it.
    const moon = moonAmount(sun[1])
    lightDirection.copy(sunDirection).multiplyScalar(moon > 0 ? -1 : 1)
    if (moon <= 0) {
      sanitizeRGB(sunlightColor(sun, sp, rgb), 1)
      // Low sun fill: lift a near-horizon sun's light to a floor, same colour, until it sets.
      const floor = LOW_SUN_LIGHT * lowSunGrade(sun[1]) * smoothstep(-0.04, 0.03, sun[1]), lum = luminance(rgb)
      if (lum > 1e-6 && lum < floor) { const s = Math.min(floor / lum, 1 / Math.max(rgb[0], rgb[1], rgb[2], 1e-6)); for (let i = 0; i < 3; i++) rgb[i] *= s }
      const k = P.sunIntensity.value
      sunColor.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, THREE.LinearSRGBColorSpace)
      light.position.copy(sunDirection).multiplyScalar(500)
    } else {
      const k = moon * P.sunMoonIntensity.value
      sunColor.setRGB(MOON_TINT[0] * k, MOON_TINT[1] * k, MOON_TINT[2] * k, THREE.LinearSRGBColorSpace)
      light.position.copy(sunDirection).multiplyScalar(-500)
    }
    light.color.copy(sunColor)
    light.intensity = 1
    light.target.position.set(0, 0, 0)

    // Ambient and fog from the sky's own colours.
    horizonColors(sun, sp, hc)
    const amb = Math.PI * P.sunAmbient.value
    const moonAmb = moon * P.sunMoonIntensity.value * 0.04
    const z = sanitizeRGB(hc.zenith, 50)
    const m = sanitizeRGB(hc.mean, 50)
    // Low sun fill: the sky light takes some of the horizon's glow (see LOW_SUN_FILL).
    const fill = lowSunGrade(sun[1]) * LOW_SUN_FILL * amb
    hemi.color.setRGB(
      z[0] * amb + m[0] * fill + MOON_TINT[0] * moonAmb, z[1] * amb + m[1] * fill + MOON_TINT[1] * moonAmb, z[2] * amb + m[2] * fill + MOON_TINT[2] * moonAmb,
      THREE.LinearSRGBColorSpace,
    )
    skyGround.setRGB(m[0] * amb * 0.5, m[1] * amb * 0.5, m[2] * amb * 0.5, THREE.LinearSRGBColorSpace)
    // Warm bounce off the ground and the sky reflection strength (src/world/lightRig.ts);
    // both at their defaults leave this exactly as before.
    applyBounce(hemi.groundColor, skyGround, sunColor, light.position.y / Math.max(1e-6, light.position.length()))
    // Written only when the slider moves, so the underwater look can still set its own.
    if (lightSkyReflection.value !== reflectionSet) { reflectionSet = lightSkyReflection.value; scene.environmentIntensity = reflectionSet }
    hemi.intensity = 1
    horizonColor.setRGB(m[0], m[1], m[2], THREE.LinearSRGBColorSpace)

    // Eye adaptation from the sky we just evaluated: no render target readback needed.
    // Uses the side horizon, not the mean, so the glow around a setting sun does not
    // darken the whole scene.
    // At a low sun the (graded, bounded) glow toward it gets a small share too: adapting only
    // to the dark sky overhead turned the sunward horizon into a white wall.
    const sideRaw = hc.side, low = lowSunGrade(sun[1]), glowShare = low * SUNWARD_ADAPT
    const towardRaw = sanitizeRGB(hc.toward, 50)
    for (let i = 0; i < 3; i++) avgSky[i] = (1 - glowShare) * (0.5 * z[i] + 0.5 * sideRaw[i]) + glowShare * towardRaw[i]
    const target = Math.log(autoExposure(luminance(avgSky), P.skyAutoExposure.value))
    adapted = Number.isNaN(adapted) ? target : adapted + (target - adapted) * Math.min(1, dt * 2)
    game.renderer.toneMappingExposure = P.skyExposure.value * Math.exp(adapted)

    // Scaled, not clamped per channel: a clamp kept one bright channel at the cap and let the
    // others through, so the fog took a different hue from the sky above it.
    const t = capRGB(sanitizeRGB(hc.toward, 1e3), FOG_MAX)
    fogState.lobe = FOG_LOBE_DAY + (FOG_LOBE_LOW_SUN - FOG_LOBE_DAY) * low
    const a = capRGB(sanitizeRGB(hc.away, 1e3), FOG_MAX)
    const s = capRGB(sanitizeRGB(hc.side, 1e3), FOG_MAX)
    fogState.toward.set(t[0], t[1], t[2])
    fogState.away.set(a[0], a[1], a[2])
    fogState.side.set(s[0], s[1], s[2])
    const hl = Math.hypot(sun[0], sun[2])
    if (hl > 1e-6) fogState.sunXZ.set(sun[0] / hl, sun[2] / hl)

    // The sky's horizon haze band (src/world/weather/haze.ts): the same haze and the same
    // colour the land fades into, so the planet's edge melts into the sky.
    const hz = sky.haze, h = hazeNow(skyHazeState)
    hz.strength.value = h.density > 0 ? horizonHaze.value : 0
    hz.density.value = h.density
    hz.height.value = h.height
    // The height haze only: the thin aerial layer is the sky's own scattering already, and
    // counted again it whitened the whole lower sky.
    hz.aerialDensity.value = 0
    hz.aerialHeight.value = AERIAL_HEIGHT
    hz.camAbove.value = Math.max(0, game.camera.position.y - h.sea)
    hz.invR.value = curveFactor()
    ;(hz.toward.value as THREE.Vector3).copy(fogState.toward)
    ;(hz.side.value as THREE.Vector3).copy(fogState.side)
    ;(hz.away.value as THREE.Vector3).copy(fogState.away)
    ;(hz.sunXZ.value as THREE.Vector2).copy(fogState.sunXZ)
    hz.lobe.value = fogState.lobe
    ;(hz.tint.value as THREE.Vector3).set(hazeTintR.value, hazeTintG.value, hazeTintB.value)
    hz.tintAmount.value = hazeTintAmount.value
    banks.update(hour, game.camera.position, sun[1])

    reflections.update(dt, hour)

    // Cascades are computed from the camera projection; redo them when it changes.
    const cam = game.camera
    if (csm?.enabled.value && csm.camera && (cam.aspect !== csmAspect || cam.fov !== csmFov)) {
      csmAspect = cam.aspect
      csmFov = cam.fov
      csm.updateFrustums()
      // Scale the normal offset with each cascade's texel footprint.
      for (const l of csm.lights) {
        const sh = l.shadow
        if (!sh) continue
        const texel = (sh.camera.right - sh.camera.left) / sh.mapSize.width
        sh.normalBias = Math.max(0.02, texel * 1.5)
      }
    }
    light.shadow.radius = shadowSoftness.value
    light.shadow.intensity = shadowStrength.value
    if (csm) for (const l of csm.lights) {
      if (!l.shadow) continue
      l.shadow.radius = shadowSoftness.value
      l.shadow.intensity = shadowStrength.value
    }
  }

  return {
    fogBanks: banks,
    sunDirection,
    sunColor,
    lightDirection,
    clouds,
    setVolumetricCloudsActive(active) { sky.cloudLayerVisible = !active },
    horizonColor,
    get hour() { return hour },
    update,
    dispose() {
      unlisten()
      unbindDay()
      reflections.dispose()
      scene.remove(sky, light, light.target, hemi)
      csm?.dispose()
      light.dispose()
      sky.geometry.dispose()
      ;(sky.material as THREE.Material).dispose()
      ;(scene as unknown as { fogNode: unknown }).fogNode = null
      scene.fog = previousFog
    },
  }
}
