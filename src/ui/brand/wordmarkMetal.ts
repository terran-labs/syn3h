/**
 * The lobby name as polished metal: gold, white, or anything between, lit by the sun at the
 * middle of the system. The shading is in the galaxy's shader (Galaxy.ts, where uMarkSolid is
 * read); this file holds its settings as parameters, so each can be tuned live and saved.
 *
 * The face is flat, so its shine comes from a normal the shader makes up: a bevel that rolls off
 * toward every edge, and slow ripples across the face. Lit from the sun's place, highlights sit
 * where the face turns toward the sun and drift as the ripples move; the sun's shafts brighten
 * whatever they cross; a glint sweeps over the name now and then.
 */
import { defineParam } from '../../../shared/params'

const knob = (id: string, label: string, value: number, min: number, max: number, step = 0.01) =>
  defineParam({ id: `lobby.logo.${id}`, label, lobbyGroup: 'Mira name', group: 'Lobby logo', scope: 'client', default: value, min, max, step })

/** Defaults are the owner's first approved settings (24 November 2026): a pale, mostly white gold, softly lit, with broad slow ripples and strong light from the shafts. */
export const METAL = {
  white: knob('white', 'Gold (0) to white (1)', 0.72, 0, 1),
  brightness: knob('brightness', 'Brightness of the sun on the face', 0.52, 0, 3),
  ambient: knob('ambient', 'Light in the shade', 0.28, 0, 1),
  colour: knob('colour', 'Colour strength', 1.37, 0, 1.5),
  bevel: knob('bevel', 'Bevel width', 0, 0, 0.14, 0.001),
  bevelDepth: knob('bevelDepth', 'Bevel depth', 0.23, 0, 3),
  shine: knob('shine', 'Highlight strength', 0.38, 0, 3),
  gloss: knob('gloss', 'Highlight tightness', 39, 2, 160, 1),
  ripple: knob('ripple', 'Ripple strength', 0.66, 0, 1.5),
  rippleScale: knob('rippleScale', 'Ripple fineness', 1, 1, 30, 0.1),
  rippleSpeed: knob('rippleSpeed', 'Ripple speed', 0.36, 0, 2),
  rays: knob('rays', 'Light from the sun’s shafts', 1.87, 0, 4),
  shadows: knob('shadows', 'Shadows of the worlds', 0.38, 0, 1),
  glint: knob('glint', 'Sweeping glint strength', 0.82, 0, 2),
  glintSpeed: knob('glintSpeed', 'Sweeping glint speed', 0.07, 0, 0.5, 0.005),
  halo: knob('halo', 'Glow round the name', 0.74, 0, 2),
} as const

/** The settings packed as the shader's four vec4s (uMetalA to uMetalD). */
export function metalUniforms(): [number[], number[], number[], number[]] {
  const m = METAL
  return [
    [m.white.value, m.brightness.value, m.bevel.value, m.bevelDepth.value],
    [m.ripple.value, m.rippleScale.value, m.rippleSpeed.value, m.shine.value],
    [m.rays.value, m.ambient.value, m.glint.value, m.glintSpeed.value],
    [m.gloss.value, m.shadows.value, m.colour.value, m.halo.value],
  ]
}
