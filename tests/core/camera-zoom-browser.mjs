// SOURCE ONLY, UNRUN. Dedicated launcher allocation required. Chrome native pixel
// wheels are not physical trackpad evidence; synthetic modes are reported separately.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.MIRA_URL, expected = process.env.UX_SOURCE_SHA, out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_LAUNCH_MANIFEST)
const deadline = Date.now() + 480000
const budget = cap => { const n = Math.min(cap, deadline - Date.now()); assert.ok(n > 0, 'fixture deadline'); return n }
const bounded = async (promise, cap = 10000) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('bounded operation expired')), budget(cap)) })]) }
  finally { clearTimeout(timer) }
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const files = ['index.html', 'src/main.ts', 'src/core/ChaseCamera.ts', 'src/weapons/bungee/Bungee.ts', 'src/core/Input.ts', 'src/ui/Shell.ts', 'tests/core/camera-zoom-browser.mjs']
const modulePaths = ['/src/core/ChaseCamera.ts', '/src/weapons/bungee/Bungee.ts']
const report = { source: expected, cases: [], responses: [], errors: [], captureComplete: false,
  limits: ['No physical mouse or trackpad feel proof', 'Chrome only', 'Synthetic line/page and suspended canvas dispatch are not native wheel evidence', 'Natural Grapple attachment is a prerequisite, not seeded or repaired'] }
let browser, page, primary
let writes = Promise.resolve()
const pending = []
await mkdir(out, { recursive: true })
async function save() {
  try {
    const text = JSON.stringify(report, null, 2)
    writes = writes.then(() => bounded(writeFile(`${out}/report.json`, text), 3000))
    await bounded(writes, 10000)
  }
  catch (error) { report.errors.push(`Evidence write: ${error}`); throw error }
}
async function drain() {
  for (let cursor = 0; cursor < pending.length;) { const end = pending.length; await bounded(Promise.allSettled(pending.slice(cursor, end))); cursor = end }
}
async function provenance() {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), expected)
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), '')
  const inventory = []
  for (const path of files) {
    const local = await bounded(readFile(`${root}/${path}`, 'utf8'))
    const response = await fetch(new URL(`/${path}?raw${path === 'index.html' ? '&import' : ''}`, origin), { redirect: 'error', signal: AbortSignal.timeout(budget(10000)) })
    const record = { kind: 'raw-source-only', path, status: response.status, contentType: response.headers.get('content-type') }
    report.responses.push(record)
    const text = await bounded(response.text())
    Object.assign(record, { sha256: sha(text), length: Buffer.byteLength(text), prefix: text.slice(0, 4096) }); await save()
    assert.equal(response.status, 200)
    const literal = text.match(/^export default ("(?:[^"\\]|\\.)*")/m)
    assert.ok(literal, path); assert.equal(JSON.parse(literal[1]), local)
    inventory.push({ path, sha256: sha(local) })
  }
  return inventory
}
const evaluate = (fn, arg) => bounded(page.evaluate(fn, arg))
const ready = (fn, arg) => page.waitForFunction(fn, arg, { timeout: budget(15000) })
const read = () => evaluate(() => {
  const p = id => mira.params.get(`camera.${id}`).value, b = miraNet.bungee, c = b.mine
  return { distance: p('distance'), speed: p('zoomSpeed'), scope: p('scope'), roam: p('roamSpeed'), mode: p('mode'),
    tick: mira.game.tick, suspended: mira.game.input.suspended, locked: document.pointerLockElement === mira.game.canvas,
    gear: miraNet.gear.current, attached: b.attached, cord: c ? { owner: c.owner, rest: c.rest, to: c.to, at: c.at, flying: !!c.hook } : null,
    stats: { ...b.stats }, connected: miraNet.connected }
})
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const vector = state => [state.distance, state.scope, state.roam]
async function caseRun(name, action) {
  const record = { name, status: 'running', observations: [] }; report.cases.push(record); await save()
  try { await action(record); await drain(); assert.deepEqual(report.errors, []); record.status = 'passed'; await save() }
  catch (error) { record.status = 'failed'; record.error = String(error.stack ?? error); try { record.state = await read() } catch {} ; try { await save() } catch {} ; throw error }
}
async function setNumber(id, value) {
  if ((await read()).locked) await bounded(page.keyboard.press('Escape'))
  const search = page.locator('.wi-search')
  await search.fill(id)
  const row = page.locator(`.wi-row[data-id="${id}"]`)
  await row.locator('.wi-num').click()
  await row.locator('.wi-num-edit').fill(String(value)); await row.locator('.wi-num-edit').press('Enter')
  await search.fill(''); await search.press('Tab')
  near(await evaluate(id => mira.params.get(id).value, id), value)
}
async function canvasPoint() {
  const point = await evaluate(() => {
    for (const [x, y] of [[640, 420], [500, 600], [700, 600], [600, 300]]) if (document.elementFromPoint(x, y) === mira.game.canvas) return { x, y }
    throw Error('No exposed canvas point; do not bypass overlay')
  })
  await bounded(page.mouse.move(point.x, point.y)); return point
}
async function wheel(delta, { syntheticMode } = {}) {
  if (syntheticMode === undefined) await canvasPoint()
  const count = await evaluate(() => zoomEvidence.events.length)
  if (syntheticMode === undefined) await bounded(page.mouse.wheel(0, delta))
  else await evaluate(({ delta, mode }) => mira.game.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, deltaMode: mode, bubbles: true, cancelable: true })), { delta, mode: syntheticMode })
  await ready(n => zoomEvidence.events.length === n + 1, count)
  const event = await evaluate(n => zoomEvidence.events[n], count)
  assert.equal(event.canvas, true); assert.equal(event.deltaY, delta)
  assert.equal(event.deltaMode, syntheticMode ?? 0); assert.equal(event.trusted, syntheticMode === undefined)
  return { event, state: await read() }
}
try {
  const launch = JSON.parse(await readFile(process.env.UX_LAUNCH_MANIFEST, 'utf8'))
  assert.equal(launch.head, expected); assert.equal(launch.origin, origin)
  assert.equal(launch.env.MIRA_NO_ROOM_SERVER, '1'); assert.ok(launch.roomPort !== 8787 && launch.roomPid && launch.vitePid)
  report.launch = launch; report.rawInventory = await provenance()
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: budget(30000) })
  page = await bounded(browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })); page.setDefaultTimeout(10000)
  page.on('pageerror', error => report.errors.push(String(error)))
  page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
    try { if (['update', 'full-reload', 'prune'].includes(JSON.parse(String(payload)).type)) report.errors.push('HMR changed source') } catch {}
  }))
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (response.request().resourceType() !== 'document' && !modulePaths.includes(path)) return
    const record = { kind: 'browser-response', url: response.url(), path, status: response.status(), type: response.request().resourceType() }
    report.responses.push(record)
    pending.push((async () => {
      const bytes = await bounded(response.body()); Object.assign(record, { sha256: sha(bytes), length: bytes.length, prefix: bytes.toString().slice(0, 4096) }); await save()
      assert.equal(response.status(), 200); assert.equal(response.fromServiceWorker(), false); assert.equal(response.request().redirectedFrom(), null)
      assert.equal(new URL(response.url()).origin, new URL(origin).origin)
      if (modulePaths.includes(path)) {
        assert.equal(record.type, 'script')
        const encoded = bytes.toString().match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
        assert.ok(encoded, path)
        const source = await bounded(readFile(`${root}${path}`, 'utf8'))
        assert.ok(JSON.parse(Buffer.from(encoded[1], 'base64').toString()).sourcesContent.includes(source), path)
        record.sourceSha256 = sha(source)
      } else { assert.ok(response.request().isNavigationRequest()); assert.equal(response.frame(), page.mainFrame()) }
      record.verified = true
    })().catch(error => { record.error = String(error); report.errors.push(String(error)) }))
  })
  const url = new URL(origin); url.searchParams.set('room', `ux-zoom-${Date.now()}`); url.searchParams.set('world', 'alpine.1~bots.count=0')
  report.entry = url.href; await save()
  await page.goto(url.href, { timeout: budget(60000) })
  await ready(() => window.mira?.shell?.galaxy?.live)
  await page.locator('.galaxy-label.is-current').focus(); await bounded(page.keyboard.press('Enter'))
  await ready(() => window.miraNet?.connected && mira.shell.playing && !mira.shell.dropping)
  if ((await read()).locked) await bounded(page.keyboard.press('Escape'))
  await drain(); assert.deepEqual(report.errors, [])
  assert.ok(report.responses.some(r => r.kind === 'browser-response' && r.type === 'document' && r.url === url.href && r.verified))
  for (const path of modulePaths) assert.ok(report.responses.some(r => r.path === path && r.sourceSha256 && r.verified), `executed module ${path}`)
  report.instances = await evaluate(() => ({ camera: mira.camera.constructor.name, grapple: miraNet.bungee.constructor.name }))
  assert.deepEqual(report.instances, { camera: 'ChaseCamera', grapple: 'Bungee' })
  // Observe ordinary zoom after the canvas handler, and intercepted wheel after the
  // Bungee window handler. No control method is replaced or invoked here.
  await evaluate(() => {
    const events = []
    const handler = event => {
      if (event.target !== mira.game.canvas) return
      const item = { canvas: true, trusted: event.isTrusted, deltaY: event.deltaY, deltaMode: event.deltaMode }
      queueMicrotask(() => {
        item.parameters = ['distance', 'scope', 'roamSpeed'].map(id => mira.params.get(`camera.${id}`).value)
        events.push(item)
      })
    }
    const intercepted = event => {
      const cord = miraNet.bungee.mine
      if ((cord?.at || cord?.to) && miraNet.gear.current === 'bungee') handler(event)
    }
    window.addEventListener('wheel', intercepted, { capture: true })
    mira.game.canvas.addEventListener('wheel', handler)
    window.zoomEvidence = { events, restore() {
      window.removeEventListener('wheel', intercepted, { capture: true })
      mira.game.canvas.removeEventListener('wheel', handler)
    } }
  })
  await caseRun('native pixel wheel and Inspector speed', async record => {
    assert.equal((await read()).attached, false); assert.equal((await read()).mode, 0); near((await read()).speed, .4)
    await setNumber('camera.distance', 10)
    for (const [delta, distance] of [[100, 10.4], [-25, 10.3], [5000, 10.7]]) { const result = await wheel(delta); near(result.state.distance, distance); record.observations.push(result); await save() }
    await setNumber('camera.zoomSpeed', .8)
    const result = await wheel(100); near(result.state.distance, 11.5); record.observations.push(result)
    for (const [value, delta] of [[25, 100], [0, -100]]) { await setNumber('camera.distance', value); near((await wheel(delta)).state.distance, value) }
    await setNumber('camera.distance', 10)
    await bounded(page.keyboard.press('Equal')); near((await read()).distance, 8.4)
    await bounded(page.keyboard.press('Minus')); near((await read()).distance, 10)
  })
  await caseRun('native scope, roam and RMB toggle', async record => {
    const before = await read(); await bounded(page.keyboard.down('KeyZ'))
    const scoped = await wheel(100); near(scoped.state.scope, before.scope - .25); near(scoped.state.distance, before.distance); near(scoped.state.roam, before.roam)
    await bounded(page.keyboard.up('KeyZ'))
    for (let i = 0; i < 4; i++) await bounded(page.keyboard.press('KeyC'))
    assert.equal((await read()).mode, 4)
    const roamBefore = await read(), roaming = await wheel(25)
    near(roaming.state.roam, roamBefore.roam + .25); near(roaming.state.scope, roamBefore.scope); near(roaming.state.distance, roamBefore.distance)
    await bounded(page.keyboard.press('KeyC')); assert.equal((await read()).mode, 0)
    const point = await canvasPoint(); await bounded(page.mouse.click(point.x, point.y, { button: 'right' })); assert.equal((await read()).mode, 1)
    await bounded(page.mouse.click(point.x, point.y, { button: 'right' })); assert.equal((await read()).mode, 0)
    record.observations.push({ before, scoped, roamBefore, roaming })
  })
  await caseRun('synthetic line/page normalization and actual pause keyboard suppression', async record => {
    const before = await read()
    const line = await wheel(.5, { syntheticMode: 1 }); near(line.state.distance, before.distance + .4)
    const paged = await wheel(-.5, { syntheticMode: 2 }); near(paged.state.distance, before.distance)
    await page.locator('.rail-pause').click(); assert.equal((await read()).suspended, true)
    await bounded(page.keyboard.press('Equal')); near((await read()).distance, before.distance)
    // Pause veil covers canvas. Explicit synthetic dispatch documents the handler's
    // existing lack of a suspension guard, not native reachability through the veil.
    const pausedWheel = await wheel(100, { syntheticMode: 0 }); near(pausedWheel.state.distance, before.distance + .8)
    await page.locator('.pause-veil').click()
    await ready(() => !mira.game.input.suspended)
    if ((await read()).locked) await bounded(page.keyboard.press('Escape'))
    record.observations.push({ before, line, paged, pausedWheel })
  })
  await caseRun('normal Grapple attachment, interception, release positive', async record => {
    // Orbit keeps a native downward look steady without recentering. One launch only.
    await bounded(page.keyboard.press('KeyC')); await bounded(page.keyboard.press('KeyC')); assert.equal((await read()).mode, 2)
    const point = await canvasPoint()
    // Primary click captures cursor before selecting Grapple, avoiding a launch on capture.
    await bounded(page.mouse.click(point.x, point.y)); await ready(() => document.pointerLockElement === mira.game.canvas)
    const digit = await evaluate(() => miraNet.gear.list().indexOf('bungee') + 1)
    assert.ok(digit > 0); await bounded(page.keyboard.press(`Digit${digit}`)); assert.equal((await read()).gear, 'bungee')
    await bounded(page.mouse.move(point.x, point.y + 100, { steps: 10 }))
    await ready(() => mira.game.camera.getWorldDirection(mira.game.camera.position.clone()).y < -.3)
    record.beforeLaunch = await read(); await save()
    await bounded(page.keyboard.down('KeyL')); await ready(n => miraNet.bungee.stats.launched === n + 1, record.beforeLaunch.stats.launched); await bounded(page.keyboard.up('KeyL'))
    await ready(() => miraNet.bungee.attached && !!(miraNet.bungee.mine?.at || miraNet.bungee.mine?.to))
    const attached = await read(); record.attached = attached; await save()
    assert.ok(attached.locked && !attached.suspended && attached.gear === 'bungee' && !attached.cord.flying)
    const paid = await wheel(100); await ready(rest => miraNet.bungee.cordLength > rest, attached.cord.rest)
    const afterOut = await read(); assert.deepEqual(vector(afterOut), vector(attached)); assert.deepEqual(paid.event.parameters, vector(attached))
    const reeled = await wheel(-100); await ready(rest => miraNet.bungee.cordLength < rest, afterOut.cord.rest)
    const afterIn = await read(); assert.deepEqual(vector(afterIn), vector(attached)); assert.deepEqual(reeled.event.parameters, vector(attached))
    await bounded(page.keyboard.press('KeyG')); await ready(() => !miraNet.bungee.mine)
    const released = await read(); assert.equal(released.stats.released, attached.stats.released + 1)
    const positive = await wheel(100); near(positive.state.distance, released.distance + released.speed)
    record.observations.push({ attached, paid, afterOut, reeled, afterIn, released, positive })
  })
  report.finalInventory = await provenance(); assert.deepEqual(report.finalInventory, report.rawInventory)
} catch (error) { primary = error; report.failure = String(error.stack ?? error) }
finally {
  if (page && !page.isClosed()) {
    try { report.finalEvents = await evaluate(() => window.zoomEvidence?.events ?? []); await save() } catch (error) { report.errors.push(String(error)) }
    try { await evaluate(() => window.zoomEvidence?.restore()) } catch (error) { report.errors.push(String(error)) }
  }
  try { if (browser) await bounded(browser.close(), 15000) } catch (error) { report.errors.push(String(error)) }
  try { await drain() } catch (error) { report.errors.push(String(error)) }
  report.captureComplete = !primary && report.errors.length === 0 && report.cases.length === 4 && report.cases.every(c => c.status === 'passed')
  try { await save() } catch (error) { report.captureComplete = false; console.error(JSON.stringify(report)); if (!primary) primary = error }
  if (primary) throw primary
  assert.deepEqual(report.errors, []); assert.equal(report.captureComplete, true)
}
