import type { Node } from 'three/webgpu'
import { Color, DoubleSide, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu'
import { attribute, float, floor, fract, mix, sin, smoothstep, uniform, uv, vec2 } from 'three/tsl'
import * as p from './params'

/** Smooth value noise keeps both backends on ordinary arithmetic and interpolation. */
const hash = (v: Node<'vec2'>) => fract(sin(v.dot(vec2(127.1, 311.7))).mul(43758.5453))
const noise = (v: Node<'vec2'>) => {
  const i = floor(v), f = fract(v), u = f.mul(f).mul(float(3).sub(f.mul(2)))
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y)
}
export function createLavaMaterial(river = false, shoreline = false) {
  const clock = uniform(0), speed = uniform(0), scale = uniform(0), crust = uniform(0), glow = uniform(0)
  const direction = uniform(new Vector2()), molten = uniform(new Color()), altitude = uniform(0)
  const coordinates = uv().mul(scale)
  const offset = direction.mul(clock).mul(speed)
  const a = noise(coordinates.sub(offset)), b = noise(coordinates.mul(2.17).add(offset.mul(0.43)))
  const field = a.mul(0.72).add(b.mul(0.28))
  const cracks = float(1).sub(smoothstep(float(0.02), float(0.22).sub(crust.mul(0.18)), field.sub(0.5).abs()))
  const edge = shoreline ? float(1).sub(smoothstep(0, 1.8, altitude.sub(attribute('groundHeight', 'float')).abs())).mul(0.4) : float(0)
  const heat = cracks.max(edge)
  const material = new MeshBasicNodeMaterial({ side: DoubleSide })
  // Unlit HDR colour is emissive without adding any real lights or requiring sunlight.
  material.colorNode = mix(uniform(new Color(0x170d0c)), molten.mul(glow), heat)
  const update = (dt: number, level = 0) => {
    clock.value += dt; speed.value = p.flowSpeed.value; scale.value = p.noiseScale.value
    crust.value = p.crustAmount.value; glow.value = p.glowIntensity.value; altitude.value = level
    direction.value.set(river ? 0 : Math.cos(p.flowDirection.value), river ? 1 : Math.sin(p.flowDirection.value))
    molten.value.setRGB(p.glowRed.value, p.glowGreen.value, p.glowBlue.value)
  }
  update(0)
  return { material, update }
}
