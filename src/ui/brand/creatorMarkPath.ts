/**
 * The creator's mark: a line-art reduction of the Mira app icon (wordmarkPath.ts ICON_RINGS,
 * ICON_WORLDS and ICON_STAR, the mira3 set), drawn before the creator's name in the bot mark's
 * slot (src/ui/playerMarks.ts). Generated here from the icon's geometry, not shipped as a file.
 *
 * The icon's three swept rings are fitted as tilted ellipses around the star; each orbit is a
 * hairline broken where it passes behind the star and around a world, as the icon breaks its
 * rings. Worlds are dots, the star is the icon's own path. Reductions differ in what is kept;
 * CREATOR_MARK picks one (round 3 sheet: _drafts/creator-mark-round3*.png, outside the repo).
 */
import { ICON_STAR } from './wordmarkPath'

export type CreatorMarkKind = 'oneOrbit' | 'twoOrbits' | 'full'
/** The mark in use: star, two orbits and two worlds, provisional pending the owner (25 Nov 2026). */
export const CREATOR_MARK: CreatorMarkKind = 'twoOrbits'

/** The icon's drawn extent in its 200 box, as an SVG viewBox. About 1.56 wide to 1 tall. */
export const CREATOR_MARK_VIEWBOX = '0 36 200 128'
/** Orbit stroke in screen px (non-scaling), the interface's hairline. */
export const CREATOR_MARK_STROKE_PX = 1.15
/** Icon units per px at the smallest size drawn (14 px nameplate text, 1.15em mark), for gaps. */
const UNITS_PER_PX = 128 / (13 * 1.15)

const CENTRE = [101, 99] as const
const TILT = (-22 * Math.PI) / 180
const STAR_RADIUS = 52
const WORLDS = { right: [185.3, 98.7, 11], top: [157.1, 56, 9], left: [46.4, 134.7, 8] } as const
const KINDS: Record<CreatorMarkKind, { rings: [number, number][]; worlds: (keyof typeof WORLDS)[] }> = {
  oneOrbit: { rings: [[100, 42]], worlds: [] },
  twoOrbits: { rings: [[100, 44], [80, 27]], worlds: ['right', 'left'] },
  full: { rings: [[100, 44], [86, 34], [72, 25]], worlds: ['right', 'top', 'left'] },
}

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CreatorMarkShape {
  /** Orbits, to stroke. */
  orbits: string
  /** Worlds and the star, to fill. */
  solids: string
}

/** The mark's paths in the icon's 200 box (crop with CREATOR_MARK_VIEWBOX). */
export function creatorMarkShape(kind: CreatorMarkKind = CREATOR_MARK): CreatorMarkShape {
  const spec = KINDS[kind]
  const stroke = CREATOR_MARK_STROKE_PX * UNITS_PER_PX
  // A world never shrinks below a dot that reads at the smallest size.
  const worlds = spec.worlds.map((w) => { const [x, y, r] = WORLDS[w]; return [x, y, Math.max(r, 1.6 * UNITS_PER_PX)] as const })
  let orbits = ''
  for (const [a, b] of spec.rings) {
    let run: string[] = []
    const flush = () => { if (run.length > 1) orbits += 'M' + run.join('L'); run = [] }
    for (let i = 0; i <= 360; i++) {
      const t = (i / 360) * Math.PI * 2
      const ex = a * Math.cos(t), ey = b * Math.sin(t)
      const x = CENTRE[0] + ex * Math.cos(TILT) - ey * Math.sin(TILT)
      const y = CENTRE[1] + ex * Math.sin(TILT) + ey * Math.cos(TILT)
      // The near half of an orbit passes in front of the star in the icon's depth, the far half
      // behind it: the icon cuts the far half with a halo, an astroid like the star itself.
      const halo = STAR_RADIUS + stroke * 1.6
      const behindStar = t < Math.PI && Math.abs(x - 100) ** (2 / 3) + Math.abs(y - 100) ** (2 / 3) < halo ** (2 / 3)
      const atWorld = worlds.some(([wx, wy, wr]) => Math.hypot(x - wx, y - wy) < wr + stroke * 1.2)
      if (behindStar || atWorld) flush()
      else run.push(`${r2(x)} ${r2(y)}`)
    }
    flush()
  }
  const dots = worlds.map(([x, y, r]) => `M${r2(x - r)} ${y}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`).join('')
  return { orbits, solids: dots + ICON_STAR }
}
