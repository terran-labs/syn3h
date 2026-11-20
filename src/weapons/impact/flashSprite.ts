/**
 * The flash at a gear impact: a small intense core and a short soft falloff, in the colour it
 * is given (ParticleBatch's tint), the brightest moment of an impact, which bloom spreads. The
 * exhaust glow sprite it replaced is a faint violet haze, never above a tenth opaque, and a
 * flash drawn with it could not be seen by day.
 */
import { float, smoothstep, vec3 } from 'three/tsl'
import type { Sprite } from '../../vehicles/effects/sprites'

export const flashSprite: Sprite = (p) => {
  const r = p.length().clamp(0, 1)
  const core = float(1).sub(smoothstep(0, 0.16, r)), halo = float(1).sub(r).pow(3)
  return { rgb: vec3(1, 1, 1).mul(core.mul(2.5).add(1)), alpha: core.add(halo.mul(0.6)).clamp(0, 1) }
}
