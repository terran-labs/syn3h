// Three clients, one Chrome browser. Source proposal only; requires allocated execution.
// Requires a separately allocated supervisor, dedicated room server and clean Vite tree.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const observationOnly = process.argv.includes('--observe-staging')
const surveyOnly = process.argv.includes('--survey-terrain')
const poseOnly = process.argv.includes('--observe-fixed-pose')
const viewsOnly = process.argv.includes('--observe-views')
const fixedPose = Object.freeze({ x: 32, z: 0, initialY: 15.622831573066174 })
assert.ok(process.argv.slice(2).every(arg => ['--observe-staging', '--survey-terrain', '--observe-fixed-pose', '--observe-views'].includes(arg)) && [observationOnly, surveyOnly, poseOnly, viewsOnly].filter(Boolean).length <= 1, 'unsupported fixture mode')
// Fixed before execution: one left-side region, no adaptive selection or early winner.
const observationPositions = Object.freeze([[-22, -42], [-22, -34], [-14, -42], [-14, -34]].map(([x, z]) => Object.freeze({ x, z })))

// Exact fixed grid, ordered z then x, independent of queried heights or visibility.
const surveySamples = Object.freeze([-40, -32, -24, -16, -8, 0].flatMap(z => [-32, -24, -16, -8, 0, 8, 16, 24, 32].map(x => Object.freeze({ x, z }))))
const surveyReference = {"seed":1,"terrainKind":0,"curve":0.71,"center":{"x":13.229718186648464,"z":-564.5650121613116},"camera":{"eye":[13.230027456509344,32.92388950050769,-519.6425462541262],"quaternion":[-0.12533730388111655,2.6983623441422033e-06,3.4089368492666596e-07,0.9921141871016739],"fov":60.02859087332993,"matrix":[0.9999999999852053,-1.0587911840678754e-22,-5.439620517886433e-06,0,-1.3528218444364532e-06,0.9685811205113929,-0.2486978347052191,0,5.2687137363712045e-06,0.24869783470889856,0.968581120497063,0,13.230027456509344,32.92388950050769,-519.6425462541262,1],"projection":[1.0819082680633991,0,0,0,0,1.7310532289014386,0,0,0,0,-1.0000250006250155,-1,0,0,-0.5000125003125078,0],"cinematic":{"position":{"x":13.229718186648464,"y":32.948007234552264,"z":-519.5650121613116},"target":{"x":13.229718186648464,"y":20,"z":-576.5650121613116},"look":{"x":13.229718186648464,"y":20,"z":-576.5650121613116},"fov":60}},"bend":[13.230027456509344,-519.6425462541262,0.0012289474942801918],"viewport":{"width":1440,"height":900},"receipt":"nameplates-current-browser-007 snapshot727"}

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
const report = { mode: viewsOnly ? 'view-observation-only' : poseOnly ? 'fixed-pose-observation-only' : surveyOnly ? 'terrain-survey-only' : observationOnly ? 'staging-observation-only' : 'acceptance', acceptanceEligible: !observationOnly && !surveyOnly && !poseOnly && !viewsOnly, source: expected, launch, captures: [], errors: [], scope: 'Three fresh contexts: observer host, two remote people, four bots; Chrome only. No maximum-roster or hardware claim.' }
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
// Screen-space opportunity only. Read the captured decisions; never rerun allocation or rays.
function twoBotSlots(state) {
  const d = state.diagnostic, ids = ['65280', '65283']
  const finite = (object, keys) => assert.ok(object && keys.every(k => Number.isFinite(object[k])), 'complete finite geometry required')
  finite(d, ['stamp']); finite(d.viewport, ['width', 'height'])
  assert.equal(state.stamp, d.stamp, 'same snapshot required')
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  const slots = c => [[0, -12], [0, -32], [-c.width / 2 - 12, -12], [c.width / 2 + 12, -12]].map(([dx, dy], spot) => {
    const x = c.x + dx, y = c.y + dy - c.height
    return { spot, plate: { left: x - c.width / 2, top: y, right: x + c.width / 2, bottom: y + c.height },
      bounds: { left: Math.min(x - c.width / 2, c.x) - 3, top: y - 3, right: Math.max(x + c.width / 2, c.x) + 3, bottom: c.y + 3 } }
  })
  for (const box of state.exclusions) finite(box, ['left', 'top', 'right', 'bottom'])
  assert.ok(Array.isArray(d.entries) && d.entries.length >= 6, 'complete staged roster required')
  for (const e of d.entries) {
    assert.equal(e.plate?.stamp, d.stamp, 'current entry required')
    finite(e.plate.candidate, ['x', 'y', 'depth', 'width', 'height', 'opacity'])
    finite(e.plate.disc, ['x', 'y', 'radius', 'depth'])
    assert.ok(e.plate.disc.radius > 0, 'valid vehicle disc required')
  }
  // Product does not stamp localDisc. Include its copied value conservatively, not as
  // proof that it was refreshed or participated in this draw. Missing geometry fails.
  finite(d.localDisc, ['x', 'y', 'radius', 'depth'])
  assert.equal(d.localDisc.id, '@local')
  assert.ok(d.localDisc.radius > 0, 'local disc must contain an observed envelope')
  const placed = d.entries.filter(e => e.plate.shown).map(e => {
    const c = e.plate.candidate, dom = state.labels.find(l => l.id === e.id)
    assert.ok(!e.plate.hidden && dom, 'shown plate requires captured DOM')
    assert.ok(Number.isInteger(c.previous) && c.previous >= 0 && c.previous <= 3, 'placed slot must be an integer from zero to three')
    const slot = slots(c)[c.previous]
    finite(dom, ['left', 'top', 'right', 'bottom', 'width', 'height'])
    for (const key of ['left', 'top', 'right', 'bottom']) assert.ok(Math.abs(dom[key] - slot.plate[key]) < .1, 'DOM matches reserved plate position')
    assert.ok(Math.abs(dom.width - c.width) < .1 && Math.abs(dom.height - c.height) < .1, 'DOM matches candidate size')
    return { id: e.id, bot: e.bot, bounds: slot.bounds }
  })
  const humans = d.entries.filter(e => !e.bot)
  assert.equal(humans.length, 2, 'two humans required')
  assert.ok(humans.every(e => e.plate.shown && placed.some(p => p.id === e.id)), 'humans retain priority and shown bounds')
  const discs = [...d.entries.map(e => e.plate.disc), d.localDisc]
  const rows = ids.map(id => {
    const e = d.entries.find(e => e.id === id), c = e?.plate.candidate
    assert.ok(e?.bot && e.visible && !e.horizon && c && !c.tick && c.opacity > 0 && c.depth > 0, 'full bot candidate required')
    assert.ok(Number.isFinite(e.distance) && e.distance >= 0 && e.distance <= 100, 'bot remains in full-label range')
    return { id, slots: slots(c).map(slot => {
      const b = slot.bounds
      const hud = state.exclusions.filter(h => overlap(b, h))
      // Both target placements are replaced by the proposed pair; other placed bots stay.
      const occupied = placed.filter(p => !ids.includes(p.id) && overlap(b, p.bounds)).map(p => p.id)
      const nearer = discs.filter(v => v.id !== id && v.depth < c.depth && Math.hypot(
        Math.max(b.left, Math.min(b.right, v.x)) - v.x,
        Math.max(b.top, Math.min(b.bottom, v.y)) - v.y) < v.radius + 3).map(v => v.id)
      const viewport = b.left >= 8 && b.top >= 8 && b.right <= d.viewport.width - 8 && b.bottom <= d.viewport.height - 8
      return { ...slot, hud, occupied, nearer, viewport, clear: viewport && !hud.length && !occupied.length && !nearer.length }
    }) }
  })
  const pairs = rows[0].slots.flatMap(a => rows[1].slots.filter(b => a.clear && b.clear && !overlap(a.bounds, b.bounds)).map(b => [a.spot, b.spot]))
  return { stamp: d.stamp, localDisc: d.localDisc, localDiscParticipation: 'unknown; copied envelope included conservatively', placed, rows, pairs }
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
// Observation-only instance wrappers. Never invoke a product draw/projection ourselves.
async function installViewObserver(page) {
  await page.evaluate(() => {
    const s = window.syn3h, tags = window.syn3hNet.tags, projection = tags.projection
    if (window.nameplateViewObserver) throw new Error('view observer already installed')
    const state = { latest: null, errors: [], droppedErrors: 0, overflow: false, restored: false }
    let active = null
    const installed = []
    const fault = error => { if (state.errors.length < 8) state.errors.push(String(error)); else state.droppedErrors++ }
    const copyCamera = camera => ({ uuid: camera.uuid, active: camera === s.game.camera,
      eye: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov,
      near: camera.near, far: camera.far, matrix: camera.matrixWorld.toArray(),
      inverse: camera.matrixWorldInverse.toArray(), projection: camera.projectionMatrix.toArray() })
    const install = (object, key, factory) => {
      const own = Object.getOwnPropertyDescriptor(object, key), original = object[key]
      if (typeof original !== 'function' || own && (!own.configurable || !('value' in own))) throw new Error(`unsupported descriptor ${key}`)
      const wrapper = factory(original)
      const descriptor = own ? { ...own, value: wrapper } : { value: wrapper, configurable: true, writable: true, enumerable: false }
      Object.defineProperty(object, key, descriptor); installed.push({ object, key, own, descriptor })
    }
    const restore = () => {
      if (state.restored) return
      state.restored = true
      for (const item of [...installed].reverse()) {
        try {
          const now = Object.getOwnPropertyDescriptor(item.object, item.key)
          if (!now || now.value !== item.descriptor.value || now.configurable !== item.descriptor.configurable || now.writable !== item.descriptor.writable || now.enumerable !== item.descriptor.enumerable) {
            fault(`foreign descriptor replacement: ${item.key}`); continue
          }
          if (item.own) Object.defineProperty(item.object, item.key, item.own)
          else delete item.object[item.key]
        } catch (error) { fault(error) }
      }
    }
    window.nameplateViewObserver = { state, restore, sample() {
      const camera = s.game.camera, net = window.syn3hNet
      const latest = state.latest ? structuredClone(state.latest) : null
      const labels = [...tags.root.querySelectorAll('.vehicle-nameplate')].filter(el => !el.hidden && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]')).map(el => {
        const b = el.getBoundingClientRect()
        return { id: el.dataset.vehicle, bot: el.classList.contains('is-bot'), tick: el.classList.contains('is-tick'), text: el.textContent,
          left: b.left, top: b.top, right: b.right, bottom: b.bottom }
      })
      return { stamp: tags.stamp, wall: performance.now(), tick: s.game.tick, camera: copyCamera(camera),
        observer: String(net.id), host: net.game.host, isHost: net.isHost, viewport: { width: innerWidth, height: innerHeight },
        mode: s.params.get('camera.mode').value, distance: s.params.get('camera.distance').value,
        cinematic: !!s.camera.cinematic, presentation: s.shell.presentation,
        controls: Object.fromEntries(['gfx.auto', 'gfx.quality', 'daydream.seconds', 'sun.dayLength', 'sun.timeOfDay', 'world.seed', 'terrain.kind', 'world.curve'].map(id => [id, s.params.get(id)?.value])),
        quality: s.game.quality.getQualityState(), daydream: s.bots.daydream.active,
        pivot: s.camera.pivot.toArray(), desiredAfterLift: s.camera.desired.toArray(), final: camera.position.toArray(), arm: s.camera.arm, lift: s.camera.lift,
        latest, errors: [...state.errors], droppedErrors: state.droppedErrors, overflow: state.overflow,
        exclusions: tags.hud.read(innerWidth, innerHeight).map(b => ({ ...b })), labels,
        actors: [{ id: String(net.id), vehicle: s.player }, ...tags.entries].map(t => ({ id: t.id, kind: t.vehicle.kind,
          body: { ...t.vehicle.body.translation() }, rendered: t.vehicle.object.position.toArray(),
          quaternion: t.vehicle.object.quaternion.toArray(), visible: t.vehicle.object.visible })),
        candidates: tags.entries.map(t => { const p = tags.plates.get(t.id); return { id: t.id, bot: t.bot, name: t.name,
          plate: p ? { stamp: p.stamp, candidate: { ...p.candidate }, shown: p.shown, sightStamp: p.sightStamp, sightBlocked: p.sightBlocked } : null } }),
        budget: tags.terrainBudget, stats: { ...tags.stats } }
    } }
    try {
      install(projection, 'envelope', original => function(...args) {
        let result
        try { result = Reflect.apply(original, this, args) }
        catch (error) { if (active) active.envelopeThrew = true; throw error }
        try {
          if (!active || this !== projection) throw new Error('envelope outside owned draw')
          if (active.envelopes.length >= 7) { state.overflow = true; throw new Error('envelope cap exceeded') }
          const [center, radius, bend, camera, width, height, output] = args
          const id = output === tags.localDisc ? '@local' : [...tags.plates].find(([, p]) => p.disc === output)?.[0]
          if (id === undefined) throw new Error('unknown envelope output identity')
          if (active.envelopes.some(e => e.id === id)) throw new Error('duplicate envelope identity')
          active.envelopes.push({ id, outputIdentityMatched: true, stamp: tags.stamp,
            center: center.toArray(), radius, bend: bend.toArray(), camera: copyCamera(camera), width, height, disc: { ...output } })
        } catch (error) { fault(error) }
        return result
      })
      install(tags, 'draw', original => function(...args) {
        const parent = active, row = { stamp: null, completed: false, threw: false, envelopeThrew: false, local: 'unknown', envelopes: [] }
        if (parent) fault('reentrant draw')
        active = row
        try {
          const result = Reflect.apply(original, this, args)
          try {
            row.stamp = tags.stamp; row.completed = this === tags && !row.envelopeThrew
            row.local = row.envelopes.some(e => e.id === '@local') ? 'participated' : 'skipped'
            row.camera = copyCamera(s.game.camera); row.bend = tags.bend.toArray()
            row.mode = s.params.get('camera.mode').value; row.distance = s.params.get('camera.distance').value
            row.cinematic = !!s.camera.cinematic; row.viewport = [innerWidth, innerHeight]
            if (row.envelopes.some(e => e.stamp !== row.stamp)) { row.completed = false; fault('draw stamp mismatch') }
          } catch (error) { row.completed = false; fault(error) }
          return result
        } catch (error) { row.threw = true; throw error }
        finally { state.latest = row; active = parent }
      })
      install(tags, 'dispose', original => function(...args) { restore(); return Reflect.apply(original, this, args) })
    } catch (error) { fault(error); restore(); throw error }
  })
}

async function geometryEvidence(page, captureLabel = null, installPose = false) {
  return page.evaluate(async ({ captureLabel, installPose }) => {
    const { copyCurveState, overHorizon } = await import('/src/world/curve.ts')
    const { renderedEnvelope } = await import('/src/ui/nameplates/anchors.ts')
    const { bendPoint, CurvedProjection } = await import('/src/ui/nameplates/curvature.ts')
    const { HudExclusions } = await import('/src/ui/nameplates/HudExclusions.ts')
    const read = captureLabel => {
    // All imports finish before this synchronous snapshot. Do not replay draw or rays.
    const s = window.syn3h, net = window.syn3hNet, tags = net.tags, camera = s.game.camera
    const stamp = tags.stamp
    const v = () => s.player.object.position.clone(), bend = v(), eye = v(), projection = new CurvedProjection()
    copyCurveState(bend); camera.getWorldPosition(eye)
    const diagnostic = { viewport: { width: innerWidth, height: innerHeight }, tick: s.game.tick, stamp: tags.stamp, terrainBudget: tags.terrainBudget, stats: { ...tags.stats },
      seed: s.params.get('world.seed')?.value, terrainKind: s.params.get('terrain.kind')?.value,
      camera: { eye: eye.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, matrix: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray(), cinematic: s.camera.cinematic },
      localDisc: tags.localDisc ? { ...tags.localDisc } : null,
      bend: bend.toArray(), roster: [...net.players].map(([id, info]) => ({ id, name: info.name, bot: id >= 0xff00 })),
      remotes: [...net.remotes].map(([id, r]) => ({ id, position: r.vehicle.object.position.toArray(), visible: r.vehicle.object.visible, responding: r.responding })),
      entries: tags.entries.map(t => {
        const center = v(), anchor = v(), bent = v(), screen = v(), rotation = s.player.object.quaternion.clone()
        const radius = renderedEnvelope(t.vehicle, center, rotation, anchor)
        anchor.copy(center); anchor.y += radius + .65
        bendPoint(anchor, bend, bent); projection.project(anchor, bend, camera, innerWidth, innerHeight, screen)
        const plate = tags.plates.get(t.id)
        return { id: t.id, name: t.name, bot: t.bot, center: center.toArray(), anchor: anchor.toArray(), bentAnchor: bent.toArray(), projectedAnchor: screen.toArray(),
          bodyPosition: { ...t.vehicle.body.translation() }, bodyRotation: { ...t.vehicle.body.rotation() },
          bodyVelocity: { ...t.vehicle.body.linvel() }, renderedRotation: t.vehicle.object.getWorldQuaternion(rotation).toArray(),
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
    if (captureLabel === 'fixed-pose-history') {
      const localCenter = v(), localAnchor = v(), rotation = s.player.object.quaternion.clone()
      const localRadius = renderedEnvelope(s.player, localCenter, rotation, localAnchor)
      state.localPose = { body: { ...s.player.body.translation() }, orientation: { ...s.player.body.rotation() },
        velocity: { ...s.player.body.linvel() }, center: localCenter.toArray(), radius: localRadius,
        renderedOrientation: s.player.object.getWorldQuaternion(rotation).toArray() }
      const slotBounds = c => [[0, -12], [0, -32], [-c.width / 2 - 12, -12], [c.width / 2 + 12, -12]].map(([dx, dy], spot) => {
        const x = c.x + dx, y = c.y + dy - c.height
        return { spot, left: Math.min(x - c.width / 2, c.x) - 3, top: y - 3,
          right: Math.max(x + c.width / 2, c.x) + 3, bottom: c.y + 3 }
      })
      const gap = (a, b) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom)
      const discGap = (b, d) => Math.hypot(Math.max(b.left, Math.min(b.right, d.x)) - d.x,
        Math.max(b.top, Math.min(b.bottom, d.y)) - d.y) - d.radius - 3
      // Existing shown slots only; never select or allocate a replacement slot.
      const placed = diagnostic.entries.filter(e => e.plate?.shown).map(e => {
        const c = e.plate.candidate, dom = labels.find(l => l.id === e.id)
        const current = e.plate.stamp === stamp && !e.plate.hidden && dom && Number.isInteger(c.previous) && c.previous >= 0 && c.previous <= 3
        const bounds = current ? slotBounds(c)[c.previous] : null
        const [dx, dy] = current ? [[0, -12], [0, -32], [-c.width / 2 - 12, -12], [c.width / 2 + 12, -12]][c.previous] : [0, 0]
        const expected = { left: c.x + dx - c.width / 2, right: c.x + dx + c.width / 2, top: c.y + dy - c.height, bottom: c.y + dy }
        const valid = current && ['left', 'right', 'top', 'bottom'].every(k => Number.isFinite(dom[k]) && Math.abs(dom[k] - expected[k]) < .1) &&
          Math.abs(dom.width - c.width) < .1 && Math.abs(dom.height - c.height) < .1
        return { id: e.id, bot: e.bot, valid: Boolean(valid), dom, bounds }
      })
      const discs = [...diagnostic.entries.map(e => e.plate?.disc), diagnostic.localDisc]
      state.poseGeometry = { placed, humanReservations: diagnostic.entries.filter(e => !e.bot).map(e =>
          placed.find(p => p.id === e.id) ?? { id: e.id, valid: false, reason: 'not shown' }),
        localDiscFreshness: 'unstamped conservative copy; no participation claim',
        margins: diagnostic.entries.map(e => {
          const c = e.plate?.candidate
          if (!c) return { id: e.id, valid: false, reason: 'candidate missing' }
          return { id: e.id, stamp: e.plate.stamp, slots: slotBounds(c).map(bounds => ({ bounds,
            viewport: Math.min(bounds.left - 8, innerWidth - 8 - bounds.right, bounds.top - 8, innerHeight - 8 - bounds.bottom),
            hud: exclusions.map(b => gap(bounds, b)),
            placed: placed.filter(p => p.id !== e.id).map(p => ({ id: p.id, gap: p.bounds ? gap(bounds, p.bounds) : null, valid: p.valid })),
            nearer: discs.filter(d => d && d.id !== e.id && d.depth < c.depth).map(d => ({ id: d.id, gap: discGap(bounds, d) })) })) }
        }) }
    }
    if (!Number.isFinite(stamp) || stamp !== diagnostic.stamp || stamp !== tags.stamp) throw new Error('Capture draw stamp changed during snapshot')
    return state
    }
    if (installPose) { window.nameplatePoseSnapshot = () => read('fixed-pose-history'); return null }
    return read(captureLabel)
  }, { captureLabel, installPose })
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
  let settlingSequence = 0
  async function waitSettled(page, far, stageID, intended = null, view = null) {
    const record = !observationOnly && !surveyOnly && !poseOnly
    const receipt = { stageID, far, intended, primaryError: null, records: null, complete: false }
    let primary
    try {
      await page.waitForFunction(({ far, stageID, record, intended, view }) => {
        // New receipt per wait, but never reset the persistent settling counter.
        const history = record ? (window.nameplateAcceptanceSettle?.stageID === stageID
          ? window.nameplateAcceptanceSettle
          : (window.nameplateAcceptanceSettle = { stageID, records: [], overflow: false, previouslyArrived: false, postArrivalCount: 0 })) : null
        if (history && history.records.length >= 180) { history.overflow = true; throw new Error('acceptance settling receipt bound exceeded') }
        const evaluated = {}
        // Only reached operands are recorded; &&, || and every keep their short circuit.
        const seen = (key, value) => { if (record) evaluated[key] = value; return value }
        const s = window.syn3h, net = window.syn3hNet, camera = s.game.camera, tags = net.tags
        const eye = camera.position.toArray(), actors = tags.entries.map(t => [t.id, ...t.vehicle.object.position.toArray()])
        const previous = window.nameplateSettle
        const current = { eye, actors, stamp: tags.stamp, count: 0 }
        const stable = previous && seen('stampChanged', previous.stamp !== current.stamp) && seen('actorCountEqual', actors.length === previous.actors.length) &&
          seen('cameraStable', Math.hypot(...eye.map((n, i) => n - previous.eye[i])) < .25) &&
          actors.every((row, i) => seen(`actor${i}Identity`, row[0] === previous.actors[i][0]) && seen(`actor${i}Stable`, Math.hypot(...row.slice(1).map((n, j) => n - previous.actors[i][j + 1])) < .25))
        current.count = stable ? previous.count + 1 : 0; window.nameplateSettle = current
        const people = tags.entries.filter(t => !t.bot)
        const roster = (view ? view.names : ['Visitor', 'Companion']).every(name => seen(`roster${name}`, people.some(t => t.name === name)))
        const nearRange = far || (people.every(t => seen(`humanRange${t.id}`, t.vehicle.object.position.distanceTo(camera.position) < 140)) &&
          seen('fourBots', tags.entries.filter(t => t.bot).length >= 4) && tags.entries.filter(t => t.bot).every(t => seen(`botRange${t.id}`, t.vehicle.object.position.distanceTo(camera.position) < 95)))
        if (window.nameplateObservationHistory) {
          const bot = s.bots.vehicles[0]
          if (window.nameplateObservationHistory.length >= 180) throw new Error('observation history bound exceeded')
          window.nameplateObservationHistory.push({ time: performance.now(), tick: s.game.tick, ...current,
            body: { ...bot.body.translation() }, rotation: { ...bot.body.rotation() }, velocity: { ...bot.body.linvel() },
            rendered: bot.object.position.toArray(), fov: camera.fov, roster, nearRange })
        }
        if (window.nameplatePoseHistory) {
          if (window.nameplatePoseHistory.length >= 180) throw new Error('fixed pose history bound exceeded')
          const snapshot = window.nameplatePoseSnapshot()
          if (snapshot.stamp !== current.stamp) throw new Error('settling and geometry stamps differ')
          window.nameplatePoseHistory.push({ time: performance.now(), ...current, roster, nearRange, snapshot })
        }
        const pose = s.camera.cinematic
        const originalResult = seen('roster', roster) && seen('nearRange', nearRange) && seen('posePresent', pose ? true : pose) &&
          seen('cameraAtTarget', camera.position.distanceTo(pose.position) < .5) && seen('fovAtTarget', Math.abs(camera.fov - pose.fov) < .5) && seen('sixCount', current.count >= 6)
        let arrival = null, result = originalResult
        if (history) {
          // Conservative fixed-scene arrival requirement, not a transport error bound.
          // Float32 targets reflect the wire; interpolation must actually reach this region.
          const targets = intended.map(target => {
            const remote = net.remotes.get(Number(target.id))
            const vehicle = target.id === String(net.id) ? s.player : tags.entries.find(t => t.id === target.id)?.vehicle
            const position = vehicle?.object.position
            const rendered = position ? position.toArray() : null
            const geometryValid = Number.isFinite(target.x) && Number.isFinite(target.z) &&
              Array.isArray(rendered) && rendered.length === 3 && rendered.every(Number.isFinite)
            const dx = position ? position.x - Math.fround(target.x) : null
            const dz = position ? position.z - Math.fround(target.z) : null
            const error = position ? Math.hypot(dx, dz) : null
            return { id: target.id, x: target.x, z: target.z, rendered, geometryValid,
              dx, dz, error, arrived: geometryValid && Number.isFinite(error) && error < .25,
              remoteAvailable: !!remote }
          })
          const arrived = targets.length === 7 && new Set(targets.map(t => t.id)).size === 7 && targets.every(t => t.arrived)
          const countIn = history.postArrivalCount
          history.postArrivalCount = arrived && history.previouslyArrived && stable ? countIn + 1 : 0
          history.previouslyArrived = arrived
          arrival = { targets, arrived, counterIn: countIn, counterOut: history.postArrivalCount }
          result = originalResult && seen('postArrivalSix', history.postArrivalCount >= 6)
          const row = { stageID, wall: performance.now(), tick: s.game.tick, time: s.game.time,
            frames: s.game.frames, paused: s.game.isPaused,
            previous: previous ? { stamp: previous.stamp, eye: [...previous.eye], actors: previous.actors.map(v => [...v]), count: previous.count } : null,
            current: { ...current, eye: [...eye], actors: actors.map(v => [...v]) },
            counterIn: previous ? previous.count : null, counterOut: current.count,
            stable: stable === undefined ? null : stable, evaluated, originalResult: !!originalResult, arrival, result: !!result,
            // Read-only arithmetic, not additional predicate evaluations or queries.
            cameraDelta: previous ? Math.hypot(...eye.map((n, i) => n - previous.eye[i])) : null,
            actorDeltas: actors.map((v, i) => previous?.actors[i]?.[0] === v[0]
              ? Math.hypot(...v.slice(1).map((n, j) => n - previous.actors[i][j + 1])) : null),
            pose: pose ? { position: pose.position.toArray(), fov: pose.fov } : null,
            cameraTargetDistance: pose ? camera.position.distanceTo(pose.position) : null,
            fovError: pose ? Math.abs(camera.fov - pose.fov) : null,
            lifecycle: [] }
          history.records.push(row) // Preserve raw geometry before validation or lifecycle copying fails.
          if (view) {
            row.observation = window.nameplateViewObserver.sample()
            const o = row.observation, cameraValues = [...o.camera.eye, ...o.camera.quaternion, o.camera.fov, o.camera.near, o.camera.far,
              ...o.camera.matrix, ...o.camera.inverse, ...o.camera.projection, ...o.pivot, ...o.desiredAfterLift, ...o.final, o.arm, o.lift]
            const expectedControls = { 'gfx.auto': false, 'gfx.quality': 4, 'daydream.seconds': 0, 'sun.dayLength': 0,
              'sun.timeOfDay': 12, 'world.seed': 1, 'terrain.kind': 0, 'world.curve': .71 }
            const controlsOK = Object.entries(expectedControls).every(([key, value]) => o.controls[key] === value) && !o.quality.auto && o.quality.level === 4 && !o.daydream
            const ready = cameraValues.every(Number.isFinite) && o.camera.active && o.mode === 0 && !o.cinematic && o.distance === 25 && !o.presentation &&
              o.viewport.width === view.width && o.viewport.height === view.height && o.isHost === view.host && controlsOK
            const matched = o.latest?.completed && !o.latest.threw && o.latest.stamp === current.stamp && o.latest.camera.uuid === o.camera.uuid &&
              o.latest.camera.matrix.every((v, i) => v === o.camera.matrix[i]) && o.latest.camera.projection.every((v, i) => v === o.camera.projection[i]) &&
              o.latest.mode === 0 && o.latest.distance === 25 && !o.latest.cinematic && o.latest.viewport[0] === view.width && o.latest.viewport[1] === view.height
            const previousMatched = history.viewMatched === true
            history.viewComparisons = matched && previousMatched && arrived && history.viewArrived === true && stable ? (history.viewComparisons ?? 0) + 1 : 0
            history.viewMatched = !!matched; history.viewArrived = arrived
            row.viewComparisons = history.viewComparisons
            row.ordinaryResult = !!(ready && roster && nearRange && current.count >= 6 && history.postArrivalCount >= 6 && history.viewComparisons >= 6 && matched)
            row.result = row.ordinaryResult; result = row.ordinaryResult
            row.observationChecks = { ready, controlsOK, matched: !!matched }
            if (o.errors.length || o.droppedErrors || o.overflow) throw new Error('passive observer sticky failure')
            if (!ready) throw new Error('ordinary camera observation controls or finite geometry differ')
            if (o.actors.length !== 7 || new Set(o.actors.map(t => t.id)).size !== 7 || o.actors.some(t => ![...Object.values(t.body), ...t.rendered, ...t.quaternion].every(Number.isFinite))) throw new Error('incomplete seven actor observation')
            if (o.latest && o.latest.envelopes.some(e => ![...e.center, e.radius, ...e.bend, e.disc.x, e.disc.y, e.disc.radius, e.disc.depth, ...e.camera.eye, ...e.camera.quaternion, ...e.camera.matrix, ...e.camera.inverse, ...e.camera.projection, e.camera.fov].every(Number.isFinite))) throw new Error('nonfinite envelope receipt')
          }
          if (!targets.every(t => t.geometryValid)) throw new Error('arrival target requires finite x/z and complete finite rendered XYZ')
          for (const t of tags.entries) {
            const remote = net.remotes.get(Number(t.id)), vehicle = t.vehicle
            row.lifecycle.push({ id: t.id, kind: vehicle.kind ?? null,
              materializing: vehicle.object.userData.materializing === undefined ? null : vehicle.object.userData.materializing,
              bodyType: typeof vehicle.body.bodyType === 'function' ? vehicle.body.bodyType() : null,
              responding: remote ? remote.responding : null, paused: remote ? remote.paused : null,
              remoteAvailable: !!remote, distance: vehicle.object.position.distanceTo(camera.position) })
          }
        }
        return result
      }, { far, stageID, record, intended, view }, { timeout: remaining(15000), polling: 100 })
    } catch (error) { primary = error; receipt.primaryError = String(error) }
    if (record) {
      report.settlingReceipts ??= []; report.settlingReceipts.push(receipt)
      try {
        const raw = await page.evaluate(() => window.nameplateAcceptanceSettle ?? null)
        receipt.raw = raw
        await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
        assert.equal(raw?.stageID, stageID, 'settling receipt belongs to this wait')
        assert.ok(Array.isArray(raw.records) && raw.records.length > 0 && raw.records.length <= 180 && !raw.overflow, 'complete bounded settling receipt required')
        for (const row of raw.records) {
          assert.equal(row.stageID, stageID)
          assert.ok([row.wall, row.tick, row.time, row.current.stamp, row.counterOut, ...row.current.eye,
            ...row.current.actors.flatMap(v => v.slice(1))].every(Number.isFinite), 'finite settling receipt required')
          assert.equal(row.lifecycle.length, row.current.actors.length, 'complete lifecycle copy required')
        }
        receipt.records = raw.records.length; receipt.complete = true
      } catch (error) { receipt.evidenceError = String(error); if (!primary) primary = error }
      try { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
      catch (error) { receipt.persistError = String(error); if (!primary) primary = error }
    }
    if (primary) throw primary
  }
  async function stage(far = false, curve = .71, hudOverlap = false, scene = 'default', view = null) {
    assert.ok(['default', 'volcanic-positive-near'].includes(scene), 'known staging scene required')
    const measuredPositive = scene === 'volcanic-positive-near'
    const acceptance = !observationOnly && !surveyOnly && !poseOnly
    const stageID = `stage-${++settlingSequence}:${scene}:far=${far}:curve=${curve}:hud=${hudOverlap}`
    if (measuredPositive) {
      assert.ok(!far && !hudOverlap && curve === .71 && !observationOnly && !surveyOnly && !poseOnly, 'measured scene is acceptance positive-near only')
      assert.equal(center.x, surveyReference.center.x); assert.equal(center.z, surveyReference.center.z)
      assert.deepEqual(a.viewportSize(), { width: 1440, height: 900 }, 'measured scene uses the recorded desktop viewport')
      const world = await a.evaluate(() => ({ seed: window.syn3h.params.get('world.seed').value, kind: window.syn3h.params.get('terrain.kind').value }))
      assert.equal(world.seed, 1); assert.equal(world.kind, 0, 'absolute height belongs only to Volcanic seed 1')
    }
    await installTerrainEvidence(a)
    await a.evaluate(curve => window.syn3h.params.set('world.curve', curve), curve)
    const initialPose = await a.evaluate(({ p, fixedNear, fixedPose, positivePose, record }) => {
      const s = window.syn3h, net = window.syn3hNet, localGround = s.terrain.heightAt(p.x, p.z + 18)
      const v = s.player.object.position.clone().set(p.x, localGround + 2, p.z + 18)
      const pose = vehicle => ({ body: { ...vehicle.body.translation() }, rotation: { ...vehicle.body.rotation() }, rendered: vehicle.object.position.toArray(),
        ...(record ? { wall: performance.now(), tick: s.game.tick, kind: vehicle.kind, velocity: { ...vehicle.body.linvel() }, input: { ...vehicle.input }, bodyType: vehicle.body.bodyType(), materializing: vehicle.object.userData.materializing ?? null } : {}) })
      const botPose = fixedPose ?? positivePose
      const actors = [], localBefore = fixedPose || record ? pose(s.player) : null
      s.player.teleport(v, 0)
      if (fixedPose || record) actors.push({ role: 'Observer', id: String(net.id), name: net.players.get(net.id)?.name,
        x: p.x, z: p.z + 18, ground: localGround, requestedTeleportY: v.y, before: localBefore, after: pose(s.player) })
      let initial = null
      s.bots.vehicles.forEach((bot, i) => {
        const x = p.x + (botPose && i === 0 ? botPose.x : fixedNear && i === 0 ? -22 : (i - 1.5) * 12)
        const z = p.z + (botPose && i === 0 ? botPose.z : fixedNear && i === 0 ? -42 : -8 - i * 6)
        const ground = s.terrain.heightAt(x, z), y = botPose && i === 0 ? botPose.initialY : ground + 2
        if (positivePose && i === 0) {
          if (![x, z, ground, y].every(Number.isFinite)) throw new Error('nonfinite positive scene initialization')
          if (String(net.tags.entries.find(entry => entry.vehicle === bot)?.id) !== '65280') throw new Error('positive scene bot identity differs')
          if (ground + 2 !== positivePose.initialY) throw new Error('positive scene ground differs from measured pose')
        }
        if (fixedPose && i === 0) {
          const samples = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz]) => s.terrain.heightAt(x + dx, z + dz))
          if (![x, z, ground, y, ...samples].every(Number.isFinite)) throw new Error('nonfinite fixed pose initialization')
          initial = { x, z, ground, initialY: y, neighborHeights: samples,
            slope: { x: (samples[1] - samples[0]) / 2, z: (samples[3] - samples[2]) / 2 },
            before: { body: { ...bot.body.translation() }, rendered: bot.object.position.toArray() } }
        }
        const before = fixedPose || record ? pose(bot) : null
        bot.teleport(v.clone().set(x, y, z), 0)
        if (fixedPose || record) actors.push({ role: `bot${i}`, index: i, id: net.tags.entries.find(entry => entry.vehicle === bot)?.id ?? null,
          x, z, ground, requestedTeleportY: y, before, after: pose(bot) })
        if (fixedPose && i === 0) initial.after = { body: { ...bot.body.translation() }, rendered: bot.object.position.toArray() }
      })
      s.camera.setCinematicPose(v.clone().set(p.x, s.terrain.heightAt(p.x, p.z + 45) + 20, p.z + 45), v.clone().set(p.x, p.y + 4, p.z - 12), 60)
      return fixedPose || record ? { ...initial, actors } : initial
    }, { p: center, fixedNear: !far && !hudOverlap, fixedPose: poseOnly ? fixedPose : null, positivePose: measuredPositive ? fixedPose : null, record: acceptance })
    if (poseOnly) { report.pose.initial = initialPose; await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
    const boundary = acceptance ? { stageID, actors: [...initialPose.actors] } : null
    if (acceptance) {
      report.ownerBoundaries ??= []; report.ownerBoundaries.push(boundary)
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
    }
    const visitorInitial = await b.evaluate(({p, far, hudOverlap, record}) => {
      const s = window.syn3h, net = window.syn3hNet, z = p.z - (far ? 260 : 4), x = p.x - (far || hudOverlap ? 24 : 8)
      const ground = s.terrain.heightAt(x, z), requestedTeleportY = ground + 2
      const pose = () => ({ body: { ...s.player.body.translation() }, rotation: { ...s.player.body.rotation() }, rendered: s.player.object.position.toArray(),
        wall: performance.now(), tick: s.game.tick, kind: s.player.kind, velocity: { ...s.player.body.linvel() }, input: { ...s.player.input }, bodyType: s.player.body.bodyType(), materializing: s.player.object.userData.materializing ?? null })
      const before = record ? pose() : null
      s.player.teleport(s.player.object.position.clone().set(x, requestedTeleportY, z), 0)
      return record ? { role: 'Visitor', id: String(net.id), name: net.players.get(net.id)?.name, x, z, ground, requestedTeleportY, before, after: pose() } : null
    }, { p: center, far, hudOverlap, record: poseOnly || acceptance })
    if (poseOnly) { report.pose.initial.actors.push(visitorInitial); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
    if (acceptance) { boundary.actors.push(visitorInitial); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
    const companionInitial = await c.evaluate(({p, far, hudOverlap, record}) => {
      const s = window.syn3h, net = window.syn3hNet, z = p.z - (far ? 190 : hudOverlap ? 12 : 4), x = p.x + (far || hudOverlap ? 24 : 8)
      const ground = s.terrain.heightAt(x, z), requestedTeleportY = ground + 2
      const pose = () => ({ body: { ...s.player.body.translation() }, rotation: { ...s.player.body.rotation() }, rendered: s.player.object.position.toArray(),
        wall: performance.now(), tick: s.game.tick, kind: s.player.kind, velocity: { ...s.player.body.linvel() }, input: { ...s.player.input }, bodyType: s.player.body.bodyType(), materializing: s.player.object.userData.materializing ?? null })
      const before = record ? pose() : null
      s.player.teleport(s.player.object.position.clone().set(x, requestedTeleportY, z), 0)
      return record ? { role: 'Companion', id: String(net.id), name: net.players.get(net.id)?.name, x, z, ground, requestedTeleportY, before, after: pose() } : null
    }, { p: center, far, hudOverlap, record: poseOnly || acceptance })
    if (acceptance) { boundary.actors.push(companionInitial); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
    if (poseOnly) {
      report.pose.initial.actors.push(companionInitial)
      // Save raw initialization before rejecting missing, duplicate or nonfinite evidence.
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
      const actors = report.pose.initial.actors
      assert.equal(actors.length, 7)
      assert.equal(new Set(actors.map(actor => actor.id)).size, 7, 'unique initial actor identities')
      assert.deepEqual(actors.map(actor => actor.role).sort(), ['Observer', 'Visitor', 'Companion', 'bot0', 'bot1', 'bot2', 'bot3'].sort())
      for (const actor of actors) {
        assert.ok(typeof actor.id === 'string' && /^[1-9][0-9]*$/.test(actor.id), 'actual actor identity required')
        if (actor.index !== undefined) assert.equal(actor.id, String(65280 + actor.index), 'bot array index matches network tag identity')
        else { assert.ok(Number(actor.id) < 65280); assert.equal(actor.name, actor.role) }
        assert.ok([actor.x, actor.z, actor.ground, actor.requestedTeleportY,
          ...Object.values(actor.before.body), ...Object.values(actor.before.rotation), ...actor.before.rendered,
          ...Object.values(actor.after.body), ...Object.values(actor.after.rotation), ...actor.after.rendered].every(Number.isFinite), 'finite initial actor receipt')
      }
      assert.equal(actors.find(actor => actor.index === 0).id, '65280', 'fixed pose belongs to bot65280')
    }
    let intended = null
    if (acceptance) {
      // Each completed owner evaluation was persisted before the next evaluation.
      assert.equal(boundary.actors.length, 7)
      assert.equal(new Set(boundary.actors.map(t => t.id)).size, 7)
      for (const actor of boundary.actors) {
        assert.ok(typeof actor.id === 'string' && /^[1-9][0-9]*$/.test(actor.id))
        if (actor.index !== undefined) assert.equal(actor.id, String(65280 + actor.index))
        else assert.equal(actor.name, actor.role)
        assert.ok([actor.x, actor.z, actor.requestedTeleportY, ...Object.values(actor.after.body),
          ...actor.after.rendered, ...Object.values(actor.after.velocity), actor.after.wall, actor.after.tick].every(Number.isFinite))
      }
      intended = boundary.actors.map(({ id, x, z }) => ({ id, x, z }))
    }
    // Record diagnostics even when settling fails. Never move the camera to skip occlusion.
    let stagingError
    try {
      if (view) {
        await view.page.setViewportSize({ width: view.width, height: view.height })
        await view.page.evaluate(() => { const s = window.syn3h; s.params.set('camera.mode', 0); s.params.set('camera.distance', 25); s.params.set('sun.timeOfDay', 12); s.shell.setPresentation(false); s.camera.clearCinematicPose() })
      }
      await waitSettled(view?.page ?? a, far, stageID, intended, view ? { names: view.names, width: view.width, height: view.height, host: view.host } : null)
    } catch (error) { stagingError = error }
    if (poseOnly) {
      report.pose.settled = !stagingError
      report.pose.settleError = stagingError ? String(stagingError) : null
      try {
        report.pose.history = await a.evaluate(() => { const history = window.nameplatePoseHistory; delete window.nameplatePoseHistory; return history })
        await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
      } catch (error) {
        report.pose.evidenceError = String(error)
        if (!stagingError) stagingError = error
      }
    }
    if (view) {
      const receipt = { case: view.id, acceptanceEligible: false, settled: !stagingError, primaryError: stagingError ? String(stagingError) : null,
        expectedPeople: view.names, expectedFullBots: ['65280', '65283'], final: null }
      report.viewObservations.push(receipt)
      try {
        receipt.final = await view.page.evaluate(() => window.nameplateViewObserver.sample())
        await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
        const final = receipt.final
        assert.ok(final.latest?.completed && !final.latest.threw && final.latest.stamp === final.stamp && !final.errors.length && !final.droppedErrors && !final.overflow, 'complete final passive draw required')
        assert.ok(final.actors.length === 7 && new Set(final.actors.map(t => t.id)).size === 7)
        assert.ok(final.camera.active && final.camera.uuid === final.latest.camera.uuid && final.mode === 0 && !final.cinematic && final.distance === 25 && !final.presentation)
        assert.deepEqual(final.viewport, { width: view.width, height: view.height }); assert.equal(final.isHost, view.host)
        assert.ok([...final.camera.eye, ...final.camera.quaternion, ...final.camera.matrix, ...final.camera.inverse, ...final.camera.projection,
          final.camera.fov, final.camera.near, final.camera.far, ...final.pivot, ...final.desiredAfterLift, ...final.final, final.arm, final.lift,
          ...final.actors.flatMap(t => [...Object.values(t.body), ...t.rendered, ...t.quaternion])].every(Number.isFinite))
        assert.ok(final.camera.matrix.every((v, i) => v === final.latest.camera.matrix[i]) && final.camera.projection.every((v, i) => v === final.latest.camera.projection[i]))
        assert.ok(Array.isArray(final.latest.envelopes) && final.latest.envelopes.length <= 7, 'bounded final envelopes required')
        assert.deepEqual(final.latest.viewport, [view.width, view.height])
        for (const e of final.latest.envelopes) {
          assert.equal(e.stamp, final.latest.stamp, 'envelope belongs to completed draw')
          assert.equal(e.width, view.width); assert.equal(e.height, view.height)
          assert.ok(e.outputIdentityMatched && e.camera.active && e.camera.uuid === final.camera.uuid, 'envelope camera and output identity required')
          assert.ok([...e.center, e.radius, ...e.bend, e.disc.x, e.disc.y, e.disc.radius, e.disc.depth,
            ...e.camera.eye, ...e.camera.quaternion, ...e.camera.matrix, ...e.camera.inverse, ...e.camera.projection,
            e.camera.fov, e.camera.near, e.camera.far].every(Number.isFinite), 'finite final envelope receipt required')
        }
        assert.deepEqual(final.controls, { 'gfx.auto': false, 'gfx.quality': 4, 'daydream.seconds': 0, 'sun.dayLength': 0,
          'sun.timeOfDay': 12, 'world.seed': 1, 'terrain.kind': 0, 'world.curve': .71 })
        assert.ok(!final.quality.auto && final.quality.level === 4 && !final.daydream)
        assert.ok(boundary.actors.every(t => Number.isFinite(t.ground)), 'all seven original ground values required')
        receipt.visibleExpectedPeople = view.names.filter(name => final.labels.some(l => !l.bot && l.text.includes(name)))
        receipt.visibleExpectedFullBots = receipt.expectedFullBots.filter(id => final.labels.some(l => l.id === id && l.bot && !l.tick))
      } catch (error) { receipt.evidenceError = String(error); if (!stagingError) stagingError = error }
      try { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
      catch (error) { receipt.persistError = String(error); if (!stagingError) stagingError = error }
      if (stagingError) throw stagingError
      return
    }
    try {
      report.stages ??= []
      report.stages.push({ far, curve, scene, observer: await geometryEvidence(a), actors: await Promise.all([b, c].map(page => page.evaluate(() => ({ id: window.syn3hNet.id, seed: window.syn3h.params.get('world.seed')?.value, terrainKind: window.syn3h.params.get('terrain.kind')?.value, position: window.syn3h.player.object.position.toArray() })))) })
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
  if (viewsOnly) {
    report.viewObservations = []
    const cases = [
      { id: 'phone-observer', page: a, width: 390, height: 844, names: ['Visitor', 'Companion'], host: true },
      { id: 'ordinary-follower', page: b, width: 640, height: 480, names: ['Observer', 'Companion'], host: false },
    ]
    for (const view of cases) {
      await installViewObserver(view.page)
      await stage(false, .71, false, 'default', view)
    }
  } else {
  if (observationOnly) {
    report.observations = { purpose: 'setup measurements only; not nameplate acceptance', region: 'center-relative x[-22,-14], z[-42,-34]',
      candidates: observationPositions, settleTimeoutMs: 15000, pollingMs: 100, historyLimit: 180, records: [], complete: false }
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  }
  if (poseOnly) {
    report.pose = { fixedPose, acceptanceEligible: false, settled: false, complete: false, history: [],
      settleTimeoutMs: 15000, pollingMs: 100, historyLimit: 180,
      note: 'one fixed initialization; no hypothesis bounds, slot selection or acceptance' }
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
    await geometryEvidence(a, null, true)
    await a.evaluate(() => { window.nameplateSettle = undefined; window.nameplatePoseHistory = [] })
    await stage()
    report.pose.final = await geometryEvidence(a, 'fixed-pose-history')
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
    const snapshots = [...report.pose.history.map(h => h.snapshot), report.pose.final]
    assert.ok(report.pose.history.length > 0 && report.pose.history.length <= 180, 'bounded pose history required')
    for (const snapshot of snapshots) {
      const d = snapshot.diagnostic
      assert.equal(snapshot.stamp, d.stamp)
      assert.equal(d.seed, surveyReference.seed); assert.equal(d.terrainKind, surveyReference.terrainKind); assert.equal(snapshot.curve, .71)
      assert.equal(d.entries.filter(e => !e.bot).length, 2); assert.equal(d.entries.filter(e => e.bot).length, 4)
      const discs = [...d.entries.map(e => e.plate?.disc), d.localDisc]
      assert.ok(discs.every(disc => disc && ['x', 'y', 'radius', 'depth'].every(k => Number.isFinite(disc[k]))), 'all seven finite discs recorded')
      assert.ok(d.entries.every(e => e.plate && e.plate.stamp === d.stamp && ['x', 'y', 'depth', 'width', 'height', 'opacity'].every(k => Number.isFinite(e.plate.candidate[k]))), 'current finite candidates required')
      assert.ok([...d.camera.eye, ...d.camera.quaternion, ...d.camera.matrix, ...d.camera.projection, ...d.bend,
        ...snapshot.localPose.center, snapshot.localPose.radius, ...snapshot.localPose.renderedOrientation,
        ...Object.values(snapshot.localPose.body), ...Object.values(snapshot.localPose.orientation), ...Object.values(snapshot.localPose.velocity),
        ...d.entries.flatMap(e => [...e.center, ...e.anchor, ...e.renderedRotation, e.radius, ...Object.values(e.bodyPosition), ...Object.values(e.bodyRotation), ...Object.values(e.bodyVelocity)])].every(Number.isFinite))
    }
    report.pose.complete = true
    report.pose.verdict = 'fixed pose evidence collected; no placement or visibility acceptance'
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  } else if (surveyOnly) {
    report.survey = { purpose: 'terrain/projection data only; no pose selection or label acceptance', reference: surveyReference,
      samples: surveySamples, heightQueryLimit: 270, envelopeLimit: 324, projectionLimit: 9072, records: [], complete: false,
      hypotheses: { centerAboveGround: [.5, 1, 2], radii: [3.5, 6], note: 'hypothetical envelopes, not measured support or settled poses' } }
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
    // No stage(), teleports, live-camera mutation or acceptance/cost windows in this mode.
    await a.evaluate(() => window.restoreNameplateTerrainEvidence?.())
    for (const sample of surveySamples) {
      const record = await bounded(a.evaluate(async ({ sample, ref }) => {
        const { CurvedProjection } = await import('/src/ui/nameplates/curvature.ts')
        const s = window.syn3h
        if (s.params.get('world.seed').value !== ref.seed || s.params.get('terrain.kind').value !== ref.terrainKind || s.params.get('world.curve').value !== ref.curve) throw new Error('survey world differs from recorded reference')
        const x = ref.center.x + sample.x, z = ref.center.z + sample.z
        const heights = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz]) => ({ x: x + dx, z: z + dz, height: s.terrain.heightAt(x + dx, z + dz) }))
        if (!heights.every(p => Number.isFinite(p.height))) throw new Error('nonfinite survey height')
        // Clone public objects so reference math never mutates the rendered camera.
        const camera = s.game.camera.clone()
        const vector = s.game.camera.position.clone()
        camera.matrixWorld.fromArray(ref.camera.matrix)
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
        camera.projectionMatrix.fromArray(ref.camera.projection)
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
        camera.near = .25
        const bend = vector.clone().fromArray(ref.bend), eye = vector.clone().fromArray(ref.camera.eye), projection = new CurvedProjection(), envelopeSamples = []
        for (const offset of [.5, 1, 2]) for (const radius of [3.5, 6]) {
          const center = vector.clone().set(x, heights[0].height + offset, z), anchor = center.clone(); anchor.y += radius + .65
          const screen = vector.clone().set(0, 0, 0), disc = { id: 'hypothetical', x: 0, y: 0, radius: 0, depth: 0 }
          projection.project(anchor, bend, camera, ref.viewport.width, ref.viewport.height, screen)
          projection.envelope(center, radius, bend, camera, ref.viewport.width, ref.viewport.height, disc)
          const distance = center.distanceTo(eye)
          if (![...screen.toArray(), ...center.toArray(), disc.x, disc.y, disc.radius, disc.depth, distance].every(Number.isFinite)) throw new Error('nonfinite survey projection')
          envelopeSamples.push({ offset, radius, center: center.toArray(), anchor: anchor.toArray(), screen: screen.toArray(), disc, distance,
            fullBotDistance: distance <= 100, withinExistingNearLimit: distance < 95 })
        }
        return { sample, x, z, heights, slope: { x: (heights[2].height - heights[1].height) / 2, z: (heights[4].height - heights[3].height) / 2 },
          envelopes: envelopeSamples, heightQueries: 5, envelopeCount: 6, projectionCount: 168,
          liveTick: s.game.tick, note: 'reference-camera projection; not live-frame placement or visibility proof' }
      }, { sample, ref: surveyReference }), 3000, 'fixed terrain survey sample')
      report.survey.records.push(record)
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
    }
    assert.equal(report.survey.records.length, 54, 'all fixed samples returned')
    report.survey.complete = true
    report.survey.verdict = 'survey collected; no candidate selected; no physics support or label acceptance claim'
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  } else {
  await stage(false, .71, false, observationOnly ? 'default' : 'volcanic-positive-near')
  if (observationOnly) {
    // Ordinary setup is complete. Across these observations only bot zero is teleported.
    await a.evaluate(() => window.restoreNameplateTerrainEvidence?.())
    for (const candidate of observationPositions) {
      const row = { candidate, settled: false, history: [], snapshot: null }
      report.observations.records.push(row)
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
      row.initial = await a.evaluate(({ center, candidate }) => {
        const s = window.syn3h, bot = s.bots.vehicles[0], x = center.x + candidate.x, z = center.z + candidate.z
        const samples = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz]) => ({ x: x + dx, z: z + dz, height: s.terrain.heightAt(x + dx, z + dz) }))
        if (!samples.every(v => Number.isFinite(v.height))) throw new Error('nonfinite observation terrain height')
        const terrainHeight = samples[0].height, teleportY = terrainHeight + 2
        const slope = { x: (samples[2].height - samples[1].height) / 2, z: (samples[4].height - samples[3].height) / 2 }
        if (!Number.isFinite(slope.x + slope.z + teleportY)) throw new Error('nonfinite observation slope or teleport height')
        const before = { body: { ...bot.body.translation() }, rendered: bot.object.position.toArray() }
        bot.teleport(bot.object.position.clone().set(x, teleportY, z), 0)
        window.nameplateSettle = undefined; window.nameplateObservationHistory = []
        return { x, z, terrainHeight, teleportY, samples, slope, before, time: performance.now(),
          seed: s.params.get('world.seed').value, curve: s.params.get('world.curve').value,
          bodyAfterTeleport: { ...bot.body.translation() }, renderedAfterTeleport: bot.object.position.toArray() }
      }, { center, candidate })
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
      try { await waitSettled(a, false); row.settled = true }
      catch (error) { row.settleError = String(error); if (error.name !== 'TimeoutError') row.fatalError = String(error) }
      // Same bounded criterion and all fixed candidates, even when ordinary settling times out.
      row.history = await a.evaluate(() => { const rows = window.nameplateObservationHistory; delete window.nameplateObservationHistory; return rows })
      row.snapshot = await geometryEvidence(a, 'observation-only')
      // Preserve the raw synchronized receipt before any completeness assertion.
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
      const d = row.snapshot.diagnostic, reference = report.stages[0].observer
      assert.equal(d.seed, reference.seed, 'observation seed unchanged')
      assert.equal(d.terrainKind, reference.terrainKind, 'observation world unchanged')
      assert.equal(row.snapshot.curve, .71, 'observation curvature unchanged')
      assert.equal(row.snapshot.stamp, d.stamp, 'observation snapshot stamp agrees')
      const values = [...d.camera.eye, ...d.camera.quaternion, ...d.camera.matrix, ...d.camera.projection, ...d.bend,
        ...d.entries.flatMap(e => [...e.center, ...e.anchor, ...e.renderedRotation, e.radius,
          ...Object.values(e.bodyPosition), ...Object.values(e.bodyRotation), ...Object.values(e.bodyVelocity)])]
      assert.ok(values.every(Number.isFinite), 'finite synchronized pose and projection required')
      row.humanReservations = row.snapshot.diagnostic.entries.filter(e => !e.bot).map(e => {
        const c = e.plate?.candidate, dom = row.snapshot.labels.find(l => l.id === e.id)
        const valid = dom && e.plate?.shown && !e.plate.hidden && Number.isInteger(c?.previous) && c.previous >= 0 && c.previous <= 3
        if (!valid) return { id: e.id, valid: false, reason: 'no shown current slot', dom }
        const [dx, dy] = [[0, -12], [0, -32], [-c.width / 2 - 12, -12], [c.width / 2 + 12, -12]][c.previous]
        const x = c.x + dx, y = c.y + dy - c.height
        return { id: e.id, valid: e.plate.stamp === row.snapshot.stamp, spot: c.previous, dom,
          bounds: { left: Math.min(x - c.width / 2, c.x) - 3, top: y - 3, right: Math.max(x + c.width / 2, c.x) + 3, bottom: c.y + 3 } }
      })
      await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
      if (row.fatalError) throw new Error(row.fatalError)
    }
    report.observations.complete = report.observations.records.length === observationPositions.length
    report.observations.verdict = 'observations collected; no candidate selected; no acceptance claim'
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  } else {
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
  report.twoBotPrecondition = twoBotSlots(near)
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  assert.ok(report.twoBotPrecondition.pairs.length > 0, 'two full bots have mutually clear saved-geometry slots')
  assert.ok(near.labels.filter(l => l.bot && !l.tick && l.text.includes('BOT')).length >= 2, 'host-owned bots have smaller labels')
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
  await stage(false, .71, false, 'volcanic-positive-near')
  const restored = await capture(a, 'near-positive-restored')
  for (const name of ['Visitor', 'Companion']) assert.ok(restored.labels.some(l => !l.bot && l.text.includes(name)), 'positive human visibility restored')
  report.restoredTwoBotPrecondition = twoBotSlots(restored)
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
  assert.ok(report.restoredTwoBotPrecondition.pairs.length > 0, 'restored full bots have mutually clear saved-geometry slots')
  assert.ok(restored.labels.filter(l => l.bot && !l.tick && l.text.includes('BOT')).length >= 2, 'two full bot labels restored')
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

  } // Acceptance scenarios are never executed or claimed by observation-only mode.
  } // Terrain survey does not enter staging or acceptance.
  } // Passive view observations do not execute acceptance scenarios.
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
    if (viewsOnly) try {
      const receipt = await bounded(page.evaluate(() => { const o = window.nameplateViewObserver; if (!o) return null; o.restore(); return o.state }), 3000, 'restore passive observer')
      if (receipt) {
        report.viewObserverCleanup ??= []; report.viewObserverCleanup.push(receipt)
        await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2))
        if (receipt.errors.length || receipt.droppedErrors || receipt.overflow || !receipt.restored) throw new Error('passive observer cleanup incomplete')
      }
    } catch (error) { report.cleanupErrors.push(String(error)) }
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
