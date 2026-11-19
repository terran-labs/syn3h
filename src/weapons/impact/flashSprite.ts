/**
 * The flash at a gear impact: a hot core and a soft halo, fully opaque at the centre, in the
 * colour it is given (ParticleBatch's tint). The exhaust glow sprite it replaced is a faint
 * violet haze, never above a tenth opaque, and a flash drawn with it could not be seen by day.
 */
import { float, smoothstep, vec3 } from 'three/tsl'
import type { Sprite } from '../../vehicles/effects/sprites'

export const flashSprite: Sprite = (p) => {
  const r = p.length().clamp(0, 1)
  const core = float(1).sub(smoothstep(0, 0.28, r)), halo = float(1).sub(r).pow(2.4)
  return { rgb: vec3(1, 1, 1).mul(core.mul(1.5).add(1)), alpha: core.add(halo.mul(0.55)).clamp(0, 1) }
}
