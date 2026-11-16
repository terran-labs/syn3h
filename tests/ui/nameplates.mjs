// Three clients, one Chrome browser. Source proposal only; requires allocated execution.
// Requires a separately allocated supervisor, dedicated room server and clean Vite tree.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL
const expected = process.env.NP_SOURCE_SHA
const out = process.env.NP_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.NP_LAUNCH_MANIFEST, 'Explicit allocated origin, source, evidence and launcher manifest required')
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
const launch = JSON.parse(await readFile(process.env.NP_LAUNCH_MANIFEST, 'utf8'))
assert.equal(launch.head, expected)
assert.equal(launch.origin, origin)
assert.equal(launch.env.SYN3H_NO_ROOM_SERVER, '1')
assert.equal(String(launch.env.SYN3H_ROOM_PORT), String(launch.roomPort), 'Vite proxy room port must be explicit')
assert.ok(Number.isInteger(launch.roomPort) && launch.roomPort !== 8787, 'dedicated room port required')
assert.ok(launch.roomPid > 0 && launch.roomStart && launch.vitePid > 0 && launch.viteStart, 'supervisor-owned PID/start provenance required')
const report = { source: expected, launch, captures: [], errors: [], scope: 'Three fresh contexts: observer host, two remote people, four bots; Chrome only. No maximum-roster or hardware claim.' }
const captures = report.captures, errors = report.errors
await mkdir(out, { recursive: false })
const files = ['index.html', 'src/main.ts', 'src/net/index.ts', 'src/net/Connection.ts', 'src/ui/Shell.ts', 'src/world/curve.ts', 'shared/params.ts', 'vite.config.ts', 'server/dev.ts', 'tools/manual-reload.mjs', 'tools/rapier-wasm.mjs', 'tests/ui/nameplates.mjs', 'src/ui/nameplates/HudExclusions.ts', 'src/ui/nameplates/VehicleNameplates.ts', 'src/ui/nameplates/anchors.ts', 'src/ui/nameplates/curvature.ts', 'src/ui/nameplates/layout.ts', 'src/ui/nameplates/occlusion.ts', 'src/ui/nameplates/preferences.ts', 'src/ui/nameplates/renderHook.ts', 'src/ui/nameplates/terrain.ts']
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
  assert.ok(report.responseReceipts.length < 5000, 'response receipt bound')
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
async function observeBrowser(page, context, name) {
  const evidence = { name, responses: [], failures: [], pending: [], openRequests: new Set(), closed: false }
  const relevant = request => {
    const url = new URL(request.url()), path = url.pathname.slice(1)
    return url.origin === new URL(origin).origin && (request.resourceType() === 'document' || path.startsWith('src/') || path.startsWith('shared/'))
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
  evidence.sockets = []
  page.on('websocket', ws => {
    const url = new URL(ws.url())
    evidence.sockets.push(ws.url())
    if (url.pathname === '/ws' && (url.host !== new URL(origin).host || url.searchParams.get('room') !== room)) evidence.failures.push('Unexpected room socket')
    ws.on('framereceived', ({ payload }) => {
    try { if (['update', 'full-reload', 'prune'].includes(JSON.parse(String(payload)).type)) evidence.failures.push('HMR changed runtime') } catch { /* room binary/non-JSON frame */ }
    })
  })
  page.on('response', response => {
    const url = new URL(response.url()), path = url.pathname.slice(1)
    if (url.origin !== new URL(origin).origin || !(response.request().resourceType() === 'document' || path.startsWith('src/') || path.startsWith('shared/'))) return
    if (evidence.pending.length >= 2000) { evidence.failures.push('response job bound exceeded'); return }
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
    assert.ok(evidence.sockets.some(value => { const u = new URL(value); return u.pathname === '/ws' && u.host === new URL(origin).host && u.searchParams.get('room') === room }), 'actual owned-room proxy socket missing')
    assert.ok(evidence.responses.some(r => r.resource === 'document'), 'actual document response missing')
    for (const path of files.filter(p => p.startsWith('src/') || p === 'shared/params.ts'))
      assert.ok(evidence.responses.some(r => r.path === path), `actual browser module missing: ${path}`)
  }
  report.browserResponses = responseReceipt()
}
async function open(name, viewport) {
  remaining(1)
  const context = await bounded(browser.newContext({ viewport, serviceWorkers: 'block' }), 10000, 'context')
  contexts.push(context)
  const page = await bounded(context.newPage(), 10000, 'page')
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000)
  await observeBrowser(page, context, name)
  page.on('console', message => { if (message.type() === 'error' && errors.length < 1000) errors.push(`${name}: console: ${message.text()}`) })
  page.on('crash', () => errors.push(`${name}: renderer crash`))
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  await page.goto(`${origin}?room=${room}&name=${name}&autoplay=1`)
  await page.waitForFunction(() => window.syn3h?.shell && document.documentElement.dataset.boot === 'done', null, { timeout: remaining(90000) })
  await page.evaluate(() => {
    const s = window.syn3h
    s.shell.play(); document.activeElement?.blur?.()
    for (const [id, value] of Object.entries({ 'gfx.auto': false, 'gfx.quality': 4, 'daydream.seconds': 0, 'sun.dayLength': 0 })) {
      if (!s.params.get(id)) throw new Error(`Missing fixture control: ${id}`)
      s.params.set(id, value)
    }
  })
  await page.waitForFunction(() => window.syn3hNet?.connected, null, { timeout: remaining(30000) })
  await page.waitForFunction(() => window.syn3hNet.players.size >= 1, null, { timeout: remaining(15000) })
  return page
}
async function capture(page, label) {
  remaining(1)
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await page.waitForTimeout(500)
  const state = await page.evaluate(async () => {
    const { HudExclusions } = await import('/src/ui/nameplates/HudExclusions.ts')
    const shell = window.syn3h.shell, hud = new HudExclusions(shell.element), exclusions = hud.read(innerWidth, innerHeight)
    hud.dispose()
    const labels = [...document.querySelectorAll('.vehicle-nameplate')].filter(el => !el.hidden && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]')).map(el => {
      const b = el.getBoundingClientRect(), style = getComputedStyle(el)
      return { id: el.dataset.vehicle, bot: el.classList.contains('is-bot'), tick: el.classList.contains('is-tick'), text: el.textContent, width: b.width, height: b.height, opacity: Number(style.opacity), left: b.left, right: b.right, top: b.top, bottom: b.bottom }
    })
    const s = window.syn3h, controls = s.params.snapshot('all'), quality = s.game.quality.getQualityState()
    if (controls['gfx.auto'] !== false || controls['gfx.quality'] !== 4 || quality.auto || quality.level !== 4 || controls['daydream.seconds'] !== 0 || controls['sun.dayLength'] !== 0 || s.bots.daydream.active) throw new Error('Fixture control drift')
    return { labels, exclusions, controls, quality, nameplateCost: { ...window.syn3hNet.tags.stats }, curve: window.syn3h.params.get('world.curve').value, local: String(window.syn3hNet.id), presentation: shell.presentation, cameraMode: window.syn3h.params.get('camera.mode').value }
  })
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  assert.ok(state.labels.every(l => l.id !== state.local), 'never label the local player')
  for (let i = 0; i < state.labels.length; i++) {
    const a = state.labels[i]
    assert.ok(state.labels.slice(i + 1).every(b => !overlap(a, b)), `${label}: labels overlap`)
    assert.ok(state.exclusions.every(b => !overlap(a, b)), `${label}: label covers HUD`)
  }
  captures.push({ label, ...state })
  await page.screenshot({ path: `${out}/${label}.png` })
  await writeFile(`${out}/measurements.json`, JSON.stringify(captures, null, 2))
  return state
}
// Existing draw stamp identifies completed label draws, not duplicate rAF observations.
// Test-only access avoids adding a runtime diagnostics API. Reading DOM here has a cost;
// report label drawMs only, never claim this is total frame/GPU cost.
async function costDistribution(page, label) {
  const evidence = await page.evaluate(() => new Promise(resolve => {
    const samples = [], s = window.syn3h, tags = window.syn3hNet.tags
    let lastStamp = tags.stamp, raf, finished = false
    const finish = () => { if (finished) return; finished = true; cancelAnimationFrame(raf); clearTimeout(timeout); resolve({ samples, timedOut: samples.length < 120 }) }
    const timeout = setTimeout(finish, 10000)
    const read = () => {
      if (tags.stamp !== lastStamp) {
        lastStamp = tags.stamp
        const entries = tags.entries.map(e => ({ id: e.id, bot: e.bot }))
        const visible = [...document.querySelectorAll('.vehicle-nameplate')].filter(el => !el.hidden && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]')).map(el => el.dataset.vehicle)
        samples.push({ stamp: lastStamp, tick: s.game.tick, ...tags.stats, entries, visible,
          missing: entries.filter(e => !visible.includes(e.id)), mode: s.params.get('hud.nameplates').value })
      }
      if (samples.length >= 120) finish(); else raf = requestAnimationFrame(read)
    }
    raf = requestAnimationFrame(read)
  }))
  const summary = key => {
    const values = evidence.samples.map(s => s[key]).sort((a, b) => a - b)
    const at = fraction => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] : null
    return { count: values.length, min: at(0), p50: at(.5), p95: at(.95), max: at(1) }
  }
  const row = { label, evidenceKind: 'observed completed label draws', ...evidence,
    terrainQueries: summary('terrainQueries'), drawMs: summary('drawMs'),
    cappedSamples: evidence.samples.filter(s => s.terrainQueries === 512).length }
  captures.push(row)
  await writeFile(`${out}/measurements.json`, JSON.stringify(captures, null, 2))
  assert.ok(evidence.samples.length, `${label}: no completed label draws observed`)
  assert.ok(evidence.samples.every(s => s.terrainQueries <= 512), `${label}: terrain query cap exceeded`)
  assert.equal(evidence.timedOut, false, `${label}: incomplete cost sample window`)
}
const room = `labels-${Date.now()}`
try {
  await bounded((async () => {
    report.provenance = await provenance()
    browser = await bounded(chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] }), 30000, 'browser launch')
    browser.on('disconnected', () => { browserDisconnected = true })
  const a = await open('Observer', { width: 1440, height: 900 })
  const b = await open('Visitor', { width: 640, height: 480 })
  const c = await open('Companion', { width: 640, height: 480 })
  await a.waitForFunction(() => window.syn3hNet.remotes.size >= 2)
  assert.equal(await a.evaluate(() => window.syn3hNet.isHost), true, 'observer must own host bots')
  assert.equal(await a.locator('.vehicle-nameplates').count(), 1, 'new module must be integrated')
  // DOM regression: touch controls are siblings of Shell, not descendants.
  assert.equal(await a.evaluate(async () => {
    const { HudExclusions } = await import('/src/ui/nameplates/HudExclusions.ts')
    const root = document.createElement('div'), touch = document.createElement('div')
    touch.className = 'touch-actions'; touch.style.cssText = 'position:fixed;left:17px;top:19px;width:37px;height:41px;display:block;opacity:1'
    document.body.append(root, touch)
    const hud = new HudExclusions(root), found = hud.read(innerWidth, innerHeight).some(r => r.left === 11 && r.top === 13 && r.right === 60 && r.bottom === 66)
    hud.dispose(); root.remove(); touch.remove(); return found
  }), true, 'sibling touch controls are protected')
  await a.evaluate(() => { const s = window.syn3h; s.params.set('bots.canDrive', false); s.params.set('bots.tagBeams', false); s.params.set('bots.count', 4) })
  await a.waitForFunction(() => window.syn3h.bots.vehicles.length >= 4, null, { timeout: 15000 })
  let center = await a.evaluate(() => { const s = window.syn3h, p = s.terrain.spawnPoint(0).position; return { x: p.x, y: p.y, z: p.z } })
  async function stage(far = false, curve = .71) {
    await a.evaluate(curve => window.syn3h.params.set('world.curve', curve), curve)
    await a.evaluate(p => {
      const s = window.syn3h, v = s.player.object.position.clone().set(p.x, s.terrain.heightAt(p.x, p.z + 18) + 2, p.z + 18)
      s.player.teleport(v, 0)
      s.bots.vehicles.forEach((bot, i) => { const x = p.x + (i - 1.5) * 24, z = p.z - 18 - i * 10; bot.teleport(v.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) })
      s.camera.setCinematicPose(v.clone().set(p.x, p.y + 35, p.z + 70), v.clone().set(p.x, p.y + 4, p.z - 35), 60)
    }, center)
    await b.evaluate(({p, far}) => { const s = window.syn3h, z = p.z - (far ? 260 : 15), x = p.x - 45; s.player.teleport(s.player.object.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) }, { p: center, far })
    await c.evaluate(({p, far}) => { const s = window.syn3h, z = p.z - (far ? 190 : 30), x = p.x + 45; s.player.teleport(s.player.object.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) }, { p: center, far })
    await a.waitForTimeout(1500)
  }
  await stage()
  const near = await capture(a, 'desktop-near-day')
  for (const name of ['Visitor', 'Companion']) assert.ok(near.labels.some(l => !l.bot && l.text.includes(name)), `${name}: both remote human names are visible`)
  const person = near.labels.find(l => !l.bot), bot = near.labels.find(l => l.bot && !l.tick)
  assert.ok(person && bot, 'human and full bot labels must be present for comparison')
  assert.ok(bot.width / person.width >= .60 && bot.width / person.width <= .70, 'bot labels are 60 to 70 percent of human size')
  assert.ok(bot.height / person.height >= .60 && bot.height / person.height <= .70, 'bot label height is smaller too')
  assert.ok(bot.opacity < person.opacity, 'bot labels are fainter than human labels')
  assert.ok(near.labels.filter(l => l.bot && l.text.includes('BOT')).length >= 2, 'host-owned bots have smaller labels')
  await costDistribution(a, 'near-all-cost')
  await a.evaluate(() => window.syn3h.params.set('hud.nameplates', 1))
  assert.ok((await capture(a, 'people-only')).labels.every(l => !l.bot))
  await a.evaluate(() => window.syn3h.params.set('hud.nameplates', 2))
  assert.equal((await capture(a, 'off')).labels.length, 0)
  await costDistribution(a, 'near-off-cost')
  await a.evaluate(() => window.syn3h.params.set('hud.nameplates', 0))
  await b.evaluate(() => window.syn3h.game.input.toggleZorb())
  await b.waitForFunction(() => window.syn3h.player.zorb.radius > 4, null, { timeout: 15000 })
  await a.waitForFunction(() => [...window.syn3hNet.remotes.values()].some(r => r.vehicle.zorb.active), null, { timeout: 15000 })
  await capture(a, 'remote-zorb')
  await b.evaluate(() => window.syn3h.game.input.toggleZorb())
  await b.evaluate(() => { void window.syn3h.swapVehicle('jet') })
  await b.waitForFunction(() => window.syn3h.player.kind === 'jet', null, { timeout: 15000 })
  await a.waitForFunction(() => [...window.syn3hNet.remotes.values()].some(r => r.vehicle.kind === 'jet'), null, { timeout: 15000 })
  await capture(a, 'remote-materialize')
  await b.waitForFunction(() => window.syn3h.player.object.userData.materializing !== true, null, { timeout: 20000 })
  for (const curve of [0, .71, 1.8]) {
    await stage(false, curve); await capture(a, `desktop-curve-${curve}-near`)
    await stage(true, curve); await capture(a, `desktop-curve-${curve}-far`)
  }
  await stage(true, .71); await capture(a, 'desktop-far-day')
  await costDistribution(a, 'far-all-cost')
  await a.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 0)); await capture(a, 'desktop-far-night')
  await stage(); await a.evaluate(() => window.syn3h.shell.setPresentation(true)); await capture(a, 'desktop-presentation-night')
  await a.evaluate(() => { window.syn3h.shell.setPresentation(false); window.syn3h.params.set('sun.timeOfDay', 12) })
  await a.setViewportSize({ width: 390, height: 844 }); await capture(a, 'phone-near-day')
  for (const curve of [.71, 1.8]) {
    await stage(true, curve); await capture(a, `phone-curve-${curve}-far`)
  }
  await stage(false, .71)
  await a.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 0)); await capture(a, 'phone-near-night')
  await a.setViewportSize({ width: 1440, height: 900 })
  await a.evaluate(() => { window.syn3h.camera.clearCinematicPose(); window.syn3h.params.set('sun.timeOfDay', 12) })
  for (const mode of [0, 1, 2, 3, 4]) {
    await a.evaluate(mode => window.syn3h.params.set('camera.mode', mode), mode)
    await capture(a, `camera-${mode}`)
  }
  // Pausing stops the render loop; the observer must hide the layer without another frame.
  await a.evaluate(() => window.syn3h.shell.requestPause())
  await a.waitForFunction(() => document.querySelector('.vehicle-nameplates').hidden)
  await a.screenshot({ path: `${out}/paused.png` })
  await a.evaluate(() => window.syn3h.shell.requestResume())
  // Snow and bright sky need a real capture, not a CSS contrast assumption.
  await a.evaluate(() => window.syn3h.planets.applyPlanet('ice'))
  await a.waitForTimeout(2000)
  center = await a.evaluate(() => { const p = window.syn3h.terrain.spawnPoint(0).position; return { x: p.x, y: p.y, z: p.z } })
  await stage(); await a.evaluate(() => window.syn3h.params.set('sun.timeOfDay', 12)); await capture(a, 'snow-day')
  // Followers must get bot labels from replicas, not duplicate the host-owned set.
  assert.equal(await b.evaluate(() => window.syn3hNet.isHost), false, 'visitor must be follower')
  const follower = await capture(b, 'follower')
  assert.equal(new Set(follower.labels.map(l => l.id)).size, follower.labels.length, 'no duplicate follower labels')

    assert.deepEqual(errors, [])
    await verifyBrowserEvidence('before final provenance')
    report.finalProvenance = await provenance()
    assert.deepEqual(report.finalProvenance, report.provenance)
    await verifyBrowserEvidence('after final provenance')
  })(), remaining(450000), 'complete three-client fixture')
} catch (error) {
  primaryError = error; report.failure = String(error.stack ?? error)
} finally {
  cleaningUp = true
  report.cleanupErrors = []
  try { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
  catch (error) { report.cleanupErrors.push(`Partial receipt: ${error}`) }
  try { await verifyBrowserEvidence('before browser close') }
  catch (error) { report.cleanupErrors.push(String(error.stack ?? error)) }
  try { if (browser) await bounded(browser.close(), 15000, 'browser close') }
  catch (error) { report.cleanupErrors.push(String(error)) }
  try { await verifyBrowserEvidence('closed browser capture boundary', true) }
  catch (error) { report.cleanupErrors.push(String(error.stack ?? error)) }
  report.browserResponses = responseReceipt()
  report.captureComplete = !primaryError && browserDisconnected && browserEvidence.every(e => e.closed && !e.openRequests.size) && report.cleanupErrors.length === 0 && errors.length === 0
  try { await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000, 'final receipt') }
  catch (error) { report.cleanupErrors.push(String(error)); console.error('PARTIAL_NAMEPLATE_RECEIPT', JSON.stringify(report)) }
  if (primaryError) throw primaryError
  if (report.cleanupErrors.length) throw new Error(report.cleanupErrors.join('; '))
}
