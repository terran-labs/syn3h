/**
 * Day and night: how long a world's day lasts, and what hour it is, the same for everyone in
 * a room.
 *
 * Day length follows the planet's distance from the sun. A world's orbit (the lane the galaxy,
 * src/ui/galaxy/Galaxy.ts, gives it round the lobby's sun) sets its default day by one rule:
 *
 *     day = 300 s × 2 ^ ((orbit − 5.5) / 5.5), clamped to 150 s … 600 s
 *
 * Five minutes at the middle of the system (5.5 lobby units out, Archipelago's lane today), half
 * that a full middle-distance nearer the sun, double it as far again beyond. Every inner world
 * spins faster than every outer one. The host may override it in the World card; the setting
 * `sun.dayLength` stores seconds, 0 for a stopped clock, ORBIT_DEFAULT to follow the orbit.
 *
 * The hour is never stepped frame by frame. It is worked out from the room's shared clock:
 *
 *     hour = sun.timeOfDay + (now − sun.dayEpoch) × 24 / day length
 *
 * so every client with the same three settings and the same clock sees the same sky, a
 * rejoin lands on it again, and nothing drifts. When the hour or the day length is changed
 * here, the anchor is moved to now and to the hour on screen, so the sky does not jump: only
 * its pace changes.
 */
import { params, type ParamSource } from '../../../shared/params'
import { currentPlanet, PLANETS } from '../planets'
import { orbitLayout } from '../../ui/galaxy/Galaxy'
import { sunDayEpoch, sunDayLength, sunTimeOfDay } from './skyParams'
import { wrapHour } from './skyMath'

/** `sun.dayLength` value meaning "follow the planet's orbit". */
export const ORBIT_DEFAULT = -1
/** A full day at the reference orbit, in seconds, and that orbit in lobby units. */
export const DAY_AT_REFERENCE = 300, REFERENCE_ORBIT = 5.5
/** Moving this far out (lobby units) doubles a day; this far in halves it. */
export const DOUBLING_ORBIT = 5.5
/** The playable range any orbit can give, in seconds. Only reached by worlds yet to be added. */
export const ORBIT_DAY_MIN = 150, ORBIT_DAY_MAX = 600

/** A world's default full day and night, in whole seconds, from its orbit in lobby units. */
export function dayLengthForOrbit(orbit: number): number {
  const day = DAY_AT_REFERENCE * Math.pow(2, (orbit - REFERENCE_ORBIT) / DOUBLING_ORBIT)
  return Math.round(Math.min(ORBIT_DAY_MAX, Math.max(ORBIT_DAY_MIN, Number.isFinite(day) ? day : DAY_AT_REFERENCE)))
}

let lanes: readonly { orbit: number }[] | undefined
/**
 * A recipe's distance from the sun, read from the galaxy's own layout of the recipe worlds
 * (src/ui/galaxy/Galaxy.ts), so a reordered system changes the days with it. A moon in that
 * layout has a lane round the sun of its own and uses it. The middle orbit for an unknown id.
 */
export function planetOrbit(id: string): number {
  lanes ??= orbitLayout(PLANETS.map(planet => planet.body ?? { size: 1, heat: 0.5 }), 0)
  const index = PLANETS.findIndex(planet => planet.id === id)
  return index < 0 || !lanes[index] ? REFERENCE_ORBIT : lanes[index].orbit
}
/** A recipe's default day length in seconds. */
export function planetDayLength(id: string): number { return dayLengthForOrbit(planetOrbit(id)) }

/** Seconds per day in effect for a setting on a planet: 0 when the clock is stopped. */
export function effectiveDayLength(setting: number = sunDayLength.value, planetId: string = currentPlanet().id): number {
  if (setting < 0) return planetDayLength(planetId)
  return setting > 0 ? setting : 0
}

/** The hour at room time `now` given an anchor hour, the room time it held, and the day length. */
export function hourAt(anchorHour: number, anchorTime: number, dayLength: number, now: number): number {
  const elapsed = now - anchorTime
  if (!(dayLength > 0) || !Number.isFinite(elapsed)) return wrapHour(anchorHour)
  return wrapHour(anchorHour + (elapsed % dayLength) * 24 / dayLength)
}

// ---------------------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------------------

/** Off line, the wall clock in Unix seconds: the same base as a room's server. */
let clock: () => number = () => Date.now() / 1000
/** Follow the room's clock once networking has synced it (src/net, onRoomClock). */
export function setDayClock(now: () => number): void { clock = now }
/** Room seconds now, as the day reads them. */
export function dayNow(): number { return clock() }

/** The hour now, 0 to 24, from the shared settings and the room clock. */
export function currentHour(now: number = dayNow()): number {
  return hourAt(sunTimeOfDay.value, sunDayEpoch.value, effectiveDayLength(), now)
}

/**
 * Ease the hour shown toward the hour the clock gives. Unchanged while they agree (within a
 * few game minutes, the drift of a frame); across a step (a host's slider, a settings message
 * landing a frame before its partner, the clock's first sync) it glides the short way round
 * in about half a second rather than snapping the sky.
 */
export function followHour(shown: number | undefined, target: number, dt: number, seconds = 0.35): number {
  if (shown === undefined || !Number.isFinite(shown)) return wrapHour(target)
  const diff = ((((target - shown) % 24) + 36) % 24) - 12
  if (Math.abs(diff) < 0.05 || !(dt > 0)) return wrapHour(target)
  return wrapHour(shown + diff * (1 - Math.exp(-dt / seconds)))
}

/**
 * Keep the anchor honest. Call once per page (the Environment does). When this client sets
 * the hour, it is anchored at now; when it changes the day length, or the planet changes the
 * orbit default, the anchor moves to the hour on screen first so only the pace changes; a new
 * planet starts at its recipe's hour. Settings arriving from the room are left as they are:
 * the host who sent them anchored them. Returns the unsubscribe.
 */
export function bindDayClock(): () => void {
  let anchoring = false
  let length = effectiveDayLength()
  const anchor = (hour: number, source: ParamSource) => {
    anchoring = true
    try { params.set(sunTimeOfDay.def.id, hour, source); params.set(sunDayEpoch.def.id, dayNow(), source) } finally { anchoring = false }
  }
  // A page that has never anchored starts its first world's day now, at that world's hour.
  if (sunDayEpoch.value === 0) anchor(sunTimeOfDay.value, 'preset')
  return params.onChange((id, value, source) => {
    if (anchoring) return
    if (id === sunTimeOfDay.def.id) {
      if (source !== 'remote') { anchoring = true; try { params.set(sunDayEpoch.def.id, dayNow(), source) } finally { anchoring = false } }
    } else if (id === sunDayEpoch.def.id) {
      // A local reset puts the anchor back to 0: start the day again from now.
      if (source !== 'remote' && value === 0) anchor(sunTimeOfDay.value, source)
    } else if (id === sunDayLength.def.id || id === 'terrain.look') {
      const before = length
      length = effectiveDayLength()
      if (source === 'remote') return
      if (id === 'terrain.look') anchor(sunTimeOfDay.value, source)
      else if (before !== length) anchor(hourAt(sunTimeOfDay.value, sunDayEpoch.value, before, dayNow()), source)
    }
  })
}

/** "4m 30s", "45s", "1h", or "stopped": a day length for a label. */
export function formatDayLength(seconds: number): string {
  if (!(seconds > 0)) return 'stopped'
  const s = Math.round(seconds)
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600}h`
  const m = Math.floor(s / 60), r = s % 60
  return m ? (r ? `${m}m ${r}s` : `${m}m`) : `${r}s`
}
