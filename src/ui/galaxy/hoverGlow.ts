/**
 * The lobby's planet glow: a lively aura dancing round the limb of the world the player is
 * pointing at (or at its label), has focused from the keyboard, or is pressing on a touch
 * screen; a steadier, slightly stronger one round the world chosen and being flown to. One
 * world at a time. Drawn in the galaxy's own shader from noise round the limb (GLOW_GLSL), in
 * a colour from the world itself, so each glow is its own. No images.
 *
 * This module holds the parameters, which world glows, how strongly (eased in quickly, out a
 * little slower) and its colour; Galaxy.ts feeds it the pointer and focus and draws it.
 */
import { defineParam } from '../../../shared/params'

export const hoverGlowIntensity = defineParam({ id: 'lobby.hoverGlow', label: 'Lobby planet glow: intensity (0 off)', group: 'Graphics', scope: 'client', default: 1, min: 0, max: 2, step: 0.05 })
export const hoverGlowSpeed = defineParam({ id: 'lobby.hoverGlowSpeed', label: 'Lobby planet glow: speed', group: 'Graphics', scope: 'client', default: 1, min: 0, max: 3, step: 0.05 })

/** Seconds to come in, and to go. */
const IN_SECONDS = 0.12, OUT_SECONDS = 0.28

export interface GlowWants {
  /** A finger down on this world (touch has no hover). */
  pressed?: string | null
  /** The pointer over this world or its label. */
  hovered?: string | null
  /** Keyboard focus on this world's label. */
  focused?: string | null
  /** The world chosen and being flown to. */
  chosen?: string | null
}
/** Which world glows, and whether it is the chosen one's steadier glow. Pressed, then hovered, then focused, then chosen. */
export function glowTarget(wants: GlowWants): { id: string; chosen: boolean } | null {
  const id = wants.pressed ?? wants.hovered ?? wants.focused ?? null
  if (id) return { id, chosen: id === wants.chosen }
  return wants.chosen ? { id: wants.chosen, chosen: true } : null
}

/**
 * The glow's state from frame to frame. Only one world glows: a new target waits for the old
 * glow to go before its own comes in, so two never show at once.
 */
export class GlowState {
  id: string | null = null
  strength = 0
  chosen = false
  /** Steps toward `target`; returns true while the glow is changing. */
  step(target: { id: string; chosen: boolean } | null, dt: number): boolean {
    const before = this.strength
    if (target && target.id === this.id) {
      this.chosen = target.chosen
      this.strength = Math.min(1, this.strength + dt / IN_SECONDS)
    } else {
      this.strength = Math.max(0, this.strength - dt / OUT_SECONDS)
      if (this.strength === 0) { this.id = target?.id ?? null; this.chosen = target?.chosen ?? false }
    }
    return this.strength !== before || (target !== null && target.id !== this.id)
  }
}

/** A world's glow colour: its land and sea mixed, saturated and brightened. Display RGB 0 to 1. */
export function glowColour(land: number, sea: number, kind: { forming?: boolean; glow?: boolean }): [number, number, number] {
  if (kind.forming) return [1, 0.55, 0.2]
  const rgb = (c: number) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]
  const a = rgb(land), b = rgb(sea), mix = a.map((v, i) => kind.glow ? b[i] * 0.7 + v * 0.3 : v * 0.55 + b[i] * 0.45)
  const top = Math.max(...mix, 1e-3), mean = mix.reduce((s, v) => s + v, 0) / 3
  // Push away from grey, then lift so the brightest channel is full.
  const vivid = mix.map(v => Math.max(0, mean + (v - mean) * 1.6) / top)
  const lift = Math.max(...vivid, 1e-3)
  return vivid.map(v => Math.min(1, (v / lift) * 0.85 + 0.15)) as [number, number, number]
}

/**
 * GLSL for the galaxy's fragment shader, before main: the glow's uniforms and planetGlow, the
 * glow at a pixel (colour, and how much: the caller lays it over what is there and adds a
 * little, so it reads against the sun's shafts as well as dark space) at a pixel whose ray passes `index`'s world, just outside its disc, unless a
 * nearer world is in the way (`nearest`, `found`). uGlow: strength, speed, steadiness (1 still:
 * reduced motion; part way for the chosen world), intensity (with the chosen world's boost).
 */
export const GLOW_GLSL = `
uniform int uGlowIndex; uniform vec4 uGlow; uniform vec3 uGlowColour; uniform float uGlowTime;
// The aura round world \`index\` at this pixel, before its colour and strength. Shared by the
// hover glow and the lobby's resting pulses (idlePulse.ts), so the two are one effect.
float glowAura(int index, vec3 ray, float nearest, int found, float steady, float speed) {
  vec4 w = uWorld[index];
  vec3 oc = uEye - w.xyz; float along = -dot(oc, ray);
  if (along <= 0.0 || (found >= 0 && found != index && nearest < along)) return 0.0;
  vec3 off = oc + ray * along;                                   // from the centre to the ray's closest pass
  float miss = length(off) - w.w;
  if (miss <= 0.0 || miss > w.w * 1.1) return 0.0;
  // Round the limb, in screen terms, so the tongues stay put as the world turns.
  float angle = atan(dot(off, uUp), dot(off, uRight));
  // Its own clock, so it dances even while the orbits are held still.
  float t = uGlowTime * speed * (1.0 - steady);
  vec2 round = vec2(cos(angle), sin(angle));
  // Tongues of light: two layers of noise flowing round the limb at different speeds.
  float tongues = noise(vec3(round * 2.3, t * 0.9)) * 0.62 + noise(vec3(round * 5.5 + 7.0, t * 1.8)) * 0.38;
  tongues = mix(tongues, 0.55, steady * 0.7);
  float reach = w.w * (0.14 + 0.4 * tongues);
  float flicker = 1.0 + 0.18 * sin(t * 6.0 + angle * 5.0) * (1.0 - steady);
  // Gone well before the edge of the search, so that edge never shows as a ring.
  return exp(-miss / reach) * smoothstep(0.0, w.w * 0.02, miss) * (1.0 - smoothstep(w.w * 0.55, w.w * 1.05, miss)) * (0.5 + tongues) * flicker;
}
vec4 planetGlow(vec3 ray, float nearest, int found) {
  if (uGlowIndex < 0 || uGlow.x <= 0.001) return vec4(0.0);
  return vec4(uGlowColour, glowAura(uGlowIndex, ray, nearest, found, uGlow.z, uGlow.y) * uGlow.x * uGlow.w);
}`
