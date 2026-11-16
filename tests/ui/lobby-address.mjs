// Source-prepared only. Requires an independently built frozen fixture and an allocated slot.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
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
    'Synthetic pagehide is identified separately from native navigation.', 'An external supervisor must enforce process closure if browser.close times out.'] }
const models = ['/models/tank.glb', '/models/tanktread.glb', '/models/buggy.glb', '/models/buggy-boxarm.glb']
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
  assert.match(m.resources[path]?.latest ?? '', /^[a-f0-9]{64}$/)
  assert.notEqual(m.resources[path].frozen, m.resources[path].latest, 'fixtures must distinguish frozen and latest: ' + path)
}
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
  await page.locator('.galaxy-label.is-current').focus()
  await page.keyboard.press('Enter') // Native keyboard activation in both contexts, not a simulated tap.
  await page.waitForFunction(() => syn3h.shell.playing && syn3hNet.connected && !syn3h.shell.dropping, null, { timeout: 60000 })
}
async function leave(page) {
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
  await panels(page)
  const el = await card(page, 'you')
  await el.getByRole('combobox', { name: 'Vehicle', exact: true }).selectOption(kind)
  await page.waitForFunction(kind => syn3h.player.kind === kind || (kind === 'buggy-syn3h' && syn3h.player.kind === 'buggy'), kind)
}

async function runCase(browser, mode, entry, missing = false) {
  const context = await browser.newContext({ ...(mode === 'phone' ? devices['iPhone 14'] : { viewport: { width: 1440, height: 1000 } }), serviceWorkers: 'block', reducedMotion: 'reduce' })
  // Pass-through routing disables browser HTTP cache; no response is mocked or rewritten.
  await context.route('**/*', route => route.continue())
  const page = await context.newPage()
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(60000)
  const result = { mode, entry: entry.url, missing, responses: [], errors: [], requests: [], sockets: [], checks: [] }
  report.cases.push(result)
  const pending = new Set()
  const jobs = promise => { pending.add(promise); promise.catch(e => result.errors.push(String(e))).finally(() => pending.delete(promise)) }
  const origin = new URL(entry.url).origin
  const expectedBodies = entry.responses
  const seen = new Set()
  page.on('pageerror', e => result.errors.push(e.message))
  page.on('websocket', ws => { result.sockets.push(ws.url()); if (new URL(ws.url()).pathname.includes('vite')) result.errors.push('HMR websocket') })
  page.on('request', request => result.requests.push({ url: request.url(), type: request.resourceType() }))
  page.on('response', response => jobs((async () => {
    const request = response.request(), url = new URL(response.url()), type = request.resourceType()
    if (url.origin !== origin) {
      assert.ok(!['document', 'script', 'stylesheet'].includes(type), 'unexpected external executable/style response'); return
    }
    if (!['document', 'script', 'stylesheet'].includes(type) && !url.pathname.includes('/models/') && !url.pathname.includes('/brand/licenses/')) return
    assert.equal(request.redirectedFrom(), null, 'no response redirects')
    assert.equal(response.fromServiceWorker(), false)
    const isMissing = missing && url.pathname === `/v/${m.version}${m.missing.path}`
    assert.equal(response.status(), isMissing ? 404 : 200, url.href)
    const sha256 = hash(await bounded(response.body(), 'response body'))
    result.responses.push({ url: url.href, type, status: response.status(), sha256 })
    if (['document', 'script', 'stylesheet'].includes(type)) {
      assert.equal(sha256, expectedBodies[url.pathname], 'actual browser artifact bytes: ' + url.pathname)
      seen.add(url.pathname)
    } else if (!isMissing) {
      const prefix = `/v/${m.version}`
      assert.ok(url.pathname.startsWith(prefix + '/'), 'unversioned or wrong-version resource: ' + url.pathname)
      const resource = url.pathname.slice(prefix.length)
      assert.equal(sha256, m.resources[resource]?.frozen, resource)
      assert.notEqual(sha256, m.resources[resource]?.latest)
    }
  })()))
  async function drain() {
    while (pending.size) await bounded(Promise.allSettled([...pending]), 'response drain')
    assert.deepEqual(result.errors, [])
  }
  let caseFailure
  try {
    const url = new URL(entry.url)
    const room = missing ? 'url-missing' : entry.room
    assert.ok(room && /^[a-z0-9_-]{1,32}$/.test(room))
    for (const [key, value] of Object.entries({ v: m.version, room, seed: '1', vehicle: 'jet', 'gfx.quality': '0' })) url.searchParams.set(key, value)
    url.hash = 'retained-entry'
    await page.goto(url.href)
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 60000 })
    await page.locator('.galaxy-links').waitFor({ state: 'visible' })
    clean(page, url.pathname)
    assert.equal(result.requests.some(r => r.url.includes('/models/')), false, 'Jet starts without model preloads')
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    await enter(page); playingURL(page, room)
    assert.ok(result.sockets.some(value => value === entry.roomSocket + '?room=' + room), 'dedicated room connection')
    if (missing) {
      assert.ok(['/models/tank.glb', '/models/tanktread.glb'].includes(m.missing.path))
      await swap(page, 'tank')
      await page.waitForFunction(() => syn3h.player.kind === 'tank')
      // Await the actual failed model request, not a synthetic fetch or route fulfillment.
      const until = Date.now() + 15000
      while (!result.responses.some(r => new URL(r.url).pathname === `/v/${m.version}${m.missing.path}` && r.status === 404)) {
        assert.ok(Date.now() < until, 'missing frozen model response'); await page.waitForTimeout(50)
      }
      await page.waitForTimeout(500)
      assert.equal(result.requests.some(r => new URL(r.url).pathname === m.missing.path), false, 'no retry on latest')
      result.checks.push('isolated missing model requested once on frozen route with no latest retry during observed interval')
    } else {
      await leave(page); clean(page, url.pathname)
      await enter(page); playingURL(page, room)
      assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'already-joined reentry does not reload')
      await swap(page, 'tank'); await swap(page, 'buggy-syn3h')
      const until = Date.now() + 30000
      while (!models.every(path => result.responses.some(r => new URL(r.url).pathname === `/v/${m.version}${path}`))) {
        assert.ok(Date.now() < until, 'all four late models'); await page.waitForTimeout(50)
      }
      await panels(page); await card(page, 'world')
      const row = page.locator('.wi-row[data-id="world.seed"]')
      const fold = row.locator('..')
      if (!(await fold.getAttribute('open') !== null)) await fold.locator('summary').click()
      await row.locator('.wi-num').click()
      await row.locator('.wi-num-edit').fill('42'); await row.locator('.wi-num-edit').press('Enter')
      await page.waitForFunction(() => syn3h.params.get('world.seed').value === 42)
      await leave(page); clean(page, url.pathname)
      await page.waitForFunction(() => {
        const saved = JSON.parse(sessionStorage.getItem('syn3h.resume.v1') || 'null')
        return saved?.entrySeed === 1 && saved.seed === 42
      })
      // Exercise the registered lifecycle handler; this is explicitly synthetic pagehide.
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      result.saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('syn3h.resume.v1')))
      assert.equal(result.saved.entrySeed, 1); assert.equal(result.saved.seed, 42)
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
      result.licences = links.filter(h => h.includes('/brand/licenses/'))
      assert.ok(links.includes('https://terranlabs.com/'))
      await page.screenshot({ path: `${out}/${mode}-${entry.room}-about.png` })
      await page.goto(url.href)
      await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 60000 })
      clean(page, url.pathname)
      assert.equal(await page.evaluate(() => syn3h.params.get('world.seed').value), 42, 'saved seed survives original entry URL')
      result.checks.push('initial/return/reentry addresses', 'four late model responses', 'ten licence hrefs and response bytes', 'invite retains room/version/world', 'periodic and synthetic lifecycle save retains entry seed', 'original entry reload resumes saved world seed')
    }
    await drain()
    for (const path of Object.keys(expectedBodies)) assert.ok(seen.has(path), 'required browser response absent: ' + path)
    assert.equal(result.requests.some(r => /\/@vite\/|\?t=/.test(r.url)), false, 'no Vite/HMR artifact')
  } catch (error) { caseFailure = error; result.errors.push(String(error)) } finally {
    // Close the page to establish a final response boundary, then drain dynamically.
    for (const [label, operation] of [
      ['page close', () => page.close()], ['final response drain', drain], ['context close', () => context.close()],
    ]) {
      try { await bounded(operation(), label, 5000) } catch (error) { result.errors.push(String(error)); caseFailure ??= error }
    }
  }
  if (caseFailure) throw caseFailure
}
let failure
try {
  await provenance()
  for (const mode of ['desktop', 'phone']) {
    const browser = await bounded(mode === 'desktop' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch(), 'browser launch')
    let browserFailure
    try {
      for (const entry of m.entries) await bounded(runCase(browser, mode, entry), 'case', remaining())
      if (mode === 'desktop') await bounded(runCase(browser, mode, m.missing, true), 'missing model case', remaining())
    } catch (error) { browserFailure = error } finally {
      try { await bounded(browser.close(), 'browser close', 10000) } catch (error) { report.errors.push(String(error)); browserFailure ??= error }
    }
    if (browserFailure) throw browserFailure
  }
  await provenance()
} catch (error) { failure = error; report.errors.push(String(error)) }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)) }
if (failure) throw failure
console.log('PASS: allocated clean-URL fixture scope only; routing classification:', m.routing)
