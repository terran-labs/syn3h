// release.sh's secrets rule (ops/RELEASE.md, Secrets), run as release.sh defines it. Bugs caught: a
// beta refused because production lacks a secret it only gets at the promote (setting one resets
// production's rooms); a deploy to a Worker that lacks a secret the build requires going ahead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = readFileSync(join(REPO, 'tools', 'release.sh'), 'utf8')
const fn = release.slice(release.indexOf('need_secrets() {'), release.indexOf('\n}\n', release.indexOf('need_secrets() {')) + 3)

function run(config, worker, have, warn = '') {
  const dest = mkdtempSync(join(tmpdir(), 'mira-secrets-'))
  writeFileSync(join(dest, 'wrangler.toml'), config)
  const script = `fail() { printf 'FAIL: %s\\n' "$*" >&2; exit 1; }\n${fn}\nneed_secrets wrangler.toml ${worker} ${warn}\necho "rc0"`
  return spawnSync('sh', ['-c', script], { cwd: REPO, encoding: 'utf8', env: { ...process.env, DEST: dest, MIRA_SECRETS_STUB: have }, timeout: 30000 })
}
const DECLARES = 'name = "x"\n[secrets]\nrequired = ["CREATOR_KEY_SHA256"]\n'

test('a Worker with every declared secret passes', () => {
  const r = run(DECLARES, 'syn3h-staging', 'syn3h-staging=CREATOR_KEY_SHA256;syn3h=') // rename-keep: the Worker names
  assert.match(r.stdout, /Secrets ok on syn3h-staging: CREATOR_KEY_SHA256/) // rename-keep: the Worker names
  assert.match(r.stdout, /rc0/)
})

test('a missing secret refuses the deploy (staging for a beta, production for a promote)', () => {
  for (const worker of ['syn3h-staging', 'syn3h']) { // rename-keep: the Worker names
    const r = run(DECLARES, worker, 'syn3h-staging=;syn3h=') // rename-keep: the Worker names
    assert.notEqual(r.status, 0, worker)
    assert.match(r.stderr, new RegExp(`Worker ${worker} has no secret CREATOR_KEY_SHA256`))
    assert.doesNotMatch(r.stdout, /rc0/)
  }
})

test("a beta only warns about production's missing secret, naming what promote will need", () => {
  const r = run(DECLARES, 'syn3h', 'syn3h-staging=CREATOR_KEY_SHA256;syn3h=', 'warn') // rename-keep: the Worker names
  assert.equal(r.status, 0)
  assert.match(r.stderr, /WARNING: promote will need: CREATOR_KEY_SHA256 on syn3h/) // rename-keep: the Worker names
  assert.match(r.stdout, /rc0/)
})

test('a config that declares no secrets needs none', () => {
  const r = run('name = "x"\n', 'syn3h', 'syn3h=') // rename-keep: the Worker names
  assert.equal(r.status, 0)
  assert.match(r.stdout, /rc0/)
})

test('release.sh applies the rule: a beta warns for production, everything else refuses', () => {
  assert.match(release, /if \[ -n "\$BETA" \] \|\| \[ -n "\$STAGE_ONLY" \]; then need_secrets wrangler\.toml syn3h warn/) // rename-keep: the Worker names
  assert.match(release, /else need_secrets wrangler\.toml syn3h; fi/) // rename-keep: the Worker names
  assert.match(release, /\[ -n "\$PROMOTE" \] \|\| need_secrets wrangler\.staging\.toml syn3h-staging/) // rename-keep: the Worker names
})
