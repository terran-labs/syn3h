/**
 * Shader-generated looks for the shared effect batches. These replace the four effect images
 * (dust.png, plasma-green.png, plasma-red.png and thruster-glow.png as a particle) and the
 * tyre mark (skidmark.png), so the effects load no image at all. See AGENTS.md: generate it,
 * do not ship it.
 *
 * Every look is a few noise calls on the sprite's own coordinates. Each particle gets its own
 * pattern from its birth time and slot, so a cloud of them no longer repeats one stamp, and the
 * pattern drifts slowly as the particle ages, so a puff billows instead of sliding.
 *
 * Colours are written in linear space, measured from the original images after the sRGB decode
 * the old loader applied, so the tints that callers pass keep their meaning.
 */
import {float,fract,fwidth,mix,mx_fractal_noise_float,mx_noise_float,positionWorld,renderGroup,smoothstep,uniform,vec2,vec3} from 'three/tsl'
import type * as T from 'three/webgpu'
import {vehicleNightAmount} from '../skins/nightReadability'

// TSL nodes are dynamically typed; showroom.ts uses the same alias.
type N = any // eslint-disable-line @typescript-eslint/no-explicit-any

/** What a particle sprite looks like at sprite position `p` (-1 to 1 across the quad). */
export interface SpriteLook { rgb: N; alpha: N }
/**
 * Builds a sprite look. `seed` is a per particle vec2 in 0 to 1, `age` its age in seconds and
 * `octaves` the noise detail, 1 at the safe graphics level and 2 or 3 above it.
 */
export type Sprite = (p: N, seed: N, age: N, octaves: number) => SpriteLook
/** Alpha across a ribbon quad from its u coordinate, 0 to 1 across the mark. */
export type MarkAlpha = (u: N) => N

/**
 * Soft, irregular dust puff. The old dust.png peaked at alpha .29 with a lumpy edge.
 *
 * Its colour channels were black, so every puff drew black whatever tint the caller passed
 * (brown for wheel dust, the sampled ground colour for hovercraft dust). This one is near white
 * with a little noise shading for volume, so the tint now shows. That is a deliberate fix.
 */
export const dustSprite: Sprite = (p, seed, age, octaves) => {
  const n = mx_fractal_noise_float(vec3(p.mul(2.1).add(seed.mul(41)), age.mul(.7)), octaves, 2, .5)
  const r = p.length().add(n.mul(.38))
  const body = float(1).sub(smoothstep(.12, .95, r))
  return { rgb: vec3(n.mul(.3).add(.88)), alpha: body.mul(n.mul(.5).add(.8).clamp(.35, 1.15)).mul(.31) }
}

/**
 * Plasma burst after plasma-green.png and plasma-red.png: a lumpy ball, saturated at the rim and
 * white hot in the core. The two images were one picture with red and green swapped, so one
 * ramp serves both. `red` picks which channel carries the colour.
 */
export function plasmaSprite(red: boolean): Sprite {
  return (p, seed, age, octaves) => {
    const n = mx_fractal_noise_float(vec3(p.mul(2.6).add(seed.mul(53)), age.mul(1.6)), octaves, 2, .55)
    const heat = float(1).sub(smoothstep(.05, .92, p.length().add(n.mul(.32)))).mul(n.mul(.35).add(1))
    const main = heat.mul(1.7).clamp(0, 1), white = heat.pow(3).mul(1.15).clamp(0, 1)
    return { rgb: red ? vec3(main, white, white.mul(.92)) : vec3(white.mul(.95), main, white), alpha: float(1) }
  }
}

/**
 * Thruster and exhaust glow, after the HoverGlow image (thruster-glow.png): a faint violet haze,
 * alpha never above about .1, now with a soft round body and a small hot core. Mean coverage
 * matches the old image's .028, so additive exhaust is no brighter overall than it was.
 */
export const glowSprite: Sprite = (p, seed, age, octaves) => {
  const n = mx_fractal_noise_float(vec3(p.mul(1.8).add(seed.mul(29)), age.mul(2.2)), octaves, 2, .5)
  const r = p.length().add(n.mul(.22)).clamp(0, 1)
  const body = float(1).sub(r).pow(1.5), core = float(1).sub(smoothstep(0, .35, r))
  return { rgb: mix(vec3(.42, .09, .85), vec3(1, .85, 1), core.mul(.6)), alpha: body.mul(n.mul(.6).add(.9).clamp(.4, 1.3)).mul(.16) }
}

/**
 * Tyre mark alpha across a ribbon quad: soft shoulders, tread ribs running along the mark and a
 * low, world-anchored patchiness so a long mark is not one flat band. `u` runs across the mark.
 *
 * The old skidmark.png had alpha 1 everywhere, so marks drew as flat bands with hard edges. The
 * ribs fade out once they get finer than a few pixels, so distant marks do not shimmer.
 */
export const tyreMarkAlpha: MarkAlpha = u => {
  const shoulders = smoothstep(0, .2, u).mul(float(1).sub(smoothstep(.8, 1, u)))
  const ribs = 6, wave = fract(u.mul(ribs)).sub(.5).abs().mul(2)
  const ribFade = float(1).sub(smoothstep(.12, .35, fwidth(u).mul(ribs)))
  const rib = mix(float(1), smoothstep(.15, .6, wave).mul(.28).add(.72), ribFade)
  const patch = mx_noise_float(vec3(positionWorld.xz.mul(1.4), 0)).mul(.12).add(.94)
  return shoulders.mul(rib).mul(patch)
}

/** Per particle seed from its birth time and buffer slot, two values in 0 to 1. */
export function particleSeed(birth: N, slot: N): N {
  return fract(vec2(birth.mul(.7548).add(slot.mul(.1347)), birth.mul(.5698).add(slot.mul(.2718))))
}

/**
 * Brightness for unlit, normally blended sprites (dust). The scene's lights do not reach a
 * sprite, so without this a tinted puff glows at night. It follows the same night ramp as the
 * vehicle night fill and keeps a fifth of its daytime brightness in full dark, which reads as
 * dust caught by headlights and moonlight. One render-group uniform, no per-frame allocation.
 */
export function unlitShadeNode(): N {
  return uniform(1).setGroup(renderGroup).onRenderUpdate(frame => 1 - .8 * vehicleNightAmount(frame.scene as T.Scene))
}
