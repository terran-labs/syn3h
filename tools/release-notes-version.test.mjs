// The notes ship as the version release.sh is about to use, or the release stops before
// anything is built. On 22 November notes renamed from v26.11.2121 to v26.11.2200 (the Pacific
// date rolled over) kept the old heading and frozen link; only publishing, after the release
// went live, refused them. Run: node --test.
import './lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAST_SYN3H_VERSION, linkedVersions, renameNotes, unshippedNotes, versionProblems } from './release-notes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const notesFor = (v, link = v) => `## Mira v${v}\n\nA deck line.\n\nReleased at 6:00am Pacific.\n\n### Play\n\nThis exact version stays playable at https://mira.cc/?v=${link}, whatever ships after it.\nSee https://github.com/terran-labs/syn3h/releases/tag/v${link}.\n\n### Known issues\n\n- A player on a version before v26.11.2118 is treated as hidden.\n`
const digestFor = () => 'A deck\n\n- A point.\n'

test('versions released as Syn3h keep their heading; later versions must say Mira', () => { // rename-keep
  const old = LAST_SYN3H_VERSION.slice(1), legacy = (v) => notesFor(v).replace('## Mira', '## Syn3h') // rename-keep
  assert.deepEqual(versionProblems(old, legacy(old), digestFor()), [])
  assert.deepEqual(versionProblems(old, notesFor(old), digestFor()), [])
  assert.equal(versionProblems('27.1.100', legacy('27.1.100'), digestFor()).length, 1)
})

test('heading, every version-bearing link and the player digest must name the version', () => {
  assert.deepEqual(versionProblems('v26.11.2200', notesFor('26.11.2200'), digestFor()), [])
  // Prose naming an older version is fine: only the heading and links must be this release's.
  assert.deepEqual(linkedVersions(notesFor('26.11.2200')), ['26.11.2200', '26.11.2200'])
  // The 22 November file: renamed, heading and link left behind.
  const stale = versionProblems('v26.11.2200', notesFor('26.11.2121'), digestFor())
  assert.ok(stale.some((p) => p.includes('heading is "## Mira v26.11.2121"')), stale.join('; '))
  assert.equal(stale.filter((p) => p.includes('link version 26.11.2121')).length, 2)
  const heading = notesFor('26.11.2200').replace('## Mira v26.11.2200', '## Mira v26.11.2121')
  assert.deepEqual(versionProblems('26.11.2200', heading, digestFor()), ['the notes\' heading is "## Mira v26.11.2121", not "## Mira v26.11.2200"'])
  assert.deepEqual(versionProblems('v26.11.2200', notesFor('26.11.2200', '26.11.2121').replace('releases/tag/v26.11.2121', 'releases/tag/v26.11.2200'), digestFor()), ['the notes link version 26.11.2121, not 26.11.2200'])
  assert.deepEqual(versionProblems('v26.11.2200', notesFor('26.11.2200'), null), ['no player digest at release-notes/player/v26.11.2200.md'])
  assert.deepEqual(versionProblems('v26.11.2200', null, 'See https://mira.cc/?v=26.11.2121\n'), ['no release notes at release-notes/releases/v26.11.2200.md', 'the player digest links version 26.11.2121, not 26.11.2200'])
  // An "(AI Generated)" line before the heading is allowed, as for publishing.
  assert.deepEqual(versionProblems('v26.11.2200', '(AI Generated)\n\n' + notesFor('26.11.2200'), digestFor()), [])
})

function notesDir() {
  const root = mkdtempSync(join(tmpdir(), 'mira-notes-'))
  mkdirSync(join(root, 'releases')); mkdirSync(join(root, 'player'))
  writeFileSync(join(root, 'history.tsv'), '')
  return root
}

test('a train\'s notes are unused versions newer than every used one; an old stray is not', () => {
  const root = notesDir()
  try {
    for (const v of ['26.11.1907', '26.11.2121']) writeFileSync(join(root, 'releases', `v${v}.md`), notesFor(v))
    assert.deepEqual(unshippedNotes(['v26.11.2120', 'v26.11.2000'], join(root, 'releases')), ['v26.11.2121'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('rename moves both files and rewrites the heading and links in one step, and refuses used versions', () => {
  const root = notesDir(), releases = join(root, 'releases'), player = join(root, 'player')
  try {
    writeFileSync(join(releases, 'v26.11.2121.md'), notesFor('26.11.2121') + '\nTrain 26.11.2121 notes.\n')
    writeFileSync(join(player, 'v26.11.2121.md'), digestFor())
    const leftover = renameNotes('v26.11.2121', 'v26.11.2200', { known: ['v26.11.2120'], releases, player })
    assert.ok(!existsSync(join(releases, 'v26.11.2121.md')) && !existsSync(join(player, 'v26.11.2121.md')))
    const notes = readFileSync(join(releases, 'v26.11.2200.md'), 'utf8')
    assert.deepEqual(versionProblems('v26.11.2200', notes, readFileSync(join(player, 'v26.11.2200.md'), 'utf8')), [])
    assert.match(notes, /before v26\.11\.2118/, 'prose naming another version is left as written')
    assert.equal(leftover.length, 1, 'a prose mention of the old number is reported, not rewritten')
    assert.match(leftover[0], /Train 26\.11\.2121 notes/)
    // A version already used is never renamed to or from.
    writeFileSync(join(releases, 'v26.11.2300.md'), notesFor('26.11.2300')); writeFileSync(join(player, 'v26.11.2300.md'), digestFor())
    assert.throws(() => renameNotes('v26.11.2300', 'v26.11.2301', { known: ['v26.11.2300'], releases, player }), /already used/)
    assert.throws(() => renameNotes('v26.11.2300', 'v26.11.2120', { known: ['v26.11.2120'], releases, player }), /already used/)
    assert.throws(() => renameNotes('v26.11.2300', 'v26.11.2200', { known: [], releases, player }), /already exists/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the check command fails with the fix named: rename a train\'s notes to the version shipping', () => {
  const root = notesDir()
  try {
    // A train's notes, far newer than any real tag, written for the day before.
    writeFileSync(join(root, 'releases', 'v27.1.121.md'), notesFor('27.1.121'))
    writeFileSync(join(root, 'player', 'v27.1.121.md'), digestFor())
    const run = (v) => spawnSync(process.execPath, [join(here, 'release-notes.mjs'), 'check', v], { encoding: 'utf8', env: { ...process.env, MIRA_RELEASE_NOTES_DIR: root } })
    const missing = run('v27.1.201')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /Fix: node tools\/release-notes\.mjs rename v27\.1\.121 v27\.1\.201/)
    assert.equal(run('v27.1.121').status, 0)
    // Renamed by hand, contents left: the heading and link are named, before anything is built.
    writeFileSync(join(root, 'releases', 'v27.1.201.md'), notesFor('27.1.121'))
    writeFileSync(join(root, 'player', 'v27.1.201.md'), digestFor())
    const stale = run('v27.1.201')
    assert.equal(stale.status, 1)
    assert.match(stale.stderr, /heading is "## Mira v27\.1\.121"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('release.sh prints its version and checks the notes first, in every mode, before anything is built', () => {
  const source = readFileSync(join(here, 'release.sh'), 'utf8')
  const lines = source.split('\n')
  const at = (needle) => lines.findIndex((l) => l.includes(needle))
  const check = at('node tools/release-notes.mjs check "$CALVER"')
  assert.ok(check > 0)
  assert.ok(!lines[check].startsWith(' '), 'the check is not inside a dry-run or release-only branch')
  assert.ok(at('echo "Version: $CALVER"') < check)
  for (const later of ['"$WRANGLER" whoami', 'r2-preflight', '# --- Freeze', 'ID="$(tools/promote-stable.sh']) assert.ok(check < at(later), `the notes check runs before ${later}`)
})
