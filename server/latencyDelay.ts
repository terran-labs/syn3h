/**
 * The latency proxy's delivery schedule (server/latency-proxy.ts), kept apart so it can be
 * tested: every message is held back by a delay and delivered strictly in the order it came,
 * as a TCP connection would.
 *
 * Order is kept by one queue and one timer, not by one timer per message. A timer per message
 * reordered them: each delay was computed from Date.now(), but Node starts every timer from
 * the loop time cached at the start of the turn. Two messages handled in one turn a
 * millisecond apart, the second's due time held back to the first's, gave the second a
 * shorter delay from the same start, so it fired first. The room sends a mode change and the
 * state before it within a millisecond, and a client that saw them swapped stayed in the old
 * mode; the dry run's latency smoke failed on it.
 */

export interface DelayOptions {
  /** Round trip added, ms; each direction gets half. */
  rtt: number
  /** Extra delay per message, uniformly random in [0, jitter] ms. */
  jitter: number
  /** Chance that a message is lost and must be resent, 0 to 1. */
  loss?: number
  /** Retransmission delay after a loss, ms. */
  rto?: number
  /** If `t` falls inside a stall window, the end of that window; otherwise `t`. */
  afterStall?: (t: number) => number
  now?: () => number
  random?: () => number
}

/** A sender that delivers after the configured delay without ever reordering. */
export function delayedSender<T extends unknown[]>(send: (...args: T) => void, opts: DelayOptions): (...args: T) => void {
  const now = opts.now ?? Date.now
  const random = opts.random ?? Math.random
  const queue: { due: number; args: T }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = 0

  const flush = () => {
    timer = null
    // Everything due, in arrival order; a later message never passes an earlier one.
    while (queue.length && queue[0].due <= now()) send(...queue.shift()!.args)
    arm()
  }
  const arm = () => {
    if (timer || !queue.length) return
    timer = setTimeout(flush, Math.max(0, queue[0].due - now()))
  }

  return (...args: T) => {
    let hold = 0
    const loss = opts.loss ?? 0
    if (loss > 0 && random() < loss) {
      hold = opts.rto ?? 200
      for (let n = 0; n < 3 && random() < loss; n++) hold *= 2
    }
    // `last` keeps a held message's followers behind it (head of line blocking).
    const due = (opts.afterStall ?? ((t) => t))(Math.max(last, now() + opts.rtt / 2 + random() * opts.jitter + hold))
    last = due
    queue.push({ due, args })
    arm()
  }
}
