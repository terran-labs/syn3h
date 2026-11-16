/** Source-only adaptation of accepted d58ff55f fixture evidence handling.
 * No servers are started here. Requires the separately reviewed dedicated supervisor. */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL, expected = process.env.GRAPPLE_SOURCE_SHA
const out = process.env.GRAPPLE_EVIDENCE_DIR
const deadline = Date.now() + 480_000, workDeadline = deadline - 30_000
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
const runtimeModules = ['src/main.ts', 'src/core/Game.ts', 'src/core/Input.ts', 'src/ui/Shell.ts',
  'src/net/index.ts', 'src/net/Connection.ts', 'src/weapons/Gear.ts', 'src/weapons/BotGear.ts',
  'src/weapons/bungee/Bungee.ts', 'src/weapons/bungee/tether.ts', 'src/weapons/bungee/drape.ts',
  'src/world/terrain/mesh.ts', 'src/world/terrain/ProceduralTerrain.ts', 'src/world/curve.ts',
  'src/weapons/warm.ts', 'src/weapons/aim.ts', 'src/core/quality.ts', 'src/world/planets.ts',
  'src/bots/params.ts', 'shared/params.ts']
const files = ['index.html', ...runtimeModules, 'src/world/Terrain.ts', 'vite.config.ts', 'server/dev.ts',
  'tests/weapons/browser-grapple-terrain-fixture.mjs', 'tests/weapons/browser-grapple-terrain.mjs']
const report = { source: expected, comparisons: [], matrix: [], native: null, failures: [], errors: [], cleanupErrors: [] }
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
    if (runtimeModules.includes(path)) {
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
  page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
    try { if (['update', 'full-reload', 'prune', 'error'].includes(JSON.parse(String(payload)).type)) evidence.failures.push('HMR changed runtime') } catch { /* room binary/non-JSON frame */ }
  }))
  page.on('response', response => {
    const url = new URL(response.url()), path = url.pathname.slice(1)
    if (url.origin !== new URL(origin).origin || !(response.request().resourceType() === 'document' || path.startsWith('src/') || path.startsWith('shared/'))) return
    const work = (async () => {
      const bytes = await capturedBody(response, 'actual browser', response.request().url(), () => response.body())
      assert.equal(response.status(), 200, `browser response ${url}`)
      assert.equal(response.fromServiceWorker(), false)
      assert.equal(url.searchParams.has('t'), false, 'HMR timestamp module')
      const entry = { url: url.href, path, sha256: hash(bytes), resource: response.request().resourceType() }
      if (entry.resource === 'script') {
        try { entry.mainFrameScript = response.frame() === page.mainFrame() }
        catch { entry.mainFrameScript = false }
      }
      if (entry.resource === 'document') {
        assert.ok(response.request().isNavigationRequest(), 'document must be navigation')
        assert.equal(response.frame(), page.mainFrame(), 'document must execute in main frame')
        assert.equal(url.href, report.navigationURL, 'exact navigation URL')
        entry.mainFrameNavigation = true
      }
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
    assert.ok(evidence.responses.some(r => r.resource === 'document' && r.mainFrameNavigation && r.url === report.navigationURL), 'actual main-frame navigation document missing')
    for (const path of runtimeModules)
      assert.ok(evidence.responses.some(r => r.path === path && r.mainFrameScript), `actual main-frame browser module missing: ${path}`)
  }
  report.browserResponses = responseReceipt()
}

async function checkpoint(stage, details = {}) {
  report.stage = stage; Object.assign(report, details)
  report.browserResponses = responseReceipt()
  await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000, 'checkpoint receipt')
}
let watchdog
try {
  assert.ok(origin && expected && out && process.env.GRAPPLE_LAUNCH_MANIFEST, 'explicit allocated origin/source/evidence/manifest required')
  await bounded(mkdir(out, { recursive: true }), 3000, 'evidence directory')
  const launch = JSON.parse(await bounded(readFile(process.env.GRAPPLE_LAUNCH_MANIFEST, 'utf8'), 3000, 'launch manifest'))
  report.launch = launch
  assert.equal(launch.head, expected); assert.equal(launch.origin, origin)
  assert.equal(launch.env.SYN3H_NO_ROOM_SERVER, '1')
  assert.equal(String(launch.env.SYN3H_ROOM_PORT), String(launch.roomPort))
  assert.ok(Number.isInteger(launch.roomPort) && launch.roomPort !== 8787)
  assert.ok(launch.roomPid > 0 && launch.roomStart && launch.vitePid > 0 && launch.viteStart)
  assert.equal(launch.deadlineSeconds, 590); assert.equal(launch.fixtureWorkStopsAt, 510)
  await checkpoint('manifest accepted')
  report.provenance = await provenance()
  await checkpoint('source preflight complete')
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: remaining(30000),
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  browser.on('disconnected', () => { browserDisconnected = true })
  // The supervisor has the hard outer process deadline. This watchdog also closes
  // the browser producer at the work cutoff instead of racing an uncancelled import.
  watchdog = setTimeout(() => {
    const error = new Error('fixture work deadline; closing browser producer')
    primaryError ??= error; report.failure ??= String(error)
    void browser.close().catch(error => report.cleanupErrors.push(`Deadline close: ${String(error)}`))
  }, remaining(450000))
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  contexts.push(context)
  const page = await context.newPage()
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000)
  page.on('pageerror', error => report.errors.push(String(error)))
  await observeBrowser(page, context, 'grapple')
  const roomStatus = async () => {
    const url = `http://127.0.0.1:${launch.roomPort}/status`
    const response = await fetch(url, { signal: AbortSignal.timeout(remaining(5000)) })
    const bytes = await capturedBody(response, 'owned room status', url, () => response.arrayBuffer())
    assert.equal(response.status, 200); return JSON.parse(bytes)
  }
  assert.deepEqual(await roomStatus(), { rooms: 0, players: 0 })
  Object.assign(globalThis, { __grappleRun: { page, report, out, origin, remaining, bounded, checkpoint,
    verifyBrowserEvidence, roomStatus, runtimeModules, expected } })
  await import('./browser-grapple-terrain.mjs')
  await verifyBrowserEvidence('before final provenance')
  report.finalProvenance = await provenance()
  assert.deepEqual(report.finalProvenance, report.provenance)
  await verifyBrowserEvidence('after final provenance')
} catch (error) {
  primaryError ??= error
  report.failure ??= String(error.stack ?? error)
} finally {
  cleaningUp = true; clearTimeout(watchdog)
  // Persist the primary failure before attempting closure, then keep response and
  // HMR listeners alive until all producers close and the dynamic queues drain.
  try { if (out) await checkpoint('work ended, closure pending') }
  catch (error) { report.cleanupErrors.push(`Partial receipt: ${String(error)}`) }
  try { await verifyBrowserEvidence('before browser closure') }
  catch (error) { report.cleanupErrors.push(String(error.stack ?? error)) }
  try { if (browser) await bounded(browser.close(), 15000, 'browser close') }
  catch (error) { report.cleanupErrors.push(String(error)) }
  try { await verifyBrowserEvidence('closed browser capture boundary', true) }
  catch (error) { report.cleanupErrors.push(String(error.stack ?? error)) }
  if (report.errors.length) report.cleanupErrors.push(...report.errors)
  report.browserResponses = responseReceipt()
  report.captureComplete = !!browser && browserDisconnected && browserEvidence.length > 0 &&
    browserEvidence.every(e => e.closed && !e.openRequests.size) && report.cleanupErrors.length === 0
  try { await bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000, 'final receipt') }
  catch (error) {
    report.cleanupErrors.push(`Receipt: ${String(error)}`); report.captureComplete = false
    console.error('PARTIAL_GRAPPLE_RECEIPT', JSON.stringify(report))
  }
  if (primaryError) throw primaryError
  if (report.cleanupErrors.length) throw new Error(`Incomplete fixture cleanup: ${report.cleanupErrors.join('; ')}`)
}
