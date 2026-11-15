/**
 * One water surface for the sea, the lake, the pools, the rivers and their waterfalls.
 *
 * The same node graph in three modes:
 *  - 'sea'   the shared swells from `seaWaves` move the vertices (the same sum of sines the
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
  abs, attribute, cameraPosition, cameraViewMatrix, color, cos, faceDirection, float, max, mix, modelWorldMatrix,
  mx_noise_float, normalize, positionGeometry, positionLocal, positionWorld, sin, smoothstep, texture, time, uniform, uv, vec2, vec3, vec4, renderGroup,
} from 'three/tsl'
import { SEA_COMPONENTS as WAVE_COUNT, seaWaves, waveScale } from './seaWaves'
import { rippleField } from './ripples'
import { waterChop, waterClarity, waterReflection } from './params'
import { prevailingWindStrength } from '../weather'

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
}

/**
 * Wind chop: short waves the sea mesh cannot carry as geometry, so they only tilt the light.
 * Each is [wavelength m, heading radians, steepness]. Headings cover the compass unevenly so
 * the pattern never lines up into a grid; steepness (amplitude times wavenumber) is what the
 * eye reads as roughness. Speeds follow deep water dispersion, like the swell.
 */
const CHOP: readonly [number, number, number][] = [
  [7.3, 0.35, 0.050], [4.1, -0.9, 0.055], [2.6, 1.7, 0.060],
  [1.7, -2.3, 0.060], [1.1, 2.9, 0.055], [0.7, -0.2, 0.045],
]

/** The terrain's height field as a texture, for depth under any pixel of any water surface. */
export interface WaterBed { texture: THREE.DataTexture; size: number; reference: number }

/**
 * The height field the terrain is drawn and driven on, as one wrapping half-float texture.
 *
 * The sea mesh has a vertex every ten metres or so. Depth interpolated across triangles that
 * size gives foam and shallows straight polygon edges. The height field has a sample every
 * four metres and the GPU interpolates it per pixel, so the shore follows the land. Heights
 * are stored relative to `reference` (the sea level), where half floats are finest.
 */
export function buildBedTexture(data: { heights: Float32Array; resolution: number; size: number }, reference: number): WaterBed {
  // The last row and column repeat the first on a wrapping tile.
  const n = data.resolution - 1
  const out = new Uint16Array(n * n)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) out[iz * n + ix] = THREE.DataUtils.toHalfFloat(Math.max(-60000, Math.min(60000, data.heights[iz * data.resolution + ix] - reference)))
  }
  const map = new THREE.DataTexture(out, n, n, THREE.RedFormat, THREE.HalfFloatType)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.magFilter = map.minFilter = THREE.LinearFilter
  map.generateMipmaps = false
  map.needsUpdate = true
  return { texture: map, size: data.size, reference }
}

/** Until a world is built: one texel far below any surface, so everything reads as deep. */
const NO_BED = (() => {
  const map = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(-1000)]), 1, 1, THREE.RedFormat, THREE.HalfFloatType)
  map.needsUpdate = true
  return map
})()

/** Cosine of the critical angle of water: the edge of Snell's window seen from below. */
const SNELL_COS = Math.cos(Math.asin(1 / 1.333))

const SHALLOW = 0x2fc4bd
const DEEP = 0x0a3562
const FOAM = 0xf4fbff

/** Refractive index of water squared: Snell's law for the ray that continues below. */
const IOR2 = 1.333 * 1.333

/** Metres of water a sight line crosses to reach the bed: deeper, and longer when oblique. */
function waterPath(depth: THREE.Node<'float'>) {
  const up = abs(normalize(cameraPosition.sub(positionWorld)).y)
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
export function waterOpacityNode(depth: THREE.Node<'float'>, foam: THREE.Node<'float'>) {
  const clarity = uniform(waterClarity.value).setGroup(renderGroup).onRenderUpdate(() => waterClarity.value)
  const view = normalize(cameraPosition.sub(positionWorld))
  const kept = waterPath(depth).mul(-2.3).div(clarity).exp()
  const mirror = float(1).sub(abs(view.y)).pow(5).mul(0.98).add(0.02)
  const above = max(float(1).sub(float(1).sub(mirror).mul(kept)), foam.mul(0.9))
  // From underwater, a clear Snell window and nearly opaque reflection outside its cone.
  const window = smoothstep(SNELL_COS - .14, SNELL_COS + .06, view.y.negate())
  return view.y.greaterThanEqual(0).select(above, mix(float(.98), float(.12), window))
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
  /** Total geometric amplitude, for normalising crest height. */
  const ampTotal = uniform(0)

  /** Chop strength: the slider times the wind (a calm still ruffles, a gale roughens). */
  const chop = uniform(1)
  const shallowColour = uniform(new THREE.Color(SHALLOW))
  const deepColour = uniform(new THREE.Color(DEEP))
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0, side: THREE.DoubleSide })
  configureWaterBlending(material)
  const p = positionWorld
  const bedMap = texture(NO_BED)
  /** (1 / tile size, half a texel, height the texture is relative to). */
  const bedFrame = uniform(new THREE.Vector3(1 / 2048, 0, 0))

  // Water depth at rest, two ways. Vertices carry the bed under them (`groundHeight`), which
  // is all the swell needs to shrink in the shallows. Pixels read the height field itself.
  const surfaceY = mode === 'sea' ? level : positionGeometry.y
  const vertexDepth = surfaceY.sub(attribute<'float'>('groundHeight', 'float'))
  const bedUv = vec2(p.x, p.z).mul(bedFrame.x).add(bedFrame.y.add(0.5))
  const depth = surfaceY.sub(bedMap.sample(bedUv).r.add(bedFrame.z))
  const shoal = mode === 'sea' ? smoothstep(0, shoalDepth, depth) : float(0)

  // Vertex: swell. World xz before the bend; the wave vectors fit the tile, so every image of
  // a chunk carries the same waves and the sea has no seam.
  if (mode === 'sea') {
    const w = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz
    let h: Sum = float(0)
    for (const u of wave) h = h.add(u.w.mul(sin(u.x.mul(w.x).add(u.y.mul(w.y)).add(u.z))))
    material.positionNode = positionLocal.add(vec3(0, h.mul(smoothstep(0, shoalDepth, vertexDepth)), 0))
  }

  // Fragment: slope of the swell, every component; the ones too short for the mesh fade with
  // distance so they do not shimmer.
  const dist = p.sub(cameraPosition).length()
  const near = smoothstep(500, 60, dist)
  let sx: Sum = float(0)
  let sz: Sum = float(0)
  let crest: Sum = float(0)
  if (mode === 'sea') {
    for (let i = 0; i < WAVE_COUNT; i++) {
      const u = wave[i]
      const arg = u.x.mul(p.x).add(u.y.mul(p.z)).add(u.z)
      // Geometric components at full strength, light-only ones fade out with distance.
      const a = u.w.add(shadeAmp[i].sub(u.w).mul(smoothstep(900, 150, dist)))
      const c = cos(arg).mul(a)
      sx = sx.add(c.mul(u.x))
      sz = sz.add(c.mul(u.y))
      crest = crest.add(sin(arg).mul(u.w))
    }
    sx = sx.mul(shoal)
    sz = sz.mul(shoal)
  }

  // Detail: small wind ripples near the camera, and on a river they run downstream.
  const flowSpeed = mode === 'river' ? attribute<'float'>('flowSpeed', 'float') : float(0)
  const steep = mode === 'river' ? attribute<'float'>('slope', 'float') : float(0)
  const drift = time.mul(0.6)
  let rx, rz
  if (mode === 'river') {
    // uv: x across the river in metres, y metres along it. Scroll downstream at the flow speed.
    const along = uv().y.sub(time.mul(flowSpeed))
    const q = vec3(uv().x.mul(0.6), along.mul(0.35), drift)
    rx = mx_noise_float(q)
    rz = mx_noise_float(q.add(vec3(17.3, 5.1, 0)))
  } else {
    const q = vec3(p.x.mul(0.3), p.z.mul(0.3), drift)
    rx = mx_noise_float(q)
    rz = mx_noise_float(q.add(vec3(17.3, 5.1, 0)))
  }
  // The simulated ripples round the camera (water.ripples): vehicle wakes and splashes. Zero
  // outside their window and while they are off. Seen in the lighting, on still water too.
  if (mode !== 'river') {
    const ripple = rippleField.rippleNormal(p.xz)
    sx = sx.sub(ripple.x.div(ripple.y))
    sz = sz.sub(ripple.z.div(ripple.y))
  }
  const rippleGain = mode === 'river' ? float(0.18).add(steep.mul(0.6)) : float(0.07)
  sx = sx.add(rx.mul(rippleGain).mul(near))
  sz = sz.add(rz.mul(rippleGain).mul(near))
  // Chop: sines are far cheaper than noise and give an exact slope. The noise above bends
  // their phase so crests wander instead of marching in ranks. Each fades out before it
  // would be smaller than a pixel, shortest first.
  let chopSlope: Sum = float(0)
  if (mode !== 'river') {
    let cx: Sum = float(0)
    let cz: Sum = float(0)
    const still = mode === 'still' ? 0.45 : 1
    for (const [length, heading, steepness] of CHOP) {
      const k = (Math.PI * 2) / length
      const dx = Math.cos(heading)
      const dz = Math.sin(heading)
      const arg = p.x.mul(k * dx).add(p.z.mul(k * dz)).add(time.mul(Math.sqrt(9.81 * k))).add(rx.mul(2.4)).add(rz.mul(1.3))
      const c = cos(arg).mul(steepness * still).mul(smoothstep(length * 45, length * 8, dist))
      cx = cx.add(c.mul(dx))
      cz = cz.add(c.mul(dz))
    }
    cx = cx.mul(chop)
    cz = cz.mul(chop)
    sx = sx.add(cx)
    sz = sz.add(cz)
    chopSlope = cx.mul(cx).add(cz.mul(cz)).sqrt()
  }

  // Lit as the slope says, flipped when seen from below.
  const worldNormal = normalize(vec3(sx.negate(), 1, sz.negate())).mul(faceDirection)
  material.normalNode = normalize(cameraViewMatrix.transformDirection(worldNormal))

  // Colour from above: shallows to deep by depth, lifted a little on the crests.
  const crestN = mode === 'sea' ? crest.div(max(ampTotal, 0.001)).mul(shoal) : float(0)
  // What the water itself sends back: the shallow tint where little of it lies along the
  // sight line, the deep colour once the line has crossed about a clarity's worth.
  const body = mix(shallowColour, deepColour, smoothstep(0.3, 16, waterPath(depth)))
  // Crests catch the light: a step toward the shallow colour, brightened.
  // Steep little faces let light through their thin tops: the same lift, from the chop.
  const lifted = mix(body, shallowColour.mul(1.15), max(smoothstep(0.2, 1, crestN).mul(0.35), smoothstep(0.05, 0.22, chopSlope).mul(0.3)))

  // Foam.
  const breakup = mx_noise_float(vec3(p.x.mul(0.12), p.z.mul(0.12), drift.mul(0.5))).mul(0.5).add(0.5)
  // The line where water meets land.
  // A thin broken edge that laps in and out, not a white apron: depth is now true per pixel.
  const lap = sin(time.mul(0.8).add(breakup.mul(9))).mul(0.08)
  let foam = smoothstep(0.42, 0.06, depth.add(rx.mul(0.18)).add(lap)).mul(smoothstep(-0.25, 0.02, depth)).mul(breakup.mul(0.6).add(0.4))
  // Pools and river banks shelve gently, so the same depth band is metres wide there: a
  // faint wet edge, not a white collar.
  if (mode !== 'sea') foam = foam.mul(mode === 'still' ? 0.35 : 0.5)
  if (mode === 'sea') {
    // Rolling lines running in to the shore: phase rises with depth so the bands travel toward
    // the coast, and they fade with depth and wherever the noise breaks them up.
    // Depth is interpolated across a coarse grid, so its contours zigzag: warp it with
    // smooth noise and keep the lines in the last couple of metres, where the grid is
    // closest to the coast and the lines are short.
    const warp = mx_noise_float(vec3(p.x.mul(0.045), p.z.mul(0.045), drift.mul(0.2))).mul(0.9)
    const lines = smoothstep(0.88, 0.99, sin(depth.add(warp).mul(1.7).add(time.mul(1.1))).mul(0.5).add(0.5))
    foam = max(foam, lines.mul(smoothstep(2.6, 0.5, depth)).mul(smoothstep(0.35, 0.75, breakup)).mul(0.7))
    // Whitecaps on the highest crests when the sea is rough.
    const rough = smoothstep(0.6, 2.2, ampTotal.mul(2))
    foam = max(foam, smoothstep(0.72, 0.95, crestN).mul(rough).mul(smoothstep(0.35, 0.8, breakup)))
  }
  if (mode === 'river') {
    // White water where the bed is steep: a cascade over a third of the run (the waterfall
    // threshold) and solid white on a falling sheet.
    const white = smoothstep(0.12, 0.5, steep)
    const streaks = mx_noise_float(vec3(uv().x.mul(1.4), uv().y.sub(time.mul(flowSpeed)).mul(0.25), drift)).mul(0.5).add(0.5)
    foam = max(foam, white.mul(smoothstep(0.25, 0.6, streaks).mul(0.6).add(white.mul(0.4))))
  }
  material.opacityNode = waterOpacityNode(depth, foam)
  const above = mix(lifted, color(FOAM), foam.mul(0.9))

  // From below: Snell's window. Looking up at the surface, `up` is the cosine between the
  // view ray and straight up.
  const up = normalize(p.sub(cameraPosition)).y
  const below = mix(deepColour.mul(0.55), color(0xbfe8f0), smoothstep(SNELL_COS - 0.14, SNELL_COS + 0.06, up))
  material.colorNode = mix(below, above, faceDirection.mul(0.5).add(0.5))
  // Glassy close up; rougher with distance, where many unresolved facets share a pixel and
  // a mirror would sparkle and alias.
  // Seen from below the surface is not a sky mirror (Snell's window above is the sky): fully
  // rough there, so the full-strength reflection capture cannot light the underside.
  const glassy = float(0.05).add(foam.mul(0.6)).add(abs(rx).mul(0.03)).add(smoothstep(80, 900, dist).mul(0.16))
  material.roughnessNode = mix(float(1), glassy, faceDirection.mul(0.5).add(0.5))
  // Roughness alone still lets the capture light the underside as a blurred blue sky. Under
  // water the surface outside Snell's window reflects the dark water below, so occlude nearly
  // all ambient and reflected light there and leave the top exactly as it is.
  material.aoNode = mix(float(0.1), float(1), faceDirection.mul(0.5).add(0.5))

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
    update(l: number) {
      level.value = l
      chop.value = waterChop.value * (0.55 + 0.9 * prevailingWindStrength())
      if (mode !== 'sea') return
      const set = seaWaves.waves
      const ph = seaWaves.phasesNow()
      let total = 0
      for (let i = 0; i < WAVE_COUNT; i++) {
        const c = set.components[i]
        const on = seaWaves.enabled && c ? waveScale() : 0
        const geo = c && !c.lightOnly ? c.amplitude * on : 0
        wave[i].value.set(c ? c.kx : 0, c ? c.kz : 0, ph[i] ?? 0, geo)
        shadeAmp[i].value = c ? c.amplitude * on : 0
        total += geo
      }
      ampTotal.value = total
      shoalDepth.value = Math.max(0.5, set.dominantLength * 0.1)
    },
  }
}

/** Sample count per metre of river when rebuilding a ribbon: fine enough for falls. */
const RIVER_STEP = 3
/** Highest a ribbon edge may stand above the bank under it, metres. */
const RIVER_EDGE_CLEARANCE = 0.25

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
): THREE.BufferGeometry {
  // Resample along the path.
  const path: { x: number; y: number; z: number; slope: number }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const run = Math.hypot(b.x - a.x, b.z - a.z)
    const slope = run > 0 ? Math.max(0, a.y - b.y) / run : 0
    const n = Math.max(1, Math.ceil(run / RIVER_STEP))
    for (let k = 0; k < n; k++) {
      const t = k / n
      path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, slope })
    }
  }
  const last = points[points.length - 1]
  path.push({ x: last.x, y: last.y, z: last.z, slope: path.length ? path[path.length - 1].slope : 0 })

  const positions: number[] = []
  const uvs: number[] = []
  const bed: number[] = []
  const speed: number[] = []
  const slopes: number[] = []
  const index: number[] = []
  let distance = 0
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    const prev = path[Math.max(0, i - 1)]
    const next = path[Math.min(path.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dz = next.z - prev.z
    const len = Math.hypot(dx, dz) || 1
    if (i) distance += Math.hypot(p.x - prev.x, p.z - prev.z)
    // Smooth the slope over neighbours so white water does not flicker segment to segment.
    const slope = (prev.slope + p.slope * 2 + next.slope) / 4
    // A centre sample keeps bank heights from making the entire channel look like foam.
    for (const side of [-1, 0, 1]) {
      const x = p.x - (dz / len) * (width / 2) * side
      const z = p.z + (dx / len) * (width / 2) * side
      const g = ground.heightAt(x, z)
      // A bank lower than the water would leave the edge hanging in the air: lay it on the
      // bank instead, so the surface spills over rather than floating past it.
      positions.push(x, side ? Math.min(p.y, g + RIVER_EDGE_CLEARANCE) : p.y, z)
      uvs.push((side * width) / 2, distance)
      bed.push(g)
      speed.push(speedAt(slope))
      slopes.push(slope)
    }
    if (i) {
      const a = (i - 1) * 3
      for (let j = 0; j < 2; j++) index.push(a + j, a + j + 1, a + j + 3, a + j + 1, a + j + 4, a + j + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('groundHeight', new THREE.Float32BufferAttribute(bed, 1))
  geometry.setAttribute('flowSpeed', new THREE.Float32BufferAttribute(speed, 1))
  geometry.setAttribute('slope', new THREE.Float32BufferAttribute(slopes, 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

/** A flat disc of still water at `y` with the ground height under each vertex. */
export function buildStillSurface(ground: { heightAt(x: number, z: number): number }, x: number, y: number, z: number, radius: number): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(radius, 48, 0, Math.PI * 2)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(x, y, z)
  const pos = geometry.attributes.position
  const uvAttr = geometry.attributes.uv
  const bed: number[] = []
  for (let i = 0; i < pos.count; i++) {
    uvAttr.setXY(i, pos.getX(i), pos.getZ(i))
    bed.push(ground.heightAt(pos.getX(i), pos.getZ(i)))
  }
  geometry.setAttribute('groundHeight', new THREE.Float32BufferAttribute(bed, 1))
  return geometry
}
