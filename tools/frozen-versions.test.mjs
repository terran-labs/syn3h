import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archive, archivedVersions, bareVersion, carry, retrying } from './frozen-versions.mjs'
import { findForbidden } from './check-shipped-assets.mjs'
import { draftNotes, frozenUrl } from './release-notes.mjs'
import { parseHistory } from './lib/release-version.mjs'

/** A frozen copy holding a tiny built site whose page names its own version. */
function build(root, name, mark) {
  const copy = join(root, name)
  mkdirSync(join(copy, 'dist', 'assets'), { recursive: true })
  mkdirSync(join(copy, 'dist', 'brand'), { recursive: true })
  writeFileSync(join(copy, 'dist', 'index.html'), `<title>${mark}</title>`)
  writeFileSync(join(copy, 'dist', 'build.json'), JSON.stringify({ mark }))
  writeFileSync(join(copy, 'dist', 'assets', `app-${mark}.js`), mark)
  writeFileSync(join(copy, 'dist', 'assets', `app-${mark}.js.map`), 'map')
  writeFileSync(join(copy, 'dist', 'brand', 'share.png'), 'png')
  writeFileSync(join(copy, 'dist', '.assetsignore'), '*.map\n')
  return copy
}

test('each release carries itself and every archived release, and only acceptance archives', () => {
  const root = mkdtempSync(join(tmpdir(), 'syn3h-frozen-'))
  try {
    const store = join(root, 'versions')
    const first = build(root, 'first', 'one')
    assert.deepEqual(carry(first, 'v26.11.1503', store), ['26.11.1503'])
    assert.equal(readFileSync(join(first, 'dist/v/26.11.1503/index.html'), 'utf8'), '<title>one</title>')
    assert.ok(!existsSync(join(first, 'dist/v/26.11.1503/assets/app-one.js.map')), 'source maps are not carried')
    assert.ok(!existsSync(join(first, 'dist/v/26.11.1503/v')), 'a frozen version never nests the others')
    assert.deepEqual(archivedVersions(store), [], 'carrying alone archives nothing: a dry run or rollback leaves no trace')
    archive(first, 'v26.11.1503', store)
    assert.deepEqual(archivedVersions(store), ['26.11.1503'])

    const second = build(root, 'second', 'two')
    assert.deepEqual(carry(second, 'v26.11.1600', store), ['26.11.1503', '26.11.1600'])
    assert.equal(readFileSync(join(second, 'dist/v/26.11.1503/assets/app-one.js'), 'utf8'), 'one')
    assert.equal(readFileSync(join(second, 'dist/v/26.11.1600/index.html'), 'utf8'), '<title>two</title>')
    assert.deepEqual(JSON.parse(readFileSync(join(second, 'dist/v/versions.json'), 'utf8')).versions, ['26.11.1503', '26.11.1600'])
    // Carrying twice (a dry run, then the release) gives the same result, not a nested copy.
    assert.deepEqual(carry(second, 'v26.11.1600', store), ['26.11.1503', '26.11.1600'])
    assert.ok(!existsSync(join(second, 'dist/v/26.11.1600/v')))

    // An accepted release is what a judge was promised: it is never replaced.
    assert.throws(() => archive(second, 'v26.11.1503', store), /never replaced/)
    assert.equal(readFileSync(join(store, '26.11.1503/index.html'), 'utf8'), '<title>one</title>')

    // The bitmap rule judges the new build, not the frozen ones it carries.
    assert.deepEqual(findForbidden(join(second, 'dist')).images, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('versions are written one way', () => {
  assert.equal(bareVersion('v26.11.1503'), '26.11.1503')
  assert.equal(bareVersion('26.11.1503'), '26.11.1503')
  assert.throws(() => bareVersion('../../etc'), /not a version/)
  assert.throws(() => bareVersion('release-7'), /not a version/)
})

test('production notes link the playable frozen version', () => {
  assert.equal(frozenUrl('v26.11.1503'), 'https://www.syn3h.com/?v=26.11.1503')
  const [row] = parseHistory('v26.11.1600\tm20\tabc1234\t2026-11-16 09:00 PST\tproduction\n')
  assert.match(draftNotes(row, 'a', 'b', []), /https:\/\/www\.syn3h\.com\/\?v=26\.11\.1600/)
})

test('a transport error, a 5xx or a 429 is retried, at most three attempts', () => {
  const answers = [() => { throw new Error('curl: (28) timed out') }, () => ({ status: 503 }), () => ({ status: 200 })]
  const slept = [], logged = []
  const got = retrying('https://x/a.js', () => answers.shift()(), { sleep: (ms) => slept.push(ms), log: (line) => logged.push(line) })
  assert.equal(got.status, 200)
  assert.deepEqual(slept, [1000, 3000])
  assert.equal(logged.length, 2)
  assert.ok(logged.every((line) => line.includes('https://x/a.js')))
  // Still failing after three attempts: the last answer stands, or the last error is thrown.
  assert.equal(retrying('u', () => ({ status: 429 }), { sleep() {}, log() {} }).status, 429)
  assert.throws(() => retrying('u', () => { throw new Error('reset') }, { sleep() {}, log() {} }), /reset/)
})

test('a 404 or any other answer is final at once', () => {
  let calls = 0
  const slept = []
  const got = retrying('u', () => { calls++; return { status: 404 } }, { sleep: (ms) => slept.push(ms), log() {} })
  assert.equal(got.status, 404)
  assert.equal(calls, 1)
  assert.deepEqual(slept, [])
})
