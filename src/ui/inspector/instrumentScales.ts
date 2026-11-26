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
 * default thrust of 2, and in proportion to thrust. Capped at SPEED_CAP: today's jet (its drag
 * gives no practical limit) reaches it; the jet-flight retune (about 110 m/s at full throttle)
 * brings the formula well under it.
 */
export function jetTopSpeed(drag = value('jet.drag', 0.0029), thrust = value('jet.flightThrust', 2)): number {
  return Math.min(SPEED_CAP, (thrust / 2) * 19.4 / (drag * 1.225 * 50))
}
/**
 * The fastest the handling report measures anything going: the jet on today's drag and the
 * hovercraft without its glide assistance both stop at 400 m/s (25 November 2026), a cap in the
 * physics rather than either vehicle's.
 */
export const SPEED_CAP = 400
/** The hovercraft's body mass (the handling report, 25 November 2026). */
export const HOVER_MASS = 50
/**
 * The hovercraft's glide top speed: constant thrust against linear drag settles at hover.thrust /
 * (mass x hover.drag) (Hovercraft.ts). The handling report measures 32.0 m/s on the Default preset
 * (320 / (50 x 0.2) = 32). Without glide assistance (hover.assist 0) there is no glide drag and it
 * runs to SPEED_CAP.
 */
export function hoverTopSpeed(thrust = value('hover.thrust', 320), drag = value('hover.drag', 0.2), assist = Number(params.get('hover.assist')?.value ?? 1)): number {
  return assist > 0 ? Math.min(SPEED_CAP, thrust / (HOVER_MASS * drag)) : SPEED_CAP
}

/** Top speed in m/s of the vehicle being driven. */
export function topSpeed(kind: VehicleKind | string): number {
  switch (kind) {
    case 'buggy': case 'buggy-syn3h': case 'buggy-classic': return BUGGY_TOP_PER_SPEED * value('buggy.speed', 30)
    case 'jet': return jetTopSpeed()
    case 'hovercraft': return hoverTopSpeed()
    // The tank's speed parameter is its target ground speed in m/s (Tank.ts).
    case 'tank': return value('tank.speed', 25)
    default: return FALLBACK_TOP_SPEED
  }
}

/** The speed, in m/s, at which the speed crescent reads full for this vehicle. */
export const speedFullScale = (kind: VehicleKind | string): number => SPEED_HEADROOM * topSpeed(kind)

/** The height, in metres, at which the altitude crescent reads full: today one scale for all. */
export const HEIGHT_FULL_SCALE = 600
/**
 * The altitude crescent's full scale for this vehicle. A stub: every vehicle reads 600 m above the
 * sea, as before. Waiting on the owner: height above the ground, full at a per-vehicle range (a big
 * jump for ground vehicles, the cruising band for the jet), would be decided here.
 */
export const heightFullScale = (_kind: VehicleKind | string): number => HEIGHT_FULL_SCALE
