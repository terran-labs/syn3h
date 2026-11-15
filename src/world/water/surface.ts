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
  mx_noise_float, normalize, positionGeometry, positionLocal, positionWorld, sin, smoothstep, time, uniform, uv, vec3, vec4,
} from 'three/tsl'
import { WAVE_COUNT } from '../../../shared/water/waves'
import { seaWaves } from './seaWaves'
import { rippleField } from './ripples'

/** A float node that sums are folded into. TSL's operator typings do not narrow through a loop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sum = any

export type WaterMode = 'sea' | 'still' | 'river'

export interface WaterSurface {
  material: THREE.MeshStandardNodeMaterial
  /** Per frame: sea level and, for the sea, the current wave phases. */
  update(level: number): void
}

/** Cosine of the critical angle of water: the edge of Snell's window seen from below. */
const SNELL_COS = Math.cos(Math.asin(1 / 1.333))

const SHALLOW = 0x2fc4bd
const DEEP = 0x0a3562
const FOAM = 0xf4fbff

export function createWaterSurface(mode: WaterMode): WaterSurface {
  const level = uniform(0)
  // Wave i: (kx, kz, phase, geometric amplitude) and the amplitude used for shading.
  const wave = Array.from({ length: WAVE_COUNT }, () => uniform(new THREE.Vector4()))
  const shadeAmp = Array.from({ length: WAVE_COUNT }, () => uniform(0))
  /** Depth over which waves grow from nothing to full: a tenth of the dominant wavelength. */
  const shoalDepth = uniform(6)
  /** Total geometric amplitude, for normalising crest height. */
  const ampTotal = uniform(0)

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0, side: THREE.DoubleSide })
  const ground = attribute<'float'>('groundHeight', 'float')
  const p = positionWorld

  // Water depth at rest. Rivers carry their own bed height, as does the sea.
  const depth = level.sub(ground)
  const shoal = mode === 'sea' ? smoothstep(0, shoalDepth, depth) : float(0)

  // Vertex: swell. World xz before the bend; the wave vectors fit the tile, so every image of
  // a chunk carries the same waves and the sea has no seam.
  if (mode === 'sea') {
    const w = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz
    let h: Sum = float(0)
    for (const u of wave) h = h.add(u.w.mul(sin(u.x.mul(w.x).add(u.y.mul(w.y)).add(u.z))))
    material.positionNode = positionLocal.add(vec3(0, h.mul(shoal), 0))
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

  // Lit as the slope says, flipped when seen from below.
  const worldNormal = normalize(vec3(sx.negate(), 1, sz.negate())).mul(faceDirection)
  material.normalNode = normalize(cameraViewMatrix.transformDirection(worldNormal))

  // Colour from above: shallows to deep by depth, lifted a little on the crests.
  const crestN = mode === 'sea' ? crest.div(max(ampTotal, 0.001)).mul(shoal) : float(0)
  const body = mix(color(SHALLOW), color(DEEP), smoothstep(0.5, 22, depth))
  const lifted = mix(body, color(0x3fd6c8), smoothstep(0.2, 1, crestN).mul(0.35))

  // Foam.
  const breakup = mx_noise_float(vec3(p.x.mul(0.12), p.z.mul(0.12), drift.mul(0.5))).mul(0.5).add(0.5)
  // The line where water meets land.
  let foam = smoothstep(1.3, 0.15, depth.add(rx.mul(0.4))).mul(smoothstep(-0.6, 0.1, depth))
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
  const above = mix(lifted, color(FOAM), foam.mul(0.9))

  // From below: Snell's window. Looking up at the surface, `up` is the cosine between the
  // view ray and straight up.
  const up = normalize(p.sub(cameraPosition)).y
  const below = mix(color(DEEP).mul(0.55), color(0xbfe8f0), smoothstep(SNELL_COS - 0.04, SNELL_COS + 0.04, up))
  material.colorNode = mix(below, above, faceDirection.mul(0.5).add(0.5))
  material.roughnessNode = float(0.08).add(foam.mul(0.6)).add(abs(rx).mul(0.04))

  return {
    material,
    update(l: number) {
      level.value = l
      if (mode !== 'sea') return
      const set = seaWaves.waves
      const ph = seaWaves.phasesNow()
      let total = 0
      for (let i = 0; i < WAVE_COUNT; i++) {
        const c = set.components[i]
        const on = seaWaves.enabled && c ? 1 : 0
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
    for (const side of [-1, 1]) {
      const x = p.x - (dz / len) * (width / 2) * side
      const z = p.z + (dx / len) * (width / 2) * side
      positions.push(x, p.y, z)
      uvs.push((side * width) / 2, distance)
      bed.push(ground.heightAt(x, z))
      speed.push(speedAt(slope))
      slopes.push(slope)
    }
    if (i) {
      const a = (i - 1) * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
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
