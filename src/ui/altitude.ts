/**
 * Altitude for the ALT readout: metres above sea level, measured from the vehicle's lowest
 * contact surface so that a vehicle resting on the sea surface reads 0 and one parked on a
 * hill reads the hill's height. Below sea level (a sunken basin, under water) it is negative.
 *
 * Sea level is the sea's surface at rest: the world's sea-level setting (`world.lavaAltitude`)
 * as the sea is drawn now, gliding with it when the slider moves (src/world/seaLevel.ts), with
 * no waves. A dry world (`terrain.dry`) has no sea to measure from, so it uses the datum the
 * terrain and the sea-level setting share: height 0.
 *
 * Display only. Height above ground (heightAboveGround.ts) still drives the flight hints, the
 * arrival camera, the music and the bots; nothing here feeds them.
 */
import { seaLevel } from '../world/seaLevel'
import { terrainDry } from '../world/terrain/settings'

/** The height ALT reads as zero, in world metres. */
export function seaDatum(dry = Number(terrainDry.value) >= 0.5, sea = seaLevel()): number {
  return dry || !Number.isFinite(sea) ? 0 : sea
}

/** Metres above sea level of a contact surface at world height `contactY`. */
export function altitudeAboveSea(contactY: number, datum = seaDatum()): number {
  return Number.isFinite(contactY) ? contactY - datum : 0
}
