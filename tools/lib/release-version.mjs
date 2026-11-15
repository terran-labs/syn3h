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

/**
 * Read ../Syn3h-stable/releases.tsv (written by tools/release.sh) and give each release-N its
 * calendar version, in the order the file lists them. Columns: release, shipped (Pacific,
 * "2026-11-14 19:08 PST"), url, milestone tag, commit, Worker version, frozen copy id.
 * The shipped column is already Pacific, so its date is used as written.
 */
export function releasesFromTsv(text) {
  const out = []
  const used = new Map()
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '')
  for (const [i, line] of lines.entries()) {
    const cols = line.split('\t')
    const [release, shipped, url, milestone, commit, workerVersion, frozen] = cols
    if (!/^release-\d+$/.test(release ?? '')) throw new Error(`releases.tsv line ${i + 1}: expected release-N, got "${release}"`)
    const when = (shipped ?? '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) (PST|PDT)$/)
    if (!when) throw new Error(`releases.tsv line ${i + 1}: expected a Pacific time like "2026-11-14 19:08 PST", got "${shipped}"`)
    const yy = Number(when[1]) % 100, month = Number(when[2]), day = Number(when[3])
    const key = `${yy}.${month}.${day}`
    const build = used.has(key) ? used.get(key) + 1 : 0
    used.set(key, build)
    out.push({ release, version: `v${formatVersion({ yy, month, day, build })}`, shipped, url, milestone, commit, workerVersion, frozen })
  }
  return out
}
