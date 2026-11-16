/**
 * The slow build and the theremin's place in it, as pure functions so the rules are tested
 * without Web Audio. The conductor (Score.ts) feeds these from the clock and the world's hour.
 *
 *  growth    0..1, how far the piece has built since play began. It rises over
 *            `audio.buildTime` seconds of play and stays at 0 in the lobby.
 *  presence  0..1, how far forward the theremin lead may come: scarce by day, allowed
 *            forward at night, eased across dusk and dawn so it never switches.
 */
import type { Role } from './Composer'
import { params } from '../../../shared/params'

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
const finite = (v: number, fallback: number) => Number.isFinite(v) ? v : fallback

/**
 * The world's hour, 0..24, as the score hears it. The one place it is read: when
 * feat/day-by-orbit lands, sun.timeOfDay becomes an anchor hour and this should return
 * currentHour() from src/world/sky/dayCycle.ts instead.
 */
export const worldHour = (): number => Number(params.get('sun.timeOfDay')?.value ?? 12)

/** Growth at which each part of the arc may begin. `still` (pads, drone, a picked chord) is always open. */
export const OPENS = { build: 0.35, theme: 0.55, climb: 0.8 } as const
/** Lead presence below which the theme is not stated at all: by day the lead waits for the climb. */
export const THEME_PRESENCE = 0.2
/**
 * Highest intensity the music may reach at a given growth: layers come with time, not with
 * the first push of the throttle. Eased in, so with a five-minute build the sequencer begins
 * to move at about half a minute, bass and drums arrive after a minute and a half, and a full
 * chase is possible only near the end.
 */
export const intensityCeiling = (growth: number) => 0.08 + 0.92 * Math.min(1, Math.max(0, finite(growth, 0))) ** 1.5

/**
 * 0 by day, 1 by night, eased across dawn (05:00 to 07:30) and dusk (17:30 to 20:00).
 * Continuous in the hour, and wraps at midnight.
 */
export function nightness(hour: number): number {
  const h = ((finite(hour, 12) % 24) + 24) % 24
  return h < 12 ? 1 - smooth(5, 7.5, h) : smooth(17.5, 20, h)
}

/**
 * How far forward the lead may come, 0..1. `level` is the player's theremin level, `day` the
 * share of it heard in full daylight, `lobby` its level in the lobby (0 is silent there).
 */
export function leadPresence(playing: boolean, hour: number, level: number, day: number, lobby: number): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, finite(v, 0)))
  if (!playing) return clamp(lobby) * clamp(level)
  const share = clamp(day) + (1 - clamp(day)) * nightness(hour)
  return clamp(level) * share
}

/**
 * Whether a section may begin, given how far the piece has built and how present the lead may
 * be. The lobby never climbs: it stays in the still opening, with an occasional statement of
 * the theme only if the player has given the lead a lobby level.
 */
export function roleOpen(role: Role, growth: number, presence: number, lobby = false): boolean {
  if (lobby) return role === 'still' || (role === 'theme' && presence >= THEME_PRESENCE)
  switch (role) {
    case 'still': return true
    case 'build': return growth >= OPENS.build
    case 'theme': return growth >= OPENS.theme && presence >= THEME_PRESENCE
    default: return growth >= OPENS.climb
  }
}
