/**
 * Seam: sky, sun, shadows and fog. Nothing is baked: everything follows one sun direction.
 *
 * Each frame the clock gives a sun direction. skyMath evaluates the same Preetham
 * scattering the sky shader draws at a handful of directions (zenith, horizon toward and
 * away from the sun, along the sun ray) and those few numbers colour the sunlight, the
 * hemisphere ambient and the fog. Sliders write uniforms and plain fields only, so dragging
 * one never recompiles a shader. The one exception is shadow quality, which rebuilds the light.
 */
import * as THREE from 'three/webgpu'
import { cameraPosition, fog, max, normalize, positionWorld, pow, renderGroup, uniform, vec2, vec3 } from 'three/tsl'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { params } from '../../shared/params'
import type { Game, System } from '../core/Game'
import type { Terrain } from './Terrain'
import { SkyEnvironmentMap } from './sky/SkyEnvironmentMap'
import { AlienSkyMesh } from './sky/AlienSkyMesh'
import { SKY_PRESET_NAMES, applySkyPreset } from './sky/presets'
import {
  NIGHT_LEVEL, TWILIGHT_LEVEL, autoExposure, luminance, twilightAmount, twilightTint, betaM, betaR, horizonColors, moonAmount, nightAmount, nightTint, sanitizeRGB, sunDirection as sunDirectionAt,
  sunE, sunlightColor, wrapHour, advanceHour, type RGB, type Vec3,
} from './sky/skyMath'
import * as P from './sky/skyParams'
import { applyBounce, lightSkyReflection } from './lightRig'
import { heightFog } from './weather/fog'

export interface Environment extends System {
  /** Unit vector pointing from the ground toward the sun. Other systems may read it. */
  readonly sunDirection: THREE.Vector3
  /** Linear colour times intensity of the direct light (sun by day, moon by night). */
  readonly sunColor: THREE.Color
  /** Linear sky colour at the horizon, averaged around the compass. Matches the fog. */
  readonly horizonColor: THREE.Color
  /** Current hour, 0 to 24. Advances on its own when the day length is non zero. */
  readonly hour: number
}

type N = any // TSL node

/** Shadow settings per quality level: [cascades, map size]. Level 0 has no shadows. */
const QUALITY: Record<number, [number, number]> = { 1: [2, 1024], 2: [3, 2048], 3: [4, 2048] }
/** Shadows reach this far from the camera, in metres. */
const SHADOW_FAR = 1000
/** Moonlight is sunlight off grey rock; it reads as blue to dark adapted eyes. */
const MOON_TINT: RGB = [0.55, 0.65, 1.0]
/** Fog colours are clamped so the Mie glow around a low sun does not flood the terrain. */
const FOG_MAX = 8

export function createEnvironment(game: Game, _terrain: Terrain): Environment {
  const scene = game.scene

  // Sky ---------------------------------------------------------------------------------
  const sky = new AlienSkyMesh()
  // The box corners must stay inside the camera far plane (20 km).
  sky.scale.setScalar(10000)
  scene.add(sky)
  const reflections = new SkyEnvironmentMap(scene, game.renderer, sky)

  // Sun or moon: one directional light with cascaded shadows -----------------------------
  let light!: THREE.DirectionalLight
  let csm: CSMShadowNode | null = null
  let csmAspect = 0
  let csmFov = 0
  const buildLight = (quality: number) => {
    if (light) {
      scene.remove(light, light.target)
      csm?.dispose()
      light.dispose()
    }
    csm = null
    light = new THREE.DirectionalLight(0xffffff, 1)
    const q = QUALITY[Math.round(quality)]
    if (q) {
      const [cascades, size] = q
      light.castShadow = true
      light.shadow.mapSize.set(size, size)
      light.shadow.camera.near = 1
      light.shadow.camera.far = 3000
      // Bias is in normalised depth over the 3 km shadow range, so this is about 6 cm.
      // CSM multiplies it by the cascade number, matching the coarser far texels.
      light.shadow.bias = -0.00002
      light.shadow.normalBias = 0.06
      csm = new CSMShadowNode(light, {
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
      csm.fade = true
      ;(light.shadow as unknown as { shadowNode: unknown }).shadowNode = csm
    }
    scene.add(light, light.target)
    csmAspect = 0
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
  const fogState = {
    toward: new THREE.Vector3(), away: new THREE.Vector3(), side: new THREE.Vector3(),
    sunXZ: new THREE.Vector2(1, 0), density: P.fogDensity.value,
  }
  const live = <T,>(initial: T, read: () => T) => (uniform(initial as never) as N).setGroup(renderGroup).onRenderUpdate(read)
  const fogToward = live(new THREE.Vector3(), () => fogState.toward)
  const fogAway = live(new THREE.Vector3(), () => fogState.away)
  const fogSide = live(new THREE.Vector3(), () => fogState.side)
  const fogSunXZ = live(new THREE.Vector2(1, 0), () => fogState.sunXZ)
  const fogDensityU = live(fogState.density, () => fogState.density)
  const view = normalize((positionWorld as N).sub(cameraPosition)) as N
  const viewXZ = normalize(vec2(view.x, view.z).add(vec2(1e-5, 0))) as N
  const cosA = viewXZ.dot(fogSunXZ) as N
  // The glow toward the sun is narrow, the darkening away from it broad.
  const towardW = pow(max(cosA, 0.0), 4.0)
  const awayW = max(cosA.negate(), 0.0)
  const side = fogSide as N
  const fogColor = side.add((fogToward as N).sub(side).mul(towardW)).add((fogAway as N).sub(side).mul(awayW))
  const previousFog = scene.fog
  scene.fog = null
  // Height fog (src/world/weather/fog.ts): per planet haze that thins with altitude, plus the
  // uniform fog density above.
  const haze = heightFog(max(fogColor, vec3(0.0)), fogDensityU)
  ;(scene as unknown as { fogNode: unknown }).fogNode = fog(haze.color, haze.factor)

  // State ---------------------------------------------------------------------------------
  let hour = wrapHour(P.sunTimeOfDay.value)
  const sun: Vec3 = [0, 1, 0]
  const sunDirection = new THREE.Vector3()
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
    sky.cloudCoverage.value = P.cloudCoverage.value
    sky.cloudDensity.value = P.cloudDensity.value
    sky.cloudScale.value = P.cloudScale.value
    sky.cloudSpeed.value = P.cloudSpeed.value
    sky.cloudElevation.value = P.cloudElevation.value
    fogState.density = P.fogDensity.value
  }
  applyUniforms()

  const unlisten = params.onChange((id, value) => {
    if (/^(sky|sun|weather)\./.test(id)) reflections.invalidate()
    if (id === P.sunTimeOfDay.def.id) hour = wrapHour(value as number)
    else if (id === P.shadowQuality.def.id) buildLight(value as number)
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
    hour = advanceHour(hour, dt, P.sunDayLength.value)
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
    if (moon <= 0) {
      sanitizeRGB(sunlightColor(sun, sp, rgb), 1)
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
    hemi.color.setRGB(
      z[0] * amb + MOON_TINT[0] * moonAmb, z[1] * amb + MOON_TINT[1] * moonAmb, z[2] * amb + MOON_TINT[2] * moonAmb,
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
    const sideRaw = hc.side
    for (let i = 0; i < 3; i++) avgSky[i] = 0.5 * z[i] + 0.5 * sideRaw[i]
    const target = Math.log(autoExposure(luminance(avgSky), P.skyAutoExposure.value))
    adapted = Number.isNaN(adapted) ? target : adapted + (target - adapted) * Math.min(1, dt * 2)
    game.renderer.toneMappingExposure = P.skyExposure.value * Math.exp(adapted)

    const t = sanitizeRGB(hc.toward, FOG_MAX)
    const a = sanitizeRGB(hc.away, FOG_MAX)
    const s = sanitizeRGB(hc.side, FOG_MAX)
    fogState.toward.set(t[0], t[1], t[2])
    fogState.away.set(a[0], a[1], a[2])
    fogState.side.set(s[0], s[1], s[2])
    const hl = Math.hypot(sun[0], sun[2])
    if (hl > 1e-6) fogState.sunXZ.set(sun[0] / hl, sun[2] / hl)

    reflections.update(dt, hour)

    // Cascades are computed from the camera projection; redo them when it changes.
    const cam = game.camera
    if (csm && csm.camera && (cam.aspect !== csmAspect || cam.fov !== csmFov)) {
      csmAspect = cam.aspect
      csmFov = cam.fov
      csm.updateFrustums()
      // A far cascade texel can be a metre wide, so one normal bias for all cascades
      // either peter-pans the near one or leaves acne on the far ones. Scale it per texel.
      for (const l of csm.lights) {
        const sh = l.shadow
        if (!sh) continue
        const texel = (sh.camera.right - sh.camera.left) / sh.mapSize.width
        sh.normalBias = Math.max(0.02, texel * 1.5)
      }
    }
  }

  return {
    sunDirection,
    sunColor,
    horizonColor,
    get hour() { return hour },
    update,
    dispose() {
      unlisten()
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
