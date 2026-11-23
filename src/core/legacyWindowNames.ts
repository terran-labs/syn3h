/**
 * The game was called Syn3h until 22 November 2026, and its debugging and test hooks were
 * window.syn3h, window.syn3hNet and window.syn3hStartup. They are window.mira, window.miraNet
 * and window.miraStartup now. Harness scripts that builders and the Orchestrator keep outside
 * the repository still use the old names, and so does the previous release's copy of the
 * hosted check (docs/NAMES.md), so these read through to the new hooks. Assigned here and
 * nowhere else.
 *
 * Remove after 22 December 2026 (docs/NAMES.md).
 */
const aliases: ReadonlyArray<readonly [legacy: string, current: string]> = [['syn3h', 'mira'], ['syn3hNet', 'miraNet'], ['syn3hStartup', 'miraStartup']]

if (typeof window !== 'undefined') {
  for (const [legacy, current] of aliases) {
    if (Object.prototype.hasOwnProperty.call(window, legacy)) continue
    Object.defineProperty(window, legacy, {
      configurable: true,
      // Only an assigned value, never another accessor: a check's init script may have put a
      // read-through accessor on the new name (tools/lib/legacy-page-names.mjs), and two
      // accessors reading each other would recurse until the stack overflows.
      get: () => {
        const own = Object.getOwnPropertyDescriptor(window, current)
        return own && 'value' in own ? own.value : undefined
      },
    })
  }
}

export {}
