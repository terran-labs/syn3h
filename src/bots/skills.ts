/**
 * How good the bots are at the games: one overall difficulty and the skills it scales. The
 * owner, 18 November 2026: "there should be an adjustable degree of accuracy and firing rate
 * for them, and it should be set fairly low initially to keep it fun instead of just having
 * them dominate human players. Actually, we should have options for all of their skills."
 *
 * Every skill is a room setting (world scope), live-tunable. Its value is what a bot does at
 * difficulty 0.5; `skill()` scales it by the difficulty, from half at 0 to double at 1, so one
 * slider makes them all easier or harder together. Errors scale the other way: a harder bot
 * misses by less.
 */
import { defineParam } from '../../shared/params'

const room = { group: 'Bots', scope: 'world' as const }

/**
 * Whether bots use gear in the games: Plasma Tag and Plasma Thunder in Tag, the Grapple on the
 * hill. On by default, as the owner asked for lasers there. Explore is governed elsewhere
 * (`bots.tagBeams`, and later the play setting). A new id rather than a new default on an old
 * one: saved worlds and room snapshots carry every value explicitly (see bots.tagBeams).
 */
export const gameGear = defineParam({ ...room, id: 'bots.gameGear', label: 'Bots use gear in Tag and King of the Hill', default: true })

/** One slider for all of a bot's game skills. 0.5 is each skill as set; 0 halves them, 1 doubles them. */
export const difficulty = defineParam({ ...room, id: 'bots.difficulty', label: 'Bot difficulty', default: 0.35, min: 0, max: 1, step: 0.05 })

/** Aim error at difficulty 0.5: the standard deviation of the angle a shot misses by, in degrees. */
export const aimError = defineParam({ ...room, id: 'bots.aimError', label: 'Bot aim error (degrees)', default: 5, min: 0, max: 30, step: 0.5 })
/** Shots a minute from one bot in Tag, at difficulty 0.5. */
export const fireRate = defineParam({ ...room, id: 'bots.fireRate', label: 'Bot Plasma Tag and Thunder a minute', default: 5, min: 0, max: 30, step: 0.5 })
/** The share of a bot's shots that are Plasma Thunder rather than Plasma Tag. Not scaled. */
export const thunderShare = defineParam({ ...room, id: 'bots.thunderShare', label: 'Bot share of Plasma Thunder', default: 0.15, min: 0, max: 1, step: 0.05 })
/** How hard a pursuing bot commits to contact in the games, 0 to 1, at difficulty 0.5. */
export const ramming = defineParam({ ...room, id: 'bots.ramming', label: 'Bot ramming', default: 0.4, min: 0, max: 1, step: 0.05 })
/** How well a pursuing bot leads its target, 0 (chases where it is) to 1 (heads for where they will meet). */
export const intercept = defineParam({ ...room, id: 'bots.intercept', label: 'Bot interception', default: 0.5, min: 0, max: 1, step: 0.05 })
/** Grapples a minute from one bot at the hill's holder, at difficulty 0.5. */
export const grappleRate = defineParam({ ...room, id: 'bots.grappleRate', label: 'Bot grapples a minute (hill)', default: 0.4, min: 0, max: 6, step: 0.1 })

/** How much the difficulty multiplies a skill: 0.5 at 0, 1 at 0.5, 2 at 1, smoothly (2 to the power 2d - 1). */
export function difficultyScale(d = difficulty.value): number {
  return 2 ** (2 * Math.max(0, Math.min(1, d)) - 1)
}

/** A skill at the current difficulty. Rates and strengths grow with it; pass `error` for things that shrink. */
export function skill(value: number, kind: 'more' | 'error' | 'unit' = 'more', d = difficulty.value): number {
  const s = difficultyScale(d)
  if (kind === 'error') return value / s
  if (kind === 'unit') return Math.max(0, Math.min(1, value * s))
  return value * s
}

/** Most bots on any one person at once, in every game and play (the Foreman's cap, 18 November 2026). */
export const PER_PERSON = 2
