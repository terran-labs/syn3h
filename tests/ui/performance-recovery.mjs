// SOURCE ONLY. Controlled recommendation stimulus, not a performance benchmark.
// Requires separately reviewed exact-source Vite/room launcher and runtime allocation.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = process.env.SYN3H_URL, expected = process.env.UX_SOURCE_SHA, out = process.env.UX_EVIDENCE_DIR
assert.ok(origin && expected && out && process.env.UX_DOCUMENT_SHA256 && process.env.UX_RENDERER_MANIFEST)
const deadline = Date.now() + 240000
const budget = cap => { const left = Math.min(cap, deadline - Date.now()); assert.ok(left > 0, 'fixture deadline'); return left }
async function bounded(promise, cap = 15000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('bounded operation expired')), budget(cap)) })]) }
  finally { clearTimeout(timer) }
}
const hash = b => createHash('sha256').update(b).digest('hex')
const sources = ['src/main.ts', 'src/core/Game.ts', 'src/core/quality.ts', 'src/core/performanceHistory.ts', 'src/core/diagnostics.ts', 'src/ui/PerformancePanel.ts']
const report = { source: expected, stimulus: '50ms frame samples substituted on actual ordinary quality.frame calls, maximum 600 calls; not measured FPS', cases: [], errors: [], status: 'in_progress' }
await mkdir(out, { recursive: false })
const persist = () => bounded(writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000)
function clean() {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), expected)
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), '')
}
clean()
const local = Object.fromEntries(await Promise.all(sources.map(async p => [p, await readFile(new URL(`../../${p}`, import.meta.url), 'utf8')])))
const rendererManifest = JSON.parse(await readFile(process.env.UX_RENDERER_MANIFEST, 'utf8'))
assert.ok(Array.isArray(rendererManifest.chunks) && rendererManifest.chunks.length > 0)
assert.ok(rendererManifest.chunks.every(c => typeof c.path === 'string' && c.path.startsWith('/') && /^[0-9a-f]{64}$/.test(c.sha256)))
assert.equal(new Set(rendererManifest.chunks.map(c => c.path)).size, rendererManifest.chunks.length)
assert.equal(rendererManifest.chunks.length, 3)
assert.ok(Array.isArray(rendererManifest.allowedChunks) && rendererManifest.allowedChunks.length >= 3)
assert.ok(rendererManifest.allowedChunks.every(c => c.path.startsWith(rendererManifest.cachePrefix) && /^[0-9a-f]{64}$/.test(c.sha256)))
assert.equal(new Set(rendererManifest.allowedChunks.map(c => c.path)).size, rendererManifest.allowedChunks.length)
for (const c of rendererManifest.chunks) assert.ok(rendererManifest.allowedChunks.some(a => a.path === c.path && a.sha256 === c.sha256))
assert.match(rendererManifest.browserHash, /^[0-9a-f]{8}$/)
report.rendererManifestSha256 = hash(await readFile(process.env.UX_RENDERER_MANIFEST))
report.sourceHashes = Object.fromEntries(sources.map(p => [p, hash(local[p])]))
let browser, primary
async function attempt(label, fn) { try { await fn() } catch (e) { report.errors.push({ label, error: String(e) }) } }
try {
  browser = await bounded(chromium.launch({ channel: 'chrome', headless: true }), 30000)
  for (const choice of ['keep', 'switch-and-recover']) {
    const row = { choice, epochs: [], expectedLossErrors: [] }
    report.cases.push(row)
    const context = await bounded(browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }))
    const page = await bounded(context.newPage())
    page.setDefaultTimeout(15000)
    const pending = [], responseErrors = []
    let epoch = null, allowedNavigations = 1, lossWindow = null
    const requestEpoch = new WeakMap()
    page.on('pageerror', e => responseErrors.push(`pageerror: ${String(e)}`))
    page.on('request', request => {
      try {
        if (request.frame() !== page.mainFrame()) return
        if (request.isNavigationRequest() && request.resourceType() === 'document') {
          assert.ok(row.epochs.length < allowedNavigations, 'unexpected main-frame navigation')
          epoch = { sequence: row.epochs.length + 1, requestURL: request.url(), committed: false, identity: null, document: null, executed: {}, rendererModules: {} }
          row.epochs.push(epoch)
        }
        if (request.resourceType() === 'script') assert.ok(epoch?.committed, 'script requested outside committed document epoch')
        requestEpoch.set(request, epoch)
      } catch (e) { responseErrors.push(String(e)) }
    })
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return
      if (!epoch || frame.url() !== epoch.requestURL) responseErrors.push('main-frame commit differs from navigation request')
      else epoch.committed = true
    })
    await page.exposeBinding('__recoveryDocumentReady', ({ frame }, identity) => {
      if (frame !== page.mainFrame() || !epoch || epoch.identity) { responseErrors.push('unexpected document identity'); return }
      epoch.identity = identity
    })
    await page.addInitScript(() => {
      const identity = { token: crypto.randomUUID(), timeOrigin: performance.timeOrigin }
      window.__recoveryDocument = identity
      void window.__recoveryDocumentReady(identity)
    })
    page.on('websocket', socket => socket.on('framereceived', event => {
      try {
        const message = JSON.parse(String(event.payload))
        if (['update', 'full-reload', 'prune'].includes(message.type)) responseErrors.push('HMR invalidates source proof')
      } catch { /* Ordinary non-JSON gameplay frames are not HMR. */ }
    }))
    page.on('console', message => {
      if (message.type() !== 'error') return
      const item = { text: message.text(), epoch: epoch?.sequence ?? null }
      if (lossWindow && item.epoch === lossWindow.epoch) lossWindow.errors.push(item)
      else responseErrors.push(`console: ${item.text}`)
    })
    page.on('response', response => {
      const request = response.request(), owner = requestEpoch.get(request)
      const task = (async () => {
        const url = new URL(response.url())
        if (request.resourceType() !== 'document' && request.resourceType() !== 'script') return
        assert.equal(request.frame(), page.mainFrame(), 'main-frame response only')
        assert.ok(owner, 'request bound to a navigation epoch')
        assert.equal(url.origin, new URL(origin).origin, 'same-origin executed code')
        assert.equal(response.fromServiceWorker(), false)
        assert.equal(request.redirectedFrom(), null)
        assert.ok([200, 304].includes(response.status()))
        const bytes = await bounded(response.body()) // Status alone is never evidence.
        if (request.resourceType() === 'document') {
          assert.equal(url.pathname, '/', 'reviewed root document route')
          assert.equal(request.isNavigationRequest(), true)
          assert.equal(request.url(), owner.requestURL)
          assert.equal(owner.document, null, 'one navigation response per epoch')
          assert.equal(hash(bytes), process.env.UX_DOCUMENT_SHA256)
          owner.document = { url: response.url(), sha256: hash(bytes), status: response.status() }
        }
        const chunk = rendererManifest.allowedChunks.find(c => c.path === url.pathname)
        if (url.pathname.startsWith(rendererManifest.cachePrefix)) assert.ok(chunk, 'unexpected optimized chunk')
        if (url.pathname.includes('/node_modules/three/')) assert.fail('unprepared direct renderer request')
        if (chunk) {
          assert.ok(url.search === '' || url.search === `?v=${rendererManifest.browserHash}`, 'prepared optimizer version only')
          assert.equal(hash(bytes), chunk.sha256)
          owner.rendererModules[chunk.path] = hash(bytes)
        }
        const path = url.pathname.slice(1)
        if (sources.includes(path)) {
          const match = bytes.toString().match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)
          assert.ok(match, `executed source map ${path}`)
          const map = JSON.parse(Buffer.from(match[1], 'base64').toString())
          assert.ok(Array.isArray(map.sources) && Array.isArray(map.sourcesContent))
          const matches = map.sources.map((name, index) => ({ name, index })).filter(({ name }) => {
            const resolved = new URL(name, new URL(map.sourceRoot || '.', response.url())).href
            return resolved === new URL(`/${path}`, origin).href || resolved === new URL(`file://${root}${path}`).href || name === `${root}${path}`
          })
          assert.equal(matches.length, 1, `unique source identity ${path}`)
          assert.equal(map.sourcesContent[matches[0].index], local[path], `matching identity and content ${path}`)
          owner.executed[path] = { sha256: hash(bytes), sourceIdentity: matches[0].name }
        }
      })().catch(e => responseErrors.push(String(e)))
      pending.push(task)
    })
    async function drain() { for (let i = 0; i < pending.length;) { const end = pending.length; await bounded(Promise.all(pending.slice(i, end))); i = end } }
    async function verifyEpoch(expectedSequence) {
      await drain()
      assert.equal(epoch.sequence, expectedSequence)
      assert.ok(epoch.committed && epoch.identity && epoch.document)
      assert.deepEqual(await page.evaluate(() => window.__recoveryDocument), epoch.identity)
      for (const path of sources) assert.ok(epoch.executed[path], `epoch ${expectedSequence} source ${path}`)
      for (const chunk of rendererManifest.chunks) assert.equal(epoch.rendererModules[chunk.path], chunk.sha256)
      assert.deepEqual(responseErrors, [])
    }
    const wait = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: budget(ms) })
    const state = () => page.evaluate(() => syn3h.game.quality.getQualityState())
    try {
      const url = new URL(origin)
      url.search = new URLSearchParams({ autoplay: '1', room: `recovery-${randomUUID()}`, webgl: '1', gfx: '3', world: 'alpine.1518~bots.count=0' }).toString()
      await bounded(page.goto(url.href), 60000)
      await wait(() => window.syn3h?.shell.playing && syn3h.game.tick > 30 && !syn3h.game.quality.isLoading, null, 60000)
      await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: budget(30000) })
      assert.equal(await page.evaluate(() => syn3h.game.backend), 'webgl')
      await verifyEpoch(1)
      if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
      const card = page.locator('.wi-card[data-section=performance]')
      await card.locator('.wi-head').click()
      const select = card.getByRole('combobox', { name: 'Quality level' })
      await select.selectOption('3')
      const auto = card.locator('.wi-auto input')
      if (await auto.isChecked()) await auto.click()
      await wait(() => syn3h.game.quality.getQualityState().level === 3 && !syn3h.game.quality.getQualityState().auto)
      const particle = card.locator('.wi-row[data-id="lava.particleBudget"]')
      // Open the real details element with its summary, not a private UI mutation.
      if (await particle.evaluate(el => !!el.closest('details') && !el.closest('details').open)) await particle.locator('xpath=ancestor::details[1]').locator('summary').click()
      await particle.locator('.wi-num').click(); await page.keyboard.type('1200'); await page.keyboard.press('Enter')
      await wait(() => syn3h.game.quality.getQualityState().overrides['lava.particleBudget'] === 1200)
      row.before = await state()
      row.stimulus = await page.evaluate(() => {
        const q = syn3h.game.quality, original = q.frame
        const trace = { calls: 0, eligibleCalls: 0, substituted: 0, exhausted: false, tick: syn3h.game.tick }
        function wrapped(metrics, ...args) {
          trace.calls++
          if (args[0] !== false && !document.hidden && !q.isLoading) trace.eligibleCalls++
          const use = trace.substituted < 600
          if (use) trace.substituted++; else trace.exhausted = true
          return Reflect.apply(original, this, [use ? { ...metrics, frameMs: 50, fps: 20 } : metrics, ...args])
        }
        q.frame = wrapped
        window.__recoveryTest = { trace, restore() { if (q.frame !== wrapped) throw new Error('sample wrapper replaced'); q.frame = original } }
        return { maximumCalls: 600, sampleMs: 50, startTick: trace.tick }
      })
      await wait(() => !!syn3h.game.quality.getPerformanceSnapshot().recommendation && !window.__recoveryTest.trace.exhausted)
      row.offer = await page.evaluate(() => syn3h.game.quality.getPerformanceSnapshot().recommendation)
      assert.equal(row.offer.level, 3); assert.equal(row.offer.targetLevel, 2)
      const offer = page.locator('.performance-recommendation')
      if (choice === 'keep') {
        await offer.getByRole('button', { name: 'Keep High', exact: true }).click()
        const calls = await page.evaluate(() => window.__recoveryTest.trace.calls)
        await wait(n => window.__recoveryTest.trace.calls >= n + 60 && !window.__recoveryTest.trace.exhausted, calls)
        assert.deepEqual(await state(), row.before)
        assert.equal(await page.evaluate(() => syn3h.game.quality.getPerformanceSnapshot().recommendation), null)
        assert.equal(await page.evaluate(() => sessionStorage.getItem('syn3h.performance.ignore')), '1')
      } else {
        await offer.getByRole('button', { name: 'Switch to Medium', exact: true }).click()
        await wait(() => syn3h.game.quality.getQualityState().level === 2)
        const after = await state()
        assert.equal(after.auto, false); assert.equal(after.pinned, true); assert.deepEqual(after.overrides, {})
        assert.equal(await page.evaluate(() => syn3h.params.get('lava.particleBudget').value), 960)
      }
      row.after = await state()
      row.samples = await page.evaluate(() => { const t = window.__recoveryTest; t.restore(); t.restored = true; return t.trace })
      assert.ok(row.samples.eligibleCalls >= 200); assert.equal(row.samples.exhausted, false)
      if (choice === 'switch-and-recover') {
        await drain(); assert.deepEqual(responseErrors, [])
        lossWindow = { epoch: epoch.sequence, errors: [] }
        row.loss = await page.evaluate(() => {
          const g = syn3h.game, gl = g.canvas.getContext('webgl2')
          if (!gl || gl.isContextLost()) throw new Error('live WebGL2 context required')
          const ext = gl.getExtension('WEBGL_lose_context')
          if (!ext) throw new Error('WEBGL_lose_context unavailable')
          const identity = { timeOrigin: performance.timeOrigin, rendererClass: g.renderer.constructor.name, tick: g.tick, backend: g.backend }
          window.__rendererBeforeLoss = g.renderer
          window.__contextLossEvent = null
          g.canvas.addEventListener('webglcontextlost', e => { window.__contextLossEvent = { trusted: e.isTrusted, lost: gl.isContextLost(), time: performance.now(), statusMessage: e.statusMessage || '', reason: null } }, { once: true, capture: true })
          ext.loseContext()
          return identity
        })
        await page.locator('#syn3h-device-lost').waitFor({ state: 'visible', timeout: budget(15000) })
        row.lossEvent = await page.evaluate(() => window.__contextLossEvent)
        assert.equal(row.lossEvent?.trusted, true); assert.equal(row.lossEvent.lost, true)
        assert.match(await page.locator('#syn3h-device-lost').innerText(), /WebGL context was lost/)
        await drain()
        const expectedLoss = `THREE.WebGPURenderer: WebGL Device Lost:\n\nMessage: ${row.lossEvent.statusMessage || 'Unknown reason'}` + (row.lossEvent.reason ? `\nReason: ${row.lossEvent.reason}` : '')
        assert.equal(lossWindow.errors.length, 1)
        assert.equal(lossWindow.errors[0].text, expectedLoss)
        row.expectedLossErrors = lossWindow.errors
        lossWindow = null // Close expectation before native Reload; recovery errors cannot qualify.
        await persist()
        allowedNavigations = 2
        await Promise.all([page.waitForEvent('load', { timeout: budget(30000) }), page.locator('#syn3h-device-lost').getByRole('button', { name: 'Reload', exact: true }).click()])
        await wait(() => window.syn3h?.shell.playing && syn3h.game.tick > 30 && syn3h.game.performance.drawCalls > 0, null, 60000)
        row.reloaded = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, rendererClass: syn3h.game.renderer.constructor.name, tick: syn3h.game.tick, backend: syn3h.game.backend, live: !syn3h.game.canvas.getContext('webgl2').isContextLost(), staleReferenceAbsent: !('__rendererBeforeLoss' in window) }))
        assert.notEqual(row.reloaded.timeOrigin, row.loss.timeOrigin)
        assert.equal(row.reloaded.staleReferenceAbsent, true); assert.equal(row.reloaded.backend, 'webgl'); assert.equal(row.reloaded.live, true)
        await wait(tick => syn3h.game.tick > tick + 30 && syn3h.game.performance.drawCalls > 0, row.reloaded.tick)
        assert.equal(await page.locator('#syn3h-device-lost').count(), 0)
        assert.equal(row.expectedLossErrors.length, 1)
      }
      await drain(); assert.deepEqual(responseErrors, [])
      await verifyEpoch(choice === 'keep' ? 1 : 2)
      assert.equal(row.epochs.length, choice === 'keep' ? 1 : 2)
      if (row.epochs.length === 2) {
        assert.notEqual(row.epochs[0].identity.token, row.epochs[1].identity.token)
        assert.notEqual(row.epochs[0].identity.timeOrigin, row.epochs[1].identity.timeOrigin)
      }
      row.status = 'passed'; await persist()
    } catch (e) { row.status = 'failed'; row.error = String(e); throw e }
    finally {
      await attempt('restore stimulus', async () => { if (!page.isClosed()) await bounded(page.evaluate(() => { if (window.__recoveryTest && !window.__recoveryTest.restored) { window.__recoveryTest.restore(); window.__recoveryTest.restored = true } })) })
      await attempt('partial case receipt', persist)
      await attempt('context close', () => bounded(context.close(), 5000))
      await attempt('final response drain', drain)
      row.responseErrors = responseErrors
      if (responseErrors.length) report.errors.push({ label: 'response/page errors', errors: responseErrors })
    }
    assert.deepEqual(report.errors, [], 'case cleanup and late errors')
  }
  clean(); report.status = 'passed_pending_closure'
} catch (e) { primary = e; report.status = 'failed'; report.primary = String(e) }
finally {
  if (browser) await attempt('browser close', () => bounded(browser.close(), 5000))
  await attempt('source after', async () => clean())
  for (const row of report.cases) {
    if (row.responseErrors?.length) report.errors.push({ label: 'post-browser late response/page errors', errors: row.responseErrors })
  }
  if (report.errors.length) report.status = 'failed'
  await attempt('final receipt', persist)
}
if (primary || report.errors.length) process.exitCode = 1
