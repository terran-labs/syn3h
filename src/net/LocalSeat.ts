/**
 * The things networking builds around the one vehicle the player drives: the guard that
 * returns it to its pad when it falls out of the world (a bug), and the lava bookkeeping. Both are constructed
 * for a particular vehicle, so when the player switches vehicle in play (no reload) they
 * must be rebuilt for the new one, or they would go on watching a vehicle that has been
 * removed. This keeps the two together, keeps the guard registered with the game exactly
 * once, and carries the player's spawn slot across the swap.
 *
 * Generic over the parts so it is unit tested with plain objects, no physics or Three.js.
 */
export interface SeatParts<V, B extends { slot: number }, R> {
  /** Build the guard for a vehicle, with its callbacks wired. */
  makeBounds(vehicle: V): B
  /** Build the rescue for a vehicle, with its callbacks wired. */
  makeRescue(vehicle: V): R
  /** Register a guard with the game loop, and take one out. */
  add(bounds: B): void
  remove(bounds: B): void
}

export class LocalSeat<V, B extends { slot: number }, R> {
  bounds: B
  rescue: R
  private started = false

  constructor(public vehicle: V, private readonly parts: SeatParts<V, B, R>) {
    this.bounds = parts.makeBounds(vehicle)
    this.rescue = parts.makeRescue(vehicle)
  }

  /** Register the guard with the game loop. Once. */
  start(): void {
    if (this.started) return
    this.started = true
    this.parts.add(this.bounds)
  }

  /**
   * The player now drives `vehicle`. Returns false, and changes nothing, if it already does.
   * The old vehicle's rescue is dropped with whatever it was timing: the new vehicle starts
   * clean, and is noticed afresh if it is itself in the lava.
   */
  swap(vehicle: V): boolean {
    if (vehicle === this.vehicle) return false
    const slot = this.bounds.slot
    if (this.started) this.parts.remove(this.bounds)
    this.vehicle = vehicle
    this.bounds = this.parts.makeBounds(vehicle)
    this.bounds.slot = slot
    this.rescue = this.parts.makeRescue(vehicle)
    if (this.started) this.parts.add(this.bounds)
    return true
  }
}
