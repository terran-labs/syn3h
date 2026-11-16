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
// Preserve the original rollback success/failure cases using the bounded fixture below.
for (const status of [0, 1]) {
  test(`rollback verification preserves smoke exit ${status}`, () => callerFixture(invoke => {
    const result = invoke('rollback', status ? 'fail' : 'success')
    assert.equal(result.status, status, result.stderr)
    if (status) assert.match(result.stderr, /verification failed/)
  }))
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

test('notes compare with accepted history, not a later failed attempt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'syn3h-notes-baseline-'))
  try {
    mkdirSync(join(dir, 'release-notes'))
    writeFileSync(join(dir, 'release-notes/history.tsv'), 'v1\taccepted-release\tgood\ttime\tproduction\nv2\tunshipped-milestone\tnew\ttime\tmilestone\n')
    const assignment = release.split('\n').find(line => line.startsWith('PREV='))
    const result = spawnSync('/bin/sh', ['-eu', '-c', assignment + '\nprintf "%s" "$PREV"'], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'accepted-release')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// Execute actual caller sections, not a second implementation of their verdict logic.
const domain = readFileSync(new URL('./domain.sh', import.meta.url), 'utf8')
function section(source, start, end) {
  const at = source.indexOf(start)
  assert.ok(at >= 0 && source.indexOf(start, at + 1) < 0, `unique start: ${start}`)
  const until = end === undefined ? source.length : source.indexOf(end, at)
  assert.ok(until > at, `end: ${end}`)
  return source.slice(at, until)
}
const smokeSections = {
  normal: section(release, 'SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-release-normal.', '\n\nif [ -n "$DRY" ]'),
  latency: section(release, '  SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-release-latency.', '\n  echo\n'),
  domain: section(domain, '  SHOT_PARENT="$(mktemp -d "/tmp/syn3h-shot-domain-', '\n  ;;'),
  rollback: section(rollback, '# Preserve the check'),
}
function callerFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'syn3h-smoke-callers-'))
  try {
    mkdirSync(join(dir, 'bin'))
    const calls = join(dir, 'calls')
    writeFileSync(calls, '')
    writeFileSync(join(dir, 'bin/mktemp'), `#!/bin/sh
set -eu
if [ "$1" = -d ]; then
  [ "$CASE" != allocation ] || exit 1
  shift
  exec /usr/bin/mktemp -d "$FIXTURE/\${1##*/}"
fi
exec /usr/bin/mktemp "$FIXTURE/\${1##*/}"
`, { mode: 0o755 })
    writeFileSync(join(dir, 'bin/node'), `#!/bin/sh
set -eu
printf '%s\n' "$SYN3H_SHOT_EVIDENCE_DIR" >> "$CALLS"
case "$SYN3H_SHOT_EVIDENCE_DIR" in "$FIXTURE"/*/evidence) ;; *) exit 91;; esac
[ -d "\${SYN3H_SHOT_EVIDENCE_DIR%/*}" ] || exit 92
[ ! -e "$SYN3H_SHOT_EVIDENCE_DIR" ] || exit 93
mkdir "$SYN3H_SHOT_EVIDENCE_DIR"
case "$CASE" in
  success) echo 'NET SMOKE OK'; exit 0;;
  fail) echo 'FAIL original gameplay'; echo 'NET SMOKE FAILED'; exit 1;;
  incomplete) echo 'NET SMOKE FAILED (incomplete shot evidence)'; exit 1;;
  exit-with-marker) echo 'NET SMOKE OK'; exit 7;;
  zero-no-marker) echo 'FAIL fixture'; exit 0;;
esac
exit 94
`, { mode: 0o755 })
    const invoke = (kind, scenario = 'success', host = 'www.syn3h.com') => {
      // Only relocate the fixed domain log into the fixture; preserve pipeline and checks.
      const body = smokeSections[kind].replaceAll('/tmp/syn3h-domain-check.log', join(dir, 'domain.log'))
      // The callers run the smoke through run_smoke (tools/smoke-run.sh), as the scripts source it.
      const result = spawnSync('/bin/sh', ['-eu', '-c', 'fail() { echo "$*" >&2; exit 1; }; die() { fail "$@"; };\n' + readFileSync(new URL('./smoke-run.sh', import.meta.url), 'utf8') + '\n' + body], {
        cwd: dir, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH,
          FIXTURE: dir, CALLS: calls, CASE: scenario, H: host, URL: 'https://example.test/',
          LOG: join(dir, 'same-log'), PROXY_PORT: '12345', SYN3H_SHOT_EVIDENCE_DIR: '/must-not-reuse/evidence' },
      })
      assert.equal(result.error, undefined, String(result.error))
      return result
    }
    fn(invoke, () => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
for (const kind of Object.keys(smokeSections)) {
  for (const scenario of ['success', 'fail', 'incomplete', 'allocation']) {
    test(`${kind} caller preserves ${scenario} behavior`, () => callerFixture((invoke, calls) => {
      const result = invoke(kind, scenario)
      assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stdout + result.stderr)
      assert.equal(calls().length, scenario === 'allocation' ? 0 : 1)
      if (scenario !== 'success') assert.doesNotMatch(result.stdout, /^NET SMOKE OK/m)
      if (kind === 'rollback' && ['fail', 'incomplete'].includes(scenario))
        assert.match(result.stderr, /verification failed/)
    }))
  }
}
test('repeated same-log calls reserve distinct absent children and override inherited evidence', () => callerFixture((invoke, calls) => {
  for (const kind of Object.keys(smokeSections)) {
    for (let i = 0; i < 2; i++) assert.equal(invoke(kind).status, 0)
  }
  assert.equal(invoke('domain', 'success', 'syn3h.com').status, 0)
  const paths = calls()
  assert.equal(paths.length, 9)
  assert.equal(new Set(paths).size, 9)
  for (const prefix of ['release-normal', 'release-latency', 'domain-www.syn3h.com', 'rollback'])
    assert.equal(paths.filter(p => p.includes(`/syn3h-shot-${prefix}.`)).length, 2)
  assert.equal(paths.filter(p => p.includes('/syn3h-shot-domain-syn3h.com.')).length, 1)
}))
test('rollback rejects a nonzero exit even when output contains a success marker', () => callerFixture(invoke => {
  assert.equal(invoke('rollback', 'exit-with-marker').status, 1)
}))
for (const kind of ['normal', 'latency', 'domain']) {
  test(`${kind} requires its marker even when Node exits zero`, () => callerFixture(invoke => {
    assert.equal(invoke(kind, 'zero-no-marker').status, 1)
  }))
}
