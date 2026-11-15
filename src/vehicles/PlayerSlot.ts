/**
 * The vehicle the local player is driving, held in one place.
 *
 * The player used to be a constant captured at startup by the camera, audio, HUD, water,
 * weather, networking and bots, so changing vehicle meant reloading the page. Systems take
 * this slot instead: they read `current` when they need the vehicle, and subscribe with
 * `onChange` if they keep anything bound to it (a listener on its object, a cached kind).
 *
 * The slot only announces a change. Building the new vehicle, disposing the old one and
 * carrying position across is the job of whoever calls `set` (see `swapVehicle` in main.ts).
 */
import type { Vehicle } from './Vehicle'

export type PlayerChange = (next: Vehicle, previous: Vehicle) => void

export class PlayerSlot {
  private vehicle: Vehicle
  private readonly listeners = new Set<PlayerChange>()

  constructor(vehicle: Vehicle) {
    this.vehicle = vehicle
  }

  /** The vehicle being driven now. Read it each time; do not keep the result across frames. */
  get current(): Vehicle {
    return this.vehicle
  }

  /**
   * Make `next` the player's vehicle and tell every listener, in the order they subscribed.
   * Setting the vehicle already held does nothing. Listeners run while `previous` is still
   * intact, so they can detach from it; dispose it after this returns. A listener that throws
   * does not stop the others: the first error is rethrown once all have run, so one broken
   * system cannot leave the rest bound to a vehicle that is about to be disposed.
   */
  set(next: Vehicle): void {
    const previous = this.vehicle
    if (next === previous) return
    this.vehicle = next
    let failed = false, failure: unknown
    for (const listener of [...this.listeners]) {
      try { listener(next, previous) } catch (error) { if (!failed) { failed = true; failure = error } }
    }
    if (failed) throw failure
  }

  /** Subscribe to changes. Returns the unsubscribe function; calling it twice is harmless. */
  onChange(listener: PlayerChange): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
