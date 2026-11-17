/**
 * The one switch for vehicles that are built but not offered. The owner hid the tank on
 * 16 November 2026: "It's just not good enough to be playable." Set TANK_AVAILABLE to true
 * and it returns everywhere: the vehicle picker, the warm-up queue, the Vehicles card's Tank
 * group, About, and remote tanks drawn as tanks. Its source stays in src/vehicles/Tank.ts.
 *
 * While it is hidden, every route to a tank lands in the buggy instead: a saved choice, a
 * rejoin snapshot, ?vehicle=tank, and a tank announced by an older client in the same room
 * (drawn as a buggy in that player's colours).
 */
export const TANK_AVAILABLE = false

/** Whether a vehicle kind may be offered to or built for a player in this build. */
export function isVehicleAvailable(kind: string): boolean {
  return kind !== 'tank' || TANK_AVAILABLE
}
