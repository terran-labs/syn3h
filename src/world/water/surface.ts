/**
 * One water surface for the sea, the lake, the pools, the rivers and their waterfalls.
 *
 * The same node graph in three modes:
 *  - 'sea'   the shared field's swells (liquidWaves.ts) move the vertices (the same sum of sines the
 *            physics floats on), shrunk in the shallows; rolling foam lines run in to the
 *            coast; whitecaps on the crests when the sea is high.
 *  - 'still' lake and pools: no swell, light wind ripples.
 *  - 'river' a ribbon at the river's true surface whose detail runs downstream at the speed
 *            Manning's formula gives each stretch, turning to white water where the bed is
 *            steep: a cascade on a steep run, a falling sheet on the steepest.
 *
 * Everything is generated: no textures. Depth comes from a `groundHeight` attribute (the bed
 * under each vertex), so shore effects need no depth pass.
 *
 * From below (the camera underwater) the surface shows Snell's window: the sky through a
 * cone of 48.6 degrees round straight up (the critical angle for water, asin(1 / 1.333)),
 * and dark total internal reflection outside it.
 */
import * as THREE from 'three/webgpu'
import {
  abs, attribute, cameraPosition, select, cameraViewMatrix, color, cos, dFdx, dFdy, faceDirection, float, max, mix, modelWorldMatrix,
  Fn, If, mx_noise_float, normalize, positionGeometry, positionView, positionLocal, positionWorld, sin, smoothstep, texture, time, uniform, uv, vec2, vec3, vec4, renderGroup,
} from 'three/tsl'
// The fragment's colour as the scene fog reads it (hazeCurve).
import { output as fogInput } from 'three/tsl'
import { SEA_COMPONENTS as WAVE_COUNT } from './seaWaves'
import { rippleField } from './ripples'
import { CHOP, WARP, chop, detailHeight, detailOn, patchAt, visual } from './seaDetail'
export { CHOP, VISUAL_DETAIL_MAX, visualDetailHeight } from './seaDetail'
import { waterClarity, waterGlitter, waterReflection, waterRipple } from './params'
import { clipmapNodes } from './clipmap'
import { bentGrazing, curveInverseRadius } from '../curve'
import { NO_BED, type WaterBed } from './bed'
import { cameraInWaterNode, liquidDaylightNode } from './daylight'
import { airFogOf } from './underwater'
import { refractThrough } from './refraction'
export { buildBedTexture, type WaterBed } from './bed'
import { fogLayersOf } from '../weather/fog'

/** A float node that sums are folded into. TSL's operator typings do not narrow through a loop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sum = any

export type WaterMode = 'sea' | 'still' | 'river'

export interface WaterSurface {
  material: THREE.MeshStandardNodeMaterial
  /** The planet's water colours (palettes.ts seaShallow and seaDeep), so the sea matches the lobby globe. */
  setColours(shallow: number, deep: number): void
  /** Per frame: sea level and, for the sea, the current wave phases. */
  update(level: number): void
  /** The bed under the water, from `buildBedTexture`: depth per pixel, not per sea vertex. */
  setBed(bed: WaterBed): void
  /** The sky reflection capture. Mirrored at full strength, not at the scene's subdued fill. */
  setEnvironment(texture: THREE.Texture | null): void
  /**
   * The waves this surface shows: the shared field for its body, `() => liquidWaves(body)`
   * (liquidWaves.ts), so what floats and what is drawn are the same surface. Flat until set.
   */
  setWaveSource(source: WaveSource | null): void
}

/**
 * One body's waves now, in the shape of liquidWaves.ts LiquidWaveField (which it accepts as is):
 * sines with their current phase (radians) and amplitude (metres, every scaling folded in), and
 * the shoaling numbers. `active` false marks a component the physics does not lift on: it only
 * tilts the light. Called once a frame; the result may be reused by the caller.
 */
export interface WaveField {
  components: readonly { kx: number; kz: number; amplitude: number; phase: number; active?: boolean }[]
  /** Depth (m) at which the waves are whole. */
  shoalDepth: number
  /** Share left in very shallow water (0 when absent). */
  shoalFloor?: number
  /** Depth (m) over which they fade to nothing at the waterline (none when absent). */
  shoalLip?: number
}
export type WaveSource = () => WaveField | null

/** Share of the waves at water `depth`, as liquidShoal in the physics: CPU twin of the shader's. */
export function shoal(depth: number, f: Pick<WaveField, 'shoalDepth' | 'shoalFloor' | 'shoalLip'>): number {
  if (!(depth > 0)) return 0
  const s = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u) }
  const lip = Math.max(1e-3, f.shoalLip ?? 1e-3), floor = f.shoalFloor ?? 0
  return s(0, lip, depth) * (floor + (1 - floor) * s(0, Math.max(1e-3, f.shoalDepth), depth))
}


/** Chop shorter than this, metres, counts as fine ripples. */
export const RIPPLE_LENGTH = 1.5
/** Metres from the camera over which fine ripples go from seen one by one to sheen only. */
const RIPPLE_SEEN: readonly [number, number] = [15, 55]
/** Radians of the fine noise's bend on each ripple's phase (alternate signs per ripple). */
const RIPPLE_BREAK = 3.2
/** Pixel footprints per wavelength over which a fine ripple goes from sheen only to drawn. */
const RIPPLE_FOOTPRINTS: readonly [number, number] = [6, 16]
/**
 * The footprint filter's ramp, in pixel footprints per wavelength: a wave is gone at
 * FOOTPRINT_GONE (a little above the two a pixel grid can sample at all) and whole from
 * FOOTPRINT_WHOLE. Between them it fades, and what it loses roughens the surface instead.
 */
export const FOOTPRINT_GONE = 2.5
export const FOOTPRINT_WHOLE = 7

/**
 * Roughness for a surface whose base roughness is `base` and from which the footprint filter
 * removed slope variance `lost` (summed over both axes). GGX alpha is roughness squared, and
 * alpha squared is the variance of the microfacet slopes, so the removed variance adds to it:
 * alpha = sqrt(alpha0^2 + lost). The usual Toksvig-style correction, done on known sines.
 */
export function filteredRoughness(base: THREE.Node<'float'>, lost: THREE.Node<'float'>) {
  const a0 = base.mul(base)
  return a0.mul(a0).add(lost).sqrt().sqrt().min(1)
}

/** Specular anti-aliasing: the screen-space filter's variance (a pixel-wide Gaussian) and the most it may add to alpha squared. */
const SPECULAR_AA_VARIANCE = 0.1
const SPECULAR_AA_MAX = 0.08
/** Share of the way from the shallow to the deep colour the lagoon's middle band sits. */
const LAGOON_BAND = 0.45
/** Peak slope of the noise ripple near the camera on the sea and still water. */
const SLOPE_NOISE = 0.05

/** Cosine of the critical angle of water: the edge of Snell's window seen from below. */
const SNELL_COS = Math.cos(Math.asin(1 / 1.333))

const SHALLOW = 0x2fc4bd
const DEEP = 0x0a3562
const FOAM = 0xf4fbff

/** Refractive index of water squared: Snell's law for the ray that continues below. */
const IOR2 = 1.333 * 1.333

/** Metres of water a sight line crosses to reach the bed: deeper, and longer when oblique. */
function waterPath(depth: THREE.Node<'float'>) {
  // The true angle of the sight line to the surface as it is drawn (round planet included).
  const up = abs(bentGrazing(positionWorld, cameraPosition)).min(1)
  // The refracted ray is never flatter than 41 degrees below the surface, so the path is at
  // most one and a half times the depth however low the camera sits.
  const cosBelow = float(1).sub(float(1).sub(up.mul(up)).div(IOR2)).sqrt()
  return max(depth, 0).div(cosBelow)
}

/**
 * How much of what lies behind the water a pixel keeps. Alpha blending shows the real bed
 * and anything opaque under the surface; there is no refraction pass or second scene render.
 *
 * Two physical terms. Beer-Lambert: light from the bed dies off along its path through the
 * water, and `water.clarity` is the distance at which a tenth survives. Fresnel: the surface
 * mirrors the sky more the shallower the view, so the far sea is a mirror and the water at
 * your wheels is a window. The same graph on both backends and every quality tier.
 */
export function waterOpacityNode(depth: THREE.Node<'float'>, foam: THREE.Node<'float'>, clarityScale = 1, behindIsAbove: THREE.Node<'float'> = float(0)) {
  const clarity = uniform(waterClarity.value * clarityScale).setGroup(renderGroup).onRenderUpdate(() => waterClarity.value * clarityScale)
  const view = normalize(cameraPosition.sub(positionWorld))
  const kept = waterPath(depth).mul(-2.3).div(clarity).exp()
  // Fresnel from the true grazing angle: on a small planet the near surface is tilted toward the
  // camera, so it mirrors less than the flat angle says.
  const grazing = bentGrazing(positionWorld, cameraPosition)
  const mirror = float(1).sub(abs(grazing).min(1)).pow(5).mul(0.98).add(0.02)
  // Whole where the straight sight line leaves the water without meeting the bed (sightLineMeetsBed).
  const above = max(max(float(1).sub(float(1).sub(mirror).mul(kept)), foam.mul(0.9)), behindIsAbove)
  // From underwater, a clear Snell window and nearly opaque reflection outside its cone.
  const window = smoothstep(SNELL_COS - .14, SNELL_COS + .06, view.y.negate())
  return view.y.greaterThanEqual(0).select(above, mix(float(.98), float(.12), window))
}

/** Metres below the bed over which a sight line counts as reaching it (sightLineMeetsBed). */
const SIGHT_LINE_MARGIN = 1.5

/**
 * Does the straight sight line through this pixel get below the bed before it comes back out of
 * the water? 1 when it does (what alpha blending shows behind the surface is the bed, as the
 * opacity assumes), 0 when it does not. Then what lies behind is above the water, and the water
 * must be whole. The owner, on v26.11.1801: "why can I see these distant hills underneath the
 * ocean?" On the drawn round planet (curve.ts) a line entering shallow water at the edge of a
 * drop-off runs on over deep water, comes back out of the curving surface and meets the hills.
 *
 * Exact on the drawn sphere: in the plane through the camera, the pixel and the planet's centre,
 * the line from its entry is stepped at eight distances growing by doubles, from where a flat bed
 * at this pixel's depth would be met out to where the line leaves the water (2 R sin a). At each
 * the line's height over the sphere is compared with the bed under its ground point. Eight bed
 * fetches per pixel; no extra pass. Always 1 on a flat world, where the line never comes back out.
 * tools/sea-see-through-scan.ts casts the same test over real terrain.
 */
function sightLineMeetsBed(surfaceY: THREE.Node<'float'>, depth: THREE.Node<'float'>, bedAt: (xz: THREE.Node<'vec2'>) => THREE.Node<'float'>) {
  const invR = curveInverseRadius
  const R = float(1).div(invR.max(1e-9))
  const sinA = bentGrazing(positionWorld, cameraPosition).max(1e-3)
  const chord = sinA.mul(2).mul(R)
  const flat = vec2(positionWorld.x, positionWorld.z).sub(vec2(cameraPosition.x, cameraPosition.z))
  const d = flat.length(), dir = flat.div(d.max(1e-4))
  // The entry as drawn, the camera at (0, camera height) over its own ground point, the centre at (0, -R).
  const t0 = d.mul(invR).min(Math.PI), r0 = R.add(surfaceY)
  const ex = r0.mul(sin(t0)), ey = r0.mul(cos(t0)).sub(R)
  const ray = vec2(ex, ey.sub(cameraPosition.y)), v = ray.div(ray.length().max(1e-6))
  let best: Sum = float(-1e9)
  let u: THREE.Node<'float'> = max(depth, 0.05).div(sinA)
  for (let k = 0; k < 8; k++) {
    const s = u.min(chord.mul(0.95))
    const px = ex.add(v.x.mul(s)), py = ey.add(v.y.mul(s))
    const rho = vec2(px, py.add(R)).length(), t = px.atan(py.add(R))
    const ground = vec2(cameraPosition.x, cameraPosition.z).add(dir.mul(R.mul(t)))
    best = best.max(bedAt(ground).sub(rho.sub(R)))
    u = u.mul(2)
  }
  // Eased over SIGHT_LINE_MARGIN metres below the bed, not 0.3: the narrow margin drew a hard
  // line on the far sea where lines stop reaching the bed. The margin starts at 0, never
  // below: counting a near miss as reaching the bed lets the land behind show through again
  // (tools/sea-see-through-scan.ts, MARGIN).
  return select(invR.lessThanEqual(0), float(1), smoothstep(0, SIGHT_LINE_MARGIN, best))
}

/** Share of the scene's aerial haze the water takes at the camera, and the distances it eases over. */
export const WATER_HAZE = { near: 0.15, from: 300, to: 1600 }

/**
 * Haze over water on its own curve. The weather's sea-level haze is right for land but washes
 * a sea seen from a few tens of metres up into milk, hiding its colour and its swell. The
 * scene's air fog mixes a pixel toward the haze colour by a factor f; mixing that result back
 * toward the unfogged colour by `keep` is the same as applying the haze at f * (1 - keep). So
 * near the camera the water takes only WATER_HAZE.near of it, easing to all of it by
 * WATER_HAZE.to metres and at the horizon, where it meets the land's haze exactly. No change
 * while the camera is in the water (the medium there is the fog). Under the weather fog
 * (fogLayersOf), the curve eases only the height haze; fog banks apply in full. With no scene fog (a lab,
 * a test, a world built before Environment) this is exactly the default. It wraps whatever
 * fog node the material is compiled against, so a rebuilt Environment is picked up when its
 * new fog node recompiles the material.
 */
export function hazeCurve(material: THREE.NodeMaterial): void {
  type FogSetup = (this: unknown, builder: { fogNode: unknown }, output: THREE.Node) => THREE.Node
  const m = material as unknown as { setupFog: FogSetup }
  const base = Object.getPrototypeOf(material).setupFog as FogSetup
  m.setupFog = function waterFog(builder, output) {
    const fogged = base.call(this, builder, output)
    if (!builder.fogNode) return fogged
    const share = mix(float(WATER_HAZE.near), float(1), smoothstep(WATER_HAZE.from, WATER_HAZE.to, positionView.length()))
    const keep = float(1).sub(share).mul(float(1).sub(cameraInWaterNode))
    const layers = fogLayersOf(airFogOf(builder.fogNode))
    if (!layers) return mix(fogged as THREE.Node<'vec4'>, output as THREE.Node<'vec4'>, keep)
    // The weather fog in its two layers: the height haze on the water's curve as above, and fog
    // banks in full, so a bank lying on the sea shows on the sea. The scene fog runs first: an
    // underwater fog node writes the colour seen through the water column into `output`, which
    // the air fog then fogs. With no banks (bankFactor 0) this is the line above exactly; in
    // the water it is the scene fog as before.
    const whole = vec4(0).toVar()
    whole.assign(fogged as THREE.Node<'vec4'>)
    const plain = output as THREE.Node<'vec4'>
    const hazed = mix(fogInput.rgb, layers.hazeColor as THREE.Node<'vec3'>, layers.hazeFactor as THREE.Node<'vec3'>)
    const eased = mix(hazed, plain.rgb, keep)
    const above = vec4(mix(eased, layers.bankColor as THREE.Node<'vec3'>, layers.bankFactor as THREE.Node<'float'>), plain.a)
    return mix(above, whole, cameraInWaterNode)
  }
}

export function configureWaterBlending(material: THREE.MeshStandardNodeMaterial): void {
  material.transparent = true
  material.depthWrite = false
  // These surfaces are single sheets; drawing both faces twice darkens the water needlessly.
  material.forceSinglePass = true
}

export function createWaterSurface(mode: WaterMode): WaterSurface {
  const level = uniform(0)
  // Wave i: (kx, kz, phase, geometric amplitude) and the amplitude used for shading.
  const wave = Array.from({ length: WAVE_COUNT }, () => uniform(new THREE.Vector4()))
  const shadeAmp = Array.from({ length: WAVE_COUNT }, () => uniform(0))
  /** Depth over which waves grow from nothing to full: a tenth of the dominant wavelength. */
  const shoalDepth = uniform(6)
  const shoalFloor = uniform(0)
  const shoalLip = uniform(1e-3)
  /** The shader's twin of `shoal()`. */
  const shoalNode = (d: THREE.Node<'float'>) => smoothstep(0, shoalLip, d).mul(shoalFloor.add(float(1).sub(shoalFloor).mul(smoothstep(0, shoalDepth, d))))
  let source: WaveSource | null = null
  /** Total geometric amplitude, for normalising crest height. */
  const ampTotal = uniform(0)

  const shallowColour = uniform(new THREE.Color(SHALLOW))
  const deepColour = uniform(new THREE.Color(DEEP))
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0, side: THREE.DoubleSide })
  configureWaterBlending(material)
  const p = positionWorld
  const bedMap = texture(NO_BED)
  /** (1 / tile size, half a texel, height the texture is relative to). */
  const bedFrame = uniform(new THREE.Vector3(1 / 2048, 0, 0))

  // Water depth at rest, per pixel, from the height field itself.
  const surfaceY = mode === 'sea' ? level : positionGeometry.y
  const bedUv = vec2(p.x, p.z).mul(bedFrame.x).add(bedFrame.y.add(0.5))
  const depth = surfaceY.sub(bedMap.sample(bedUv).r.add(bedFrame.z))
  const shoalHere = shoalNode(depth)

  const glitter = uniform(waterGlitter.value).setGroup(renderGroup).onRenderUpdate(() => waterGlitter.value)
  const rippleStrength = uniform(waterRipple.value).setGroup(renderGroup).onRenderUpdate(() => waterRipple.value)
  // Vertex: swell, on the clipmap (clipmap.ts). Every component the shared field holds,
  // evaluated at the morphed world xz; components too short for the level's cells fade out
  // there and live on in the normals below. Depth for shoaling is the bed texture's, read in
  // the vertex stage at mip 0, so the waves die on the same shore the foam draws.
  if (mode === 'sea') {
    const grid = clipmapNodes()
    const w = grid.world
    const bedHere = bedMap.sample(w.mul(bedFrame.x).add(bedFrame.y.add(0.5))).level(float(0)).r.add(bedFrame.z)
    let h: Sum = float(0)
    for (const u of wave) {
      const length = float(Math.PI * 2).div(vec2(u.x, u.y).length().max(1e-4))
      const fade = smoothstep(grid.fadeCell.mul(3), grid.fadeCell.mul(5), length)
      h = h.add(u.w.mul(fade).mul(sin(u.x.mul(w.x).add(u.y.mul(w.y)).add(u.z))))
    }
    material.positionNode = vec3(grid.local.x, h.mul(shoalNode(level.sub(bedHere))).add(detailHeight(w, grid.fadeCell)), grid.local.y)
  } else {
    // Lakes, pools and rivers: their own meshes, at their own surface heights, displaced by
    // whatever wave source they are given (`setWaveSource`; flat until one is). The mesh
    // spacing (userData.spacing, metres) decides which components it can carry.
    const spacing = uniform(3).onObjectUpdate(({ object }) => (object?.userData as { spacing?: number } | undefined)?.spacing ?? 3)
    const w = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz
    const bedHere = bedMap.sample(w.mul(bedFrame.x).add(bedFrame.y.add(0.5))).level(float(0)).r.add(bedFrame.z)
    let h: Sum = float(0)
    for (const u of wave) {
      const length = float(Math.PI * 2).div(vec2(u.x, u.y).length().max(1e-4))
      h = h.add(u.w.mul(smoothstep(spacing.mul(3), spacing.mul(5), length)).mul(sin(u.x.mul(w.x).add(u.y.mul(w.y)).add(u.z))))
    }
    const lift = h.mul(shoalNode(positionGeometry.y.sub(bedHere))).add(detailHeight(w, spacing).mul(mode === 'still' ? 0.7 : 0.4))
    material.positionNode = positionLocal.add(vec3(0, lift, 0))
  }

  // Fragment: slope of the swell, every component; the ones too short for the mesh fade with
  // distance so they do not shimmer.
  const dist = p.sub(cameraPosition).length()
  const near = smoothstep(500, 60, dist)
  // The footprint filter. A pixel covers `footprint` metres of water along the screen axis that
  // covers the most (at a grazing view that is the axis toward the horizon, many times the other).
  // A wave shorter than a few footprints cannot be drawn: summed into the normal it aliases into
  // the hatch and the streaks the owner saw. Each wave is faded by `resolved(length)` instead, and
  // the slope it would have given (its variance, slope amplitude squared over two) goes to
  // `lost`, which roughens the surface by exactly that much (filteredRoughness): the far sea turns
  // to a sheen that keeps the brightness of the detail it can no longer show. By footprint, not by
  // distance, so a low camera, a high one and any screen resolution are each filtered for what
  // they actually resolve.
  const footprint = max(dFdx(p.xz).length(), dFdy(p.xz).length()).max(1e-4)
  const resolved = (length: THREE.Node<'float'> | number) => smoothstep(footprint.mul(FOOTPRINT_GONE), footprint.mul(FOOTPRINT_WHOLE), length)
  let lost: Sum = float(0)
  /** Fade one wave's slope (s, its peak slope) by the filter and record what was removed. */
  const filtered = (length: THREE.Node<'float'> | number, s: THREE.Node<'float'>) => {
    const w = resolved(length)
    lost = lost.add(s.mul(s).mul(0.5).mul(float(1).sub(w.mul(w))))
    return w
  }
  let sx: Sum = float(0)
  let sz: Sum = float(0)
  let crest: Sum = float(0)
  {
    for (let i = 0; i < WAVE_COUNT; i++) {
      const u = wave[i]
      const arg = u.x.mul(p.x).add(u.y.mul(p.z)).add(u.z)
      // Geometric components at full strength, light-only ones fade out with distance.
      const a = u.w.add(shadeAmp[i].sub(u.w).mul(smoothstep(900, 150, dist)))
      const k = vec2(u.x, u.y).length()
      const w = filtered(float(Math.PI * 2).div(k.max(1e-4)), a.mul(k))
      const c = cos(arg).mul(a).mul(w)
      sx = sx.add(c.mul(u.x))
      sz = sz.add(c.mul(u.y))
      crest = crest.add(sin(arg).mul(u.w))
    }
    // No steepening with distance: the old far-field boost (up to 2.6 times) printed the
    // swell's interference lattice to the horizon. The far sea reads by its sheen instead.
    sx = sx.mul(shoalHere)
    sz = sz.mul(shoalHere)
  }

  // Detail: small wind ripples near the camera, and on a river they run downstream.
  const flowSpeed = mode === 'river' ? attribute<'float'>('flowSpeed', 'float') : float(0)
  const steep = mode === 'river' ? attribute<'float'>('slope', 'float') : float(0)
  const drift = time.mul(0.6)
  let rx: Sum, rz: Sum
  if (mode === 'river') {
    // uv: x across the river in metres, y metres along it. Scroll downstream at the flow speed.
    const along = uv().y.sub(time.mul(flowSpeed))
    const q = vec3(uv().x.mul(0.6), along.mul(0.35), drift)
    rx = mx_noise_float(q)
    rz = mx_noise_float(q.add(vec3(17.3, 5.1, 0)))
  } else {
    // The sea and still water: chop and fine ripples, only where the quality level runs the
    // detail layer (a uniform branch, so changing level builds nothing and skips the work).
    // Sines are far cheaper than noise and give an exact slope; the two noises bend each one's
    // phase by its own weights (WARP), so crests wander instead of marching in ranks.
    // One shader function, so the branch has a stack to live on. Returns the detail's slope (x, z),
    // the slope variance the footprint filter took from it, and the first noise (for foam and sheen).
    const detail = Fn(() => {
      const nx = float(0).toVar(), cx = float(0).toVar(), cz = float(0).toVar(), lostDetail = float(0).toVar()
      If(detailOn.greaterThan(0.5), () => {
        const q = vec3(p.x.mul(0.3), p.z.mul(0.3), drift)
        const n1 = mx_noise_float(q), n2 = mx_noise_float(q.add(vec3(17.3, 5.1, 0)))
        // A finer noise (features about 0.6 m) for the ripples alone: it breaks their crests into
        // short crestlets, so four ripple waves can never read as rows, even with the sun behind them.
        const n3 = mx_noise_float(vec3(p.x.mul(1.7), p.z.mul(1.7), drift.mul(1.6).add(31.7)))
        nx.assign(n1)
        const patch = patchAt(p.xz)
        const still = mode === 'still' ? 0.45 : 1
        // Chop is never fully calm (55 per cent in a lull); ripples ease in a lull and grow near the camera.
        const chopShare = chop.mul(still).mul(float(0.55).add(patch.mul(0.45)))
        const rippleShare = chop.mul(still).mul(rippleStrength).mul(float(0.5).add(patch.mul(0.5)))
        // Ripples are seen one by one only near the camera (RIPPLE_SEEN): further out their slope
        // still counts, as roughness, so the water keeps its sheen without printing their pattern.
        // And only with pixels to spare: a ripple close to the pixel limit along the view beats with
        // its neighbours into rows through a low sun's path (the low-sun frames). So ripples need
        // more footprints per wavelength than the rest (RIPPLE_FOOTPRINTS). By footprint, not by
        // view angle: a low camera at the shore is grazing everywhere, yet the ripples a few
        // metres away are many pixels long and stay drawn; the same angle at 40 m fades them.
        const rippleSeen = smoothstep(RIPPLE_SEEN[1], RIPPLE_SEEN[0], dist)
        const rippleResolved = (length: number) => smoothstep(footprint.mul(RIPPLE_FOOTPRINTS[0]), footprint.mul(RIPPLE_FOOTPRINTS[1]), float(length))
        // Glitter: with distance, the share of each wave's slope kept as a sharp facet; the rest
        // roughens (filteredRoughness), so the middle distance is a sheen with sparse glints. Near
        // the camera every facet is sharp: there the ripples are seen one by one.
        const facet = mix(float(1), mix(float(0.45), float(1), glitter), smoothstep(30, 150, dist))
        const add = (gx: THREE.Node<'float'>, gz: THREE.Node<'float'>, length: number, slope: THREE.Node<'float'>, keep: THREE.Node<'float'>) => {
          lostDetail.addAssign(slope.mul(slope).mul(0.5).mul(float(1).sub(keep.mul(keep))))
          cx.addAssign(gx.mul(slope).mul(keep))
          cz.addAssign(gz.mul(slope).mul(keep))
        }
        CHOP.forEach(([length, heading, steepness], i) => {
          const k = (Math.PI * 2) / length
          const dx = Math.cos(heading), dz = Math.sin(heading)
          // The shorter the wave, the harder its phase is bent, so short crossings never settle into a grid.
          const bend = Math.sqrt(CHOP[0][0] / length)
          const ripple = length < RIPPLE_LENGTH
          let arg = p.x.mul(k * dx).add(p.z.mul(k * dz)).add(time.mul(Math.sqrt(9.81 * k))).add(n1.mul(WARP[i][0] * bend)).add(n2.mul(WARP[i][1] * bend))
          if (ripple) arg = arg.add(n3.mul(RIPPLE_BREAK * (i % 2 ? -1 : 1)))
          const c = cos(arg)
          add(c.mul(dx), c.mul(dz), length, (ripple ? rippleShare : chopShare).mul(steepness), resolved(length).mul(facet).mul(ripple ? rippleSeen.mul(rippleResolved(length)) : float(1)))
        })
        // A little noise in the slope near the camera; its features are about 3 m across (1 / 0.3).
        add(n1, n2, 3, near.mul(SLOPE_NOISE), resolved(3))
      })
      return vec4(cx, cz, lostDetail, nx)
    })()
    lost = lost.add(detail.z)
    sx = sx.add(detail.x)
    sz = sz.add(detail.y)
    rx = detail.w
    rz = float(0)
  }
  // The simulated ripples round the camera (water.ripples): vehicle wakes and splashes. Zero
  // outside their window and while they are off. Seen in the lighting, on still water too.
  if (mode !== 'river') {
    const ripple = rippleField.rippleNormal(p.xz)
    sx = sx.sub(ripple.x.div(ripple.y))
    sz = sz.sub(ripple.z.div(ripple.y))
  }
  // On a river, the noise is its running texture: features about 2.5 m long.
  if (mode === 'river') {
    const rippleGain = float(0.18).add(steep.mul(0.6))
    const rippleKeep = filtered(2.5, rippleGain.mul(near))
    sx = sx.add(rx.mul(rippleGain).mul(near).mul(rippleKeep))
    sz = sz.add(rz.mul(rippleGain).mul(near).mul(rippleKeep))
  }

  // Lit as the slope says, flipped when seen from below.
  const worldNormal = normalize(vec3(sx.negate(), 1, sz.negate())).mul(faceDirection)
  material.normalNode = normalize(cameraViewMatrix.transformDirection(worldNormal))

  // Colour from above: shallows to deep by depth, lifted a little on the crests.
  const crestN = crest.div(max(ampTotal, 0.001)).mul(shoalHere)
  // What the water itself sends back: the shallow tint where little of it lies along the
  // sight line, the deep colour once the line has crossed about a clarity's worth.
  // A river is a few metres deep at most: it darkens over its own depths, so its pools read deep.
  // The sea grades as a lagoon does: the shallow colour holds over the first few metres (with the
  // bed showing through, from the opacity), eases to a band between the planet's two colours, and
  // drops to the deep colour past the shelf. Both colours are the planet's own, so a murky world
  // stays murky. A river keeps its short ramp.
  const path = waterPath(depth)
  const grade = mode === 'river'
    ? smoothstep(0.3, 9, path)
    : smoothstep(1.5, 9, path).mul(LAGOON_BAND).add(smoothstep(9, 30, path).mul(1 - LAGOON_BAND))
  const body = mix(shallowColour, deepColour, grade)
  // Swell crests catch the light: a step toward the shallow colour, brightened. Only the swell:
  // when the chop lifted the colour too, every small cell was printed into the water's body.
  const lifted = mix(body, shallowColour.mul(1.15), smoothstep(0.2, 1, crestN).mul(0.25).mul(visual.min(1.5)))

  // Foam.
  const breakup = mx_noise_float(vec3(p.x.mul(0.12), p.z.mul(0.12), drift.mul(0.5))).mul(0.5).add(0.5)
  // The line where water meets land.
  // A thin broken edge that laps in and out, not a white apron: depth is now true per pixel.
  const lap = sin(time.mul(0.8).add(breakup.mul(9))).mul(0.08)
  let foam = smoothstep(0.42, 0.06, depth.add(rx.mul(0.18)).add(lap)).mul(smoothstep(-0.25, 0.02, depth)).mul(breakup.mul(0.6).add(0.4))
  // Pools and river banks shelve gently, so the same depth band is metres wide there: a
  // faint wet edge, not a white collar.
  // A river's edge is the bed showing through ever thinner water (riverFade below): no foam line.
  if (mode !== 'sea') foam = foam.mul(mode === 'still' ? 0.35 : 0)
  if (mode === 'sea') {
    // Rolling lines running in to the shore: phase rises with depth so the bands travel toward
    // the coast, and they fade with depth and wherever the noise breaks them up.
    // Depth is interpolated across a coarse grid, so its contours zigzag: warp it with
    // smooth noise and keep the lines in the last couple of metres, where the grid is
    // closest to the coast and the lines are short.
    const warp = mx_noise_float(vec3(p.x.mul(0.045), p.z.mul(0.045), drift.mul(0.2))).mul(0.9)
    const lines = smoothstep(0.88, 0.99, sin(depth.add(warp).mul(1.7).add(time.mul(1.1))).mul(0.5).add(0.5))
    foam = max(foam, lines.mul(smoothstep(2.6, 0.5, depth)).mul(smoothstep(0.35, 0.75, breakup)).mul(0.7))
    // Whitecaps on the highest crests when the sea is rough, and on any crest steep enough to
    // break, broken up by noise so they read as caps, not stripes.
    const rough = smoothstep(0.3, 1.4, ampTotal.mul(2))
    const steepness = sx.mul(sx).add(sz.mul(sz)).sqrt()
    foam = max(foam, smoothstep(0.62, 0.92, crestN).mul(max(rough, smoothstep(0.08, 0.16, steepness))).mul(smoothstep(0.4, 0.8, breakup)).mul(visual.min(1.2)))
    // Waves shoaling over the last few metres crest and spill white before the shore.
    foam = max(foam, smoothstep(0.35, 0.75, crestN).mul(smoothstep(3.5, 1.2, depth)).mul(smoothstep(0.3, 0.9, depth)).mul(smoothstep(0.3, 0.7, breakup)).mul(0.8))
  }
  // A river: clear moving water over its bed, white only where it breaks, fading to nothing over
  // its shallows and its skirt so it has no edge. The owner, on v26.11.1801: "make areas where
  // it's very shallow nearly transparent ... like water flowing down a mountain, not like some
  // kind of white, jaggy toothpaste blob". Before, white came from the bed's slope alone
  // (smoothstep(0.12, 0.5, slope)): every stretch steeper than one in two was white from bank to
  // bank, and foam set the floor of the opacity, so the shallows and the edge were opaque too.
  let riverFade: THREE.Node<'float'> = float(1)
  if (mode === 'river') {
    const churn = attribute<'float'>('churn', 'float'), edge = attribute<'float'>('edge', 'float')
    // Where water breaks. A change of slope along the river: lips, steps, the foot of a fall.
    // A steep chute, the steeper the whiter: a fall (more than one in one) is nearly all white.
    // Shallow fast water, a little: the Froude number v / sqrt(g d) well past 1, where it tears.
    const froude = flowSpeed.div(max(depth, 0.05).mul(9.81).sqrt())
    const breaking = max(max(churn, smoothstep(0.3, 1.1, steep).mul(0.85)), smoothstep(2, 4, froude).mul(smoothstep(0.15, 0.6, depth)).mul(0.3))
    // Streaks: ridged noise that changes fifteen times faster across the river than along it, so
    // its ridges are thin lines running with the flow; two scales, carried at the river's speed.
    const ridge = (n: THREE.Node<'float'>) => { const r = float(1).sub(abs(n)); return r.mul(r).mul(r).mul(r) }
    const along = uv().y.sub(time.mul(flowSpeed))
    const lace = max(
      ridge(mx_noise_float(vec3(uv().x.mul(1.2), along.mul(0.08), drift.mul(0.3)))),
      ridge(mx_noise_float(vec3(uv().x.mul(3.3), along.mul(0.2).sub(time.mul(0.3)), drift.mul(0.5).add(9)))).mul(0.85),
    )
    // More breaking, more of the lace turns white; a little stays laced even at full churn.
    const white = smoothstep(float(0.62).sub(breaking.mul(0.5)), float(0.85).sub(breaking.mul(0.35)), lace).mul(breaking.min(1))
    // Water this thin shows its bed, white or not; the skirt fades to nothing at the mesh's edge.
    riverFade = smoothstep(0.02, 0.35, depth).mul(smoothstep(0, RIVER_SKIRT, edge))
    foam = max(foam, white.mul(smoothstep(0.05, 0.3, depth)))
  }
  // A running river is clearer than standing water: twice the clarity, so its bed shows.
  const bedAt = (xz: THREE.Node<'vec2'>) => bedMap.sample(xz.mul(bedFrame.x).add(bedFrame.y.add(0.5))).level(float(0)).r.add(bedFrame.z)
  const behindIsAbove = float(1).sub(sightLineMeetsBed(surfaceY, depth, bedAt))
  material.opacityNode = waterOpacityNode(depth, foam, mode === 'river' ? 2 : 1, behindIsAbove).mul(riverFade)
  const above = mix(lifted, color(FOAM), foam.mul(0.9))

  // From below: Snell's window. The sky shows through a cone round the surface normal (so it
  // wobbles with every wave, which is how waves read from underneath); outside it the surface
  // mirrors the lit water below. Self-lit, scaled by daylight, since the lights come from above
  // and would leave the underside black.
  const lookUp = normalize(p.sub(cameraPosition))
  const waveNormal = normalize(vec3(sx.negate(), 1, sz.negate()))
  const cosUp = lookUp.dot(waveNormal)
  const window = smoothstep(SNELL_COS - 0.05, SNELL_COS + 0.05, cosUp)
  const edgeGlow = smoothstep(SNELL_COS - 0.12, SNELL_COS, cosUp).mul(float(1).sub(window))
  const skyBelow = mix(color(0x9fdcf2), color(0xffffff), smoothstep(0.75, 1, cosUp)).mul(1.7)
  const mirror = mix(shallowColour.mul(0.55), deepColour.mul(0.9), smoothstep(-0.2, 0.6, lookUp.y.negate()))
  const below = mix(mirror.add(shallowColour.mul(edgeGlow.mul(0.8))), skyBelow, window).mul(liquidDaylightNode)
  const fromAbove = faceDirection.mul(0.5).add(0.5)
  material.colorNode = mix(vec3(0), above, fromAbove)
  material.emissiveNode = below.mul(float(1).sub(fromAbove))
  // Inside the window the bright sky is the surface's own colour: mostly opaque so it reads
  // as a window of light rather than the fogged sky dome behind it.
  // The underside only exists for a camera in the water; from above it would be the far sea
  // turning away past the horizon, drawn as a flat slab in front of the sky.
  material.opacityNode = mix(mix(float(0.92), float(0.85), window).mul(cameraInWaterNode), material.opacityNode as THREE.Node<'float'>, fromAbove)
  // Glassy close up; rougher with distance, where many unresolved facets share a pixel and
  // a mirror would sparkle and alias.
  // Seen from below the surface is not a sky mirror (Snell's window above is the sky): fully
  // rough there, so the full-strength reflection capture cannot light the underside.
  // Specular anti-aliasing (Kaplanyan and Tokuyoshi's normal-variance kernel): where the normal
  // turns quickly from one pixel to the next, a sharp highlight would alias into rows even though
  // each wave is resolved (the Foreman, on the low-sun frames: "a scanline pattern"). The normal's
  // screen-space variance widens the highlight by exactly what one pixel spans, capped.
  const upNormal = normalize(vec3(sx.negate(), 1, sz.negate()))
  const nx = dFdx(upNormal), ny = dFdy(upNormal)
  const kernel = nx.dot(nx).add(ny.dot(ny)).mul(SPECULAR_AA_VARIANCE * 2).min(SPECULAR_AA_MAX)
  const glassy = filteredRoughness(float(0.05).add(foam.mul(0.6)).add(abs(rx).mul(0.03)), lost.add(kernel))
  material.roughnessNode = mix(float(1), glassy, faceDirection.mul(0.5).add(0.5))
  // Roughness alone still lets the capture light the underside as a blurred blue sky. Under
  // water the surface outside Snell's window reflects the dark water below, so occlude nearly
  // all ambient and reflected light there and leave the top exactly as it is.
  material.aoNode = mix(float(0.1), float(1), faceDirection.mul(0.5).add(0.5))

  hazeCurve(material)
  // From Medium up, what lies under the surface wobbles with it (refraction.ts).
  refractThrough(material, { x: sx, z: sz }, depth)

  return {
    material,
    setColours(shallow: number, deep: number) {
      shallowColour.value.setHex(shallow)
      deepColour.value.setHex(deep)
    },
    setBed(bed: WaterBed) {
      bedMap.value = bed.texture
      bedFrame.value.set(1 / bed.size, 0.5 / bed.texture.image.width, bed.reference)
    },
    setEnvironment(texture: THREE.Texture | null) {
      material.envMapIntensity = waterReflection.value
      if (material.envMap === texture) return
      // Null to a capture happens once, at load; the capture target is reused afterwards.
      material.envMap = texture
      material.needsUpdate = true
    },
    setWaveSource(next: WaveSource | null) { source = next },
    update(l: number) {
      level.value = l
      // Whatever field this body was given (the sea's by default), or flat.
      const field = source?.() ?? null
      let total = 0
      for (let i = 0; i < WAVE_COUNT; i++) {
        const c = field?.components[i]
        const geo = c && c.active !== false ? c.amplitude : 0
        wave[i].value.set(c ? c.kx : 0, c ? c.kz : 0, c ? c.phase : 0, geo)
        shadeAmp[i].value = c ? c.amplitude : 0
        total += geo
      }
      ampTotal.value = total
      shoalDepth.value = Math.max(1e-3, field?.shoalDepth ?? 1)
      shoalFloor.value = field?.shoalFloor ?? 0
      shoalLip.value = Math.max(1e-3, field?.shoalLip ?? 1e-3)
    },
  }
}

/** Metres between cross sections of a river ribbon by default: fine enough for falls. */
const RIVER_STEP = 3
/** Highest a ribbon edge may stand above the bank under it, metres. */
const RIVER_EDGE_CLEARANCE = 0.25
/**
 * How far the drawn ribbon reaches past the river's own width on each side, metres
 * (volcanics.ts builds it `r.width + 1.5` wide): a skirt that tucks into the banks.
 */
export const RIVER_SKIRT = 0.75
/** Metres either side of a point over which a river's slope is compared, for where it breaks. */
const RIVER_CHURN_RUN = 6

/**
 * A ribbon at the river's true surface (`points[].y`), carrying for the water material: uv
 * (across in metres, along in metres), `groundHeight` (the bed under each vertex),
 * `flowSpeed` (m/s from Manning's formula, as the physics uses) and `slope` (fall over run).
 * The river is resampled every RIVER_STEP metres so the surface follows steep drops.
 */
export function buildRiverSurface(
  ground: { heightAt(x: number, z: number): number },
  points: readonly { x: number; y: number; z: number }[],
  width: number,
  speedAt: (slope: number) => number,
  /** Metres between cross sections; the columns across are about as far apart. */
  step = RIVER_STEP,
): THREE.BufferGeometry {
  // Columns across, as offsets from the centre line: about `step` apart, one on the centre line,
  // one on each edge of the river itself (the skirt starts there) and one at each outer edge.
  const half = width / 2, inner = Math.max(0, half - RIVER_SKIRT)
  const offsets = [0]
  const n = Math.max(1, Math.round(inner / step))
  for (let k = 1; k <= n; k++) offsets.push((inner * k) / n)
  if (half > inner) offsets.push(half)
  const across = [...offsets.slice(1).reverse().map((o) => -o), ...offsets]
  const cols = across.length
  // Resample along the path. Each cross-section lies square to its stretch, and at a joint along
  // the bisector of the two stretches, whatever the step: exactly as physics reads the river
  // (lava.ts riverStripAt), so the two agree across the width at every quality.
  const path: { x: number; y: number; z: number; slope: number; dx: number; dz: number }[] = []
  const unit = (i: number) => {
    const a = points[i], b = points[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z)
    return l > 1e-9 ? [(b.x - a.x) / l, (b.z - a.z) / l] : null
  }
  let before: number[] | null = null
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const run = Math.hypot(b.x - a.x, b.z - a.z)
    const slope = run > 0 ? Math.max(0, a.y - b.y) / run : 0
    const here = unit(i)
    if (!here) continue
    let jx = here[0], jz = here[1]
    if (before) { const nx = before[0] + here[0], nz = before[1] + here[1], l = Math.hypot(nx, nz); if (l > 1e-6) { jx = nx / l; jz = nz / l } }
    const n = Math.max(1, Math.ceil(run / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, slope, dx: k === 0 ? jx : here[0], dz: k === 0 ? jz : here[1] })
    }
    before = here
  }
  const last = points[points.length - 1]
  path.push({ x: last.x, y: last.y, z: last.z, slope: path.length ? path[path.length - 1].slope : 0, dx: before?.[0] ?? 1, dz: before?.[1] ?? 0 })

  // Where the river breaks: the change of slope along it, over about RIVER_CHURN_RUN metres either
  // side. A lip (gentle into steep), the foot of a fall (steep into gentle) and a step in a
  // cascade churn; an even slope, however steep, runs smooth between them.
  const reach = Math.max(1, Math.round(RIVER_CHURN_RUN / Math.max(0.5, step)))
  const mean = (from: number, to: number) => {
    let s = 0, n = 0
    for (let j = Math.max(0, from); j < Math.min(path.length, to); j++) { s += path[j].slope; n++ }
    return n ? s / n : 0
  }
  const churns = path.map((_, i) => Math.min(1, Math.max(0, (Math.abs(mean(i, i + reach) - mean(i - reach, i)) - 0.06) / 0.3)))

  const positions: number[] = []
  const uvs: number[] = []
  const bed: number[] = []
  const speed: number[] = []
  const slopes: number[] = []
  const churn: number[] = []
  const edge: number[] = []
  const index: number[] = []
  let distance = 0
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    const prev = path[Math.max(0, i - 1)]
    const next = path[Math.min(path.length - 1, i + 1)]
    const dx = p.dx
    const dz = p.dz
    const len = Math.hypot(dx, dz) || 1
    if (i) distance += Math.hypot(p.x - prev.x, p.z - prev.z)
    // Smooth the slope over neighbours so white water does not flicker segment to segment.
    const slope = (prev.slope + p.slope * 2 + next.slope) / 4
    // A centre sample keeps bank heights from making the entire channel look like foam.
    for (const offset of across) {
      const x = p.x - (dz / len) * offset
      const z = p.z + (dx / len) * offset
      const g = ground.heightAt(x, z)
      // Across the river itself the water is level at its surface, as physics floats things on
      // it (lavaSurfaceAt). Only the skirt beyond, on the banks, is laid on a bank lower than the
      // water, so the edge spills over rather than floating past it.
      const skirt = Math.abs(offset) > inner + 1e-6
      positions.push(x, skirt ? Math.min(p.y, g + RIVER_EDGE_CLEARANCE) : p.y, z)
      uvs.push(offset, distance)
      bed.push(g)
      speed.push(speedAt(slope))
      slopes.push(slope)
      churn.push(churns[i])
      edge.push(half - Math.abs(offset))
    }
    if (i) {
      const a = (i - 1) * cols
      for (let j = 0; j < cols - 1; j++) index.push(a + j, a + j + 1, a + j + cols, a + j + 1, a + j + cols + 1, a + j + cols)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('groundHeight', new THREE.Float32BufferAttribute(bed, 1))
  geometry.setAttribute('flowSpeed', new THREE.Float32BufferAttribute(speed, 1))
  geometry.setAttribute('slope', new THREE.Float32BufferAttribute(slopes, 1))
  geometry.setAttribute('churn', new THREE.Float32BufferAttribute(churn, 1))
  geometry.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * A disc of still water at `y` with the ground height under each vertex: rings about
 * `spacing` metres apart, each with as many vertices as keeps its arcs that long too, so waves
 * down to about four spacings can move it. Capped at MAX_STILL_VERTICES by widening the
 * spacing on a very large lake.
 */
export function buildStillSurface(ground: { heightAt(x: number, z: number): number }, x: number, y: number, z: number, radius: number, spacing = 3): THREE.BufferGeometry {
  // Vertex count is about pi r^2 / s^2.
  const s = Math.max(spacing, Math.sqrt((Math.PI * radius * radius) / MAX_STILL_VERTICES))
  const rings = Math.max(2, Math.ceil(radius / s))
  const positions: number[] = [x, y, z]
  const uvs: number[] = [x, z]
  const bed: number[] = [ground.heightAt(x, z)]
  const index: number[] = []
  let previous = [0]
  for (let r = 1; r <= rings; r++) {
    const rr = (radius * r) / rings
    const n = Math.max(8, Math.ceil((Math.PI * 2 * rr) / s))
    const ring: number[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr
      ring.push(positions.length / 3)
      positions.push(px, y, pz)
      uvs.push(px, pz)
      bed.push(ground.heightAt(px, pz))
    }
    // Stitch to the ring inside by walking both round together.
    let i = 0, j = 0
    const m = previous.length
    while (i < n || j < m) {
      const ai = (i / n), aj = (j / m)
      const ri = ring[i % n], pj = previous[j % m]
      if (j >= m || (i < n && ai + 0.5 / n <= aj + 0.5 / m)) { index.push(pj, ring[(i + 1) % n], ri); i++ }
      else { index.push(pj, previous[(j + 1) % m], ri); j++ }
    }
    previous = ring
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('groundHeight', new THREE.Float32BufferAttribute(bed, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

/** Most vertices one lake or pool may have. */
export const MAX_STILL_VERTICES = 40000
