/**
 * The game was called Syn3h until 22 November 2026, and its debugging and test hooks were
 * window.syn3h and window.syn3hNet. They are window.mira and window.miraNet now. Harness
 * scripts that builders and the Orchestrator keep outside the repository still use the old
 * names, so these two read through to the new hooks. Assigned here and nowhere else.
 *
 * Remove after 22 December 2026 (docs/NAMES.md).
 */
const aliases: ReadonlyArray<readonly [legacy: string, current: string]> = [['syn3h', 'mira'], ['syn3hNet', 'miraNet']]

if (typeof window !== 'undefined') {
  for (const [legacy, current] of aliases) {
    if (Object.prototype.hasOwnProperty.call(window, legacy)) continue
    Object.defineProperty(window, legacy, {
      configurable: true,
      get: () => (window as unknown as Record<string, unknown>)[current],
    })
  }
}

export {}
