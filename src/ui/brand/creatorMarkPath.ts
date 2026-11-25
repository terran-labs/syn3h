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
/** The mark in use: star, two orbits and two worlds, the owner's choice (25 Nov 2026). */
export const CREATOR_MARK: CreatorMarkKind = 'twoOrbits'

/** The icon's drawn extent in its 200 box, as an SVG viewBox. About 1.56 wide to 1 tall. */
export const CREATOR_MARK_VIEWBOX = '0 36 200 128'
/** Orbit stroke in screen px (non-scaling), the interface's hairline. */
export const CREATOR_MARK_STROKE_PX = 1.15
/** Icon units per px at the smallest size drawn (14 px nameplate text, 1.15em mark), for gaps. */
const UNITS_PER_PX = 128 / (13 * 1.15)

/**
 * Clear space between the star (or a world) and an orbit's cut end, in stroke widths, beyond
 * the round cap. The owner (25 Nov 2026): "a little more white space around the central star.
 * Don't move the orbits. Just cut them where they would otherwise intersect the star."
 */
export const CREATOR_MARK_CLEARANCE = 1.5
/** The name size, px, at which the clearance is measured in strokes (strokes do not scale). */
export const CREATOR_MARK_CLEARANCE_AT_PX = 24
/** An orbit piece shorter than this many strokes after cutting is dropped: a speck, not an arc. */
const MIN_RUN_STROKES = 3

const CENTRE = [101, 99] as const
const TILT = (-22 * Math.PI) / 180

/** The star's outline as a polygon: ICON_STAR is absolute M/L/Z only. */
const STAR_POINTS: [number, number][] = [...ICON_STAR.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])])

/** Distance from (x, y) to the star's outline, 0 inside it. */
function starDistance(x: number, y: number): number {
  let inside = false, best = Infinity
  for (let i = 0, j = STAR_POINTS.length - 1; i < STAR_POINTS.length; j = i++) {
    const [ax, ay] = STAR_POINTS[j], [bx, by] = STAR_POINTS[i]
    if ((by > y) !== (ay > y) && x < ((ax - bx) * (y - by)) / (ay - by) + bx) inside = !inside
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
  }
  return inside ? 0 : best
}
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
export function creatorMarkShape(kind: CreatorMarkKind = CREATOR_MARK, clearanceAtPx = CREATOR_MARK_CLEARANCE_AT_PX): CreatorMarkShape {
  const spec = KINDS[kind]
  const stroke = CREATOR_MARK_STROKE_PX * UNITS_PER_PX
  // Icon units of one stroke at the size the clearance is measured at.
  const clearStroke = CREATOR_MARK_STROKE_PX * (128 / (clearanceAtPx * 1.15))
  // A world never shrinks below a dot that reads at the smallest size.
  const worlds = spec.worlds.map((w) => { const [x, y, r] = WORLDS[w]; return [x, y, Math.max(r, 1.6 * UNITS_PER_PX)] as const })
  let orbits = ''
  for (const [a, b] of spec.rings) {
    let run: string[] = [], length = 0, last: [number, number] | null = null
    // Sampled finely so each cut lands where it should; every third point drawn, ends kept.
    const flush = () => {
      if (run.length > 1 && length >= MIN_RUN_STROKES * stroke) orbits += 'M' + run.filter((_, k) => k % 3 === 0 || k === run.length - 1).join('L')
      run = []; length = 0; last = null
    }
    for (let i = 0; i <= 720; i++) {
      const t = (i / 720) * Math.PI * 2
      const ex = a * Math.cos(t), ey = b * Math.sin(t)
      const x = CENTRE[0] + ex * Math.cos(TILT) - ey * Math.sin(TILT)
      const y = CENTRE[1] + ex * Math.sin(TILT) + ey * Math.cos(TILT)
      // Cut wherever the orbit would touch the star or a world, leaving the round cap (half a
      // stroke) plus CREATOR_MARK_CLEARANCE strokes of empty space. The orbits never move.
      const clear = stroke * 0.5 + clearStroke * CREATOR_MARK_CLEARANCE
      const atStar = starDistance(x, y) < clear
      const atWorld = worlds.some(([wx, wy, wr]) => Math.hypot(x - wx, y - wy) < wr + clear)
      if (atStar || atWorld) flush()
      else {
        if (last) length += Math.hypot(x - last[0], y - last[1])
        last = [x, y]; run.push(`${r2(x)} ${r2(y)}`)
      }
    }
    flush()
  }
  const dots = worlds.map(([x, y, r]) => `M${r2(x - r)} ${y}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`).join('')
  return { orbits, solids: dots + ICON_STAR }
}
