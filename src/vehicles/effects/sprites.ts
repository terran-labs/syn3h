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
/**
 * Alpha over a ribbon quad: `u` 0 to 1 across the mark, `v` 0 to 1 along the quad, `tread` the
 * per-quad surface response (0 a scuff, 1 a deep print).
 */
export type MarkAlpha = (u: N, v: N, tread: N) => N

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
 * Tyre mark alpha across a ribbon quad. `u` runs across the mark, `v` along it (0 to 1 over
 * each quad) and `tread` says what the ground does with a tyre (see treads.ts): 1 is a deep
 * print in soft ground, with strong ribs and chevron lug blocks; 0 is a scuff on hard ground,
 * with no pattern, soft edges and a broken, patchy body. One shader draws every surface, so
 * the marks stay a single draw call.
 *
 * The old skidmark.png had alpha 1 everywhere, so marks drew as flat bands with hard edges. The
 * ribs and lugs fade out once they get finer than a few pixels, so distant marks do not shimmer.
 */
export const tyreMarkAlpha: MarkAlpha = (u, v, tread) => {
  // A print has a firm edge; a scuff feathers out over a third of its width.
  const edge = mix(float(.34), float(.16), tread)
  const shoulders = smoothstep(0, edge, u).mul(float(1).sub(smoothstep(float(1).sub(edge), 1, u)))
  const ribs = 6, wave = fract(u.mul(ribs)).sub(.5).abs().mul(2)
  const ribFade = float(1).sub(smoothstep(.12, .35, fwidth(u).mul(ribs)))
  const ribDepth = mix(float(.06), float(.42), tread)
  const rib = mix(float(1), float(1).sub(ribDepth).add(smoothstep(.15, .6, wave).mul(ribDepth)), ribFade)
  // Lug blocks: three chevrons to a quad, pointing along the mark. A whole number, so the
  // pattern runs on from one quad into the next.
  const lugs = 3, chevron = fract(v.mul(lugs).add(u.sub(.5).abs().mul(1.4)))
  const lugFade = float(1).sub(smoothstep(.12, .35, fwidth(v).mul(lugs)))
  const lug = mix(float(1), smoothstep(0, .14, chevron).mul(float(1).sub(smoothstep(.62, .78, chevron))).mul(.55).add(.45), tread.mul(lugFade))
  // World-anchored patchiness: slight on a print, heavy on a scuff, which comes and goes.
  const amount = mix(float(.5), float(.12), tread)
  const patch = mx_noise_float(vec3(positionWorld.xz.mul(1.4), 0)).mul(amount).add(float(1).sub(amount.mul(.5))).clamp(0, 1.1)
  return shoulders.mul(rib).mul(lug).mul(patch)
}

/** Per particle seed from its birth time and buffer slot, two values in 0 to 1. */
export function particleSeed(birth: N, slot: N): N {
  return fract(vec2(birth.mul(.7548).add(slot.mul(.1347)), birth.mul(.5698).add(slot.mul(.2718))))
}

/**
 * Brightness for unlit, normally blended effects (dust and tyre marks). The scene's lights do not reach a
 * sprite, so without this a tinted puff glows at night. It follows the same night ramp as the
 * vehicle night fill and keeps a fifth of its daytime brightness in full dark, which reads as
 * dust caught by headlights and moonlight. One render-group uniform, no per-frame allocation.
 */
export function unlitShadeNode(): N {
  return uniform(1).setGroup(renderGroup).onRenderUpdate(frame => 1 - .8 * vehicleNightAmount(frame.scene as T.Scene))
}
