import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const release = readFileSync(new URL('./release.sh', import.meta.url), 'utf8')
const hook = release.slice(release.indexOf('# These artifacts describe'))
for (const failure of ['draft', 'capture', 'tag']) {
  test(`a failed ${failure} preserves successful deployment status`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'syn3h-release-hook-'))
    try {
      mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'release-notes'))
      writeFileSync(join(dir, 'bin/node'), '#!/bin/sh\necho "$*" >> "$CALLS"\ncase "$*" in *" draft "*) [ "$FAILURE" != draft ];; *showcase*) [ "$FAILURE" != capture ];; esac\n', { mode: 0o755 })
      writeFileSync(join(dir, 'bin/git'), '#!/bin/sh\n[ "$FAILURE" != tag ]\n', { mode: 0o755 })
      const calls = join(dir, 'calls')
      const result = spawnSync('/bin/sh', ['-eu', '-c', hook], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, FAILURE: failure, CALLS: calls, CALVER: 'v26.11.1500', MILESTONE: 'test', COMMIT: '1234567', WHEN: 'test time', N: '3', PREV: 'release-2', DEST: dir, LOG: join(dir, 'log') } })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Warning: release is live/)
      assert.match(readFileSync(calls, 'utf8'), /showcase.mjs/)
      assert.doesNotMatch(readFileSync(calls, 'utf8'), /publish/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

const rollback = readFileSync(new URL('./rollback.sh', import.meta.url), 'utf8')
const rollbackCheck = rollback.slice(rollback.indexOf('# Preserve the check'))
for (const status of [0, 1]) {
  test(`rollback verification preserves smoke exit ${status}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'syn3h-rollback-check-'))
    try {
      mkdirSync(join(dir, 'bin'))
      writeFileSync(join(dir, 'bin/node'), `#!/bin/sh\necho '${status ? 'FAIL no page errors' : 'NET SMOKE OK'}'\nexit ${status}\n`, { mode: 0o755 })
      const result = spawnSync('/bin/sh', ['-eu', '-c', rollbackCheck], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, URL: 'https://example.test' } })
      assert.equal(result.status, status, result.stderr)
      if (status) assert.match(result.stderr, /verification failed/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

const primaryCheck = release.slice(release.indexOf('# --- Primary public acceptance'), release.indexOf('# --- Record'))
for (const failure of ['none', 'assets', 'gameplay']) {
  test(`primary acceptance ${failure} failure cannot record a release`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'syn3h-primary-check-'))
    try {
      mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'tools'))
      writeFileSync(join(dir, 'bin/node'), '#!/bin/sh\n[ "$FAILURE" != assets ]\n', { mode: 0o755 })
      writeFileSync(join(dir, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      writeFileSync(join(dir, 'tools/domain.sh'), '#!/bin/sh\n[ "$FAILURE" != gameplay ]\n', { mode: 0o755 })
      const result = spawnSync('/bin/sh', ['-eu', '-c', 'fail() { echo "$*" >&2; exit 1; };\n' + primaryCheck + '\necho RECORDED'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, FAILURE: failure, DEST: dir, LOG: join(dir, 'log') } })
      assert.equal(result.status, failure === 'none' ? 0 : 1, result.stderr)
      assert.equal(result.stdout.includes('RECORDED'), failure === 'none')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

}
