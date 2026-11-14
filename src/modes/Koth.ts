/**
 * King of the Hill, the local side: notices when this client's vehicle touches lava or falls
 * off the world, takes it out of play, and brings it back at its spawn point after the
 * respawn delay. The server keeps score; see server/room.ts.
 */
import { RAPIER } from '../core/physics'
import type { Game } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { kothRespawnDelay } from './params'

export type DeathCause = 'lava' | 'fell'

/** Touching counts a little above the surface: wheels dip in before the body does. */
const LAVA_MARGIN = 0.3

export class LocalLife {
  /** Game time when the vehicle comes back, or 0 while alive. */
  private outUntil = 0
  slot = 0
  onDied: (cause: DeathCause) => void = () => {}
  onRespawn: () => void = () => {}

  constructor(private readonly game: Game, private readonly terrain: Terrain, private readonly player: Vehicle) {}

  get out(): boolean {
    return this.outUntil > 0
  }

  /** Run after each physics step while King of the Hill is on. */
  check(): void {
    if (this.outUntil) {
      if (this.game.time >= this.outUntil) this.respawn()
      return
    }
    const p = this.player.body.translation()
    const lava = this.terrain.liquidHeightAt?.(p.x, p.z) ?? -Infinity
    const half = this.terrain.size * 0.5
    if (Number.isFinite(lava) && p.y < lava + LAVA_MARGIN) this.die('lava')
    else if (p.y < -250 || Math.abs(p.x) > half * 1.5 || Math.abs(p.z) > half * 1.5) this.die('fell')
  }

  /** The mode ended or the round reset: come back now if out. */
  revive(): void {
    if (this.outUntil) this.respawn()
  }

  private die(cause: DeathCause): void {
    this.outUntil = this.game.time + Math.max(0.05, kothRespawnDelay.value)
    // Parked and invisible: frozen where it fell, out of everyone's way.
    this.player.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    this.player.object.visible = false
    this.onDied(cause)
  }

  private respawn(): void {
    this.outUntil = 0
    this.player.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    const s = this.terrain.spawnPoint(this.slot)
    this.player.teleport(s.position, s.heading)
    this.player.object.visible = true
    this.onRespawn()
  }
}
