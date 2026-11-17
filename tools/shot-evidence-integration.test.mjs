/** Source-prepared integration tests. No real browser, network or filesystem writes.
 * Runs the actual smoke option/finalization code in a child VM module. Only the long
 * gameplay scenario body is replaced by a fixture; helper correctness is tested separately.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import * as vm from 'node:vm'
import * as path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const childMode = process.argv[2] === '--fixture-child'

async function fixtureChild(scenario) {
  let launches = 0, closes = 0, evaluations = 0, mkdirCalls = 0
  const output = [], writes = []
  const source = readFileSync(path.join(here, 'net-smoke.mjs'), 'utf8')
  const start = "try {\n  const a = await open('Alice')"
  const end = "} catch (e) {\n  check('no exception'"
  const begin = source.indexOf(start), finish = source.indexOf(end, begin)
  assert.ok(begin >= 0 && finish > begin, 'exact gameplay seam must exist')
  assert.equal(source.indexOf(start, begin + 1), -1, 'gameplay seam must be unique')
  // Keep imports, preflight, check(), evidence capture, catch/finally, marker and exit intact.
  const instrumented = source.slice(0, begin) + `try {
    clients.push(...globalThis.__fixtureClients)
    // One browser per page, as open() launches them: the fixture's pages get one each.
    for (const _ of globalThis.__fixtureClients) browsers.push(await launch())
    check('fixture original gameplay', ${scenario !== 'original-failure'})
  ` + source.slice(finish)
  const enabled = scenario !== 'default'
  const env = enabled ? { SYN3H_SHOT_EVIDENCE_DIR: '/tmp/mock-fresh-shot-evidence' } : {}
  if (scenario === 'relative') env.SYN3H_SHOT_EVIDENCE_DIR = 'relative'
  if (scenario === 'empty') env.SYN3H_SHOT_EVIDENCE_DIR = ''
  const exitSignal = Symbol('exit')
  let exitCode = null
  const sandbox = {
    console: {
      log: (...args) => output.push(args.join(' ')),
      error: (...args) => output.push(args.join(' ')),
    },
    process: { env, argv: ['node', 'net-smoke.mjs', 'https://example.invalid/'], exit: code => { exitCode = code; throw exitSignal } },
    setTimeout, clearTimeout, performance,
  }
  const context = vm.createContext(sandbox)
  const phase = label => ({ label, shooter: 2, victim: label === 'human' ? 1 : 65280, emitted: [], events: [], overflow: scenario === 'overflow' })
  sandbox.__fixtureClients = ['Alice', 'Bob'].filter(n => scenario !== 'missing-client' || n !== 'Bob').map(name => ({
    name,
    page: {
      async evaluate(fn) {
        evaluations++
        // Existing broad failure diagnostics are outside this focused acceptance test.
        if (String(fn).includes('const s = window.syn3h')) return { fixture: true }
        if (scenario === 'capture-error') throw new Error('fixture capture error')
        if (scenario === 'timeout') return new Promise(() => {})
        sandbox.window = { __shotEvidence: { snapshot(label) {
          if (scenario === 'missing-phase' && label === 'bot') return null
          const value = phase(label)
          if (scenario === 'truncation') value.events = Array.from({ length: 129 }, () => ({ kind: 'fixture' }))
          return value
        } } }
        return fn()
      },
    },
  }))
  function moduleFrom(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function() {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  }
  const modules = {
    'node:crypto': moduleFrom({ randomBytes: () => Buffer.from('010203040506', 'hex') }),
    'node:path': moduleFrom({ isAbsolute: path.isAbsolute, join: path.join }),
    'node:fs': moduleFrom({
      mkdirSync() { mkdirCalls++; if (scenario === 'existing') throw new Error('EEXIST fixture') },
      writeFileSync(target, data) {
        if (scenario === 'write-failure' && target.endsWith('shot-evidence.json')) throw new Error('EACCES fixture')
        writes.push({ target, data: String(data) })
      },
    }),
    'playwright-core': moduleFrom({ chromium: { async launch() {
      launches++
      return { async close() { closes++; if (scenario === 'close-rejection') throw new Error('fixture browser close rejected') } }
    } } }),
    './shot-evidence.mjs': new vm.SourceTextModule(readFileSync(path.join(here, 'shot-evidence.mjs'), 'utf8'), { context }),
    './lib/smoke-retry.mjs': new vm.SourceTextModule(readFileSync(path.join(here, 'lib', 'smoke-retry.mjs'), 'utf8'), { context }),
  }
  let thrown = null
  try {
    const mod = new vm.SourceTextModule(instrumented, { context })
    await mod.link(specifier => { assert.ok(modules[specifier], `unexpected dependency ${specifier}`); return modules[specifier] })
    await mod.evaluate()
  } catch (error) {
    if (error !== exitSignal) { thrown = String(error); exitCode = 1 }
  }
  process.stdout.write(JSON.stringify({ exitCode, output, writes, launches, closes, evaluations, mkdirCalls, thrown }))
}

function run(scenario) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url), '--fixture-child', scenario], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
  })
  assert.equal(child.error, undefined, `child failed: ${child.error}`)
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout)
}
const hasOK = r => r.output.some(line => line.startsWith('NET SMOKE OK'))
const acceptance = r => JSON.parse(r.output.find(line => line.startsWith('SHOT EVIDENCE ACCEPTANCE ')).slice('SHOT EVIDENCE ACCEPTANCE '.length))

if (childMode) {
  await fixtureChild(process.argv[3])
} else {
  test('default uses original marker/exit without collector evaluation or evidence output', () => {
    const r = run('default')
    assert.equal(r.exitCode, 0); assert.equal(hasOK(r), true)
    assert.equal(r.evaluations, 0); assert.equal(r.mkdirCalls, 0); assert.equal(r.writes.length, 0)
    assert.equal(r.closes, r.launches); assert.ok(r.launches >= 1); assert.equal(r.output.some(l => l.startsWith('SHOT EVIDENCE ACCEPTANCE')), false)
  })
  test('opt-in complete evidence permits marker and zero exit', () => {
    const r = run('complete')
    assert.equal(r.exitCode, 0); assert.equal(hasOK(r), true)
    assert.equal(acceptance(r).evidenceComplete, true); assert.equal(r.closes, r.launches); assert.ok(r.launches >= 1)
    assert.equal(r.evaluations, 2); assert.ok(r.writes.length >= 2)
  })
  for (const scenario of ['capture-error', 'missing-client', 'missing-phase', 'truncation', 'overflow', 'write-failure', 'timeout']) {
    test(`${scenario}: nonzero exit, no success marker, nested browser close`, () => {
      const r = run(scenario)
      assert.equal(r.exitCode, 1); assert.equal(hasOK(r), false)
      assert.equal(acceptance(r).evidenceComplete, false); assert.equal(r.closes, r.launches); assert.ok(r.launches >= 1)
    })
  }
  test('browser close rejection exits nonzero without a success marker', () => {
    const r = run('close-rejection')
    assert.equal(r.exitCode, 1); assert.equal(hasOK(r), false)
    assert.equal(r.closes, r.launches); assert.ok(r.launches >= 1); assert.match(r.thrown, /fixture browser close rejected/)
  })
  test('complete evidence never rescues an original gameplay failure', () => {
    const r = run('original-failure')
    assert.equal(acceptance(r).evidenceComplete, true)
    assert.equal(r.exitCode, 1); assert.equal(hasOK(r), false); assert.equal(r.closes, r.launches); assert.ok(r.launches >= 1)
    assert.ok(r.output.some(l => l.startsWith('FAIL fixture original gameplay')))
  })
  for (const scenario of ['empty', 'relative', 'existing']) {
    test(`${scenario} output is rejected before browser launch`, () => {
      const r = run(scenario)
      assert.equal(r.exitCode, 1); assert.equal(hasOK(r), false)
      assert.equal(r.launches, 0); assert.equal(r.evaluations, 0)
    })
  }
}
