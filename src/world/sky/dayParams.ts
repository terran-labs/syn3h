/**
 * The two day clock settings, apart from the rest of the sky so the room server can import
 * them alone: it validates the anchor (a Unix time, beyond its limit for unknown settings) and
 * reads an old room's day length (server/room.ts). See dayCycle.ts for how they are used.
 */
import { defineParam } from '../../../shared/params'

const w = 'world' as const
/**
 * Real seconds per full day and night. ORBIT_DEFAULT (-1) follows the planet's distance from
 * the sun (dayCycle.ts); 0 stops the clock. Rooms and links that stored nothing get the orbit.
 */
export const sunDayLength = defineParam({ id: 'sun.dayLength', label: 'Day length (s)', group: 'Sun', scope: w, default: -1, min: -1, max: 3600, step: 1 })
/**
 * Room clock seconds (Unix time on the room's server) at which the hour was `sun.timeOfDay`.
 * Set with the hour, never by hand; the inspector hides it.
 */
export const sunDayEpoch = defineParam({ id: 'sun.dayEpoch', label: 'Day clock anchor (s)', group: 'Sun', scope: w, default: 0, min: 0, max: 1e11, hidden: true })
