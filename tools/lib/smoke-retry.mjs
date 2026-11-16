/**
 * When may a failed net-smoke step run again? Only when a page's socket dropped uncleanly
 * while the step ran: then the failure says something about the network, not the game.
 * A step that fails with no drop in its window fails; so does a step that fails twice.
 */
export const MAX_STEP_RETRIES = 3

/**
 * A browser page crashed under the smoke (Chromium's renderer or GPU process died): a failure of
 * the machine running the check, not of the game or the network. Playwright reports it as
 * "Target crashed" or "Page crashed".
 */
export function isBrowserCrash(text) {
  return /\b(Target|Page) crashed\b/i.test(String(text ?? ''))
}

/** Closes a page recorded at or after `since` (that page's own clock) that were not clean. */
export function uncleanSince(closes, since) {
  return (closes ?? []).filter((c) => c.at >= since && (!c.clean || c.code === 1006))
}

/**
 * 'pass' | 'fail' | 'retry' | 'unstable'.
 * supported: every page records its closes (builds before 16 November 2026 do not).
 * retryable: the step can run again from its own start (one that opens a page cannot).
 */
export function retryDecision({ failed, drops, retried, retriesUsed, supported = true, retryable = true }) {
  if (!failed) return 'pass'
  if (!supported || !retryable || retried || drops.length === 0) return 'fail'
  if (retriesUsed >= MAX_STEP_RETRIES) return 'unstable'
  return 'retry'
}
