// Credentials never reach a browser or any other child a release starts (17 Nov 2026: smoke
// Chromes inherited the Cloudflare token and wrote it into crash dumps). Run: node --test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserEnv, SECRET_NAME } from './lib/safe-env.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FAKE = 'fake-value-for-the-test-0123456789'

test('a browser environment carries no credential-named variable', () => {
  const env = browserEnv({ PATH: '/usr/bin', HOME: '/tmp', CLOUDFLARE_API_TOKEN: FAKE, GH_TOKEN: FAKE, NPM_TOKEN: FAKE, ANTHROPIC_API_KEY: FAKE, MY_SECRET: FAKE, DB_PASSWORD: FAKE, CLAUDE_CODE_MESSAGING_TOKEN: FAKE })
  assert.deepEqual(Object.keys(env).filter((n) => SECRET_NAME.test(n)), [])
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.CHROME_HEADLESS, '1')
  // And a real child started with it sees none of them.
  const seen = spawnSync('/usr/bin/env', [], { env, encoding: 'utf8' }).stdout
  assert.ok(!seen.includes(FAKE), 'a child process saw a credential')
})

test('every browser the smoke and the public check launch gets that environment', () => {
  for (const file of ['net-smoke.mjs', 'public-check.mjs']) {
    const source = readFileSync(join(here, file), 'utf8')
    const launches = source.match(/chromium\.launch\(\{[^]*?\}\)/g) ?? []
    assert.ok(launches.length > 0, `${file} launches a browser`)
    for (const call of launches) assert.match(call, /env: browserEnv\(\)/, `${file}: a chromium.launch without env: browserEnv()`)
  }
})

test('the release scripts never export the Cloudflare token; only with_cf_token commands get it', () => {
  for (const file of ['release.sh', 'rollback.sh', 'domain.sh', 'cloudflare-token.sh', 'smoke-run.sh']) {
    assert.doesNotMatch(readFileSync(join(here, file), 'utf8'), /export\s+CLOUDFLARE_API_TOKEN/, `${file} exports the token`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'syn3h-cf-'))
  try {
    const file = join(dir, 'token'); writeFileSync(file, FAKE + '\n', { mode: 0o600 })
    const script = `. "${join(here, 'cloudflare-token.sh')}"; printf 'plain:'; /usr/bin/env | grep -c "${FAKE}"; printf 'cf:'; with_cf_token /usr/bin/env | grep -c "${FAKE}"`
    for (const env of [{ PATH: process.env.PATH, SYN3H_CLOUDFLARE_TOKEN_FILE: file }, { PATH: process.env.PATH, CLOUDFLARE_API_TOKEN: FAKE }]) {
      const out = spawnSync('/bin/sh', ['-c', script], { env, encoding: 'utf8' }).stdout
      assert.match(out, /plain:0/, 'a plain child saw the token')
      assert.match(out, /cf:1/, 'a with_cf_token child did not get the token')
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('domain.sh: its API calls get the token on standard input, never on a command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'syn3h-domain-'))
  try {
    const file = join(dir, 'token'); writeFileSync(file, FAKE + '\n', { mode: 0o600 })
    // A stand-in curl: records its argv and standard input, answers success.
    writeFileSync(join(dir, 'curl'), `#!/bin/sh\nprintf '%s ' "$@" > "${dir}/curl.argv"\ncat > "${dir}/curl.stdin"\necho '{"success":true,"result":[]}'\n`, { mode: 0o755 })
    const script = `. ./domain.sh; cf GET /zones >/dev/null && echo api-ok`
    // $0 names domain.sh, so its `cd "$(dirname "$0")/.."` lands in the repo as when run directly.
    const out = spawnSync('/bin/sh', ['-c', script, join(here, 'domain.sh')], {
      cwd: here, encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH}`, HOME: process.env.HOME, SYN3H_DOMAIN_LIB: '1', SYN3H_CLOUDFLARE_TOKEN_FILE: file },
    })
    assert.match(out.stdout, /api-ok/, `the API helper failed: ${out.stderr}`)
    assert.ok(!readFileSync(join(dir, 'curl.argv'), 'utf8').includes(FAKE), 'the token was on curl\'s command line')
    assert.match(readFileSync(join(dir, 'curl.stdin'), 'utf8'), new RegExp(`^Authorization: Bearer ${FAKE}`), 'curl did not get the header on standard input')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
