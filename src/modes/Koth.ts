/**
 * King of the Hill, the local side. Nothing in this world can be destroyed: lava is thick and
 * sticky, and a vehicle that sinks into it is stuck. It may crawl out under its own power;
 * if it is still in the lava when the return delay ends it is lifted back to its spawn pad.
 * A vehicle that leaves the world is returned to its pad at once. The server keeps score and
 * leaves a stuck vehicle out of the hill count; see server/room.ts.
 *
 * The drag and the glow of a vehicle in lava belong to the vehicle code (src/vehicles/lava.ts).
 */
import type { Game } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { kothRespawnDelay } from './params'

/** How a stuck vehicle got free: under its own power, or lifted back to its pad. */
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
  /** Game time when the vehicle is lifted back to its pad, or 0 while free. */
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

export class LocalRescue {
  slot = 0
  /** The vehicle just sank into the lava. */
  onStuck: () => void = () => {}
  /** It is free again: it crawled out, or was lifted back to its pad. */
  onFreed: (by: FreedBy) => void = () => {}
  /** It left the world and was put back on its pad. */
  onReturned: () => void = () => {}
  private readonly timer = new StuckTimer()

  constructor(private readonly game: Game, private readonly terrain: Terrain, private readonly player: Vehicle) {}

  get stuck(): boolean {
    return this.timer.stuck
  }

  /** Whole seconds until a stuck vehicle is lifted back to its pad. */
  get secondsLeft(): number {
    return this.timer.stuck ? Math.max(0, Math.ceil(this.timer.until - this.game.time)) : 0
  }

  /** Run after each physics step while King of the Hill is on. */
  check(): void {
    const p = this.player.body.translation()
    const half = this.terrain.size * 0.5
    if (p.y < -250 || Math.abs(p.x) > half * 1.5 || Math.abs(p.z) > half * 1.5) {
      this.timer.clear()
      this.toPad()
      this.onReturned()
      return
    }
    const what = this.timer.step(this.game.time, inStickyLiquid(this.terrain, p), kothRespawnDelay.value)
    if (what === 'stuck') this.onStuck()
    else if (what) {
      if (what === 'returned') this.toPad()
      this.onFreed(what)
    }
  }

  /** The mode ended: forget any countdown. The vehicle stays where it is. */
  release(): void {
    this.timer.clear()
  }

  private toPad(): void {
    const s = this.terrain.spawnPoint(this.slot)
    this.player.teleport(s.position, s.heading)
  }
}
