/**
 * How far each instrument crescent reads at full, per vehicle (the Foreman, 25 November 2026,
 * approving: "speed arc full at about 1.15 times the active vehicle's top speed, from the
 * registry"). The speed crescent used to be full at a fixed 140 mph, which a buggy passes at
 * about two thirds of its top speed and a jet in seconds, so it sat pinned at full.
 *
 * Top speeds come from the parameter registry, so retuning a vehicle moves its crescent with it.
 * Read by id, not by importing the vehicles, so the interface does not pull vehicle code in.
 * Where a vehicle's top speed is not one parameter, the relation is written out below with where
 * it was measured.
 *
 * The altitude crescent keeps its single scale for now; a per-vehicle height range (above the
 * ground) is waiting on the owner and would be one more function beside speedFullScale.
 */
import { params } from '../../../shared/params'
import type { VehicleKind } from '../../vehicles'

/** The crescent is full a little above top speed, so top speed reads nearly full, never pinned. */
export const SPEED_HEADROOM = 1.15
/** The old fixed scale, 140 mph in m/s: the fallback for a vehicle with no known top speed. */
export const FALLBACK_TOP_SPEED = 140 / 2.23694

const value = (id: string, fallback: number): number => {
  const v = Number(params.get(id)?.value)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * The buggy's top speed per unit of `buggy.speed`: 101.8 m/s at its default of 30 (the handling
 * report, Balanced preset, 25 November 2026: top speed rolling forward from rest, uncapped). The
 * motor's target is `buggy.speed` times ten in wheel speed and drag holds it below that, so the
 * report's ratio stands in for a formula; it scales with the parameter.
 */
export const BUGGY_TOP_PER_SPEED = 101.8 / 30
/**
 * The jet's top speed from its flight drag and thrust (Jet.ts, jet.drag's note): at sea level full
 * thrust, `jet.flightThrust` times weight, balances drag at 19.4 / (drag x 1.225 x 50) m/s for the
 * default thrust of 2, and in proportion to thrust. The handling report measured today's jet at
 * 400 m/s (its drag gives no practical limit), so that is the most it reads; the jet-flight retune
 * (about 110 m/s at full throttle) brings the formula well under it.
 */
export const JET_MEASURED_TOP = 400
export function jetTopSpeed(drag = value('jet.drag', 0.0029), thrust = value('jet.flightThrust', 2)): number {
  return Math.min(JET_MEASURED_TOP, (thrust / 2) * 19.4 / (drag * 1.225 * 50))
}

/** Top speed in m/s of the vehicle being driven. */
export function topSpeed(kind: VehicleKind | string): number {
  switch (kind) {
    case 'buggy': case 'buggy-syn3h': case 'buggy-classic': return BUGGY_TOP_PER_SPEED * value('buggy.speed', 30)
    case 'jet': return jetTopSpeed()
    // The tank's speed parameter is its target ground speed in m/s (Tank.ts).
    case 'tank': return value('tank.speed', 25)
    // The hovercraft's glide speed comes from thrust against drag with no single parameter, and
    // the handling report does not measure it yet: the old scale until it does.
    default: return FALLBACK_TOP_SPEED
  }
}

/** The speed, in m/s, at which the speed crescent reads full for this vehicle. */
export const speedFullScale = (kind: VehicleKind | string): number => SPEED_HEADROOM * topSpeed(kind)
