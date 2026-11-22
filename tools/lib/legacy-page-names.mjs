/**
 * Pages built before the rename to Mira (v26.11.2206 and earlier) expose their test hooks as
 * window.syn3h, window.syn3hNet and window.syn3hStartup; renamed builds use window.mira,
 * window.miraNet and window.miraStartup. Checks that can drive an older build (the rollback
 * check, the public check, the mixed-version check) add this as an init script, so `window.mira`
 * reads the old hook on an old page and is an ordinary property on a new one.
 *
 *   await context.addInitScript(legacyPageNames)
 *
 * Remove once no release older than the rename can be rolled back to (docs/NAMES.md).
 */
export function legacyPageNames() {
  for (const [name, old] of [['mira', 'syn3h'], ['miraNet', 'syn3hNet'], ['miraStartup', 'syn3hStartup']]) {
    if (Object.prototype.hasOwnProperty.call(window, name)) continue
    Object.defineProperty(window, name, {
      configurable: true,
      // Only an assigned value: a renamed build defines the old name as an accessor that reads
      // this one (src/core/legacyWindowNames.ts), and the two must not read each other.
      get() {
        const own = Object.getOwnPropertyDescriptor(window, old)
        return own && 'value' in own ? own.value : undefined
      },
      // A renamed build assigns its own hook: that replaces this accessor with a plain value.
      set(value) { Object.defineProperty(window, name, { value, writable: true, configurable: true, enumerable: true }) },
    })
  }
}
