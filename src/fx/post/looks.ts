/**
 * Colour looks per planet kind, applied after tone mapping (display values, 0 to 1).
 *
 * A look is five numbers and three colours. `post.look` scales the whole look (0 neutral,
 * 1 as designed, 2 doubled), and the Contrast, Saturation and Warmth sliders sit on top.
 *
 *   volcanic  ember: warm highlights, cool basalt shadows, rich colour, firm contrast.
 *   desert    bleached heat: golden highlights, warm lifted shadows, a little less colour.
 *   alpine    thin cold air: neutral to blue highlights, cool shadows, crisp contrast.
 */
export type RGB = [number, number, number]

export interface Look {
  /** Multiplies highlights (white balance). */
  gain: RGB
  /** Added to shadows, falling off towards white. */
  lift: RGB
  /** S curve amount: 0 none. */
  contrast: number
  /** 1 unchanged. */
  saturation: number
}

export const LOOKS: Record<'volcanic' | 'desert' | 'alpine', Look> = {
  volcanic: { gain: [1.05, 0.99, 0.93], lift: [0.0, 0.008, 0.02], contrast: 0.22, saturation: 1.1 },
  desert: { gain: [1.05, 1.01, 0.9], lift: [0.022, 0.014, 0.0], contrast: 0.12, saturation: 0.92 },
  alpine: { gain: [0.97, 1.0, 1.04], lift: [0.0, 0.006, 0.018], contrast: 0.18, saturation: 1.04 },
}

/** terrain.kind: 0 volcanic, 1 desert, 2 alpine (src/world/planets.ts). */
export function lookForKind(kind: unknown): Look {
  return kind === 1 ? LOOKS.desert : kind === 2 ? LOOKS.alpine : LOOKS.volcanic
}

export interface Grade { gain: RGB; lift: RGB; contrast: number; saturation: number }

/**
 * The grade for this frame: the planet's look scaled by `amount`, then the sliders.
 * `warmth` -1 to 1 tilts the white balance from blue to amber.
 */
export function gradeFor(look: Look, amount: number, sliders: { contrast: number; saturation: number; warmth: number }, out?: Grade): Grade {
  const g = out ?? { gain: [1, 1, 1], lift: [0, 0, 0], contrast: 0, saturation: 1 }
  const w = sliders.warmth
  const warm: RGB = [1 + 0.06 * w, 1 + 0.01 * w, 1 - 0.08 * w]
  for (let i = 0; i < 3; i++) {
    g.gain[i] = (1 + (look.gain[i] - 1) * amount) * warm[i]
    g.lift[i] = look.lift[i] * amount
  }
  g.contrast = look.contrast * amount + sliders.contrast
  g.saturation = (1 + (look.saturation - 1) * amount) * sliders.saturation
  return g
}
