/**
 * King of the Hill, the local side. Nothing in this world can be destroyed: lava is thick and
 * sticky, and a vehicle that sinks into it is stuck. A player's vehicle stays where it is until
 * it crawls out under its own power: the game never moves it for being in the lava (the
 * owner's rule of 18 November 2026, see AGENTS.md). Stuck only matters for the score: the
 * server leaves a stuck player out of the hill count until it is free; see server/room.ts.
 * The host's bots still get lifted back to a pad after the return delay (net/index.ts).
 *
 * The drag and the glow of a vehicle in lava belong to the vehicle code (src/vehicles/lava.ts).
 */
import type { Game } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'

/** How a stuck vehicle got free: under its own power, or (bots only) lifted back to a pad. */
export type FreedBy = 'crawled' | 'returned'

/** Touching counts a little above the surface: wheels dip in before the body does. */
const LAVA_MARGIN = 0.3

/** Seconds clear of the lava before a stuck vehicle counts as having crawled out, so a
 * vehicle bobbing at the surface does not flip between stuck and free. */
const CLEAR_TIME = 0.5

/** The terrain methods this reads. `liquidKindAt` is optional and newer than the rest. */
type LiquidTerrain = Pick<Terrain, 'liquidHeightAt'> & {
  liquidKindAt?(x: number, z: number): 'lava' | 'water' | null
}

/**
 * True if a vehicle at `p` is in a liquid that sticks. Where the terrain can tell lava from
 * water, only lava does (water never sticks); where it cannot, any liquid does.
 */
export function inStickyLiquid(terrain: LiquidTerrain, p: { x: number; y: number; z: number }): boolean {
  const surface = terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity
  if (!Number.isFinite(surface) || p.y >= surface + LAVA_MARGIN) return false
  if (!terrain.liquidKindAt) return true
  return terrain.liquidKindAt(p.x, p.z) === 'lava'
}

/**
 * Stuck-in-lava bookkeeping for one vehicle, free of the game so it can be tested and shared
 * by the local player and the host's bots. Feed it the game time and whether the vehicle is
 * in the lava each step; it answers what just happened.
 */
export class StuckTimer {
  /** Game time when the vehicle is lifted back to its pad (Infinity: never), or 0 while free. */
  until = 0
  private clearSince = 0

  get stuck(): boolean {
    return this.until > 0
  }

  step(time: number, inLava: boolean, delay: number): 'stuck' | FreedBy | null {
    if (!this.until) {
      if (!inLava) return null
      this.until = time + Math.max(0.05, delay)
      this.clearSince = 0
      return 'stuck'
    }
    if (inLava) {
      this.clearSince = 0
      if (time < this.until) return null
      this.until = 0
      return 'returned'
    }
    if (!this.clearSince) this.clearSince = time
    if (time - this.clearSince < CLEAR_TIME) return null
    this.until = 0
    return 'crawled'
  }

  clear(): void {
    this.until = 0
    this.clearSince = 0
  }
}

/**
 * The local player's stuck-in-lava bookkeeping. It reports stuck and free; it never moves the
 * vehicle. A vehicle that falls out of the world is BoundsGuard's (src/modes/Tag.ts), in every mode.
 */
export class LocalRescue {
  /** The vehicle just sank into the lava. */
  onStuck: () => void = () => {}
  /** It crawled out under its own power. */
  onFreed: () => void = () => {}
  private readonly timer = new StuckTimer()

  constructor(private readonly game: Game, private readonly terrain: Terrain, private readonly player: Vehicle) {}

  get stuck(): boolean {
    return this.timer.stuck
  }

  /** Run after each physics step while King of the Hill is on. */
  check(): void {
    const what = this.timer.step(this.game.time, inStickyLiquid(this.terrain, this.player.body.translation()), Infinity)
    if (what === 'stuck') this.onStuck()
    else if (what === 'crawled') this.onFreed()
  }

  /** The mode ended: forget the stuck state. The vehicle stays where it is. */
  release(): void {
    this.timer.clear()
  }
}
