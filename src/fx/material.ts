import type { Node, Texture } from 'three/webgpu'
import { Color, FrontSide, MeshBasicNodeMaterial, Vector2, Vector3, Vector4 } from 'three/webgpu'
import {
  Fn, If, cameraPosition, float, floor, fract, length, max, mix, modelWorldMatrix, positionGeometry, positionLocal, positionWorld, sin,
  smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import { NO_BED } from '../world/water/bed'
import { clipmapNodes } from '../world/water/clipmap'
import type { WaveSource } from '../world/water/surface'
import * as p from './params'
import { qualityLevel } from '../core/quality'

/** Smooth value noise keeps both backends on ordinary arithmetic and interpolation. */
const hash = (v: Node<'vec2'>) => fract(sin(v.dot(vec2(127.1, 311.7))).mul(43758.5453))
const noise = (v: Node<'vec2'>) => {
  const i = floor(v), f = fract(v), u = f.mul(f).mul(float(3).sub(f.mul(2)))
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y)
}

/** Every lava surface's `setSunk`, so the vehicle effects can thin them all at once. */
const sinkers = new Set<(at: { x: number; y: number; z: number } | null, radius?: number) => void>()
/** Thin the top layer of every lava surface round a sinking vehicle, or clear it with null. */
export function setLavaSunk(at: { x: number; y: number; z: number } | null, radius?: number): void {
  for (const set of sinkers) set(at, radius)
}

/** Swell components a lava surface carries (the liquid-feel lava field has four). */
const SWELL = 4

export interface LavaOptions {
  /** A ribbon whose uv is (across, along) in metres: the pattern flows along it. */
  river?: boolean
  /** Glow where the lava meets land, from the bed height texture (`setBed`). */
  shoreline?: boolean
  /** A surface to the horizon: the crack pattern fades into its average glow far away. */
  far?: boolean
  /** Drawn on the clipmap (clipmap.ts) at the sea level, not on its own mesh. */
  clipmap?: boolean
}

/**
 * Lava, alive. Unlit HDR colour, so it glows without lights and whatever the sun does.
 *
 *  - A dark crust drifting with the flow over molten lava, the pair domain-warped so the plates
 *    stretch and turn instead of sliding as one sheet. Cracks between plates open and close
 *    slowly, white-yellow at their hottest core.
 *  - Bubbles: here and there a dome of brighter melt swells over several seconds with a dark
 *    rim, then bursts in a ring of light.
 *  - The shore, from the same bed height texture the water uses (src/world/water/bed.ts): a
 *    bright rim where lava meets land that pulses and creeps in and out, and inside it a band of
 *    cooler, darker crust whose cracks re-melt and close again.
 *  - A slow, heavy swell from the shared wave field (`setWaveSource`).
 *  - Translucent round a vehicle sinking into it (`setSunk`), so it glows through the top layer.
 *
 * Pattern coordinates are world metres (`positionWorld.xz`), or for a river its own
 * across-and-along uv so the crust runs downstream.
 */
export function createLavaMaterial(options: LavaOptions | boolean = {}, legacyShoreline = false, legacyFar = false) {
  const o: LavaOptions = typeof options === 'boolean' ? { river: options, shoreline: legacyShoreline, far: legacyFar } : options
  const river = !!o.river
  const clock = uniform(0), speed = uniform(0), scale = uniform(0), crust = uniform(0), glow = uniform(0)
  // 0..1: turns the glow down when the camera's exposure is turned up at night, so lava stays
  // orange instead of burning out to white.
  const dim = uniform(1)
  /** 1 at Medium quality and up: the domain warp and the bubbles. */
  const detail = uniform(1)
  const direction = uniform(new Vector2()), molten = uniform(new Color()), altitude = uniform(0)
  const bedMap = texture(NO_BED)
  /** (1 / tile size, half a texel, height the texture is relative to). */
  const bedFrame = uniform(new Vector3(1 / 2048, 0, 0))
  const bedAt = (xz: Node<'vec2'>, vertex = false) => {
    const s = bedMap.sample(xz.mul(bedFrame.x).add(bedFrame.y.add(0.5)))
    return (vertex ? s.level(float(0)) : s).r.add(bedFrame.z)
  }
  /** A sinking vehicle: (x, y, z, radius); radius 0 when none. */
  const sunk = uniform(new Vector4(0, -1e6, 0, 0))
  // Swell: (kx, kz, phase, amplitude) per component and the shoaling numbers.
  const swell = Array.from({ length: SWELL }, () => uniform(new Vector4()))
  const shoalDepth = uniform(1.6), shoalFloor = uniform(0.35), shoalLip = uniform(0.3)
  let source: WaveSource | null = null
  const shoal = (d: Node<'float'>) => smoothstep(0, shoalLip, d).mul(shoalFloor.add(float(1).sub(shoalFloor).mul(smoothstep(0, shoalDepth, d))))
  const swellAt = (w: Node<'vec2'>, cell: Node<'float'>) => {
    let h: Node<'float'> = float(0)
    for (const u of swell) {
      const lengthOf = float(Math.PI * 2).div(vec2(u.x, u.y).length().max(1e-4))
      h = h.add(u.w.mul(smoothstep(cell.mul(3), cell.mul(5), lengthOf)).mul(sin(u.x.mul(w.x).add(u.y.mul(w.y)).add(u.z))))
    }
    return h
  }

  // Front side only: from above, a back face is the lava sea curving away past the horizon,
  // and no camera is ever under lava (ChaseCamera clamps every mode above it).
  const material = new MeshBasicNodeMaterial({ side: FrontSide })
  if (o.clipmap) {
    const grid = clipmapNodes()
    const w = grid.world
    material.positionNode = vec3(grid.local.x, swellAt(w, grid.fadeCell).mul(shoal(altitude.sub(bedAt(w, true)))), grid.local.y)
  } else {
    const spacing = uniform(3).onObjectUpdate(({ object }) => (object?.userData as { spacing?: number } | undefined)?.spacing ?? 3)
    const w = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz
    material.positionNode = positionLocal.add(vec3(0, swellAt(w, spacing).mul(shoal(positionGeometry.y.sub(bedAt(w, true)))), 0))
  }

  const metres = river ? uv() : positionWorld.xz
  const coordinates = metres.mul(scale)
  const offset = direction.mul(clock).mul(speed)
  // Domain warp: the flow bends round slow eddies. Medium and up only: at Low and below the
  // branch is skipped (a uniform branch costs nothing) so lava costs on a phone what it did.
  const warp = Fn(() => {
    const w = vec2(0, 0).toVar()
    If(detail.greaterThan(0.5), () => {
      w.assign(vec2(noise(coordinates.mul(0.35).add(clock.mul(0.02))), noise(coordinates.mul(0.35).add(vec2(5.2, 1.3)).sub(clock.mul(0.02)))).sub(0.5))
    })
    return w
  })()
  const q = coordinates.add(warp.mul(1.6)).sub(offset)
  const a = noise(q), b = noise(q.mul(2.17).add(offset.mul(0.43)))
  // A third, finer layer so the crust still has detail when a vehicle is sitting in it.
  const c = noise(q.mul(6.3).sub(offset.mul(1.7)))
  const field = a.mul(0.6).add(b.mul(0.26)).add(c.mul(0.14))
  // Cracks breathe: slowly wider and narrower across the surface.
  const open = noise(coordinates.mul(0.18).add(vec2(clock.mul(0.05), clock.mul(-0.04))))
  const width = float(0.2).sub(crust.mul(0.16)).mul(open.mul(0.8).add(0.55))
  const gap = field.sub(0.5).abs()
  let cracks: Node<'float'> = float(1).sub(smoothstep(float(0.02), width, gap))
  const core = float(1).sub(smoothstep(float(0), width.mul(0.35), gap))
  // Cooling crust glows faintly from below in patches.
  const ember = noise(q.mul(3.1)).pow(4).mul(0.18)

  // Bubbles (Medium and up), in world metres: one possible bubble per 6 m cell, about a third of cells active.
  const cellSize = 6
  const bubbles = Fn(() => {
    const out = vec2(0, 0).toVar()
    If(detail.greaterThan(0.5), () => {
      const g = positionWorld.xz.div(cellSize)
      const id = floor(g), f = fract(g)
      const h1 = hash(id), h2 = hash(id.add(17.1))
      const period = h1.mul(6).add(4)
      const phase = fract(clock.div(period).add(h1.mul(3.7)))
      const centre = vec2(hash(id.add(3.3)).mul(0.5).add(0.25), hash(id.add(9.1)).mul(0.5).add(0.25))
      const r = length(f.sub(centre)).mul(cellSize).mul(noise(f.mul(5).add(id)).mul(0.35).add(0.83))
      const radius = smoothstep(0, 0.85, phase).mul(1.25).add(0.2)
      const swelling = float(1).sub(smoothstep(0.86, 0.88, phase))
      const dome = float(1).sub(smoothstep(radius.mul(0.65), radius, r)).mul(swelling)
      const rimDark = smoothstep(radius.mul(0.7), radius, r).mul(float(1).sub(smoothstep(radius, radius.mul(1.25), r))).mul(swelling)
      const burstT = smoothstep(0.88, 1, phase)
      const ring = float(1).sub(smoothstep(0, 0.35, r.sub(radius.add(burstT.mul(2.5))).abs())).mul(float(1).sub(burstT)).mul(float(1).sub(swelling))
      const active = smoothstep(0.62, 0.66, h2)
      const bubbleNow = active.mul(max(dome.mul(0.85), ring.mul(1.4)))
      out.assign(vec2(bubbleNow, rimDark.mul(active)))
    })
    return out
  })()
  const bubble = bubbles.x
  const rimDarkNow = bubbles.y

  // The shore.
  let rim: Node<'float'> = float(0)
  if (o.shoreline) {
    const surfaceY = o.clipmap ? altitude : positionWorld.y
    const depth = surfaceY.sub(bedAt(positionWorld.xz))
    const creep = sin(clock.mul(0.5).add(noise(metres.mul(0.08)).mul(6.28))).mul(0.18).add(noise(metres.mul(0.4).add(clock.mul(0.1))).mul(0.2))
    rim = smoothstep(0.55, 0, depth.add(creep)).mul(smoothstep(-0.5, 0, depth))
      .mul(sin(clock.mul(1.3).add(metres.x.mul(0.21)).add(metres.y.mul(0.17))).mul(0.2).add(0.9))
    // Inside the rim a band of cooler crust whose cracks re-melt now and then.
    const band = smoothstep(0.35, 0.9, depth).mul(smoothstep(2.8, 1.4, depth))
    const remelt = smoothstep(0.7, 0.92, noise(coordinates.mul(0.7).add(clock.mul(0.08))))
    cracks = cracks.mul(float(1).sub(band.mul(0.8)).add(band.mul(remelt)))
  }

  const distance = positionWorld.sub(cameraPosition).length()
  const farFade = o.far ? smoothstep(250, 1400, distance) : float(0)
  const heatNear = max(max(cracks, bubble), rim)
  const heat = mix(heatNear, float(0.09), farFade).max(rim.mul(0.6))
  const hot = molten.mul(glow).mul(dim)
  const white = vec3(1, 0.62, 0.22).mul(glow).mul(dim).mul(1.25)
  const crustColour = vec3(0.09, 0.05, 0.045).mul(dim).add(hot.mul(ember.mul(float(1).sub(farFade))))
  const lit = mix(hot, white, max(core.mul(cracks), rim.mul(0.6)).mul(float(1).sub(farFade)))
  // Unlit HDR colour is emissive without adding any real lights or requiring sunlight.
  material.colorNode = mix(crustColour, lit, heat).mul(float(1).sub(rimDarkNow.mul(0.5)))
  // Round a sinking vehicle the top layer is thin enough to see it glow through.
  const nearSunk = smoothstep(sunk.w, sunk.w.mul(0.55), positionWorld.sub(sunk.xyz).length()).mul(sunk.w.greaterThan(0).select(1, 0))
  material.transparent = true
  material.depthWrite = true
  material.opacityNode = float(1).sub(nearSunk.mul(0.42))

  const update = (dt: number, level = 0, exposureDim = 1) => {
    dim.value = exposureDim
    detail.value = Math.round(qualityLevel.value) >= 2 ? 1 : 0
    clock.value += dt; speed.value = p.flowSpeed.value; scale.value = p.noiseScale.value
    crust.value = p.crustAmount.value; glow.value = p.glowIntensity.value; altitude.value = level
    direction.value.set(river ? 0 : Math.cos(p.flowDirection.value), river ? 1 : Math.sin(p.flowDirection.value))
    molten.value.setRGB(p.glowRed.value, p.glowGreen.value, p.glowBlue.value)
    const field = source?.() ?? null
    for (let i = 0; i < SWELL; i++) {
      const s = field?.components[i]
      swell[i].value.set(s ? s.kx : 0, s ? s.kz : 0, s ? s.phase : 0, s && s.active !== false ? s.amplitude : 0)
    }
    shoalDepth.value = Math.max(1e-3, field?.shoalDepth ?? 1)
    shoalFloor.value = field?.shoalFloor ?? 0
    shoalLip.value = Math.max(1e-3, field?.shoalLip ?? 1e-3)
  }
  const setBed = (bed: { texture: Texture; size: number; reference: number } | null) => {
    bedMap.value = bed?.texture ?? NO_BED
    bedFrame.value.set(1 / (bed?.size ?? 2048), bed ? 0.5 / (bed.texture.image as { width: number }).width : 0, bed?.reference ?? 0)
  }
  /** The shared field's swell for this surface's body. */
  const setWaveSource = (next: WaveSource | null) => { source = next }
  /** A vehicle sinking in this lava, or null: the top layer thins round it. */
  const setSunk = (at: { x: number; y: number; z: number } | null, radius = 3.2) => {
    if (at) sunk.value.set(at.x, at.y, at.z, radius)
    else sunk.value.w = 0
  }
  sinkers.add(setSunk)
  update(0)
  // Drawn first among transparent things, so flames and smoke over it are not overwritten.
  const renderOrder = -10
  return { material, update, setBed, setWaveSource, setSunk, renderOrder }
}
