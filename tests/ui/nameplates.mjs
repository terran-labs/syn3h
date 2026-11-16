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
  evidence.lifecycle = []; evidence.droppedLifecycle = 0
  const requestIds = new WeakMap(); let nextRequest = 0
  const requestId = request => { if (!requestIds.has(request)) requestIds.set(request, ++nextRequest); return requestIds.get(request) }
  const recordLifecycle = record => {
    if (evidence.lifecycle.length < 4000) evidence.lifecycle.push({ time: Date.now(), ...record })
    else { evidence.droppedLifecycle++; if (evidence.droppedLifecycle === 1) evidence.failures.push('lifecycle evidence bound exceeded') }
  }
  for (const [owner, emitter] of [['page', page], ['context', context]]) {
    for (const event of ['request', 'response', 'requestfinished', 'requestfailed']) emitter.on(event, value => {
      const request = event === 'response' ? value.request() : value
      if (!relevant(request)) return
      recordLifecycle({ owner, event, id: requestId(request), url: request.url(), resource: request.resourceType(),
        status: event === 'response' ? value.status() : null, failure: event === 'requestfailed' ? request.failure() : null })
      // Context events are evidence only. Do not remove a page request without
      // an observed matching terminal event and captured body proof.
    })
  }
  page.on('worker', worker => {
    recordLifecycle({ owner: 'worker', event: 'created', url: worker.url() })
    worker.on('close', () => recordLifecycle({ owner: 'worker', event: 'closed', url: worker.url() }))
  })
  browserEvidence.push(evidence)
  const cdp = await bounded(context.newCDPSession(page), 5000, 'CDP provenance')
  for (const event of ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed', 'Target.attachedToTarget', 'Target.detachedFromTarget']) cdp.on(event, data => {
    recordLifecycle({ owner: 'page-CDP', event, requestId: data.requestId, sessionId: data.sessionId, target: data.targetInfo, url: data.request?.url ?? data.response?.url, type: data.type, errorText: data.errorText })
  })
  // Observe target discovery without changing auto-attach or pausing worker execution.
  cdp.on('Target.targetCreated', data => recordLifecycle({ owner: 'page-CDP', event: 'Target.targetCreated', target: data.targetInfo }))
  cdp.on('Target.targetDestroyed', data => recordLifecycle({ owner: 'page-CDP', event: 'Target.targetDestroyed', targetId: data.targetId }))
  await bounded(cdp.send('Target.setDiscoverTargets', { discover: true }), 5000, 'target discovery')
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
      const entry = { requestId: requestId(response.request()), url: url.href, path, sha256: hash(bytes), resource: response.request().resourceType() }
      // Compare bytes actually delivered to Chrome with the isolated served module,
      // then tie TS input back to checkout. A Node refetch alone is not evidence.
      const expectedResponse = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(remaining(10000)) })
      const comparison = await capturedBody(expectedResponse, 'served comparison', url, () => expectedResponse.arrayBuffer())
      assert.equal(expectedResponse.status, 200)
      assert.equal(hash(comparison), entry.sha256)
      if ((files.includes(path) || path === 'src/ui/planets/planetMapWorker.ts' && url.searchParams.has('worker_file')) && path.endsWith('.ts')) {
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
async function workerBeforePlay(page, name) {
  const evidence = browserEvidence.find(e => e.name === name)
  const workerPath = '/src/ui/planets/planetMapWorker.ts'
  const matches = value => { const u = new URL(value); return u.origin === new URL(origin).origin && u.pathname === workerPath && u.searchParams.has('worker_file') }
  const until = Date.now() + remaining(20000)
  let rows = []
  while (Date.now() < until) {
    remaining(1)
    assert.deepEqual(evidence.failures, [], 'worker provenance observer errors')
    const requests = evidence.lifecycle.filter(e => e.owner === 'page' && e.event === 'request' && matches(e.url))
    rows = requests.map(request => {
      const body = evidence.responses.find(r => r.requestId === request.id && matches(r.url) && r.sourceSha256)
      const terminal = evidence.lifecycle.find(e => e.owner === 'page' && e.id === request.id && ['requestfinished', 'requestfailed'].includes(e.event))
      const raw = evidence.lifecycle.find(e => e.event === 'Network.requestWillBeSent' && e.url === request.url)
      const target = evidence.lifecycle.find(e => e.event === 'Target.targetCreated' && e.target?.targetId === raw?.requestId)
      const destroyed = target && evidence.lifecycle.find(e => e.event === 'Target.targetDestroyed' && e.targetId === target.target.targetId)
      return { request, body: body ?? null, terminal: terminal ?? null, target: target ?? null, destroyed: destroyed ?? null,
        verdict: body && terminal?.event === 'requestfinished' ? 'complete' : destroyed ? 'target destroyed; body or terminal unobserved' : 'pending body and terminal' }
    })
    if (rows.length && rows.every(r => r.verdict === 'complete')) break
    if (rows.some(r => r.terminal?.event === 'requestfailed')) break
    await bounded(new Promise(resolve => setTimeout(resolve, 50)), 1000, 'worker provenance wait')
  }
  report.workerEntry ??= []
  report.workerEntry.push({ name, time: Date.now(), rows, graphics: await page.evaluate(() => window.syn3h.shell.graphics),
    hypothesis: 'Autoplay may terminate the lobby worker early; historical cause not proved.' })
  report.browserResponses = responseReceipt()
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  assert.ok(rows.length && rows.every(r => r.verdict === 'complete'), `${name}: worker body/source-map and terminal required before play: ${rows.map(r => r.verdict).join(', ') || 'no matching request'}`)
}
// Same four slot bounds as the allocator, evaluated against actual curved candidates.
// This is a stage precondition only; real renderer visibility assertions still decide success.
function hudSlots(state, expectedHidden = false) {
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  return state.diagnostic.entries.filter(e => !e.bot).map(entry => {
    const c = entry.plate?.candidate
    assert.ok(c && entry.plate.stamp === state.diagnostic.stamp, 'current human candidate required')
    const slots = [[0, -12], [0, -32], [-c.width / 2 - 12, -12], [c.width / 2 + 12, -12]].map(([dx, dy]) => {
      const x = c.x + dx, y = c.y + dy - c.height
      const bounds = { left: Math.min(x - c.width / 2, c.x) - 3, top: y - 3, right: Math.max(x + c.width / 2, c.x) + 3, bottom: c.y + 3 }
      const hits = state.exclusions.filter(box => overlap(bounds, box))
      return { bounds, hits, clear: !hits.length && bounds.left >= 8 && bounds.top >= 8 && bounds.right <= state.diagnostic.viewport.width - 8 && bounds.bottom <= state.diagnostic.viewport.height - 8 }
    })
    return { id: entry.id, name: entry.name, expectedHidden, slots }
  })
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
  const navigationURL = new URL(origin)
  navigationURL.searchParams.set('room', room); navigationURL.searchParams.set('name', name)
  report.intendedNavigation ??= []; report.intendedNavigation.push({ name, room, url: navigationURL.href })
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await page.goto(navigationURL.href)
  await page.waitForFunction(() => window.syn3h?.shell && document.documentElement.dataset.boot === 'done', null, { timeout: remaining(90000) })
  await page.evaluate(() => {
    const s = window.syn3h
    document.activeElement?.blur?.()
    for (const [id, value] of Object.entries({ 'gfx.auto': false, 'gfx.quality': 4, 'daydream.seconds': 0, 'sun.dayLength': 0 })) {
      if (!s.params.get(id)) throw new Error(`Missing fixture control: ${id}`)
      s.params.set(id, value)
    }
  })
  await workerBeforePlay(page, name)
  await page.waitForFunction(() => window.syn3h.shell.galaxy?.live, null, { timeout: remaining(15000) })
  const beforeEntry = await page.evaluate(async () => {
    const { currentPlanet } = await import('/src/world/planets.ts')
    return { world: currentPlanet().id, seed: window.syn3h.params.get('world.seed').value,
      room: window.syn3h.shell.room, visibleURL: location.href }
  })
  report.lobbyEntry ??= []; report.lobbyEntry.push({ intended: { url: navigationURL.href, room, name }, actual: beforeEntry })
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  const cleanLobbyURL = new URL(navigationURL.href); cleanLobbyURL.search = ''; cleanLobbyURL.hash = ''
  assert.equal(beforeEntry.visibleURL, cleanLobbyURL.href, 'lobby presents a clean visible URL')
  assert.equal(beforeEntry.room, room, 'Shell retains the allocated room')
  const currentLabel = page.locator('.galaxy-label.is-current')
  await currentLabel.waitFor({ state: 'visible', timeout: remaining(15000) })
  assert.equal(await currentLabel.getAttribute('data-world'), beforeEntry.world)
  await currentLabel.focus(); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.syn3hNet?.connected && window.syn3h.shell.playing && !window.syn3h.shell.dropping, null, { timeout: remaining(60000) })
  const afterEntry = await page.evaluate(async () => {
    const { currentPlanet } = await import('/src/world/planets.ts')
    return { world: currentPlanet().id, seed: window.syn3h.params.get('world.seed').value,
      name: window.syn3hNet.players.get(window.syn3hNet.id)?.name, visibleURL: location.href }
  })
  report.nativeEntry ??= []; report.nativeEntry.push({ name, before: beforeEntry, after: afterEntry, method: 'visible current galaxy label, focus and native Enter' })
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  assert.equal(afterEntry.world, beforeEntry.world); assert.equal(afterEntry.seed, beforeEntry.seed)
  const restoredURL = new URL(afterEntry.visibleURL)
  assert.equal(restoredURL.searchParams.get('room'), room, 'play restores allocated room query')
  assert.equal(restoredURL.searchParams.get('name'), name, 'play restores intended name query')
  assert.equal(afterEntry.name, name)
  assert.ok(browserEvidence.find(e => e.name === name).sockets.some(value => { const u = new URL(value); return u.pathname === '/ws' && u.host === new URL(origin).host && u.searchParams.get('room') === room }), 'native entry preserves allocated room')
  await page.waitForFunction(() => window.syn3hNet.players.size >= 1, null, { timeout: remaining(15000) })
  return page
}
// Snapshot existing draw decisions; do not replay queries or alter the query budget.
async function geometryEvidence(page, captureLabel = null) {
  return page.evaluate(async captureLabel => {
    const { copyCurveState, overHorizon } = await import('/src/world/curve.ts')
    const { renderedEnvelope } = await import('/src/ui/nameplates/anchors.ts')
    const { bendPoint, CurvedProjection } = await import('/src/ui/nameplates/curvature.ts')
    const { HudExclusions } = await import('/src/ui/nameplates/HudExclusions.ts')
    // All imports finish before this synchronous snapshot. Do not replay draw or rays.
    const s = window.syn3h, net = window.syn3hNet, tags = net.tags, camera = s.game.camera
    const stamp = tags.stamp
    const v = () => s.player.object.position.clone(), bend = v(), eye = v(), projection = new CurvedProjection()
    copyCurveState(bend); camera.getWorldPosition(eye)
    const diagnostic = { viewport: { width: innerWidth, height: innerHeight }, tick: s.game.tick, stamp: tags.stamp, terrainBudget: tags.terrainBudget, stats: { ...tags.stats },
      seed: s.params.get('world.seed')?.value, terrainKind: s.params.get('terrain.kind')?.value,
      camera: { eye: eye.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, matrix: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray(), cinematic: s.camera.cinematic },
      bend: bend.toArray(), roster: [...net.players].map(([id, info]) => ({ id, name: info.name, bot: id >= 0xff00 })),
      remotes: [...net.remotes].map(([id, r]) => ({ id, position: r.vehicle.object.position.toArray(), visible: r.vehicle.object.visible, responding: r.responding })),
      entries: tags.entries.map(t => {
        const center = v(), anchor = v(), bent = v(), screen = v(), rotation = s.player.object.quaternion.clone()
        const radius = renderedEnvelope(t.vehicle, center, rotation, anchor)
        anchor.copy(center); anchor.y += radius + .65
        bendPoint(anchor, bend, bent); projection.project(anchor, bend, camera, innerWidth, innerHeight, screen)
        const plate = tags.plates.get(t.id)
        return { id: t.id, name: t.name, bot: t.bot, center: center.toArray(), anchor: anchor.toArray(), bentAnchor: bent.toArray(), projectedAnchor: screen.toArray(),
          distance: center.distanceTo(eye), radius, visible: t.vehicle.object.visible, horizon: overHorizon(center.x, center.z, radius, center.y + radius),
          plate: plate ? { stamp: plate.stamp, candidate: { ...plate.candidate }, disc: { ...plate.disc }, sightStamp: plate.sightStamp, sightBlocked: plate.sightBlocked, shown: plate.shown, hidden: plate.el.hidden } : null }
      }), terrain: window.nameplateTerrainEvidence ? { ...window.nameplateTerrainEvidence, rays: [...window.nameplateTerrainEvidence.rays] } : null }
    if (captureLabel === null) return diagnostic
    const shell = window.syn3h.shell, hud = new HudExclusions(shell.element), exclusions = hud.read(innerWidth, innerHeight)
    hud.dispose()
    const labels = [...document.querySelectorAll('.vehicle-nameplate')].filter(el => !el.hidden && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]')).map(el => {
      const b = el.getBoundingClientRect(), style = getComputedStyle(el)
      return { id: el.dataset.vehicle, bot: el.classList.contains('is-bot'), tick: el.classList.contains('is-tick'), text: el.textContent, width: b.width, height: b.height, opacity: Number(style.opacity), left: b.left, right: b.right, top: b.top, bottom: b.bottom }
    })
    const controls = s.params.snapshot('all'), quality = s.game.quality.getQualityState()
    if (controls['gfx.auto'] !== false || controls['gfx.quality'] !== 4 || quality.auto || quality.level !== 4 || controls['daydream.seconds'] !== 0 || controls['sun.dayLength'] !== 0 || s.bots.daydream.active) throw new Error('Fixture control drift')
    const state = { label: captureLabel, stamp, labels, exclusions, controls, quality, nameplateCost: { ...window.syn3hNet.tags.stats }, curve: window.syn3h.params.get('world.curve').value, local: String(window.syn3hNet.id), presentation: shell.presentation, cameraMode: window.syn3h.params.get('camera.mode').value }
    state.diagnostic = diagnostic
    if (!Number.isFinite(stamp) || stamp !== diagnostic.stamp || stamp !== tags.stamp) throw new Error('Capture draw stamp changed during snapshot')
    return state
  }, captureLabel)
}
async function installTerrainEvidence(page) {
  await page.evaluate(() => {
    window.restoreNameplateTerrainEvidence?.()
    const tags = window.syn3hNet.tags, options = tags.options, original = options.terrainHit
    const evidence = window.nameplateTerrainEvidence = { stamp: -1, rays: [], dropped: 0 }
    const wrapped = (from, to) => {
      if (evidence.stamp !== tags.stamp) { evidence.stamp = tags.stamp; evidence.rays = []; evidence.dropped = 0 }
      const result = original(from, to)
      if (evidence.rays.length < 512) evidence.rays.push({ from: { ...from }, to: { ...to }, blocked: result })
      else evidence.dropped++
      return result
    }
    options.terrainHit = wrapped
    window.restoreNameplateTerrainEvidence = () => {
      if (options.terrainHit !== wrapped) throw new Error('terrain observer replaced externally')
      options.terrainHit = original
      delete window.restoreNameplateTerrainEvidence
    }
  })
}
async function capture(page, label) {
  remaining(1)
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  await page.waitForTimeout(500)
  const state = await geometryEvidence(page, label)
  captures.push(state)
  await writeFile(`${out}/measurements.json`, JSON.stringify(captures, null, 2))
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  assert.equal(state.stamp, state.diagnostic.stamp, 'capture and diagnostic share a draw stamp')
  assert.ok(state.labels.every(l => l.id !== state.local), 'never label the local player')
  for (let i = 0; i < state.labels.length; i++) {
    const a = state.labels[i]
    assert.ok(state.labels.slice(i + 1).every(b => !overlap(a, b)), `${label}: labels overlap`)
    assert.ok(state.exclusions.every(b => !overlap(a, b)), `${label}: label covers HUD`)
  }
  // Screenshot pixels are captured later than the synchronous measurement above.
  await page.screenshot({ path: `${out}/${label}.png` })
  await writeFile(`${out}/measurements.json`, JSON.stringify(captures, null, 2))
  return state
}
// Existing draw stamp identifies completed label draws, not duplicate rAF observations.
// Test-only access avoids adding a runtime diagnostics API. Reading DOM here has a cost;
// report label drawMs only, never claim this is total frame/GPU cost.
async function costDistribution(page, label) {
  await page.evaluate(() => window.restoreNameplateTerrainEvidence?.())
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
  await installTerrainEvidence(a)
  let center = await a.evaluate(() => { const s = window.syn3h, p = s.terrain.spawnPoint(0).position; return { x: p.x, y: p.y, z: p.z } })
  async function stage(far = false, curve = .71, hudOverlap = false) {
    await installTerrainEvidence(a)
    await a.evaluate(curve => window.syn3h.params.set('world.curve', curve), curve)
    await a.evaluate(p => {
      const s = window.syn3h, v = s.player.object.position.clone().set(p.x, s.terrain.heightAt(p.x, p.z + 18) + 2, p.z + 18)
      s.player.teleport(v, 0)
      s.bots.vehicles.forEach((bot, i) => { const x = p.x + (i - 1.5) * 12, z = p.z - 8 - i * 6; bot.teleport(v.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) })
      s.camera.setCinematicPose(v.clone().set(p.x, s.terrain.heightAt(p.x, p.z + 45) + 20, p.z + 45), v.clone().set(p.x, p.y + 4, p.z - 12), 60)
    }, center)
    await b.evaluate(({p, far, hudOverlap}) => { const s = window.syn3h, z = p.z - (far ? 260 : 4), x = p.x - (far || hudOverlap ? 24 : 8); s.player.teleport(s.player.object.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) }, { p: center, far, hudOverlap })
    await c.evaluate(({p, far, hudOverlap}) => { const s = window.syn3h, z = p.z - (far ? 190 : hudOverlap ? 12 : 4), x = p.x + (far || hudOverlap ? 24 : 8); s.player.teleport(s.player.object.position.clone().set(x, s.terrain.heightAt(x, z) + 2, z), 0) }, { p: center, far, hudOverlap })
    // Record diagnostics even when settling fails. Never move the camera to skip occlusion.
    let stagingError
    try {
      await a.waitForFunction(far => {
        const s = window.syn3h, net = window.syn3hNet, camera = s.game.camera, tags = net.tags
        const eye = camera.position.toArray(), actors = tags.entries.map(t => [t.id, ...t.vehicle.object.position.toArray()])
        const previous = window.nameplateSettle
        const current = { eye, actors, stamp: tags.stamp, count: 0 }
        const stable = previous && previous.stamp !== current.stamp && actors.length === previous.actors.length &&
          Math.hypot(...eye.map((n, i) => n - previous.eye[i])) < .25 &&
          actors.every((row, i) => row[0] === previous.actors[i][0] && Math.hypot(...row.slice(1).map((n, j) => n - previous.actors[i][j + 1])) < .25)
        current.count = stable ? previous.count + 1 : 0; window.nameplateSettle = current
        const people = tags.entries.filter(t => !t.bot)
        const roster = ['Visitor', 'Companion'].every(name => people.some(t => t.name === name))
        const nearRange = far || (people.every(t => t.vehicle.object.position.distanceTo(camera.position) < 140) &&
          tags.entries.filter(t => t.bot).length >= 4 && tags.entries.filter(t => t.bot).every(t => t.vehicle.object.position.distanceTo(camera.position) < 95))
        const pose = s.camera.cinematic
        return roster && nearRange && pose && camera.position.distanceTo(pose.position) < .5 && Math.abs(camera.fov - pose.fov) < .5 && current.count >= 6
      }, far, { timeout: remaining(15000), polling: 100 })
    } catch (error) { stagingError = error }
    try {
      report.stages ??= []
      report.stages.push({ far, curve, observer: await geometryEvidence(a), actors: await Promise.all([b, c].map(page => page.evaluate(() => ({ id: window.syn3hNet.id, seed: window.syn3h.params.get('world.seed')?.value, terrainKind: window.syn3h.params.get('terrain.kind')?.value, position: window.syn3h.player.object.position.toArray() })))) })
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
    }
    catch (error) {
      report.stageEvidenceErrors ??= []; report.stageEvidenceErrors.push(String(error))
      if (!stagingError) stagingError = error
    }
    if (stagingError) throw stagingError
    const stage = report.stages.at(-1)
    assert.ok(stage.actors.every(actor => actor.seed === stage.observer.seed && actor.terrainKind === stage.observer.terrainKind), 'clients share staged world')
  }
  await stage()
  const near = await capture(a, 'desktop-near-day')
  const positiveSlots = hudSlots(near)
  report.placementPreconditions = [{ label: 'near-positive', entries: positiveSlots }]
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  assert.equal(positiveSlots.length, 2, 'two staged humans required')
  assert.ok(positiveSlots.every(e => e.slots.some(s => s.clear)), 'each human has an actual curved viewport/HUD-clear slot')
  for (const name of ['Visitor', 'Companion']) assert.ok(near.labels.some(l => !l.bot && l.text.includes(name)), `${name}: both remote human names are visible`)
  const person = near.labels.find(l => !l.bot), bot = near.labels.find(l => l.bot && !l.tick)
  assert.ok(person && bot, 'human and full bot labels must be present for comparison')
  assert.ok(bot.width / person.width >= .60 && bot.width / person.width <= .70, 'bot labels are 60 to 70 percent of human size')
  assert.ok(bot.height / person.height >= .60 && bot.height / person.height <= .70, 'bot label height is smaller too')
  assert.ok(bot.opacity < person.opacity, 'bot labels are fainter than human labels')
  assert.ok(near.labels.filter(l => l.bot && l.text.includes('BOT')).length >= 2, 'host-owned bots have smaller labels')
  await costDistribution(a, 'near-all-cost')
  // Retain the original overlap geometry as an explicit negative case, without hiding HUD.
  await stage(false, .71, true)
  const hidden = await capture(a, 'expected-hidden-hud-overlap')
  const hiddenSlots = hudSlots(hidden, true)
  report.placementPreconditions.push({ label: 'expected-hidden-hud-overlap', entries: hiddenSlots })
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  assert.equal(hiddenSlots.length, 2)
  assert.ok(hiddenSlots.every(e => e.slots.every(s => s.hits.length > 0)), 'all human slots intersect visible HUD in negative stage')
  assert.ok(hiddenSlots.every(e => !hidden.labels.some(l => l.id === e.id)), 'HUD-overlapped humans must remain hidden')
  await stage()
  const restored = await capture(a, 'near-positive-restored')
  for (const name of ['Visitor', 'Companion']) assert.ok(restored.labels.some(l => !l.bot && l.text.includes(name)), 'positive human visibility restored')
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
  for (const context of contexts) for (const page of context.pages()) {
    try { await bounded(page.evaluate(() => window.restoreNameplateTerrainEvidence?.()), 3000, 'restore terrain observer') }
    catch (error) { report.cleanupErrors.push(String(error)) }
  }
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
