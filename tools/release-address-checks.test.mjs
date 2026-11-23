// The address checks tools/release.sh runs after acceptance, run as written against a stand-in
// curl. Bugs caught: a release reporting a false failure for the bare syn3h.com, a redirect-only
// placeholder with no origin since 22 November 2026, whose non-navigation fetches answer 522; and
// a real failure (a redirect that drops the query, an open page's fetch redirected, a dead
// socket) going unreported.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const release = readFileSync(new URL('./release.sh', import.meta.url), 'utf8')
const start = release.indexOf('OLD_HOSTS=')
const end = release.indexOf('# --- Record', start)
assert.ok(start > 0 && end > start, 'the address checks moved: update this test')
const block = release.slice(start, end)

/** answers: host -> { navigate, fetch, ws } as curl's -w output for that kind of request. */
function run(answers) {
  const dir = mkdtempSync(join(tmpdir(), 'syn3h-address-checks-'))
  try {
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers))
    writeFileSync(join(dir, 'curl'), `#!/usr/bin/env node
const a = JSON.parse(require('fs').readFileSync(${JSON.stringify(join(dir, 'answers.json'))}, 'utf8'))
const args = process.argv.slice(2), url = new URL(args.find(x => x.startsWith('https://')))
const kind = args.includes('Upgrade: websocket') ? 'ws' : args.includes('Sec-Fetch-Mode: navigate') ? 'navigate' : 'fetch'
process.stdout.write(String((a[url.host] ?? {})[kind] ?? '000'))
`, { mode: 0o755 })
    return spawnSync('/bin/sh', ['-c', block], { encoding: 'utf8', env: { PATH: `${dir}:${process.env.PATH}` } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const redirect = '302 https://mira.cc/?room=redirect-check&v=26.11.1503'

test('the bare syn3h.com is checked only by its navigation redirect', () => {
  const out = run({
    'www.mira.cc': { navigate: redirect },
    'www.syn3h.com': { navigate: redirect, fetch: '200', ws: '101' },
    'syn3h.com': { navigate: redirect, fetch: '522' },
  })
  assert.equal(out.status, 0)
  assert.doesNotMatch(out.stderr, /ADDRESS CHECK FAILED/)
  assert.match(out.stdout, /a page opened at https:\/\/syn3h\.com\/ goes to mira\.cc/)
  assert.doesNotMatch(out.stdout, /https:\/\/syn3h\.com\/v\/versions\.json/)
})

test('a broken redirect, a redirected open-page fetch or a dead socket is reported, never fatal', () => {
  const out = run({
    'www.mira.cc': { navigate: '302 https://mira.cc/' },
    'www.syn3h.com': { navigate: redirect, fetch: '302', ws: '000' },
    'syn3h.com': { navigate: redirect },
  })
  assert.equal(out.status, 0)
  assert.match(out.stderr, /ADDRESS CHECK FAILED: a page opened at https:\/\/www\.mira\.cc/)
  assert.match(out.stderr, /ADDRESS CHECK FAILED: https:\/\/www\.syn3h\.com\/v\/versions\.json, fetched as an open page would, answered 302/)
  assert.match(out.stderr, /ADDRESS CHECK FAILED: wss:\/\/www\.syn3h\.com\/ws answered 000/)
})
