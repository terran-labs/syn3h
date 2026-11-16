import type { Node, Texture } from 'three/webgpu'
import { Color, DoubleSide, MeshBasicNodeMaterial, Vector2, Vector3 } from 'three/webgpu'
import { cameraPosition, float, floor, fract, max, mix, positionWorld, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl'
import { NO_BED } from '../world/water/bed'
import { clipmapNodes } from '../world/water/clipmap'
import * as p from './params'

/** Smooth value noise keeps both backends on ordinary arithmetic and interpolation. */
const hash = (v: Node<'vec2'>) => fract(sin(v.dot(vec2(127.1, 311.7))).mul(43758.5453))
const noise = (v: Node<'vec2'>) => {
  const i = floor(v), f = fract(v), u = f.mul(f).mul(float(3).sub(f.mul(2)))
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y)
}

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
 * Lava. Unlit HDR colour, so it glows without lights and whatever the sun does.
 *
 * Pattern coordinates are world metres (`positionWorld.xz`), or for a river its own
 * across-and-along uv so the crust runs downstream. Depth below the surface comes from the
 * same bed height texture the water uses (src/world/water/bed.ts), per pixel, so the shoreline
 * follows the land on the sea, the lake, the pools and the rivers alike.
 */
export function createLavaMaterial(options: LavaOptions | boolean = {}, legacyShoreline = false, legacyFar = false) {
  const o: LavaOptions = typeof options === 'boolean' ? { river: options, shoreline: legacyShoreline, far: legacyFar } : options
  const river = !!o.river
  const clock = uniform(0), speed = uniform(0), scale = uniform(0), crust = uniform(0), glow = uniform(0)
  // 0..1: turns the glow down when the camera's exposure is turned up at night, so lava stays
  // orange instead of burning out to white.
  const dim = uniform(1)
  const direction = uniform(new Vector2()), molten = uniform(new Color()), altitude = uniform(0)
  const bedMap = texture(NO_BED)
  /** (1 / tile size, half a texel, height the texture is relative to). */
  const bedFrame = uniform(new Vector3(1 / 2048, 0, 0))
  const coordinates = (river ? uv() : positionWorld.xz).mul(scale)
  const offset = direction.mul(clock).mul(speed)
  const a = noise(coordinates.sub(offset)), b = noise(coordinates.mul(2.17).add(offset.mul(0.43)))
  // A third, finer layer so the crust still has detail when a vehicle is sitting in it.
  const c = noise(coordinates.mul(6.3).sub(offset.mul(1.7)))
  const field = a.mul(0.6).add(b.mul(0.26)).add(c.mul(0.14))
  const cracks = float(1).sub(smoothstep(float(0.02), float(0.22).sub(crust.mul(0.18)), field.sub(0.5).abs()))
  // Depth of lava over the land under this pixel.
  const surfaceY = o.clipmap ? altitude : positionWorld.y
  const bed = bedMap.sample(positionWorld.xz.mul(bedFrame.x).add(bedFrame.y.add(0.5))).r.add(bedFrame.z)
  const depth = surfaceY.sub(bed)
  const edge = o.shoreline ? smoothstep(1.8, 0, depth.abs()).mul(0.4) : float(0)
  const distance = positionWorld.sub(cameraPosition).length()
  const heat = o.far ? max(mix(cracks, float(0.09), smoothstep(250, 1400, distance)), edge) : max(cracks, edge)
  const material = new MeshBasicNodeMaterial({ side: DoubleSide })
  if (o.clipmap) {
    const grid = clipmapNodes()
    material.positionNode = vec3(grid.local.x, 0, grid.local.y)
  }
  // Unlit HDR colour is emissive without adding any real lights or requiring sunlight.
  material.colorNode = mix(uniform(new Color(0x170d0c)), molten.mul(glow).mul(dim), heat)
  const update = (dt: number, level = 0, exposureDim = 1) => {
    dim.value = exposureDim
    clock.value += dt; speed.value = p.flowSpeed.value; scale.value = p.noiseScale.value
    crust.value = p.crustAmount.value; glow.value = p.glowIntensity.value; altitude.value = level
    direction.value.set(river ? 0 : Math.cos(p.flowDirection.value), river ? 1 : Math.sin(p.flowDirection.value))
    molten.value.setRGB(p.glowRed.value, p.glowGreen.value, p.glowBlue.value)
  }
  const setBed = (bed: { texture: Texture; size: number; reference: number } | null) => {
    bedMap.value = bed?.texture ?? NO_BED
    bedFrame.value.set(1 / (bed?.size ?? 2048), bed ? 0.5 / (bed.texture.image as { width: number }).width : 0, bed?.reference ?? 0)
  }
  update(0)
  return { material, update, setBed }
}
