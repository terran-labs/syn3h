/**
 * How much the bots may say without being asked: one room-wide allowance, so adding bots
 * does not add noise. The director (Director.ts) checks every line against it in speak().
 *
 * Exempt, never counted or dropped: a bot answering a person who addressed it, and the lines
 * a player needs to follow a rescue. Everything else (idle talk, reactions, bot-to-bot
 * replies, rescue colour) draws from a bucket that refills at `bots.chatterAmount` times
 * today's rate. An exchange (a line and the replies queued behind it) may run to three lines,
 * one token each, and then the room goes quiet until the bucket refills.
 */
import { botChatterAmount } from '../../../shared/chat'

export { botChatterAmount }

/**
 * Unprompted lines a minute at amount 1, at chatter level normal: measured with one person
 * and four bots on two planets, about 70 budgeted lines in ten
 * minutes. Quiet and chatty scale it (LEVEL_SCALE).
 */
export const BASE_PER_MINUTE = 7
const LEVEL_SCALE = [0.4, 1, 2]
/** Lines one exchange may run to: a remark and up to two replies. */
export const EXCHANGE_MAX = 3
/** The bucket holds at most one exchange. */
const CAPACITY = EXCHANGE_MAX

/** Pool keys that never count against the budget. */
// Rescue lines are not exempt by key: the director's rescue wrapper (Director.rescueLine)
// marks the ones a player needs as news (the first start of a rescue, the call, the outcome),
// and repeats of the same keys are colour that counts.
export const BUDGET_EXEMPT: ReadonlySet<string> = new Set<string>()

/** A bot answering a person: requests, looks, tag, a request wearing off, choosing between two people. */
export function isExemptPrefix(key: string): boolean {
  return /^(req|look|tag|bored)\./.test(key) || key === 'follow.split'
}

export function exempt(key: string): boolean {
  return BUDGET_EXEMPT.has(key) || isExemptPrefix(key)
}

export class ChatterBudget {
  private tokens = 1
  private at = 0
  private left = 0

  /**
   * May a budgeted line be said now? `newExchange` when nothing else is queued: it needs a
   * whole token and opens an exchange of up to EXCHANGE_MAX lines; a reply needs room in it.
   * Seconds on any clock.
   */
  take(now: number, newExchange: boolean, amount: number, level: number): boolean {
    const rate = (BASE_PER_MINUTE * amount * (LEVEL_SCALE[level] ?? 1)) / 60
    this.tokens = Math.min(CAPACITY, this.tokens + Math.max(0, now - this.at) * rate)
    this.at = now
    if (amount <= 0) return false
    if (newExchange) {
      if (this.tokens < 1) return false
      this.left = EXCHANGE_MAX
    } else if (this.left <= 0) return false
    this.left--
    this.tokens -= 1
    return true
  }
}
