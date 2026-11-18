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

test('the release scripts never export the Cloudflare token; only cf commands get it', () => {
  for (const file of ['release.sh', 'rollback.sh', 'domain.sh', 'cloudflare-token.sh', 'smoke-run.sh']) {
    assert.doesNotMatch(readFileSync(join(here, file), 'utf8'), /export\s+CLOUDFLARE_API_TOKEN/, `${file} exports the token`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'syn3h-cf-'))
  try {
    const file = join(dir, 'token'); writeFileSync(file, FAKE + '\n', { mode: 0o600 })
    const script = `. "${join(here, 'cloudflare-token.sh')}"; printf 'plain:'; /usr/bin/env | grep -c "${FAKE}"; printf 'cf:'; cf /usr/bin/env | grep -c "${FAKE}"`
    for (const env of [{ PATH: process.env.PATH, SYN3H_CLOUDFLARE_TOKEN_FILE: file }, { PATH: process.env.PATH, CLOUDFLARE_API_TOKEN: FAKE }]) {
      const out = spawnSync('/bin/sh', ['-c', script], { env, encoding: 'utf8' }).stdout
      assert.match(out, /plain:0/, 'a plain child saw the token')
      assert.match(out, /cf:1/, 'a cf child did not get the token')
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
