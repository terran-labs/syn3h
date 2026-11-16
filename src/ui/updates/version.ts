/** Calendar versions like v26.11.1603 (year, month, day and release of the day). */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

/** "v26.11.1603" or "26.11.1603" to "26.11.1603"; anything else, such as a dev build label, to null. */
export function bareVersion(text: unknown): string | null {
  const match = VERSION.exec(String(text ?? '').trim())
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null
}

/** Negative when a is older than b, positive when newer, 0 when the same. Invalid sorts oldest. */
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a.trim()), y = VERSION.exec(b.trim())
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0)
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return d }
  return 0
}

/** True only when both are versions and the candidate is strictly newer. */
export function isNewer(candidate: string, current: string): boolean {
  return bareVersion(candidate) !== null && bareVersion(current) !== null && compareVersions(candidate, current) > 0
}

export function latestVersion(list: readonly unknown[]): string | null {
  let best: string | null = null
  for (const item of list) { const v = bareVersion(item); if (v && (!best || compareVersions(v, best) > 0)) best = v }
  return best
}
