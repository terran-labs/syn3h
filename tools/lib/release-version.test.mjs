// node --test tools/lib/release-version.test.mjs
// node:test beside the tool, like tools/serve-stable.test.mjs: vitest excludes tools/**.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { compareVersions, formatVersion, isVersion, kindLine, matchReleases, nextVersion, pacificDay, parseHistory, parseVersion, releasesFromTsv } from './release-version.mjs'
import { draftNotes, parseManifest, referencedAssets, renderNotes, screenshotSection } from '../release-notes.mjs'

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

// The checked-in history, so a bad edit to it fails here.
const HISTORY_TEXT = readFileSync(new URL('../../release-notes/history.tsv', import.meta.url), 'utf8')
const HISTORY = parseHistory(HISTORY_TEXT)

test('the checked-in history: fourteen builds of 14 November, two of them public', () => {
  assert.equal(HISTORY.length, 14)
  assert.equal(HISTORY[0].version, 'v26.11.1400')
  assert.equal(HISTORY[0].milestone, 'm00-proposal')
  assert.equal(HISTORY.at(-1).version, 'v26.11.1413')
  assert.deepEqual(HISTORY.filter((r) => r.channel === 'production').map((r) => [r.version, r.milestone, r.commit]), [
    ['v26.11.1412', 'm13.1-steering', 'ee73e41'],
    ['v26.11.1413', 'm14.2-release2', 'bc8cb48'],
  ])
  assert.ok(!HISTORY.some((r) => /^m14\.[34]/.test(r.milestone)), 'unshipped candidates are not in the history')
  const { pairs, problems } = matchReleases(HISTORY, releasesFromTsv(TSV))
  assert.deepEqual(problems, [])
  assert.deepEqual(pairs.map((p) => [p.release, p.version]), [['release-1', 'v26.11.1412'], ['release-2', 'v26.11.1413']])
})

test('next comes after the history', () => {
  const versions = HISTORY.map((r) => r.version)
  assert.equal(nextVersion(new Date('2026-11-15T05:30:00Z'), versions), 'v26.11.1414') // 9:30pm on the 14th
  assert.equal(nextVersion(new Date('2026-11-15T18:00:00Z'), versions), 'v26.11.1500') // 10am on the 15th
})

test('kind lines never call a milestone public', () => {
  const [plan, , first] = HISTORY
  assert.equal(kindLine(plan), 'Milestone build at 2:06pm Pacific on 14 November 2026. It was not released publicly.')
  assert.equal(kindLine(first), 'Milestone build at 2:50pm Pacific on 14 November 2026. It ran on a private preview and was not released publicly.')
  assert.equal(kindLine(HISTORY[12]), 'Public release at 7:08pm Pacific on 14 November 2026, live at https://www.syn3h.com/.')
  assert.equal(kindLine({ ...first, time: '2026-11-15 09:05 PST' }), 'Milestone build at 9:05am Pacific on 15 November 2026. It ran on a private preview and was not released publicly.')
  assert.equal(kindLine({ ...first, time: '2026-11-15 00:10 PST' }).slice(0, 26), 'Milestone build at 12:10am')
  for (const row of HISTORY.filter((r) => r.channel === 'milestone')) assert.match(kindLine(row), /not released publicly\.$/)
})

test('a bad history is rejected', () => {
  const row = (v, t, c = 'milestone', extra = '') => `${v}\tm\tabc1234\t2026-11-14 ${t} PST\t${c}${extra}`
  assert.equal(parseHistory(['# comment', row('v26.11.1400', '14:00'), row('v26.11.1401', '15:00', 'production')].join('\n')).length, 2)
  assert.throws(() => parseHistory(row('v26.11.1401', '14:00')), /should be build 00/)
  assert.throws(() => parseHistory([row('v26.11.1400', '14:00'), row('v26.11.1402', '15:00')].join('\n')), /should be build 01/)
  assert.throws(() => parseHistory([row('v26.11.1401', '14:00'), row('v26.11.1400', '15:00')].join('\n')), /should be build 00/)
  assert.throws(() => parseHistory([row('v26.11.1400', '14:00'), row('v26.11.1401', '13:00')].join('\n')), /earlier than/)
  assert.throws(() => parseHistory(row('v26.11.1500', '14:00')), /not on the day/)
  assert.throws(() => parseHistory(row('v26.11.1400', '14:00', 'beta')), /channel must be/)
  assert.throws(() => parseHistory(row('26.11.1400', '14:00')), /write the version as v26\.11\.1400/)
  assert.throws(() => parseHistory(row('v26.11.1400', '14:00', 'milestone', '\tmaybe')), /preview must be yes or no/)
  assert.equal(parseHistory(row('v26.11.1400', '14:00', 'milestone', '\tno'))[0].preview, false)
  assert.throws(() => parseHistory('v26.11.1400\tm\tnot-a-sha\t2026-11-14 14:00 PST\tmilestone'), /expected a commit/)
})

test('production versions and deployed builds must match', () => {
  const releases = releasesFromTsv(TSV + 'release-3\t2026-11-15 09:30 PST\tu\tm15\tabc1234\tid\tf\n')
  assert.deepEqual(matchReleases(HISTORY, releases).problems, ['release-3 (abc1234) has no production version in history.tsv'])
  assert.deepEqual(matchReleases(HISTORY, releasesFromTsv(TSV.split('\n')[0])).problems, ['v26.11.1413 is production but no build of bc8cb48 is in releases.tsv'])
})

test('releases.tsv with a malformed row is rejected', () => {
  assert.throws(() => releasesFromTsv('first\t2026-11-14 19:08 PST\n'), /expected release-N/)
  assert.throws(() => releasesFromTsv('release-1\t2026-11-14T19:08\n'), /expected a Pacific time/)
})

const MILESTONE = HISTORY[2]
const PRODUCTION = HISTORY[12]
const notesFor = (row, { play = row.channel === 'production', extra = '' } = {}) => [
  `## Syn3h ${row.version}`, '', 'A deck', '', kindLine(row), '', '<!-- a comment -->', '',
  '### The story so far', '', 'It happened.', '', '### Features', '', '- a', '', '### Fixes', '', '- b', '',
  ...(play ? ['### Play', '', 'p', ''] : []), '### Known issues', '', '- k', '', extra,
].join('\n')

test('a draft cannot render until it is written', () => {
  const draft = draftNotes(MILESTONE, 'm01-foundation', 'm02-first-playable', ['abc1234 Buggy: a -- b'])
  assert.match(draft, /^## Syn3h v26\.11\.1402\n/)
  assert.doesNotMatch(draft, /AI Generated/)
  assert.doesNotMatch(draft, /### Play/)
  assert.match(draftNotes(PRODUCTION, 'a', 'b', []), /### Play/)
  assert.throws(() => renderNotes(draft, MILESTONE), /still contain TODO/)
})

test('render checks the shape for the channel', () => {
  const body = renderNotes(notesFor(MILESTONE), MILESTONE)
  assert.doesNotMatch(body, /a comment|\n\n\n|Screenshots/)
  assert.ok(renderNotes(notesFor(PRODUCTION), PRODUCTION).includes('### Play'))
  assert.throws(() => renderNotes(notesFor(MILESTONE, { play: true }), MILESTONE), /Play" belongs only in production/)
  assert.throws(() => renderNotes(notesFor(PRODUCTION, { play: false }), PRODUCTION), /production notes need/)
  assert.throws(() => renderNotes(notesFor(MILESTONE), HISTORY[3]), /must be the heading "## Syn3h v26.11.1403"/)
  assert.throws(() => renderNotes(notesFor(MILESTONE).replace(kindLine(MILESTONE), kindLine(PRODUCTION)), MILESTONE), /line under the deck/)
  assert.throws(() => renderNotes(`(AI Generated)\n\n${notesFor(MILESTONE)}`, MILESTONE), /first line must be the heading/)
  assert.throws(() => renderNotes(notesFor(MILESTONE).replace('- b', '- b — c'), MILESTONE), /dash/)
  assert.throws(() => renderNotes(notesFor(MILESTONE).replace('- b', '- the lasers fire'), MILESTONE), /wording rule: lasers, fire/)
  assert.throws(() => renderNotes(notesFor(MILESTONE, { extra: '### Screenshots\n\n![x](y)' }), MILESTONE), /built from the assets manifest/)
  const swapped = notesFor(MILESTONE).replace('### The story so far\n\nIt happened.\n\n### Features\n\n- a', '### Features\n\n- a\n\n### The story so far\n\nIt happened.')
  assert.throws(() => renderNotes(swapped, MILESTONE), /must be the first section/)
})

test('screenshots come from the manifest, the GIF first', () => {
  const manifest = parseManifest(JSON.stringify({ images: [{ file: '01-lobby.png', caption: 'The lobby' }, { file: '02-hill.png', caption: 'King of the Hill' }], gif: 'syn3h-showcase.gif' }))
  const body = renderNotes(notesFor(MILESTONE), MILESTONE, manifest)
  const section = body.slice(body.indexOf('### Screenshots'))
  assert.equal(section, [
    '### Screenshots', '',
    '![Syn3h showcase](https://github.com/terran-labs/syn3h/releases/download/v26.11.1402/syn3h-showcase.gif)', '',
    '![The lobby](https://github.com/terran-labs/syn3h/releases/download/v26.11.1402/01-lobby.png)', '_The lobby_', '',
    '![King of the Hill](https://github.com/terran-labs/syn3h/releases/download/v26.11.1402/02-hill.png)', '_King of the Hill_', '',
  ].join('\n'))
  assert.deepEqual(referencedAssets(body, 'v26.11.1402'), ['syn3h-showcase.gif', '01-lobby.png', '02-hill.png'])
  // No GIF, and no images at all.
  assert.doesNotMatch(screenshotSection('v26.11.1402', parseManifest('{"images":[{"file":"a.png","caption":"A"}],"gif":null}')), /showcase/)
  assert.equal(screenshotSection('v26.11.1400', parseManifest('{"images":[],"gif":null}')), '')
  assert.doesNotMatch(renderNotes(notesFor(MILESTONE), MILESTONE, parseManifest('{"images":[],"gif":null}')), /Screenshots/)
})

test('a bad manifest is rejected', () => {
  assert.throws(() => parseManifest('nope'), /not JSON/)
  assert.throws(() => parseManifest('{"images":[{"file":"../x.png","caption":"x"}]}'), /plain file name/)
  assert.throws(() => parseManifest('{"images":[{"file":"x.png","caption":""}]}'), /no caption/)
  assert.throws(() => parseManifest('{"images":[{"file":"x.png","caption":"a [b]"}]}'), /brackets/)
  assert.throws(() => parseManifest('{"images":[],"gif":"manifest.json"}'), /gif must be/)
})

test('every checked-in notes file renders', () => {
  for (const row of HISTORY) {
    const text = readFileSync(new URL(`../../release-notes/releases/${row.version}.md`, import.meta.url), 'utf8')
    const body = renderNotes(text, row)
    assert.match(body, /### The story so far\n\n[^\n#]+\n/, row.version)
    assert.doesNotMatch(body, /mars|unity|mapmagic/i, row.version)
  }
})
