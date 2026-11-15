/**
 * Vehicle kinds as they cross the wire, against the vehicles this build really makes.
 * A kind's name can outlive its vehicle: the Mars Explorer buggy ('buggy-classic') was
 * retired, but a client from an earlier release still announces it, and this build draws the
 * Syn3h buggy for it. Networking must compare what is built, not what it is called.
 */
import { canonicalVehicleKind } from '../vehicles'

/**
 * True when a remote vehicle built as `built` has to be replaced to show a player who now
 * announces `announced`. Comparing the names alone rebuilt an older client's buggy on every
 * profile message (each colour change), because the copy built for 'buggy-classic' calls
 * itself 'buggy' and never matched.
 */
export function needsRebuild(built: string | undefined, announced: string): boolean {
  return built !== undefined && canonicalVehicleKind(built) !== canonicalVehicleKind(announced)
}

/** The kind to announce for a locally chosen one: a retired name is announced as what we drive. */
export function announcedKind(kind: string | null | undefined): string | null | undefined {
  return kind === 'buggy-classic' ? canonicalVehicleKind(kind) : kind
}
