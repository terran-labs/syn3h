// FIRST FOUR Chrome slices only. Source-prepared; not a release/full-modal gate.
// Requires a separately allocated supervisor, dedicated room server and clean Vite tree.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL
const expected = process.env.UX_SOURCE_SHA
const out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_LAUNCH_MANIFEST, 'Explicit allocated origin, source, evidence and launcher manifest required')
const deadline = Date.now() + 480_000
const workDeadline = deadline - 30_000
let cleaningUp = false
const remaining = cap => { const ms = Math.min(cap, (cleaningUp ? deadline : workDeadline) - Date.now()); assert.ok(ms > 0, 'fixture absolute deadline'); return ms }
const bounded = async (promise, cap, label) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} deadline`)), remaining(cap))
  })]) } finally { clearTimeout(timer) }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: remaining(5000) }).trim()
const launch = JSON.parse(await readFile(process.env.UX_LAUNCH_MANIFEST, 'utf8'))
assert.equal(launch.head, expected)
assert.equal(launch.origin, origin)
assert.equal(launch.env.SYN3H_NO_ROOM_SERVER, '1')
assert.equal(String(launch.env.SYN3H_ROOM_PORT), String(launch.roomPort), 'Vite proxy room port must be explicit')
assert.ok(Number.isInteger(launch.roomPort) && launch.roomPort !== 8787, 'dedicated room port required')
assert.ok(launch.roomPid > 0 && launch.roomStart && launch.vitePid > 0 && launch.viteStart, 'supervisor-owned PID/start provenance required')
const report = { source: expected, launch, cases: [], classification: {
  chrome: 'installed channel chrome', tag: 'synthetic touch PointerEvents through actual TAG handlers',
  nativeTag: 'native Chrome mouse on the actual TAG button', keyboard: 'native Playwright KeyL in hasTouch=true context; canvas Escape in hasTouch=false desktop',
  canvasMouse: 'native Playwright mouse with actual pointer lock', gamepad: 'not in first four slices',
  touchHardware: 'not verified', expandedAbout: 'not implemented or covered',
}, errors: [] }
await mkdir(out, { recursive: true })
const files = ['index.html', 'src/main.ts', 'src/core/Input.ts', 'src/core/Game.ts', 'src/ui/Shell.ts',
  'src/ui/TouchControls.ts', 'src/ui/gear/GearSelector.ts', 'src/net/index.ts',
  'src/net/Connection.ts', 'src/weapons/Gear.ts', 'src/weapons/BigRed.ts',
  'src/weapons/yoink/Yoink.ts', 'src/weapons/yoink/params.ts', 'src/weapons/bigRedParams.ts',
  'src/weapons/bungee/Bungee.ts', 'src/weapons/aim.ts', 'src/bots/params.ts',
  'shared/params.ts', 'vite.config.ts', 'tests/ui/about-input.mjs', 'tests/ui/about-input-observers.mjs']
// Each response has its own partial file, so concurrent browser callbacks cannot
// overwrite one another. Receipt errors remain fatal without masking a read/assertion.
let responseSequence = 0
async function capturedBody(response, kind, requestedURL, readBody) {
  const native = typeof response.status === 'number'
  const headers = native ? response.headers : response.headers()
  const selected = Object.fromEntries(['content-type', 'content-length', 'etag'].map(name =>
    [name, native ? headers.get(name) : headers[name] ?? null]))
  const receipt = { sequence: ++responseSequence, kind, requestedURL: String(requestedURL),
    url: native ? response.url : response.url(), status: native ? response.status : response.status(),
    headers: selected, body: null }
  report.responseReceipts ??= []
  report.responseReceipts.push(receipt)
  const persist = async () => {
    try {
      await bounded(writeFile(`${out}/response-${receipt.sequence}.json`, JSON.stringify(receipt, null, 2)), 3000, 'partial response receipt')
    } catch (error) {
      const failure = `Response receipt ${receipt.sequence}: ${String(error)}`
      report.errors.push(failure)
      console.error(failure)
    }
  }
  await persist()
  try {
    const bytes = Buffer.from(await bounded(readBody(), 10000, `${kind} body`))
    receipt.body = { length: bytes.length, sha256: hash(bytes),
      first4096Bytes: bytes.subarray(0, 4096).toString('utf8'), truncated: bytes.length > 4096 }
    await persist()
    return bytes
  } catch (error) {
    receipt.readFailure = String(error.stack ?? error)
    await persist()
    throw error
  }
}
async function provenance() {
  assert.equal(git('rev-parse', 'HEAD'), expected)
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '')
  const manifest = []
  for (const path of files) {
    const local = await readFile(new URL(path, new URL('../../', import.meta.url)), 'utf8')
    const rawURL = new URL(`/${path}?raw${path === 'index.html' ? '&import' : ''}`, origin)
    const response = await fetch(rawURL, { signal: AbortSignal.timeout(remaining(10000)), cache: 'no-store' })
    const raw = (await capturedBody(response, 'source', rawURL, () => response.arrayBuffer())).toString('utf8')
    assert.equal(response.status, 200, path)
    const literal = raw.match(/^export default ("(?:[^"\\]|\\.)*")\s*;?/m)
    assert.ok(literal, `${path} raw export`)
    assert.equal(JSON.parse(literal[1]), local, `${path} served identity`)
    let transformedHash
    if (path.startsWith('src/') && path.endsWith('.ts')) {
      const transformed = await fetch(new URL(`/${path}`, origin), { signal: AbortSignal.timeout(remaining(10000)), cache: 'no-store' })
      const module = (await capturedBody(transformed, 'transformed source', new URL(`/${path}`, origin), () => transformed.arrayBuffer())).toString('utf8')
      assert.equal(transformed.status, 200)
      const encoded = module.match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
      assert.ok(encoded, `${path} inline source map required`)
      const map = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'))
      assert.ok(map.sourcesContent?.includes(local), `${path} transformed input differs`)
      transformedHash = hash(module)
    }
    manifest.push({ path, sha256: hash(local), transformedHash })
  }
  return manifest
}
let browser, primaryError
let browserDisconnected = false
const contexts = [], browserEvidence = []
const recipe = { world: 'alpine', seed: 1518, quality: 2, auto: false, hour: 12, dayLength: 0 }
report.recipe = recipe
async function observeBrowser(page, context, name) {
  const evidence = { name, responses: [], failures: [], pending: [], openRequests: new Set(), closed: false }
  const relevant = request => {
    const url = new URL(request.url()), path = url.pathname.slice(1)
    return url.origin === new URL(origin).origin && (request.resourceType() === 'document' || path.startsWith('src/') || path.startsWith('shared/') || path === 'tests/ui/about-input-observers.mjs')
  }
  page.on('close', () => { evidence.closed = true })
  page.on('request', request => { if (relevant(request)) evidence.openRequests.add(request) })
  page.on('requestfinished', request => evidence.openRequests.delete(request))
  page.on('requestfailed', request => {
    if (relevant(request)) evidence.failures.push(`Runtime request failed: ${request.url()}: ${request.failure()?.errorText}`)
    evidence.openRequests.delete(request)
  })
  browserEvidence.push(evidence)
  const cdp = await bounded(context.newCDPSession(page), 5000, 'CDP provenance')
  await bounded(cdp.send('Network.enable'), 5000, 'network observation')
  await bounded(cdp.send('Network.setCacheDisabled', { cacheDisabled: true }), 5000, 'disable browser cache')
  cdp.on('Network.responseReceived', ({ response }) => {
    if (response.url.startsWith(origin) && (response.fromDiskCache || response.fromServiceWorker || response.fromPrefetchCache))
      evidence.failures.push(`Cached runtime response: ${response.url}`)
  })
  cdp.on('Network.requestServedFromCache', ({ requestId }) => evidence.failures.push(`Cached request: ${requestId}`))
  page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
    try { if (['update', 'full-reload', 'prune'].includes(JSON.parse(String(payload)).type)) evidence.failures.push('HMR changed runtime') } catch { /* room binary/non-JSON frame */ }
  }))
  page.on('response', response => {
    const url = new URL(response.url()), path = url.pathname.slice(1)
    if (url.origin !== new URL(origin).origin || !(response.request().resourceType() === 'document' || path.startsWith('src/') || path.startsWith('shared/') || path === 'tests/ui/about-input-observers.mjs')) return
    const work = (async () => {
      const bytes = await capturedBody(response, 'actual browser', response.request().url(), () => response.body())
      assert.equal(response.status(), 200, `browser response ${url}`)
      assert.equal(response.fromServiceWorker(), false)
      assert.equal(url.searchParams.has('t'), false, 'HMR timestamp module')
      const entry = { url: url.href, path, sha256: hash(bytes), resource: response.request().resourceType() }
      // Compare bytes actually delivered to Chrome with the isolated served module,
      // then tie TS input back to checkout. A Node refetch alone is not evidence.
      const expectedResponse = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(remaining(10000)) })
      const comparison = await capturedBody(expectedResponse, 'served comparison', url, () => expectedResponse.arrayBuffer())
      assert.equal(expectedResponse.status, 200)
      assert.equal(hash(comparison), entry.sha256)
      if (path === 'tests/ui/about-input-observers.mjs') {
        const local = await readFile(new URL(path, new URL('../../', import.meta.url)), 'utf8')
        assert.ok(bytes.toString().startsWith(local.trimEnd()), 'actual observer differs from checkout')
        entry.sourceSha256 = hash(local)
      }
      if (files.includes(path) && path.endsWith('.ts')) {
        const local = await readFile(new URL(path, new URL('../../', import.meta.url)), 'utf8')
        const encoded = bytes.toString().match(/sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/)
        assert.ok(encoded, `${path} actual browser source map`)
        assert.ok(JSON.parse(Buffer.from(encoded[1], 'base64')).sourcesContent?.includes(local), `${path} browser input differs`)
        entry.sourceSha256 = hash(local)
      }
      evidence.responses.push(entry)
    })().catch(error => evidence.failures.push(String(error.stack ?? error)))
    evidence.pending.push(work)
  })
}
function responseReceipt() {
  return browserEvidence.map(({ pending, openRequests, ...evidence }) => ({ ...evidence,
    responseJobs: pending.length, openRequests: [...openRequests].map(request => request.url()) }))
}
async function drainResponses(boundary) {
  // Re-read the live queues after each await. A single Promise.all snapshot can
  // miss responses appended while earlier body reads or final provenance run.
  const cursors = new Map()
  const drainDeadline = Math.min(deadline, Date.now() + 10000)
  let stable = 0
  while (stable < 2) {
    remaining(1)
    assert.ok(Date.now() < drainDeadline, `${boundary}: stable capture deadline`)
    let added = false
    for (const evidence of browserEvidence) {
      const cursor = cursors.get(evidence) ?? 0
      const end = evidence.pending.length
      if (end > cursor) {
        added = true
        await bounded(Promise.allSettled(evidence.pending.slice(cursor, end)), Math.max(1, drainDeadline - Date.now()), `${boundary}: response drain`)
        cursors.set(evidence, end)
      }
    }
    await bounded(new Promise(resolve => setTimeout(resolve, 25)), 1000, `${boundary}: event delivery`)
    const settled = browserEvidence.every(e => e.pending.length === (cursors.get(e) ?? 0) && e.openRequests.size === 0)
    stable = settled && !added ? stable + 1 : 0
  }
  report.responseBoundaries ??= []
  report.responseBoundaries.push({ boundary, browserDisconnected,
    pages: browserEvidence.map(e => ({ name: e.name, closed: e.closed, jobs: e.pending.length, openRequests: e.openRequests.size })) })
}
async function verifyBrowserEvidence(boundary, closed = false) {
  await drainResponses(boundary)
  if (closed) {
    assert.ok(!browser || browserDisconnected, 'browser disconnect must establish final capture boundary')
    assert.ok(browserEvidence.every(e => e.closed), 'all observed pages must be closed')
  }
  assert.deepEqual(report.errors, [], 'page errors through capture boundary')
  for (const evidence of browserEvidence) {
    assert.deepEqual(evidence.failures, [], evidence.name)
    assert.ok(evidence.responses.some(r => r.resource === 'document'), 'actual document response missing')
    for (const path of files.filter(p => p.startsWith('src/') || p === 'shared/params.ts' || p === 'tests/ui/about-input-observers.mjs'))
      assert.ok(evidence.responses.some(r => r.path === path), `actual browser module missing: ${path}`)
  }
  report.browserResponses = responseReceipt()
}
function assertTransactions(transactions) {
  for (const transaction of transactions) {
    assert.ok(transaction.returned, 'cancellation invocation must return')
    const calls = transaction.calls
    assert.deepEqual(calls.map(call => call.method), ['BigRed.cancel', 'Yoink.cancel', 'Input.inhibit'])
    for (const call of calls) {
      assert.equal(call.transaction, transaction.id); assert.ok(call.after)
      assert.equal(call.before.suspended, transaction.before.suspended, 'must cancel before changing suspension')
      assert.equal(call.after.suspended, transaction.before.suspended)
    }
    assert.equal(calls[2].before.charge, -1); assert.equal(calls[2].before.holding, null)
    assert.equal(transaction.returned.fire, false)
    assert.equal(transaction.returned.suspended, transaction.before.suspended)
  }
}
function phases(record) { return [record.immediate, record.stepEntry, record.firstStep] }
function canceledRed(before, record) {
  for (const phase of phases(record)) { assert.equal(phase.charge, -1); assert.equal(phase.fire, false); noRed(before, phase) }
}

async function ready(page, fn, arg, timeout = 10000) {
  await page.waitForFunction(fn, arg, { timeout: remaining(timeout) })
}
async function state(page) { return page.evaluate(() => aboutInputObserver.snapshot()) }
async function record(page, label, expectStep = true) {
  await ready(page, ({ label, expectStep }) => {
    aboutInputObserver.diagnostics()
    const r = aboutInputObserver.records.find(r => r.label === label)
    if (r?.lifecycleFailure) return true
    return r?.immediate && (!expectStep || (r.stepEntry && r.firstStep))
  }, { label, expectStep })
  const r = await page.evaluate(label => aboutInputObserver.records.find(r => r.label === label), label)
  report.cases.push(r)
  assert.equal(r.lifecycleFailure ?? null, null, 'observer lifecycle must preserve first normal step')
  assert.equal(r.preconditionFailure, null)
  assertTransactions(r.transactions)
  assert.equal(r.immediate.tick, r.eventReturn.tick, 'event microtask precedes simulation')
  if (r.detail.method === 'requestPause') {
    assert.ok(r.transactions.length > 0, 'pause must invoke full cancellation in this event')
    assert.ok(r.transactions.some(t => !t.before.suspended && !t.returned.suspended), 'cancel returns before pause suspends input')
    assert.equal(r.immediate.suspended, true)
  }
  if (expectStep) {
    assert.ok(r.stepEntry && r.firstStep)
    assert.equal(r.stepEntry.tick, r.firstStep.tick, 'same first fixed step entry/exit')
  } else assert.equal(r.immediate.tick, r.eventReturn.tick, 'pause cannot advance simulation')
  return r
}
function noRed(before, after) {
  assert.equal(after.red.sent, before.red.sent); assert.equal(after.red.fizzled, before.red.fizzled)
  assert.equal(after.redCalls, before.redCalls)
}
function oneRed(before, after) {
  assert.equal(after.red.sent - before.red.sent, 1)
  assert.equal(after.redCalls - before.redCalls, 1)
  assert.equal(after.red.fizzled, before.red.fizzled)
}
async function select(page, id) {
  // The real rack keyboard selector runs before the next normal fixed step.
  // Derive actual order from source at runtime, do not rely on guessed digits.
  const digit = await page.evaluate(id => syn3hNet.gear.list().indexOf(id) + 1, id)
  assert.ok(digit > 0 && digit <= 9)
  await page.keyboard.press(`Digit${digit}`)
  await ready(page, id => syn3hNet.gear.current === id, id)
  await ready(page, () => !syn3h.game.input.state.fire && !syn3h.game.input.suspended)
  // Wait normal simulation cooldown; never overwrite pending action state.
  const waitUntil = await page.evaluate(() => syn3h.game.time + Math.max(
    syn3h.params.get('bigRed.cooldown').value, syn3h.params.get('yoink.cooldown').value) + .1)
  await ready(page, time => syn3h.game.time >= time, waitUntil)
}
async function tagDown(page, id) {
  await page.locator('.touch-fire').waitFor({ state: 'visible', timeout: remaining(10000) })
  await page.evaluate(id => {
    const tag = document.querySelector('.touch-fire')
    tag.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: id, button: 0, buttons: 1 }))
  }, id)
}
async function tagEnd(page, id, type, label, target = null) {
  // Arm and dispatch synchronously: target and hold-window check immediately precedes action.
  return page.evaluate(({ id, type, label, target }) => {
    const before = aboutInputObserver.arm(label, type, target)
    document.querySelector('.touch-fire').dispatchEvent(new PointerEvent(type,
      { bubbles: true, pointerType: 'touch', pointerId: id, button: 0, buttons: 0 }))
    return before
  }, { id, type, label, target })
}
async function newGame(touch, name) {
  const context = await bounded(browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: touch, serviceWorkers: 'block' }), 10000, 'new context')
  contexts.push(context)
  const page = await bounded(context.newPage(), 10000, 'new page')
  // Playwright evaluate and low-level input APIs have no per-call timeout option.
  // Bound their promises without changing the browser-side event or application.
  for (const [object, names] of [[page, ['evaluate']], [page.keyboard, ['down', 'up', 'press']],
    [page.mouse, ['down', 'up', 'move', 'click']]]) {
    for (const name of names) {
      const original = object[name].bind(object)
      object[name] = (...args) => { remaining(15000); return bounded(original(...args), 15000, name) }
    }
  }
  await observeBrowser(page, context, name)
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000)
  page.on('pageerror', error => report.errors.push({ name, message: error.message }))
  const sockets = []
  page.on('websocket', ws => sockets.push(ws.url()))
  const url = new URL(origin)
  url.searchParams.set('world', `${recipe.world}.${recipe.seed}~sun.timeOfDay=${recipe.hour},sun.dayLength=${recipe.dayLength}`)
  url.searchParams.set('room', `ux-input-${name}-${Date.now()}`)
  await page.goto(url.href, { timeout: remaining(30000) })
  await ready(page, () => !!window.syn3h?.shell?.galaxy?.live, null, 60000)
  assert.equal(await page.locator('.galaxy-label.is-current').getAttribute('data-world'), recipe.world)
  await page.locator('.galaxy-label.is-current').focus(); await page.keyboard.press('Enter')
  await ready(page, () => window.syn3hNet?.connected && syn3h.shell.playing && !syn3h.shell.dropping, null, 60000)
  const websocketBase = launch.env.VITE_SERVER_URL ?? origin.replace(/^http/, 'ws')
  const expectedSocket = websocketBase.replace(/\/+$/, '').replace(/\/ws$/, '') + '/ws?room=' + encodeURIComponent(url.searchParams.get('room'))
  assert.ok(sockets.includes(expectedSocket), 'actual connection must match allocated room origin and room')
  assert.ok(sockets.every(socket => socket === expectedSocket || new URL(socket).pathname === '/'), 'unexpected websocket destination')
  assert.ok(await page.evaluate(() => syn3hNet.isHost), 'isolated fixture must own room')
  const settings = await page.evaluate(async recipe => {
    const { currentPlanet } = await import('/src/world/planets.ts')
    if (currentPlanet().id !== recipe.world) throw new Error('World recipe changed during entry')
    const changes = { 'daydream.seconds': 0, 'bots.tagBeams': false, 'bots.canDrive': false,
      'bots.count': 1, 'bots.fleet': 0, 'world.seed': recipe.seed, 'gfx.auto': recipe.auto,
      'gfx.quality': recipe.quality, 'sun.timeOfDay': recipe.hour, 'sun.dayLength': recipe.dayLength }
    const before = {}
    for (const [id, value] of Object.entries(changes)) {
      before[id] = syn3h.params.get(id).value
      syn3h.params.set(id, value)
    }
    return { before, applied: changes, holdTime: syn3h.params.get('yoink.holdTime').value,
      charge: syn3h.params.get('bigRed.charge').value, actual: Object.fromEntries(Object.keys(changes).map(id => [id, syn3h.params.get(id).value])) }
  }, recipe)
  assert.deepEqual(settings.actual, settings.applied)
  report[name] = { url: url.href, sockets, settings }
  // Parameter assignment precedes BotManager's ordinary update reconciliation.
  // Observe actual public roster identities across a later frame and physics tick.
  await ready(page, () => {
    const { game, bots } = syn3h
    const vehicles = [...bots.vehicles]
    const rows = [...syn3hNet.players.values()].filter(p => p.bot)
    const valid = syn3hNet.isHost && vehicles.length === 1 && rows.length === 1 &&
      syn3hNet.vehicleOf(rows[0].id) === vehicles[0] && game.systems.includes(vehicles[0])
    const previous = window.aboutInputSettledRoster
    if (!valid) { delete window.aboutInputSettledRoster; return false }
    if (previous?.vehicle === vehicles[0] && previous.botId === rows[0].id &&
        game.frames > previous.frame && game.tick > previous.tick) return true
    window.aboutInputSettledRoster = { vehicle: vehicles[0], botId: rows[0].id, frame: game.frames, tick: game.tick }
    return false
  })
  report[name].settledRoster = await page.evaluate(async () => {
    const { installAboutInputObservers } = await import('/tests/ui/about-input-observers.mjs')
    // The module import yields; recheck the retained identities before installing.
    const settled = window.aboutInputSettledRoster
    const { game, bots } = syn3h
    const rows = [...syn3hNet.players.values()].filter(p => p.bot)
    if (!settled || !syn3hNet.isHost || bots.vehicles.length !== 1 || bots.vehicles[0] !== settled.vehicle ||
        rows.length !== 1 || rows[0].id !== settled.botId || syn3hNet.vehicleOf(settled.botId) !== settled.vehicle ||
        !game.systems.includes(settled.vehicle)) throw new Error('Settled roster changed before observer installation')
    const receipt = { botId: settled.botId, firstFrame: settled.frame, firstTick: settled.tick,
      installedFrame: game.frames, installedTick: game.tick, vehicleIndex: game.systems.indexOf(settled.vehicle) }
    installAboutInputObservers()
    delete window.aboutInputSettledRoster
    return receipt
  })
  return page
}
async function stageTarget(page) {
  const staged = await page.evaluate(async () => {
    if (syn3hNet.yoink.holding !== null) throw new Error('Cannot stage during carry')
    const { aimFrom } = await import('/src/weapons/aim.ts')
    const candidate = [...syn3hNet.players.values()].find(p => p.bot && syn3hNet.vehicleOf(p.id))
    if (!candidate) throw new Error('No actual host bot target')
    const vehicle = syn3hNet.vehicleOf(candidate.id)
    const aim = aimFrom(syn3h.game, syn3h.player.body, syn3h.params.get('yoink.range').value, .4, 2.4, 0, true)
    const position = aim.o.clone().addScaledVector(aim.d, 8)
    vehicle.body.setTranslation(position, true)
    vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    return { id: candidate.id, position: position.toArray(), tick: syn3h.game.tick }
  })
  await ready(page, staged => {
    const vehicle = syn3hNet.vehicleOf(staged.id)
    const p = vehicle?.body.translation()
    return syn3h.game.tick >= staged.tick + 3 && p && vehicle.object.position.distanceTo(p) < 2
  }, staged)
  report.targetSetups ??= []; report.targetSetups.push(staged)
  return staged.id
}

try {
  report.provenance = await provenance()
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: remaining(30000) })
  browser.on('disconnected', () => { browserDisconnected = true })
  const touch = await newGame(true, 'tag')
  const charged = () => ready(touch, () => syn3hNet.bigRed.ready && syn3h.game.input.state.fire)
  // Slice 1: positive and negative real TAG controls through actual state refresh.
  for (const [id, type] of [[101, 'pointerup'], [102, 'pointercancel']]) {
    await select(touch, 'red'); await tagDown(touch, id); await charged()
    await ready(touch, () => syn3hNet.gear.controls().state === 'ready' &&
      document.querySelector('.gs-hints [data-action=charge] .gs-act')?.textContent === 'Let go to send')
    const label = `tag-thunder-${type}`
    const before = await tagEnd(touch, id, type, label)
    assert.equal(before.ready, true)
    const r = await record(touch, label)
    if (type === 'pointerup') { noRed(before, r.immediate); noRed(before, r.stepEntry); oneRed(before, r.firstStep) }
    else {
      canceledRed(before, r)
    }
  }
  // Native mouse on the real TAG button, in the same touch-capable app layout.
  await select(touch, 'red')
  const tag = touch.locator('.touch-fire')
  const box = await tag.boundingBox(); assert.ok(box)
  await touch.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await touch.mouse.down(); await charged()
  const nativeBefore = await touch.evaluate(() => aboutInputObserver.arm('tag-thunder-native-up', 'pointerup'))
  await touch.mouse.up()
  const nativeRelease = await record(touch, 'tag-thunder-native-up')
  assert.equal(nativeRelease.detail.trusted, true); noRed(nativeBefore, nativeRelease.immediate); noRed(nativeBefore, nativeRelease.stepEntry); oneRed(nativeBefore, nativeRelease.firstStep)

  // End the unrelated native mouse hover BEFORE any synthetic Yoink owner exists.
  // This isolates the fixture; broad TAG cleanup with real mixed devices remains unverified.
  const neutralMouse = await touch.evaluate(() => {
    const s = aboutInputObserver.snapshot()
    if (s.fire || s.holding !== null || s.rawPrimary.length || s.canvasOwners.length ||
        document.querySelector('.touch-fire.held')) throw new Error('Cannot reposition mouse during an active hold')
    const canvas = syn3h.game.canvas
    for (const yf of [.25, .5, .75]) for (const xf of [.25, .5, .75]) {
      const x = innerWidth * xf, y = innerHeight * yf
      if (document.elementFromPoint(x, y) === canvas) return { x, y, before: s }
    }
    throw new Error('No neutral canvas point outside TAG')
  })
  await touch.mouse.move(neutralMouse.x, neutralMouse.y)
  neutralMouse.after = await touch.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y), s = aboutInputObserver.snapshot()
    if (hit !== syn3h.game.canvas || hit.closest('.touch-fire') || s.fire || s.holding !== null ||
        s.rawPrimary.length || s.canvasOwners.length || document.querySelector('.touch-fire.held'))
      throw new Error('Neutral mouse setup changed or an owner became active')
    return s
  }, neutralMouse)
  report.tag.neutralMouse = neutralMouse

  // Slice 2: actual acquisition, not a seeded carry. No target movement while held.
  for (const [id, type] of [[201, 'pointerup'], [202, 'pointercancel'], [203, 'fling']]) {
    await select(touch, 'yoink')
    await ready(touch, () => [...syn3hNet.players.values()].some(p => p.bot && syn3hNet.vehicleOf(p.id)))
    const target = await stageTarget(touch)
    await tagDown(touch, id)
    await ready(touch, target => syn3hNet.yoink.holding === target, target, 3000)
    await ready(touch, () => syn3hNet.gear.controls().state === 'holding' &&
      document.querySelector('.gs-status')?.textContent.startsWith('Holding '))
    const label = `tag-yoink-${type}`
    let before
    if (type === 'fling') {
      const fling = touch.locator('.gs-action[data-action="fling"]')
      await fling.waitFor({ state: 'visible', timeout: remaining(2000) })
      before = await touch.evaluate(({ label, target }) => aboutInputObserver.arm(label, 'fling', target), { label, target })
      await fling.click({ timeout: remaining(2000) })
    } else before = await tagEnd(touch, id, type, label, target)
    assert.equal(before.holding, target)
    const r = await record(touch, label)
    assert.equal(r.firstStep.holding, null)
    assert.equal(r.firstStep.yoink.flings - before.yoink.flings, type === 'pointercancel' ? 0 : 1)
    assert.equal(r.firstStep.yoink.drops - before.yoink.drops, type === 'pointercancel' ? 1 : 0)
    for (const phase of [r.immediate, r.stepEntry]) {
      if (type === 'pointerup') {
        assert.equal(phase.holding, target)
        assert.deepEqual(phase.yoinkSends, before.yoinkSends)
      } else {
        assert.equal(phase.holding, null)
        assert.deepEqual(phase.yoinkSends.slice(before.yoinkSends.length).map(({ kind, target }) => ({ kind, target })),
          [{ kind: type === 'pointercancel' ? 'drop' : 'fling', target }])
      }
    }
    const sent = r.firstStep.yoinkSends.slice(before.yoinkSends.length)
    assert.deepEqual(sent.map(({ kind, target }) => ({ kind, target })), [{ kind: type === 'pointercancel' ? 'drop' : 'fling', target }])
    if (type === 'pointercancel') for (const phase of phases(r)) {
      assert.equal(phase.holding, null); assert.equal(phase.yoink.flings, before.yoink.flings)
      assert.deepEqual(phase.yoinkSends.slice(before.yoinkSends.length).map(({ kind, target }) => ({ kind, target })), [{ kind: 'drop', target }])
    }
    if (type === 'fling') {
      const later = await tagEnd(touch, id, 'pointerup', 'yoink-old-tag-up')
      const ended = await record(touch, 'yoink-old-tag-up')
      assert.equal(ended.firstStep.yoink.flings, later.yoink.flings)
    }
  }

  // Slice 3a: native keyboard hold across actual pause/resume, without forced lock state.
  await select(touch, 'red'); await touch.keyboard.down('KeyL'); await charged()
  const keyBefore = await touch.evaluate(() => aboutInputObserver.arm('key-pause', 'requestPause'))
  await touch.keyboard.press('Escape')
  const paused = await record(touch, 'key-pause', false)
  assert.equal(paused.immediate.paused, true); assert.equal(paused.immediate.charge, -1)
  noRed(keyBefore, paused.immediate)
  await touch.evaluate(() => aboutInputObserver.arm('key-resume-held', 'requestResume'))
  await touch.keyboard.press('Escape')
  const resumed = await record(touch, 'key-resume-held')
  canceledRed(keyBefore, resumed)
  const linkedKeyPause = await record(touch, 'key-pause')
  assert.equal(linkedKeyPause.resumedBy, resumed.label); assert.equal(resumed.resumes, linkedKeyPause.label)
  assert.equal(linkedKeyPause.beforeResume.tick, linkedKeyPause.immediate.tick)
  assert.deepEqual(linkedKeyPause.firstStep, resumed.firstStep)
  canceledRed(keyBefore, linkedKeyPause)
  await touch.keyboard.up('KeyL'); await touch.keyboard.down('KeyL'); await charged()
  const freshKey = await touch.evaluate(() => aboutInputObserver.arm('key-fresh-up', 'keyup'))
  await touch.keyboard.up('KeyL')
  oneRed(freshKey, (await record(touch, 'key-fresh-up')).firstStep)

  // Slice 4: both sources genuinely acquired before partial cancellation.
  for (const [id, final] of [[301, 'intentional-key'], [302, 'cancel-tag']]) {
    await select(touch, 'red'); await tagDown(touch, id); await touch.keyboard.down('KeyL'); await charged()
    const overlap = await touch.evaluate(() => ({ state: aboutInputObserver.snapshot(),
      tagHeld: document.querySelector('.touch-fire').classList.contains('held'),
      keyHeld: syn3h.game.input.held('KeyL') }))
    assert.ok(overlap.tagHeld && overlap.keyHeld)
    if (final === 'intentional-key') {
      const before = await tagEnd(touch, id, 'pointercancel', 'overlap-cancel-tag')
      const r = await record(touch, 'overlap-cancel-tag')
      for (const phase of phases(r)) { assert.equal(phase.fire, true); assert.equal(phase.ready, true); noRed(before, phase) }
      await touch.evaluate(() => aboutInputObserver.arm('overlap-final-key', 'keyup'))
      await touch.keyboard.up('KeyL')
      oneRed(before, (await record(touch, 'overlap-final-key')).firstStep)
    } else {
      await touch.evaluate(() => aboutInputObserver.arm('overlap-partial-key', 'keyup'))
      await touch.keyboard.up('KeyL')
      const partial = await record(touch, 'overlap-partial-key')
      for (const phase of phases(partial)) { assert.equal(phase.fire, true); assert.equal(phase.ready, true); noRed(partial.before, phase) }
      const before = await tagEnd(touch, id, 'pointercancel', 'overlap-final-cancel')
      const r = await record(touch, 'overlap-final-cancel')
      canceledRed(before, r)
    }
  }
  // Slice 3b: native canvas mouse. Escape releases lock, then pauses, with no mouseup.
  const desktop = await newGame(false, 'canvas')
  await select(desktop, 'red')
  if (!await desktop.evaluate(() => !!document.pointerLockElement)) {
    const point = await desktop.evaluate(() => { const r = syn3h.game.canvas.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await desktop.mouse.click(point.x, point.y)
  }
  await ready(desktop, () => document.pointerLockElement === syn3h.game.canvas)
  await desktop.mouse.down()
  await ready(desktop, () => syn3hNet.bigRed.ready)
  const canvasBefore = await desktop.evaluate(() => aboutInputObserver.arm('canvas-unlock-held', 'releaseCursor'))
  assert.ok(canvasBefore.rawPrimary.length > 0)
  await desktop.keyboard.press('Escape')
  const unlocked = await record(desktop, 'canvas-unlock-held')
  canceledRed(canvasBefore, unlocked)
  assert.deepEqual(unlocked.immediate.rawPrimary, canvasBefore.rawPrimary)
  await desktop.evaluate(() => aboutInputObserver.arm('canvas-pause-held', 'requestPause'))
  await desktop.keyboard.press('Escape')
  const canvasPause = await record(desktop, 'canvas-pause-held', false)
  assert.equal(canvasPause.immediate.paused, true)
  assert.deepEqual(canvasPause.immediate.rawPrimary, canvasBefore.rawPrimary)
  await desktop.evaluate(() => aboutInputObserver.arm('canvas-resume-held', 'requestResume'))
  await desktop.keyboard.press('Escape')
  const canvasResume = await record(desktop, 'canvas-resume-held')
  canceledRed(canvasBefore, canvasResume)
  const linkedCanvasPause = await record(desktop, 'canvas-pause-held')
  assert.equal(linkedCanvasPause.resumedBy, canvasResume.label); assert.equal(canvasResume.resumes, linkedCanvasPause.label)
  assert.equal(linkedCanvasPause.beforeResume.tick, linkedCanvasPause.immediate.tick)
  assert.deepEqual(linkedCanvasPause.firstStep, canvasResume.firstStep)
  canceledRed(canvasBefore, linkedCanvasPause)
  assert.deepEqual(canvasResume.immediate.rawPrimary, canvasBefore.rawPrimary)
  await desktop.mouse.up()
  await ready(desktop, () => document.pointerLockElement === syn3h.game.canvas)
  await desktop.mouse.down(); await ready(desktop, () => syn3hNet.bigRed.ready)
  const freshMouse = await desktop.evaluate(() => aboutInputObserver.arm('canvas-fresh-up', 'canvasup'))
  await desktop.mouse.up()
  oneRed(freshMouse, (await record(desktop, 'canvas-fresh-up')).firstStep)
  for (const page of [touch, desktop]) {
    const actualRecipe = await page.evaluate(async () => {
      const { currentPlanet } = await import('/src/world/planets.ts')
      return { world: currentPlanet().id, seed: syn3h.params.get('world.seed').value,
        quality: syn3h.params.get('gfx.quality').value, auto: syn3h.params.get('gfx.auto').value,
        hour: syn3h.params.get('sun.timeOfDay').value, dayLength: syn3h.params.get('sun.dayLength').value }
    })
    assert.deepEqual(actualRecipe, recipe)
    const trace = await page.evaluate(() => ({ order: aboutInputObserver.order, events: aboutInputObserver.events }))
    report.traces ??= []; report.traces.push(trace)
    assertTransactions(await page.evaluate(() => aboutInputObserver.transactions))
  }
  assert.deepEqual(report.errors, [])
  await verifyBrowserEvidence('before final provenance')
  report.finalProvenance = await provenance()
  assert.deepEqual(report.finalProvenance, report.provenance)
  await verifyBrowserEvidence('after final provenance')
} catch (error) {
  primaryError = error
  report.failure = String(error.stack ?? error)
} finally {
  cleaningUp = true
  report.cleanupErrors = []
  for (const context of contexts) {
    let pages
    try { pages = context.pages() } catch (error) { report.cleanupErrors.push(String(error)); continue }
    for (const page of pages) {
      try {
        remaining(1)
        await bounded(page.evaluate(() => {
          if (!window.aboutInputObserver) return null
          const evidence = { records: aboutInputObserver.records, order: aboutInputObserver.order, events: aboutInputObserver.events }
          try { evidence.diagnostics = aboutInputObserver.diagnostics() }
          catch (error) { evidence.diagnosticFailure = String(error) }
          finally { try { aboutInputObserver.restore() } catch (error) { evidence.restoreFailure = String(error) } }
          return evidence
        }).then(evidence => { if (evidence) { report.partialTraces ??= []; report.partialTraces.push(evidence)
          if (evidence.restoreFailure) report.cleanupErrors.push(evidence.restoreFailure)
          if (evidence.diagnosticFailure) report.cleanupErrors.push(evidence.diagnosticFailure)
          if (evidence.diagnostics?.lifecycleFailures.length) report.cleanupErrors.push('Observer lifecycle failure in final evidence')
        } }), 3000, 'observer restore')
      } catch (error) { report.cleanupErrors.push(String(error)) }
    }
  }
  // Restore observers first, drain their final response activity, then close the
  // browser. Keep response/HMR/page-error listeners installed through disconnect.
  try { await verifyBrowserEvidence('after observer teardown') }
  catch (error) { report.cleanupErrors.push(String(error.stack ?? error)) }
  try { if (browser) { remaining(1); await bounded(browser.close(), 15000, 'browser close') } }
  catch (error) { report.cleanupErrors.push(String(error)) }
  try { await verifyBrowserEvidence('closed browser capture boundary', true) }
  catch (error) { report.cleanupErrors.push(String(error.stack ?? error)) }
  if (report.errors.length) report.cleanupErrors.push(...report.errors)
  report.browserResponses = responseReceipt()
  report.captureComplete = (!browser || browserDisconnected) && browserEvidence.every(e => e.closed && !e.openRequests.size)
    && report.cleanupErrors.length === 0
  try {
    remaining(1)
    await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000, 'final receipt')
  } catch (error) {
    report.cleanupErrors.push(`Receipt: ${String(error)}`)
    report.captureComplete = false
    console.error('PARTIAL_ABOUT_INPUT_RECEIPT', JSON.stringify(report))
  }
  // Cleanup never replaces the original assertion/timeout. Both survive in the
  // receipt; if there was no original failure, cleanup alone still fails the run.
  if (primaryError) throw primaryError
  if (report.cleanupErrors.length) throw new Error(`Incomplete fixture cleanup: ${report.cleanupErrors.join('; ')}`)
}
