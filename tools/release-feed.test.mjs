// The in-game Updates feed never shows players a banned or hidden word, and its Changes list
// keeps only changes to the game. Bug caught (25 Nov 2026): beta v26.11.2503's Changes showed
// "Dimensional portal: the creator's sign-in, revealed by five taps on the version label", a
// commit subject, and about half the list was tooling and checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFeed, buildFeeds, forPlayers } from './release-feed.mjs'
import { bannedWords } from './lib/public-words.mjs'

const LEAK = "Dimensional portal: the creator's sign-in, revealed by five taps on the version label"

test('the Changes list drops hidden-sign-in subjects, tools and checks, and keeps game changes', () => {
  for (const title of [
    LEAK,
    'Version label: Updates opens at once on every tap; the hidden gesture counts over the open sheet',
    "release.sh: a beta warns about production's secrets, a promote requires them",
    "creator-key: mark the owner's local config path as kept",
    'about-updates: check the Updates view by day, and wait on the sheet, not a delay',
    'Lobby sheets check waits for the settled ring',
    'Dev server: answer the analytics reports at /e',
    'Release feed: one git log per build, and a dev server builds it once',
    'Record v26.11.2502 beta (m-welcome-2502, 20261125-184635-7dceeaff)',
    'Measure the gear list\'s circles once the drum has stopped turning',
    'Ask what gear-wired sees while driving once the captured-cursor fade ends',
    'Lobby pictures in one command: tools/lobby-captures.mjs',
    'Water tools: window.mira, not the old window.syn3h name',
    'Updates feed: players see only game changes, never a banned or hidden word',
    'Share card built, not tracked: the build renders it into dist/brand/share-<hash>.png',
    'Ship the physics engine\'s WebAssembly as its own file',
  ]) assert.equal(forPlayers(title), false, title)
  for (const title of [
    'Skip vehicles across water, and make the wake behind them easy to see',
    'Drop the dark halo under the minimap\'s arrows',
    'During a move the veil says only the move\'s own lines',
    'Fireworks seen by day and across the map',
  ]) assert.equal(forPlayers(title), true, title)
})

test('banned words are found in any text, the notes words and the hidden ones', () => {
  assert.deepEqual(bannedWords(LEAK), ['portal', 'sign-in', 'revealed', 'five taps'])
  assert.deepEqual(bannedWords('Skip vehicles across water'), [])
  assert.deepEqual(bannedWords('Weapons and CREATOR_KEY_SHA256'), ['weapons', 'creator_key_sha256'])
})

/** A repository with two production releases; the second's train has the leaking commit. */
function fixture(secondNotes, firstNotes = 'The first.') {
  const repo = mkdtempSync(join(tmpdir(), 'feed-'))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T')
  const commit = (subject) => { git('commit', '-q', '--allow-empty', '-m', subject); return git('rev-parse', '--short=8', 'HEAD') }
  const first = commit('First release')
  commit(LEAK)
  commit('Skip vehicles across water, and make the wake behind them easy to see')
  commit('release.sh: the fingerprint and the secrets, before any deploy')
  const second = commit('Drop the dark halo under the minimap\'s arrows')
  mkdirSync(join(repo, 'release-notes', 'releases'), { recursive: true })
  writeFileSync(join(repo, 'release-notes', 'history.tsv'),
    `v26.11.2401\tm-a\t${first}\t2026-11-24 10:00 PST\tproduction\nv26.11.2402\tm-b\t${second}\t2026-11-24 12:00 PST\tproduction\n`)
  writeFileSync(join(repo, 'release-notes', 'releases', 'v26.11.2401.md'), `## Mira v26.11.2401\n\n${firstNotes}\n`)
  writeFileSync(join(repo, 'release-notes', 'releases', 'v26.11.2402.md'), `## Mira v26.11.2402\n\n${secondNotes}\n`)
  return repo
}

test('the feed built from a train with the leaking commit lists only the game changes', () => {
  const repo = fixture('Vehicles skip across water.')
  try {
    const feed = buildFeed(repo, 60, undefined)
    const latest = feed.releases.find(r => r.version === '26.11.2402')
    assert.deepEqual(latest.changes.map(c => c.title), [
      'Skip vehicles across water, and make the wake behind them easy to see',
      'Drop the dark halo under the minimap\'s arrows',
    ])
    assert.deepEqual(bannedWords(JSON.stringify(feed)), [])
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('a banned word anywhere in the finished feed fails the build', () => {
  const repo = fixture('Tap the version label five times to open the portal.')
  try {
    assert.throws(() => buildFeed(repo, 60, undefined), /banned words: portal/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('older releases go to their own file, named by the recent one only when it exists', () => {
  const repo = fixture('Vehicles skip across water.')
  try {
    const split = buildFeeds(repo, 1, undefined)
    assert.deepEqual(split.recent.releases.map(r => r.version), ['26.11.2402'])
    assert.equal(split.recent.older, '/releases-older.json')
    assert.deepEqual(split.older.releases.map(r => r.version), ['26.11.2401'])
    const whole = buildFeeds(repo, 60, undefined)
    assert.equal(whole.older, null)
    assert.equal('older' in whole.recent, false)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('a banned word in the older history fails the build too', () => {
  const repo = fixture('Vehicles skip across water.', 'Back buttons are easier to hit.')
  try {
    assert.throws(() => buildFeeds(repo, 1, undefined), /releases-older\.json\) would show players banned words: hit/)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})
