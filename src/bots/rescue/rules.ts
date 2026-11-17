/**
 * The rescue's decisions, as plain functions: when a bot counts as stuck, who goes to help,
 * which way to pull, and when the accident-prone bot next gets into trouble. No physics, no
 * DOM, so the tests run them over long simulated sessions.
 */
import { defineParam } from '../../../shared/params'
import { seededRandom, hashString } from '../random'

/**
 * How often the session's accident-prone bot takes a bolder line into trouble, per hour of
 * play. 0 turns it off; the bot then gets stuck only as often as any other.
 */
export const botMishaps = defineParam({ id: 'bots.mishapsPerHour', label: 'Accident-prone bot: mishaps per hour', group: 'Bots', scope: 'world', default: 3, min: 0, max: 12, step: 1 })

/** The signals the bots already keep (BotBrain.trouble), seconds. */
export interface Trouble { stuck: number; flipped: number; bog: number }

/** Seconds of each kind of trouble that count as needing help. */
export const STUCK_AFTER = { stuck: 5, flipped: 3.5, bog: 3 }

/**
 * Stuck, and how: wheels in liquid, upside down past the vehicle's own self-righting, or going
 * nowhere while trying. Null when it is fine. Bogged wins over wedged: a bot in the sea also
 * makes no progress.
 */
export function stuckKind(t: Trouble): 'bogged' | 'flipped' | 'wedged' | null {
  if (t.bog >= STUCK_AFTER.bog) return 'bogged'
  if (t.flipped >= STUCK_AFTER.flipped) return 'flipped'
  if (t.stuck >= STUCK_AFTER.stuck) return 'wedged'
  return null
}

export interface Candidate {
  id: number
  /** Metres to the stuck bot. */
  distance: number
  /** 0..1 from its character: how hard it is to pull away from a player (voices.ts). */
  loyalty: number
  /** It is with a player right now (a request, or trailing the host). */
  withPlayer: boolean
  /** It can rescue at all (has a mind, is not stuck, is not already busy rescuing). */
  able: boolean
  /** Eager characters peel off at once (the intern). */
  eager?: boolean
  /** A hovercraft or jet: it can pull from over the water, where a buggy is dragged in. */
  floats?: boolean
}

export interface Situation {
  /** Seconds the bot has been stuck. */
  stuckFor: number
  /** Rescuers already on the way. */
  helpers: number
  /** A game of Tag is on: leaving the game costs more. */
  tag: boolean
  /** The room's "Bots rescue each other". */
  enabled: boolean
  /** The stuck vehicle is in liquid. */
  liquid?: boolean
}

export const MAX_RESCUERS = 2
/** Farther than this, a bot does not notice. */
export const RESCUE_RANGE = 220

/**
 * Score staying against going, per bot. Higher goes. Legible on purpose:
 *   +1 to start, the urge to help
 *   - loyalty, if it is with a player (the loyal one stays)
 *   - distance / 150 (far is a long way)
 *   + stuck seconds / 30, up to 1 (guilt grows)
 *   - 0.6 per rescuer already going
 *   - 0.4 in a game of Tag
 *   + 0.3 if eager
 *   + 0.8 for a hovercraft or jet when the stuck one is in liquid (a buggy on the shore is
 *     dragged into the water by the cord; in trials a hovercraft frees a vehicle 2.6 m deep
 *     every time, a buggy about two times in three)
 */
export function rescueScore(c: Candidate, s: Situation): number {
  return 1 - (c.withPlayer ? c.loyalty : 0) - c.distance / 150 + Math.min(1, s.stuckFor / 30) - 0.6 * s.helpers - (s.tag ? 0.4 : 0) + (c.eager ? 0.3 : 0) + (c.floats && s.liquid ? 0.8 : 0)
}

/** Who goes now: the best scores above the line, at most two in all, none with the setting off. */
export function chooseRescuers(candidates: readonly Candidate[], s: Situation, threshold = 0.45): number[] {
  if (!s.enabled) return []
  const out: number[] = []
  let helpers = s.helpers
  const ranked = candidates.filter((c) => c.able && c.distance < RESCUE_RANGE).map((c) => ({ c, score: rescueScore(c, s) })).sort((a, b) => b.score - a.score)
  for (const { c } of ranked) {
    if (helpers >= MAX_RESCUERS) break
    // Re-score with the helpers already chosen: the second one has to want it more.
    if (rescueScore(c, { ...s, helpers }) < threshold) continue
    out.push(c.id); helpers++
  }
  return out
}

/** Torn: with a player and the score close to the line either way. These say so out loud. */
export function torn(c: Candidate, s: Situation, threshold = 0.45): boolean {
  return c.withPlayer && Math.abs(rescueScore(c, s) - threshold) < 0.45
}

/**
 * Which way to pull a stuck vehicle out: back along the way it came for a wedge (its recent
 * track, reversed), towards dry ground for a bog, a little uphill for a flip. Unit (x, z).
 */
export function pullDirection(
  kind: 'bogged' | 'flipped' | 'wedged',
  at: { x: number; z: number },
  cameFrom: { x: number; z: number } | null,
  heading: { x: number; z: number },
  dry: (x: number, z: number) => boolean,
  height: (x: number, z: number) => number,
): { x: number; z: number } {
  const unit = (x: number, z: number) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l } }
  if (kind === 'bogged') {
    for (const r of [6, 12, 20, 32]) {
      let best: { x: number; z: number } | null = null, bestH = -Infinity
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r
        if (dry(x, z) && height(x, z) > bestH) { bestH = height(x, z); best = { x: Math.cos(a), z: Math.sin(a) } }
      }
      if (best) return best
    }
  }
  if (kind === 'flipped') {
    // Uphill is where the roll-over pull has the ground's help, not its weight against it.
    const gx = height(at.x + 2, at.z) - height(at.x - 2, at.z), gz = height(at.x, at.z + 2) - height(at.x, at.z - 2)
    if (Math.hypot(gx, gz) > 0.1) return unit(gx, gz)
  }
  if (cameFrom && Math.hypot(cameFrom.x - at.x, cameFrom.z - at.z) > 2) return unit(cameFrom.x - at.x, cameFrom.z - at.z)
  return unit(-heading.x, -heading.z)
}

/**
 * When the accident-prone bot next goes looking for trouble: a seeded schedule at `perHour`
 * mishaps an hour, never closer together than four minutes, so it is a running joke and not
 * a constant one.
 *
 * `due` only asks; `happened` uses the turn up. A moment when the bot is busy is tried again
 * at the next decision rather than thrown away (which, when a bot was nearly always with a
 * player, meant a whole gap of four minutes or more lost each time, and no mishap at all).
 */
export class MishapSchedule {
  private next: number
  /** The last mishap, or when the schedule began: the four-minute floor counts from here. */
  private last: number
  private rate: number
  private readonly random: () => number
  constructor(seed: string, now: number, private readonly perHour: () => number) {
    this.random = seededRandom(hashString(`mishaps:${seed}`))
    this.last = now
    this.rate = perHour()
    this.next = now + this.gap()
  }

  /** True when a mishap may happen now. Nothing is used up until `happened`. */
  due(now: number): boolean {
    const rate = this.perHour()
    if (rate <= 0) { this.rate = 0; return false }
    // A new rate takes effect at once, still at least four minutes after the last mishap.
    if (rate !== this.rate) { this.rate = rate; this.next = this.last + this.gap() }
    return now >= this.next
  }

  /** A mishap began now: the next is a fresh gap away. */
  happened(now: number): void {
    this.last = now
    this.next = now + this.gap()
  }

  /** Not possible just now (no shore near): ask again in `seconds`. */
  later(now: number, seconds: number): void {
    this.next = Math.max(this.next, now + seconds)
  }

  private gap(): number {
    // A floor of four minutes plus an exponential gap for the surprise, its mean chosen so
    // the average rate is the one asked for (down to one every five minutes at the top).
    const mean = Math.max(60, 3600 / Math.max(0.01, this.perHour()) - 240)
    return 240 - Math.log(1 - this.random() * 0.999) * mean
  }
}
