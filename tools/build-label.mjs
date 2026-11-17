/**
 * The build label shown beside the lobby's settings gear. A released build is its version,
 * set by the release script. A development build is "dev · " and the short commit, read from
 * git describe, so it stays short and never needs truncating; a checkout sitting exactly on a
 * release tag still shows that release.
 */
const RELEASE = /^v?\d+\.\d+\.\d+$/

/** From `git describe --tags --always` output (or null when git is unavailable) to a label. */
export function devLabel(describe) {
  const text = (describe ?? '').trim()
  if (RELEASE.test(text)) return text
  // "<tag>-<commits>-g<sha>[-dirty]", or a bare sha when no tag is reachable.
  const sha = /-g([0-9a-f]{7,})(?:-dirty)?$/.exec(text)?.[1] ?? (/^[0-9a-f]{7,}$/.test(text) ? text : null)
  return sha ? `dev · ${sha.slice(0, 7)}` : 'dev'
}
