/**
 * The colour of the ground under a wheel, and the colours of the tyre mark and dust it makes.
 *
 * The owner (16 November 2026): marks and dust take their look from the ground. Ice leaves a
 * pale scuff and throws a little pale spray, never brown; sand a soft trough and plenty of
 * sand coloured dust; grass a darker pressed print and few flecks.
 *
 * The terrain already says what the ground is made of at a point (`terrain.surfaceAt`, one
 * cheap CPU lookup per wheel). Each planet look has one palette (palettes.ts), the same table
 * the terrain shader paints from, so the colour of a surface on a planet is one of 9 x 11
 * values worked out once and cached here. No GPU readback, no extra pass. The patches of
 * colour the shader adds with noise are not reproduced: marks and dust are a shade of the
 * ground's average colour there, which is what the eye compares them with.
 *
 * Plain numbers, linear RGB, no renderer imports, so tests can hold it to the rules.
 */
import { SURFACE_KINDS, type SurfaceKind } from '../../world/terrain/surface'
import { PALETTES, paletteFor } from '../../world/terrain/palettes'

export type RGB = [number, number, number]

// Looks, by index into palettes.ts LOOK_NAMES.
const DESERT = 1, ALPINE = 2

function linear(c: number): number { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
function hexMix(a: number, b: number, t: number, out: RGB): RGB {
  for (let i = 0; i < 3; i++) {
    const s = 16 - 8 * i, x = linear(((a >> s) & 255) / 255), y = linear(((b >> s) & 255) / 255)
    out[i] = x + (y - x) * t
  }
  return out
}
export function luminance(c: readonly number[]): number { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }

const cache = new Map<number, RGB>()

/** Linear colour of the bare ground of `kind` on planet look `look`, from that look's palette. */
export function groundColour(look: number, kind: SurfaceKind): Readonly<RGB> {
  const key = look * 16 + SURFACE_KINDS.indexOf(kind)
  let c = cache.get(key)
  if (c) return c
  const p = paletteFor(look), mid = (a: number, b: number) => hexMix(a, b, 0.5, [0, 0, 0])
  switch (kind) {
    case 'snow': c = hexMix(p.snow, p.snow, 0, [0, 0, 0]); break
    case 'rock': c = mid(p.rockDark, p.rockLight); break
    case 'road': case 'track': c = mid(p.roadDark, p.roadLight); break
    // Sand is the ground itself on the desert, a beach anywhere else.
    case 'sand': c = look === DESERT ? mid(p.groundDark, p.groundLight) : mid(p.shore, p.groundLight); break
    // Alpine tundra and scree above the meadow: part ground, part granite.
    case 'dust': c = look === ALPINE ? hexMix(p.groundDark, p.rockLight, 0.6, [0, 0, 0]) : mid(p.groundDark, p.groundLight); break
    default: c = mid(p.groundDark, p.groundLight)
  }
  cache.set(key, c)
  return c
}

/** Number of planet looks, for tests. */
export const LOOK_COUNT = PALETTES.length

/** How a surface tints what a wheel leaves on it, relative to its ground colour. */
export interface Tone {
  /** Brightness relative to the ground: below 1 darker, above 1 lighter. */
  shade: number
  /** Share of the ground's saturation kept: 1 all of it, 0 grey. */
  sat: number
  /** 0..1 pull toward pale blue-white frost (ice and snow). */
  frost: number
  /** 0..1 pull toward a fixed earth brown (torn turf showing soil). */
  earth?: number
}

const FROST: RGB = [0.92, 0.97, 1]
const EARTH: RGB = [0.16, 0.1, 0.05]

/** The ground colour toned: desaturated, darkened or lightened, frosted. Writes into `out`. */
export function tone(ground: Readonly<RGB>, t: Tone, out: RGB): RGB {
  const l = luminance(ground)
  for (let i = 0; i < 3; i++) {
    let c = (l + (ground[i] - l) * t.sat) * t.shade
    if (t.earth) c += (EARTH[i] - c) * t.earth
    c += (FROST[i] - c) * t.frost
    out[i] = Math.min(1, Math.max(0, c))
  }
  return out
}

const toned = new Map<number, RGB>()

/**
 * `tone` of the ground colour of `kind` on `look`, cached, so a wheel's lookup allocates
 * nothing. `table` tells apart tones from different tables (0 marks, 1 dust).
 */
export function surfaceTone(look: number, kind: SurfaceKind, t: Tone, table: number): Readonly<RGB> {
  const k = (table * 64 + look) * 16 + SURFACE_KINDS.indexOf(kind)
  let c = toned.get(k)
  if (!c) { c = tone(groundColour(look, kind), t, [0, 0, 0]); toned.set(k, c) }
  return c
}
