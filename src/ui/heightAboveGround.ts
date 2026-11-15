/**
 * Height above ground for the display, measured from the vehicle's contact surfaces (tyres,
 * treads, landing gear, skirt), not from the middle of its body. The owner's rule,
 * 15 November 2026: "A vehicle sitting on the ground should say 0 meters, not 1 meter."
 *
 * Three sources, best first:
 * 1. The vehicle measures it itself (`heightAboveSurface`), from its own contact points and
 *    whatever it rides on. This is the real answer; vehicles gain it one by one.
 * 2. The vehicle reports a true count of wheels or tracks touching the ground. Touching
 *    means 0 m. The body's height at that moment is how far its origin sits above its contact
 *    surfaces, so in the air that much is taken off: the reading rises from 0 without a jump.
 * 3. Otherwise the body's height above the ground beneath it, as before. The hovercraft and
 *    the jet are here until they measure it themselves: the hovercraft counts as "grounded"
 *    anywhere within 30 m of the surface, and the jet reports no contact at all, so neither
 *    count can be trusted as contact.
 */
export interface GroundedVehicle {
  readonly kind: string
  /** Wheels or tracks touching the ground this step. */
  readonly wheelsGrounded: number
  /** Metres between the lowest contact surface and what is beneath it; 0 at rest. */
  heightAboveSurface?(): number
}

/** Kinds whose `wheelsGrounded` is a real contact count. */
const COUNTS_CONTACT: ReadonlySet<string> = new Set(['buggy', 'buggy-syn3h', 'buggy-classic', 'tank'])
/** No vehicle's origin sits further than this above its contact surfaces; bounds a bad sample. */
const MAX_REST_HEIGHT = 3

export class HeightAboveGround {
  /** Per vehicle: how far its origin was above the ground when it last touched it. */
  private readonly rest = new WeakMap<object, number>()

  /** Call each frame with the body origin's height and the ground height beneath it. Allocates nothing. */
  read(vehicle: GroundedVehicle, originY: number, groundY: number): number {
    const measured = vehicle.heightAboveSurface?.()
    if (typeof measured === 'number' && Number.isFinite(measured)) return Math.max(0, measured)
    const gap = originY - groundY
    if (!Number.isFinite(gap)) return 0
    if (!COUNTS_CONTACT.has(vehicle.kind)) return Math.max(0, gap)
    if (vehicle.wheelsGrounded > 0) { this.rest.set(vehicle, Math.min(MAX_REST_HEIGHT, Math.max(0, gap))); return 0 }
    return Math.max(0, gap - (this.rest.get(vehicle) ?? 0))
  }
}
