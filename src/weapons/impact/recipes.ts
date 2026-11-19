/**
 * What a gear impact looks like on each kind of surface: the table the impact effects read
 * (ImpactFx.ts). Pure data and pure functions, so the choice can be tested without a renderer.
 *
 * The layering follows how shooters build impacts (Valve's Source impact table, the Unreal and
 * Unity impact packs): a very short flash; sparks along the surface, more and livelier on hard
 * ground; a puff of the ground itself (dust, clods, powder) or what the bolt makes of a liquid
 * (steam from water, embers from lava); a scorch that glows and cools on solid ground.
 */
import type { SurfaceKind } from '../../world/terrain/surface'

export type ImpactSurface = SurfaceKind | 'water' | 'lava' | 'vehicle'
export type Debris = 'dust' | 'clods' | 'powder' | 'steam' | 'embers' | null

export interface ImpactRecipe {
  /** Share of the full spark count. */
  sparks: number
  /** Share of the spark speed. */
  speed: number
  /** How much of a spark's speed into the surface comes back when it bounces (0 to 1); -1 none (a liquid: it falls in). */
  bounce: number
  /** What the surface throws up, and how much of the full count. */
  debris: Debris
  debrisCount: number
  /** A scorch that glows and cools where it hit. Not on liquids or vehicles. */
  scorch: boolean
}

const SOFT: ImpactRecipe = { sparks: 0.55, speed: 0.75, bounce: 0.25, debris: 'dust', debrisCount: 1, scorch: true }
const HARD: ImpactRecipe = { sparks: 1.3, speed: 1.15, bounce: 0.55, debris: 'dust', debrisCount: 0.35, scorch: true }

export const RECIPES: Readonly<Record<ImpactSurface, ImpactRecipe>> = {
  dust: SOFT,
  sand: { ...SOFT, debrisCount: 1.3 },
  regolith: { ...SOFT, debrisCount: 1.2 },
  track: SOFT,
  grass: { ...SOFT, debris: 'clods', debrisCount: 0.9 },
  mud: { ...SOFT, sparks: 0.4, debris: 'clods', debrisCount: 1.1 },
  snow: { ...SOFT, sparks: 0.45, debris: 'powder', debrisCount: 1.4 },
  rock: HARD,
  road: HARD,
  glass: { ...HARD, sparks: 1.5, bounce: 0.65 },
  ice: { ...HARD, debris: 'powder', debrisCount: 0.6, bounce: 0.6 },
  water: { sparks: 0.3, speed: 0.6, bounce: -1, debris: 'steam', debrisCount: 1.4, scorch: false },
  lava: { sparks: 0.5, speed: 0.6, bounce: -1, debris: 'embers', debrisCount: 1.2, scorch: false },
  vehicle: { sparks: 1.4, speed: 1.1, bounce: 0.5, debris: null, debrisCount: 0, scorch: false },
}

/** The parts of the terrain the classifier reads; all optional, as on a test world. */
export interface SurfaceSource {
  surfaceAt?(x: number, z: number): SurfaceKind
  liquidHeightAt?(x: number, z: number): number
  liquidKindAt?(x: number, z: number): 'lava' | 'water' | null
}

/**
 * Where a shot that ended at `point`, travelling along unit `dir`, is seen to strike, and on
 * what. Gear rays pass through liquids and end on the bed beneath; when a liquid's surface
 * stands above the end point, the impact is drawn where the shot crossed that surface instead,
 * as water or lava. A vehicle hit is a vehicle. Writes the drawn point into `out`.
 */
export function classifyImpact(point: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, onVehicle: boolean, terrain: SurfaceSource | undefined, out: { x: number; y: number; z: number }): ImpactSurface {
  out.x = point.x; out.y = point.y; out.z = point.z
  if (onVehicle) return 'vehicle'
  const level = terrain?.liquidHeightAt?.(point.x, point.z) ?? -Infinity
  if (Number.isFinite(level) && level > point.y) {
    // Back along the shot to where it crossed the surface (straight down if it came flat).
    const back = dir.y < -0.05 ? (level - point.y) / -dir.y : 0
    out.x = point.x - dir.x * back; out.y = level; out.z = point.z - dir.z * back
    return terrain?.liquidKindAt?.(point.x, point.z) === 'lava' ? 'lava' : 'water'
  }
  return terrain?.surfaceAt?.(point.x, point.z) ?? 'rock'
}

/**
 * How many of each part one impact emits, for the graphics level (0 Minimal, 1 Low and
 * Medium, 2 and up High). `full` is the spark count at High; `thunder` scales it for Plasma
 * Thunder. Never negative, never fractional.
 */
export function impactCounts(recipe: ImpactRecipe, full: number, level: number, thunder: boolean): { sparks: number; debris: number } {
  const share = level <= 0 ? 0.3 : level === 1 ? 0.55 : 1
  const scale = Math.max(0, full) * share * (thunder ? 2.2 : 1)
  return { sparks: Math.round(scale * recipe.sparks), debris: Math.round(Math.min(24, scale * 0.6) * recipe.debrisCount) }
}
