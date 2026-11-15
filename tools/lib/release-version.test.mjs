// node --test tools/lib/release-version.test.mjs
// node:test beside the tool, like tools/serve-stable.test.mjs: vitest excludes tools/**.
import assert from 'node:assert/strict'
import test from 'node:test'
import { compareVersions, formatVersion, isVersion, nextVersion, pacificDay, parseVersion, releasesFromTsv } from './release-version.mjs'
import { draftNotes, referencedAssets, renderNotes, screenshotSection } from '../release-notes.mjs'

// 14 November 2026, 19:08 PST is 03:08 UTC on the 15th.
const release1 = new Date('2026-11-15T03:08:00Z')

test('first build of a day is 00', () => {
  assert.equal(nextVersion(release1, []), 'v26.11.1400')
  assert.equal(nextVersion(release1, ['m13.1-steering', 'release-1', 'v1.2.3']), 'v26.11.1400')
})

test('later builds count up from the highest used that day', () => {
  assert.equal(nextVersion(release1, ['v26.11.1400']), 'v26.11.1401')
  assert.equal(nextVersion(release1, ['v26.11.1400', 'v26.11.1401']), 'v26.11.1402')
  assert.equal(nextVersion(release1, ['v26.11.1405', 'v26.11.1400']), 'v26.11.1406')
  assert.equal(nextVersion(release1, ['26.11.1409']), 'v26.11.1410')
  // Other days do not count.
  assert.equal(nextVersion(release1, ['v26.11.1307', 'v26.10.1404', 'v25.11.1404']), 'v26.11.1400')
})

test('a day runs out after build 99', () => {
  assert.throws(() => nextVersion(release1, ['v26.11.1499']), /No builds left/)
})

test('the day is the Pacific day, not the UTC day', () => {
  assert.deepEqual(pacificDay(release1), { yy: 26, month: 11, day: 14 })
  assert.deepEqual(pacificDay(new Date('2026-11-15T08:30:00Z')), { yy: 26, month: 11, day: 15 })
  // Daylight time: 23:30 PDT on 1 July is 06:30 UTC on 2 July.
  assert.deepEqual(pacificDay(new Date('2026-07-02T06:30:00Z')), { yy: 26, month: 7, day: 1 })
})

test('days 1 to 9 are not zero padded', () => {
  assert.equal(nextVersion(new Date('2026-11-01T20:00:00Z'), []), 'v26.11.100')
  assert.equal(nextVersion(new Date('2026-11-09T20:00:00Z'), ['v26.11.900']), 'v26.11.901')
  assert.deepEqual(parseVersion('v26.11.100'), { version: '26.11.100', tag: 'v26.11.100', yy: 26, month: 11, day: 1, build: 0 })
  assert.deepEqual(parseVersion('26.4.1203'), { version: '26.4.1203', tag: 'v26.4.1203', yy: 26, month: 4, day: 12, build: 3 })
  assert.equal(parseVersion('v26.11.1000').day, 10)
  assert.equal(formatVersion({ yy: 26, month: 1, day: 5, build: 7 }), '26.1.507')
})

test('month and year rollover', () => {
  // 23:59 PST on 30 November, then the first minute of 1 December.
  assert.equal(nextVersion(new Date('2026-12-01T07:59:00Z'), ['v26.11.3003']), 'v26.11.3004')
  assert.equal(nextVersion(new Date('2026-12-01T08:00:00Z'), ['v26.11.3003']), 'v26.12.100')
  // New Year's Eve, then New Year's Day.
  assert.equal(nextVersion(new Date('2027-01-01T07:59:00Z'), ['v26.12.3100']), 'v26.12.3101')
  assert.equal(nextVersion(new Date('2027-01-01T08:00:00Z'), ['v26.12.3101']), 'v27.1.100')
})

test('compare orders by year, month, day, then build', () => {
  const sorted = ['v27.1.100', 'v26.11.1401', 'v26.12.100', 'v26.11.1400', 'v26.11.900', 'v26.2.2800']
    .sort(compareVersions)
  assert.deepEqual(sorted, ['v26.2.2800', 'v26.11.900', 'v26.11.1400', 'v26.11.1401', 'v26.12.100', 'v27.1.100'])
  assert.equal(compareVersions('v26.11.1400', '26.11.1400'), 0)
})

test('malformed versions are rejected', () => {
  for (const bad of [
    '', 'v', 'release-1', 'm13.1-steering', 'v26.11', 'v26.11.14', 'v26.11.1', // too short
    'v26.11.14000', 'v26.11.14001', // build of three digits
    'v26.13.100', 'v26.0.100', 'v26.011.1400', // month out of range or padded
    'v26.11.0100', 'v26.11.000', 'v26.11.3100', 'v26.2.3000', 'v27.2.2900', // day padded, zero or not in the month
    'v2026.11.1400', 'V26.11.1400', 'v26.11.1400-dev', ' v26 .11.1400', 'vv26.11.1400',
  ]) {
    assert.equal(isVersion(bad), false, bad)
    assert.throws(() => parseVersion(bad), /Not a Syn3h version/, bad)
  }
  assert.equal(isVersion('v28.2.2900'), true, 'leap day')
  assert.throws(() => parseVersion(undefined), /Not a version/)
  assert.throws(() => formatVersion({ yy: 26, month: 11, day: 14, build: 100 }), /Cannot format/)
  assert.throws(() => nextVersion(new Date('nonsense')), /Not a date/)
})

const TSV = [
  'release-1\t2026-11-14 19:08 PST\thttps://syn3h.af-4e7.workers.dev/\tm13.1-steering\tee73e41\t9c01cffa-51a2-4da8-bf00-27b3d1de8bb0\t20261114-190707-ee73e41',
  'release-2\t2026-11-14 20:07 PST\thttps://syn3h.af-4e7.workers.dev/\tm14.2-release2\tbc8cb48\t747d2041-ba63-403a-818f-77834ae9951a\t20261114-200625-bc8cb48',
  '',
].join('\n')

test('releases.tsv maps release-N to its version', () => {
  const rows = releasesFromTsv(TSV)
  assert.deepEqual(rows.map((r) => [r.release, r.version, r.milestone, r.commit]), [
    ['release-1', 'v26.11.1400', 'm13.1-steering', 'ee73e41'],
    ['release-2', 'v26.11.1401', 'm14.2-release2', 'bc8cb48'],
  ])
  const later = releasesFromTsv(TSV + 'release-3\t2026-11-15 09:30 PST\tu\tm15\tabc1234\tid\tf\n')
  assert.equal(later[2].version, 'v26.11.1500')
})

test('releases.tsv with a malformed row is rejected', () => {
  assert.throws(() => releasesFromTsv('first\t2026-11-14 19:08 PST\n'), /expected release-N/)
  assert.throws(() => releasesFromTsv('release-1\t2026-11-14T19:08\n'), /expected a Pacific time/)
})

test('a draft cannot render until it is written', () => {
  const draft = draftNotes('v26.11.1500', 'release-2', 'm15', ['abc1234 Buggy: a -- b'])
  assert.match(draft, /^\(AI Generated\)\n\n## Syn3h v26\.11\.1500\n/)
  assert.throws(() => renderNotes(draft, 'v26.11.1500'), /still contain TODO/)
})

test('render strips comments and checks the shape', () => {
  const notes = [
    '(AI Generated)', '', '## Syn3h v26.11.1500', '', 'A deck', '', '<!-- private -->', '',
    '### Features', '', '- a', '', '### Fixes', '', '- b', '', '### Play', '', 'p', '',
    '### Known issues', '', '- k', '', screenshotSection('v26.11.1500'), '',
  ].join('\n')
  const body = renderNotes(notes, 'v26.11.1500')
  assert.doesNotMatch(body, /private|\n\n\n/)
  assert.throws(() => renderNotes(notes, 'v26.11.1501'), /heading must be/)
  assert.throws(() => renderNotes(notes.replace('(AI Generated)', '(AI Generated).'), 'v26.11.1500'), /first line/)
  assert.throws(() => renderNotes(notes.replace('- b', '- b — c'), 'v26.11.1500'), /dash/)
  const names = referencedAssets(body, 'v26.11.1500')
  assert.equal(names[0], 'syn3h-showcase.gif')
  assert.equal(names.length, 11)
})
