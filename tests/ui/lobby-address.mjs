// Source-prepared only. Requires an independently built frozen fixture and an allocated slot.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const deadline = Date.now() + 480000
const remaining = () => { const ms = deadline - Date.now(); assert.ok(ms > 0, '480s fixture deadline'); return ms }
async function bounded(promise, label, cap = 30000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: deadline`)), Math.min(cap, remaining()))
  })]) } finally { clearTimeout(timer) }
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: Math.min(5000, remaining()) }).trim()
assert.ok(process.env.UX_FROZEN_MANIFEST && process.env.UX_SOURCE_SHA && process.env.UX_EVIDENCE_DIR)
const manifestBytes = await readFile(process.env.UX_FROZEN_MANIFEST)
const m = JSON.parse(manifestBytes)
const out = process.env.UX_EVIDENCE_DIR
await mkdir(out, { recursive: true })
const report = { fixtureHead: process.env.UX_SOURCE_SHA, manifestSha256: hash(manifestBytes), cases: [], errors: [],
  limits: ['Source-to-build linkage is supplied by the independent artifact producer; this fixture verifies browser response bytes against that manifest.',
    'WebKit phone emulation is not a physical iPhone.', 'Clean root hard reload intentionally loads latest.',
    'Synthetic pagehide is identified separately from native navigation.', 'An external supervisor must enforce process closure if browser.close times out.',
    'An external kill can interrupt the latest evidence write; persisted checkpoints are partial evidence, not a complete kill guarantee.'] }
async function persist(stage) {
  report.checkpoint = { stage, at: new Date().toISOString() }
  try {
    await bounded(writeFile(`${out}/report.json.tmp`, JSON.stringify(report, null, 2)), 'partial report write', 5000)
    await bounded(rename(`${out}/report.json.tmp`, `${out}/report.json`), 'partial report rename', 5000)
  } catch (error) {
    report.errors.push(`Evidence persistence failed at ${stage}: ${String(error)}`)
    console.error('PARTIAL_REPORT_WRITE_FAILED', JSON.stringify(report))
    throw error
  }
}
// decodeWorld applies these world-scoped values before Game/player/bot construction.
const entryWorld = 'volcanic.1~bots.count=0'
const models = ['/models/buggy.glb', '/models/buggy-boxarm.glb']
const legacyTankModels = ['/models/tank.glb', '/models/tanktread.glb']
const licences = ['three.txt', 'qr.txt', 'rapier.txt', 'tweakpane.txt', 'lato.txt', 'roboto-apache.txt', 'roboto-notice.txt', 'barlow.txt', 'marked.txt', 'ws.txt'].map(n => '/brand/licenses/' + n)
const sources = ['src/main.ts', 'src/core/frozenResources.ts', 'src/core/resume.ts', 'src/ui/LobbyAddress.ts', 'src/ui/Shell.ts',
  'src/vehicles/skins/VehicleModel.ts', 'src/vehicles/skins/LoadedBuggySkin.ts', 'src/ui/data/credits.ts', 'server/worker.ts', 'package-lock.json']
async function provenance() {
  assert.equal(git('rev-parse', 'HEAD'), report.fixtureHead)
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '')
  assert.match(m.sourceSha, /^[a-f0-9]{40}$/)
  assert.equal(git('diff', m.sourceSha, 'HEAD', '--', ...sources), '', 'product sources match artifact source revision')
  assert.equal(hash(await readFile(process.env.UX_FROZEN_MANIFEST)), report.manifestSha256)
  for (const path of sources) {
    assert.match(m.sourceFiles[path] ?? '', /^[a-f0-9]{64}$/)
    assert.equal(hash(await readFile(new URL('../../' + path, import.meta.url))), m.sourceFiles[path], path)
  }
}
assert.match(m.version, /^\d+\.\d+\.\d+$/)
assert.ok(['real-worker', 'local-fixture'].includes(m.routing))
assert.ok(m.artifactReceipt && m.isolated === true, 'independent isolated artifact receipt required')
assert.equal(m.entries.length, 2, 'root query and frozen pathname entries required')
assert.equal(new URL(m.entries[0].url).pathname, '/')
assert.equal(new URL(m.entries[1].url).pathname, `/v/${m.version}/`)
assert.ok(m.missing && m.missing.isolated === true, 'isolated missing-model fixture required')
for (const path of [...models, ...licences]) {
  assert.match(m.resources[path]?.frozen ?? '', /^[a-f0-9]{64}$/)
}
if (m.distinctResource) {
  assert.ok([...models, ...licences].includes(m.distinctResource.path))
  assert.match(m.distinctResource.latestSha256 ?? '', /^[a-f0-9]{64}$/)
  assert.notEqual(m.resources[m.distinctResource.path].frozen, m.distinctResource.latestSha256)
}
report.resourceScope = m.distinctResource
  ? { exactPathsAndHashes: 12, discriminationResource: m.distinctResource.path }
  : { exactPathsAndHashes: 12, discriminationResource: null, limitation: 'Identical frozen/latest bytes cannot establish byte discrimination; exact frozen paths and expected hashes are checked.' }
report.legacyTankCoverage = 'VehicleModel legacy Tank loader is not exercised by normal play; source and unit evidence only.'
report.routingDeclaredByProducer = m.routing
report.artifactReceipt = m.artifactReceipt

async function panels(page) {
  if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
  const toggle = page.locator('.inspector-toggle')
  if (await page.locator('.world-inspector').isHidden() && await toggle.isVisible()) await toggle.click()
  await page.locator('.world-inspector').waitFor({ state: 'visible' })
}
async function card(page, section) {
  const el = page.locator(`.wi-card[data-section=${section}]`)
  if (await el.locator('.wi-body').isHidden()) await el.locator('.wi-head').click()
  return el
}
async function enter(page) {
  await persist('before planet entry')
  await page.locator('.galaxy-label.is-current').focus()
  await page.keyboard.press('Enter') // Native keyboard activation in both contexts, not a simulated tap.
  await page.waitForFunction(() => syn3h.shell.playing && syn3hNet.connected && !syn3h.shell.dropping, null, { timeout: 60000 })
}
async function leave(page) {
  await persist('before leaving world')
  await panels(page)
  await page.locator('.exit-world').click()
  await page.locator('.exit-leave').click()
  await page.waitForFunction(() => syn3h.shell.menuOpen)
}
function clean(page, pathname) {
  const url = new URL(page.url())
  assert.equal(url.pathname, pathname); assert.equal(url.search, ''); assert.equal(url.hash, '')
}
function playingURL(page, room, seed = '1') {
  const url = new URL(page.url())
  assert.equal(url.searchParams.get('room'), room)
  assert.equal(url.searchParams.get('seed'), seed)
  assert.equal(url.searchParams.get('v'), m.version)
}
async function swap(page, kind) {
  await persist(`before vehicle swap to ${kind}`)
  await panels(page)
  const el = await card(page, 'you')
  await el.getByRole('combobox', { name: 'Vehicle', exact: true }).selectOption(kind)
  await page.waitForFunction(kind => syn3h.player.kind === kind || (kind === 'buggy-syn3h' && syn3h.player.kind === 'buggy'), kind)
}

async function runCase(browser, mode, entry, missing = false) {
  await persist(`before context creation: ${mode} ${entry.url} missing=${missing}`)
  const context = await browser.newContext({ ...(mode === 'phone' ? devices['iPhone 14'] : { viewport: { width: 1440, height: 1000 } }), serviceWorkers: 'block', reducedMotion: 'reduce' })
  // Passive page-clock evidence. No routing, cache suppression or loader interception.
  await context.addInitScript(() => {
    const evidence = { timeOrigin: performance.timeOrigin, transitions: [], resources: [] }
    Object.defineProperty(window, '__lobbyAddressTiming', { value: evidence })
    const original = history.replaceState
    history.replaceState = function (...args) {
      const before = location.href
      const value = Reflect.apply(original, this, args) // Preserve receiver, arguments, return and throw.
      try { evidence.transitions.push({ before, after: location.href, at: performance.now() }) } catch { /* Observation cannot change navigation. */ }
      return value
    }
    const record = entries => {
      for (const entry of entries) {
        if (new URL(entry.name).pathname.includes('/models/')) evidence.resources.push({
          url: entry.name, startTime: entry.startTime, initiatorType: entry.initiatorType,
          duration: entry.duration, transferSize: entry.transferSize,
        })
      }
    }
    const observer = new PerformanceObserver(list => record(list.getEntries()))
    observer.observe({ type: 'resource', buffered: true })
    // Read pending entries in the same page before returning a checkpoint.
    Object.defineProperty(window, '__readLobbyAddressTiming', { value: () => {
      record(observer.takeRecords())
      return evidence
    } })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(60000)
  const result = { mode, entry: entry.url, missing, responses: [], errors: [], requests: [], sockets: [], checks: [] }
  report.cases.push(result)
  const pending = new Set()
  const jobs = promise => { pending.add(promise); promise.catch(e => result.errors.push(String(e))).finally(() => pending.delete(promise)) }
  const origin = new URL(entry.url).origin
  const expectedBodies = entry.responses
  const requiredBodies = entry.requiredResponses
  assert.ok(Array.isArray(requiredBodies) && requiredBodies.length > 0, 'explicit HTML-derived required response list')
  assert.ok(requiredBodies.includes(new URL(entry.url).pathname), 'document must be required')
  for (const path of requiredBodies) assert.match(expectedBodies[path] ?? '', /^[a-f0-9]{64}$/, 'required hash missing: ' + path)
  const seen = new Set()
  // Per-context verified representations only. A 304 has no body hash of its own.
  const verified200 = new Map()
  let responseSequence = 0
  const strongETag = value => typeof value === 'string' && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)
  const varyNames = value => value ? value.split(',').map(v => v.trim().toLowerCase()).sort() : []
  // Persist digests, never raw varying values (which may contain credentials).
  const varyValues = (names, headers) => Object.fromEntries(names.map(name =>
    [name, Object.hasOwn(headers, name) ? hash(headers[name]) : null]))
  page.on('pageerror', e => result.errors.push(e.message))
  page.on('websocket', ws => { result.sockets.push(ws.url()); if (new URL(ws.url()).pathname.includes('vite')) result.errors.push('HMR websocket') })
  context.on('request', request => result.requests.push({ url: request.url(), type: request.resourceType() }))
  context.on('response', response => jobs((async () => {
    const sequence = ++responseSequence
    const request = response.request(), url = new URL(response.url()), type = request.resourceType()
    // Worklets/workers can be reported as 'other' or 'fetch', not 'script'.
    // Observe the entire isolated context and classify by path/MIME as well as type.
    const contentType = response.headers()['content-type'] ?? ''
    const executable = ['document', 'script', 'stylesheet'].includes(type) || /\.(?:m?js|css)$/i.test(url.pathname) || /(?:javascript|ecmascript|text\/css)/i.test(contentType)
    const inventoried = Object.hasOwn(expectedBodies, url.pathname)
    const cacheEligible = inventoried && (type === 'document' || /\.(?:m?js|css)$/i.test(url.pathname))
    if (url.origin !== origin) {
      assert.ok(!executable, 'unexpected external executable/style response'); return
    }
    if (!executable && !inventoried && !url.pathname.includes('/models/') && !url.pathname.includes('/brand/licenses/')) return
    // Capture evidence before any status/validator verdict, within the fixture deadline.
    const [requestHeaders, responseHeaders] = await bounded(Promise.all([
      request.allHeaders(), response.allHeaders(),
    ]), 'response validators')
    const vary = varyNames(responseHeaders.vary)
    const record = { sequence, url: url.href, type, status: response.status(), method: request.method(),
      validators: { etag: responseHeaders.etag ?? null, ifNoneMatch: requestHeaders['if-none-match'] ?? null,
        vary, varyingRequestValueSha256: varyValues(vary, requestHeaders) } }
    result.responses.push(record)
    assert.equal(request.redirectedFrom(), null, 'no response redirects')
    assert.equal(response.fromServiceWorker(), false)
    const isMissing = missing && url.pathname === `/v/${m.version}${m.missing.path}`
    if (response.status() === 304) {
      assert.ok(cacheEligible, '304 restricted to inventoried documents/JS/CSS')
      assert.equal(request.method(), 'GET')
      const prior = verified200.get(url.href)
      assert.ok(prior && prior.sequence < sequence, '304 requires earlier same-context verified GET 200')
      assert.equal(prior.sha256, expectedBodies[url.pathname])
      assert.ok(strongETag(prior.etag) && strongETag(record.validators.etag), 'strong ETags required')
      assert.equal(record.validators.etag, prior.etag, '304 response ETag matches verified representation')
      assert.equal(record.validators.ifNoneMatch, prior.etag, 'single exact If-None-Match required')
      assert.ok(vary.every(name => /^[!#$%&'\*+.^_`|~0-9a-z-]+$/.test(name) && name !== '*'), 'valid non-wildcard Vary names required')
      assert.equal(new Set(vary).size, vary.length, 'duplicate Vary names are ambiguous')
      assert.deepEqual(vary, prior.vary, 'unchanged Vary')
      assert.deepEqual(record.validators.varyingRequestValueSha256, prior.varyValues, 'matching Vary request values')
      record.reuseSha = prior.sha256
      record.prior200Sequence = prior.sequence
      seen.add(url.pathname)
      return // Never read/refetch a 304 body or call its payload hashed.
    }
    assert.equal(response.status(), isMissing ? 404 : 200, url.href)
    const sha256 = hash(await bounded(response.body(), 'response body'))
    record.sha256 = sha256
    if (executable || inventoried) {
      assert.equal(sha256, expectedBodies[url.pathname], 'actual browser artifact bytes: ' + url.pathname)
      seen.add(url.pathname)
      if (request.method() === 'GET' && cacheEligible) {
        verified200.set(url.href, { sequence, sha256, etag: record.validators.etag,
          vary, varyValues: record.validators.varyingRequestValueSha256 })
      }
    } else if (!isMissing) {
      const prefix = `/v/${m.version}`
      assert.ok(url.pathname.startsWith(prefix + '/'), 'unversioned or wrong-version resource: ' + url.pathname)
      const resource = url.pathname.slice(prefix.length)
      assert.equal(sha256, m.resources[resource]?.frozen, resource)
      if (resource === m.distinctResource?.path) assert.notEqual(sha256, m.distinctResource.latestSha256)
    }
  })()))
  async function drain() {
    while (pending.size) await bounded(Promise.allSettled([...pending]), 'response drain')
    assert.deepEqual(result.errors, [])
  }
  async function verifyPostCleanupResources(paths, timeOrigin) {
    result.addressTiming = await page.evaluate(() => window.__readLobbyAddressTiming())
    await persist('address/resource timing captured before assertions')
    const evidence = result.addressTiming
    assert.equal(evidence.timeOrigin, timeOrigin, 'timing belongs to original document')
    const cleanup = evidence.transitions.find(t => {
      const before = new URL(t.before), after = new URL(t.after)
      return (before.search || before.hash) && !after.search && !after.hash && after.pathname === new URL(entry.url).pathname
    })
    assert.ok(cleanup, 'observed successful address cleanup in this document')
    result.postCleanupResources = paths.map(path => {
      const url = new URL(`/v/${m.version}${path}`, origin).href
      const observed = evidence.resources.filter(r => r.url === url && r.initiatorType === 'fetch' && r.startTime > cleanup.at)
      assert.ok(observed.length, 'model fetch initiated after address cleanup: ' + path)
      assert.ok(result.responses.some(r => r.url === url), 'matching actual browser response: ' + path)
      return { path, cleanupAt: cleanup.at, observed, trigger: 'unknown: normal warmer or selection; cache status not inferred' }
    })
    await persist('post-cleanup resource timing verified')
  }
  async function requireHost(stage) {
    const role = await page.evaluate(() => ({ connected: syn3hNet.connected,
      isHost: syn3hNet.isHost, id: syn3hNet.id, host: syn3hNet.game.host,
      seed: syn3h.params.get('world.seed').value }))
    ;(result.hostSnapshots ??= []).push({ stage, ...role })
    await persist(`host precondition: ${stage}`)
    assert.equal(role.connected, true, 'connected host required')
    assert.equal(role.isHost, true, 'host required; no role repair or second wait')
    assert.ok(Number.isInteger(role.id) && role.id > 0, 'assigned player identity')
    assert.equal(role.id, role.host, 'actual host identity')
    assert.equal(role.seed, 1, 'entry seed must remain 1 before host edit')
  }
  let caseFailure
  try {
    const url = new URL(entry.url)
    const room = missing ? 'url-missing' : entry.room
    assert.ok(room && /^[a-z0-9_-]{1,32}$/.test(room))
    for (const [key, value] of Object.entries({ v: m.version, room, world: entryWorld, seed: '1', vehicle: 'jet', 'gfx.quality': '0' })) url.searchParams.set(key, value)
    url.hash = 'retained-entry'
    await persist('before initial document navigation')
    await page.goto(url.href)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 60000 })
    await page.locator('.galaxy-links').waitFor({ state: 'visible' })
    clean(page, url.pathname)
    result.startup = await page.evaluate(() => ({
      kind: syn3h.player.kind, seed: syn3h.params.get('world.seed').value,
      requestedBots: syn3h.params.get('bots.count').value, bots: syn3h.bots.vehicles.length,
      recipe: syn3h.planets.currentPlanet().id,
    }))
    assert.deepEqual(result.startup, { kind: 'jet', seed: 1, requestedBots: 0, bots: 0, recipe: 'volcanic' }, 'shared-world setup applied before startup')
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    await enter(page); playingURL(page, room)
    assert.ok(result.sockets.some(value => value === entry.roomSocket + '?room=' + room), 'dedicated room connection')
    if (missing) {
      assert.ok(models.includes(m.missing.path))
      await swap(page, 'buggy-syn3h')
      // Await the actual failed model request, not a synthetic fetch or route fulfillment.
      const until = Date.now() + 15000
      while (!result.responses.some(r => new URL(r.url).pathname === `/v/${m.version}${m.missing.path}` && r.status === 404)) {
        assert.ok(Date.now() < until, 'missing frozen model response'); await page.waitForTimeout(50)
      }
      await page.waitForTimeout(500)
      assert.equal(result.requests.some(r => new URL(r.url).pathname === m.missing.path), false, 'no retry on latest')
      await verifyPostCleanupResources([m.missing.path], timeOrigin)
      result.checks.push('isolated missing Buggy fetch after cleanup uses frozen route with no latest retry during observed interval')
    } else {
      await requireHost('initial connected entry')
      await leave(page); clean(page, url.pathname)
      await enter(page); playingURL(page, room)
      assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'already-joined reentry does not reload')
      assert.equal(await page.evaluate(() => syn3h.bots.vehicles.length), 0, 'no bot model loads before swaps')
      await swap(page, 'tank')
      result.tank = await bounded(page.evaluate(async () => {
        const tank = syn3h.player
        await tank.modelReady
        let meshes = 0
        tank.object.traverse(object => { if (object.isMesh) meshes++ })
        return { kind: tank.kind, cockpit: tank.object.userData.cockpit,
          ownLamps: tank.object.userData.ownLamps, meshes,
          cameraMode: syn3h.params.get('camera.mode').value, timeOrigin: performance.timeOrigin }
      }), 'generated Tank ready')
      assert.equal(result.tank.kind, 'tank'); assert.equal(result.tank.cockpit, true)
      assert.equal(result.tank.ownLamps, true); assert.ok(result.tank.meshes > 0, 'normal generated Tank has rendered geometry')
      assert.equal(result.tank.timeOrigin, timeOrigin, 'Tank switch stays in this document')
      assert.equal(result.requests.some(r => legacyTankModels.some(path => new URL(r.url).pathname.endsWith(path))), false, 'generated Tank does not request legacy meshes')
      await persist('generated Tank verified; before Buggy swap')
      await swap(page, 'buggy-syn3h')
      const until = Date.now() + 30000
      while (!models.every(path => result.responses.some(r => new URL(r.url).pathname === `/v/${m.version}${path}`))) {
        assert.ok(Date.now() < until, 'both late Buggy models'); await page.waitForTimeout(50)
      }
      await drain()
      await verifyPostCleanupResources(models, timeOrigin)
      result.checks.push('generated Tank without legacy requests', 'two post-cleanup frozen Buggy responses; trigger unknown')
      await persist('late models verified; before returning to original Jet')
      await swap(page, 'jet')
      assert.equal(await page.evaluate(() => syn3h.player.kind), 'jet', 'save the original entry vehicle')
      await persist('before host seed edit')
      await panels(page); await card(page, 'world')
      const row = page.locator('.wi-row[data-id="world.seed"]')
      const fold = row.locator('..')
      if (!(await fold.getAttribute('open') !== null)) await fold.locator('summary').click()
      await requireHost('immediately before seed edit')
      await row.locator('.wi-num').click()
      await row.locator('.wi-num-edit').fill('42'); await row.locator('.wi-num-edit').press('Enter')
      await page.waitForFunction(() => syn3h.params.get('world.seed').value === 42)
      await leave(page); clean(page, url.pathname)
      await page.waitForFunction(() => {
        const saved = JSON.parse(sessionStorage.getItem('syn3h.resume.v1') || 'null')
        return saved?.entrySeed === 1 && saved.seed === 42 && saved.kind === 'jet'
      })
      result.periodicSaved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('syn3h.resume.v1')))
      await persist('periodic save captured before host assertions')
      assert.equal(result.periodicSaved.wasHost, true)
      assert.equal(result.periodicSaved.world['world.seed'], 42)
      // Exercise the registered lifecycle handler; this is explicitly synthetic pagehide.
      await persist('before synthetic pagehide')
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      result.saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('syn3h.resume.v1')))
      await persist('lifecycle save captured before host assertions')
      assert.equal(result.saved.wasHost, true); assert.equal(result.saved.world['world.seed'], 42)
      assert.equal(result.saved.entrySeed, 1); assert.equal(result.saved.seed, 42); assert.equal(result.saved.kind, 'jet')
      await persist('Jet resume snapshot verified; before invite/About navigation')
      await page.locator('.galaxy-links [data-goto=multiplayer]').click()
      const invite = new URL(await page.locator('[data-panel=multiplayer] .invite-link').innerText())
      assert.equal(invite.searchParams.get('v'), m.version); assert.equal(invite.searchParams.get('room'), room)
      assert.equal(invite.pathname, url.pathname); assert.ok(invite.searchParams.get('world'))
      await page.keyboard.press('Escape')
      await page.locator('.galaxy-links [data-goto=about]').click()
      const links = await page.locator('[data-panel=about] a[href]').evaluateAll(es => es.map(e => e.getAttribute('href')))
      assert.deepEqual(links.filter(h => h.includes('/brand/licenses/')), licences.map(path => `/v/${m.version}${path}`))
      for (const path of licences) {
        const response = await context.request.get(new URL(`/v/${m.version}${path}`, origin).href, { timeout: 15000, maxRedirects: 0 })
        assert.equal(response.status(), 200); assert.equal(hash(await response.body()), m.resources[path].frozen)
      }
      if (m.distinctResource) {
        const path = m.distinctResource.path
        const response = await context.request.get(new URL(path, origin).href, { timeout: 15000, maxRedirects: 0, headers: { referer: origin + '/' } })
        assert.equal(response.status(), 200)
        const latestHash = hash(await response.body())
        assert.equal(latestHash, m.distinctResource.latestSha256)
        assert.notEqual(latestHash, m.resources[path].frozen)
        result.distinctResource = { path, latestHash, frozenHash: m.resources[path].frozen }
      }
      result.licences = links.filter(h => h.includes('/brand/licenses/'))
      assert.ok(links.includes('https://terranlabs.com/'))
      await persist('before About capture')
      await page.screenshot({ path: `${out}/${mode}-${entry.room}-about.png` })
      await drain() // Finish initial verified representations before conditional reload responses.
      await persist('before original-entry reload')
      await page.goto(url.href)
      await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 60000 })
      clean(page, url.pathname)
      assert.equal(await page.evaluate(() => syn3h.params.get('world.seed').value), 42, 'saved seed survives original entry URL')
      result.checks.push('initial/return/reentry addresses', 'ten licence hrefs and response bytes', 'invite retains room/version/world', 'periodic and synthetic lifecycle save retains entry seed', 'original entry reload resumes saved world seed')
    }
    assert.equal(result.requests.some(r => legacyTankModels.some(path => new URL(r.url).pathname.endsWith(path))), false, 'no legacy Tank requests throughout case')
    await drain()
    for (const path of requiredBodies) assert.ok(seen.has(path), 'required browser response absent: ' + path)
    result.requiredResponses = requiredBodies
    result.observedConditionalResponses = [...seen].filter(path => !requiredBodies.includes(path))
    assert.equal(result.requests.some(r => /\/@vite\/|\?t=/.test(r.url)), false, 'no Vite/HMR artifact')
  } catch (error) { caseFailure = error; result.errors.push(String(error)) } finally {
    try { await persist('before case cleanup') } catch (error) { caseFailure ??= error }
    // Close the page to establish a final response boundary, then drain dynamically.
    for (const [label, operation] of [
      ['page close', () => page.close()], ['final response drain', drain], ['context close', () => context.close()], ['post-context response drain', drain],
    ]) {
      try { await bounded(operation(), label, 5000) } catch (error) { result.errors.push(String(error)); caseFailure ??= error }
    }
  }
  result.outcome = caseFailure ? 'failed' : 'passed'
  try { await persist('case complete') } catch (error) { caseFailure ??= error; result.outcome = 'failed' }
  if (caseFailure) throw caseFailure
}
let failure
try {
  await persist('before provenance checks')
  await provenance()
  for (const mode of ['desktop', 'phone']) {
    await persist(`before ${mode} browser launch`)
    const browser = await bounded(mode === 'desktop' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch(), 'browser launch')
    let browserFailure
    try {
      for (const entry of m.entries) await bounded(runCase(browser, mode, entry), 'case', remaining())
      if (mode === 'desktop') await bounded(runCase(browser, mode, m.missing, true), 'missing model case', remaining())
    } catch (error) { browserFailure = error } finally {
      try { await persist('before browser close') } catch (error) { browserFailure ??= error }
      try { await bounded(browser.close(), 'browser close', 10000) } catch (error) { report.errors.push(String(error)); browserFailure ??= error }
    }
    if (browserFailure) throw browserFailure
    if (mode === 'desktop') {
      // Default REJOIN_GRACE is 30s. Keep normal rejoin and literal room=lobby.
      // This boundary is not host proof: each entry separately asserts the real role.
      assert.ok(remaining() > 31000, 'budget for single inter-browser boundary')
      const boundary = report.interBrowserBoundary = { requestedMs: 31000,
        startedAt: new Date().toISOString(), startMonotonicMs: performance.now() }
      await persist('Chrome closed; before single rejoin grace boundary')
      let timer
      try {
        await bounded(new Promise(resolve => { timer = setTimeout(resolve, 31000) }), 'inter-browser grace', 32000)
      } finally {
        clearTimeout(timer)
        boundary.elapsedMs = performance.now() - boundary.startMonotonicMs
        boundary.endedAt = new Date().toISOString()
      }
      await persist('inter-browser grace boundary finished')
      assert.ok(boundary.elapsedMs >= 31000, 'full single grace boundary elapsed')
    }
  }
  await provenance()
} catch (error) { failure = error; report.errors.push(String(error)) }
finally {
  report.outcome = failure || report.errors.length ? 'failed' : 'passed'
  try { await persist('final report') } catch (error) { failure ??= error; report.outcome = 'failed' }
}
if (!failure && report.errors.length) failure = new Error(report.errors.join('\n'))
if (failure) throw failure
console.log('PASS: allocated clean-URL fixture scope only; routing classification:', m.routing)
