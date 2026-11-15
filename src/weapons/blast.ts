/**
 * Impacts push: where a bolt of energy ends, vehicles nearby are shoved away from it, with
 * some lift and spin. Nobody is harmed; firing Plasma Thunder into the ground under your
 * own vehicle throws it tumbling into the air.
 *
 * Who applies it. Every client already flies every shot from the same relayed launch, so
 * every client finds the same impact on its own; each then pushes only the vehicles it
 * simulates (its own, and the bots when it hosts). Nothing is pushed twice and no message is
 * needed. As with the Chaser's bump, a sender cannot make a push bigger: the pushed
 * vehicle's own client applies it, from this room's sliders, under the limits below.
 *
 * Cost: one pass over the vehicles in the room per impact, nothing per frame.
 */
import type { Game } from '../core/Game'
import type { RAPIER } from '../core/physics'
import { wrapDelta } from '../../shared/wrap'
import { BLAST_BUDGET, BLAST_MAX, BLAST_WINDOW, blastAllowed, blastSpec, type BlastKind, type BlastSpec } from './blastParams'

export type V3 = [number, number, number]

/** How much of the push reaches a body `distance` metres away: 1 at the centre, 0 at the radius, smooth between. */
export function blastFalloff(distance: number, radius: number): number {
  if (!(radius > 0) || !(distance < radius)) return 0
  const u = Math.max(0, distance) / radius
  const k = 1 - u * u
  return k * k
}

/**
 * The speed change for a body whose centre is `offset` from the blast, or null if it is out
 * of reach. It points away from the blast, tipped upward by `lift`; a body right on top of
 * the blast goes straight up.
 */
export function blastPush(offset: Readonly<V3>, spec: BlastSpec): V3 | null {
  const d = Math.hypot(offset[0], offset[1], offset[2])
  const k = blastFalloff(d, spec.radius)
  const speed = Math.min(BLAST_MAX, spec.push * k)
  if (!(speed > 0) || !Number.isFinite(d)) return null
  let x = 0, y = 1, z = 0
  if (d > 1e-3) {
    x = offset[0] / d; y = offset[1] / d + spec.lift; z = offset[2] / d
    const n = Math.hypot(x, y, z)
    if (n > 1e-6) { x /= n; y /= n; z /= n } else { x = 0; y = 1; z = 0 }
  }
  return [x * speed, y * speed, z * speed]
}

export interface BlastHooks {
  vehicleIds(): number[]
  bodyOf(id: number): RAPIER.RigidBody | undefined
  /** True if this client simulates the vehicle, so it may push it. */
  owns(id: number): boolean
  wrapSize(): number
}

/** How far from its centre, toward the blast, a vehicle is pushed: off centre, so it spins. */
const ARM = 0.6

export class Blast {
  /** Push already given to each vehicle inside the current window, m/s. */
  private readonly spent = new Map<number, { since: number; sum: number }>()
  /** Counts for automated checks. */
  stats = { blasts: 0, pushed: 0 }

  constructor(private readonly game: Game, private readonly hooks: BlastHooks) {}

  /** An impact of `kind` at `at`: push every vehicle in reach that this client simulates. */
  at(kind: BlastKind, at: { x: number; y: number; z: number }): void {
    if (!blastAllowed.value) return
    const spec = blastSpec(kind)
    if (!(spec.radius > 0) || !(spec.push > 0)) return
    this.stats.blasts++
    const size = this.hooks.wrapSize()
    for (const id of this.hooks.vehicleIds()) {
      if (!this.hooks.owns(id)) continue
      const body = this.hooks.bodyOf(id)
      if (!body) continue
      const p = body.translation()
      const off: V3 = [size > 0 ? wrapDelta(at.x, p.x, size) : p.x - at.x, p.y - at.y, size > 0 ? wrapDelta(at.z, p.z, size) : p.z - at.z]
      const push = blastPush(off, spec)
      if (!push) continue
      const k = this.allow(id, Math.hypot(push[0], push[1], push[2]))
      if (!(k > 0)) continue
      const m = body.mass() * k
      // Applied a little toward the blast from the centre of mass, so the lift turns the body.
      const d = Math.hypot(off[0], off[1], off[2])
      const arm = d > 1e-3 ? Math.min(ARM, d) / d : 0
      body.applyImpulseAtPoint(
        { x: push[0] * m, y: push[1] * m, z: push[2] * m },
        { x: p.x - off[0] * arm, y: p.y - off[1] * arm, z: p.z - off[2] * arm }, true,
      )
      this.stats.pushed++
    }
  }

  /** Forget what has been spent: for a world change. */
  reset(): void {
    this.spent.clear()
  }

  /** The share of a push of `speed` this vehicle may still take in the current window, 0 to 1. */
  private allow(id: number, speed: number): number {
    const now = this.game.time
    let s = this.spent.get(id)
    if (!s || now - s.since > BLAST_WINDOW || now < s.since) this.spent.set(id, s = { since: now, sum: 0 })
    const room = Math.max(0, BLAST_BUDGET - s.sum)
    const take = Math.min(speed, room)
    s.sum += take
    return speed > 0 ? take / speed : 0
  }
}
