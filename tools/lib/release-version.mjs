// Calendar versions for Syn3h production releases, as used by Freed and Vorteo.
//
//   v<YY>.<M>.<D><BB>     for example v26.11.1401
//
// YY is the two digit year, M the month and D the day, all in Pacific time and with no zero
// padding. BB is the build of that day, two digits counting from 00. So v26.11.1401 is the
// second production release on 14 November 2026, and v26.11.100 is the first on 1 November.
//
// Pure functions only: no git, no files, no clock. tools/release-notes.mjs supplies those.

const TIME_ZONE = 'America/Los_Angeles'
const VERSION = /^v?(\d{2})\.([1-9]|1[0-2])\.([1-9]\d?)(\d{2})$/
const MAX_BUILD = 99

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Parse "v26.11.1401" or "26.11.1401". Throws on anything else, including a day that the
 * month does not have and zero padded months or days.
 */
export function parseVersion(text) {
  if (typeof text !== 'string') throw new Error(`Not a version: ${String(text)}`)
  const match = text.trim().match(VERSION)
  if (!match) throw new Error(`Not a Syn3h version: "${text}". Expected vYY.M.DDBB, for example v26.11.1401.`)
  const yy = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const build = Number(match[4])
  if (day > daysInMonth(2000 + yy, month)) throw new Error(`Not a Syn3h version: "${text}". Day ${day} is not in month ${month}.`)
  const version = formatVersion({ yy, month, day, build })
  return { version, tag: `v${version}`, yy, month, day, build }
}

/** True when `text` parses as a Syn3h version, with or without the "v". */
export function isVersion(text) {
  try { parseVersion(text); return true } catch { return false }
}

/** { yy, month, day, build } to "26.11.1401", without the "v". */
export function formatVersion({ yy, month, day, build }) {
  const ok = Number.isInteger(yy) && yy >= 0 && yy <= 99 &&
    Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= daysInMonth(2000 + yy, month) &&
    Number.isInteger(build) && build >= 0 && build <= MAX_BUILD
  if (!ok) throw new Error(`Cannot format a version from ${JSON.stringify({ yy, month, day, build })}`)
  return `${String(yy).padStart(2, '0')}.${month}.${day}${String(build).padStart(2, '0')}`
}

/** Negative, zero or positive, for sorting. Accepts strings or parsed versions. */
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a
  const y = typeof b === 'string' ? parseVersion(b) : b
  return x.yy - y.yy || x.month - y.month || x.day - y.day || x.build - y.build
}

/** The calendar day of `date` in Pacific time, as { yy, month, day }. */
export function pacificDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error(`Not a date: ${String(date)}`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(date)
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  return { yy: get('year') % 100, month: get('month'), day: get('day') }
}

/**
 * The version for a release made at `date`, given every existing tag or version string.
 * Tags that are not Syn3h versions (m13.1-steering, release-1) are ignored. Builds count
 * from 00 on each Pacific day, one past the highest build already used that day.
 */
export function nextVersion(date, existing = []) {
  const { yy, month, day } = pacificDay(date)
  let build = 0
  for (const tag of existing) {
    if (!isVersion(tag)) continue
    const v = parseVersion(tag)
    if (v.yy === yy && v.month === month && v.day === day) build = Math.max(build, v.build + 1)
  }
  if (build > MAX_BUILD) throw new Error(`No builds left on ${yy}.${month}.${day}: ${MAX_BUILD + 1} already used.`)
  return `v${formatVersion({ yy, month, day, build })}`
}

const PACIFIC_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) (PST|PDT)$/
export const CHANNELS = ['milestone', 'production']

/**
 * Read ../Syn3h-stable/releases.tsv (written by tools/release.sh): which builds were deployed.
 * Columns: release, shipped (Pacific, "2026-11-14 19:08 PST"), url, milestone tag, commit,
 * Worker version, frozen copy id. Versions come from history.tsv, not from this file.
 */
export function releasesFromTsv(text) {
  const out = []
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '')
  for (const [i, line] of lines.entries()) {
    const [release, shipped, url, milestone, commit, workerVersion, frozen] = line.split('\t')
    if (!/^release-\d+$/.test(release ?? '')) throw new Error(`releases.tsv line ${i + 1}: expected release-N, got "${release}"`)
    if (!PACIFIC_TIME.test(shipped ?? '')) throw new Error(`releases.tsv line ${i + 1}: expected a Pacific time like "2026-11-14 19:08 PST", got "${shipped}"`)
    if (!/^[0-9a-f]{7,40}$/.test(commit ?? '')) throw new Error(`releases.tsv line ${i + 1}: expected a commit, got "${commit}"`)
    out.push({ release, shipped, url, milestone, commit, workerVersion, frozen })
  }
  return out
}

/**
 * Read release-notes/history.tsv: every version, oldest first. Lines starting with # are
 * comments. Columns: version, milestone tag, commit, Pacific time ("2026-11-14 14:06 PST"),
 * channel (milestone or production), and optionally preview (yes or no, default yes: whether
 * a milestone ran on a private preview; a plan or a build before the first preview did not).
 * Checks that each version's day is the day of its
 * time, that versions only rise, and that builds of a day run 00, 01, 02 with no gaps.
 */
export function parseHistory(text) {
  const rows = []
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  for (const [i, line] of lines.entries()) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const where = `history.tsv line ${i + 1}`
    const [version, milestone, commit, time, channel, preview = 'yes', ...rest] = line.split('\t')
    if (rest.length) throw new Error(`${where}: expected 5 or 6 columns, got ${6 + rest.length}`)
    if (preview !== 'yes' && preview !== 'no') throw new Error(`${where}: preview must be yes or no, got "${preview}"`)
    const v = parseVersion(version ?? '')
    if (version !== v.tag) throw new Error(`${where}: write the version as ${v.tag}`)
    if (!milestone) throw new Error(`${where}: no milestone tag`)
    if (!/^[0-9a-f]{7,40}$/.test(commit ?? '')) throw new Error(`${where}: expected a commit, got "${commit}"`)
    const when = (time ?? '').match(PACIFIC_TIME)
    if (!when) throw new Error(`${where}: expected a Pacific time like "2026-11-14 14:06 PST", got "${time}"`)
    if (Number(when[1]) % 100 !== v.yy || Number(when[2]) !== v.month || Number(when[3]) !== v.day) {
      throw new Error(`${where}: ${v.tag} is not on the day of ${time}`)
    }
    if (!CHANNELS.includes(channel)) throw new Error(`${where}: channel must be milestone or production, got "${channel}"`)
    const prev = rows.at(-1)
    if (prev) {
      if (compareVersions(prev.parsed, v) >= 0) throw new Error(`${where}: ${v.tag} does not follow ${prev.version}`)
      if (time < prev.time) throw new Error(`${where}: ${time} is earlier than ${prev.time}`)
    }
    const sameDay = prev && prev.parsed.yy === v.yy && prev.parsed.month === v.month && prev.parsed.day === v.day
    const expected = sameDay ? prev.parsed.build + 1 : 0
    if (v.build !== expected) throw new Error(`${where}: ${v.tag} should be build ${String(expected).padStart(2, '0')} of its day`)
    rows.push({ version: v.tag, milestone, commit, time, channel, preview: preview === 'yes', parsed: v, hour: Number(when[4]), minute: Number(when[5]) })
  }
  return rows
}

/** "2026-11-14 19:08 PST" as "7:08pm". */
export function clockTime(time) {
  const when = time.match(PACIFIC_TIME)
  if (!when) throw new Error(`Not a Pacific time: ${time}`)
  const hour = Number(when[4])
  return `${hour % 12 || 12}:${when[5]}${hour < 12 ? 'am' : 'pm'}`
}

/** "2026-11-14 19:08 PST" as "14 November 2026". */
export function longDate(time) {
  const when = time.match(PACIFIC_TIME)
  if (!when) throw new Error(`Not a Pacific time: ${time}`)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${Number(when[3])} ${months[Number(when[2]) - 1]} ${when[1]}`
}

/**
 * The line under the deck that says what kind of build a version was. A milestone never
 * reads as public.
 */
export function kindLine(row, url = 'https://www.syn3h.com/') {
  return row.channel === 'production'
    ? `Public release at ${clockTime(row.time)} Pacific on ${longDate(row.time)}, live at ${url}.`
    : row.preview === false
      ? `Milestone build at ${clockTime(row.time)} Pacific on ${longDate(row.time)}. It was not released publicly.`
      : `Milestone build at ${clockTime(row.time)} Pacific on ${longDate(row.time)}. It ran on a private preview and was not released publicly.`
}

/**
 * Pair each production row of the history with its releases.tsv row, by commit. Returns
 * the problems found: a production version with no deployed build, or a deployed build
 * with no production version.
 */
export function matchReleases(history, releases) {
  const same = (a, b) => a.startsWith(b) || b.startsWith(a)
  const problems = []
  const pairs = []
  for (const row of history.filter((r) => r.channel === 'production')) {
    const release = releases.find((r) => same(r.commit, row.commit))
    if (release) pairs.push({ ...row, release: release.release, shipped: release.shipped })
    else problems.push(`${row.version} is production but no build of ${row.commit} is in releases.tsv`)
  }
  for (const release of releases) {
    if (!history.some((r) => r.channel === 'production' && same(r.commit, release.commit))) {
      problems.push(`${release.release} (${release.commit}) has no production version in history.tsv`)
    }
  }
  return { pairs, problems }
}
