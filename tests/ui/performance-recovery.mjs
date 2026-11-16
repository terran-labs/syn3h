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
assert.ok(origin && expected && out && process.env.UX_DOCUMENT_SHA256 && process.env.UX_RENDERER_MODULE_PATH && process.env.UX_RENDERER_MODULE_SHA256)
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
report.sourceHashes = Object.fromEntries(sources.map(p => [p, hash(local[p])]))
let browser, primary
async function attempt(label, fn) { try { await fn() } catch (e) { report.errors.push({ label, error: String(e) }) } }
try {
  browser = await bounded(chromium.launch({ channel: 'chrome', headless: true }), 30000)
  for (const choice of ['keep', 'switch-and-recover']) {
    const row = { choice, rendererModules: [], executed: {}, documents: [], console: [], expectedLossErrors: [], lost: false }
    report.cases.push(row)
    const context = await bounded(browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }))
    const page = await bounded(context.newPage())
    page.setDefaultTimeout(15000)
    const pending = [], responseErrors = []
    page.on('pageerror', e => responseErrors.push(`pageerror: ${String(e)}`))
    page.on('console', message => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (row.lost && text.startsWith('THREE.WebGPURenderer: WebGL Device Lost:')) row.expectedLossErrors.push(text)
      else responseErrors.push(`console: ${text}`)
    })
    page.on('response', response => {
      const task = (async () => {
        const request = response.request(), url = new URL(response.url())
        if (request.resourceType() !== 'document' && request.resourceType() !== 'script') return
        assert.equal(url.origin, new URL(origin).origin, 'same-origin executed code')
        assert.equal(response.fromServiceWorker(), false)
        assert.equal(request.redirectedFrom(), null)
        assert.ok([200, 304].includes(response.status()))
        const bytes = await bounded(response.body()) // 304 alone never passes; exact body proof still required.
        if (request.resourceType() === 'document') {
          assert.equal(hash(bytes), process.env.UX_DOCUMENT_SHA256)
          row.documents.push({ url: response.url(), sha256: hash(bytes), status: response.status() })
        }
        if (url.pathname === process.env.UX_RENDERER_MODULE_PATH) {
          assert.equal(hash(bytes), process.env.UX_RENDERER_MODULE_SHA256)
          row.rendererModules.push({ path: url.pathname, sha256: hash(bytes) })
        }
        const path = url.pathname.slice(1)
        if (sources.includes(path)) {
          const match = bytes.toString().match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)
          assert.ok(match, `executed source map ${path}`)
          const map = JSON.parse(Buffer.from(match[1], 'base64').toString())
          assert.ok(map.sourcesContent?.includes(local[path]), `executed source bytes ${path}`)
          row.executed[path] = hash(bytes)
        }
      })().catch(e => responseErrors.push(String(e)))
      pending.push(task)
    })
    async function drain() { for (let i = 0; i < pending.length;) { const end = pending.length; await bounded(Promise.all(pending.slice(i, end))); i = end } }
    const wait = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: budget(ms) })
    const state = () => page.evaluate(() => syn3h.game.quality.getQualityState())
    try {
      const url = new URL(origin)
      url.search = new URLSearchParams({ autoplay: '1', room: `recovery-${randomUUID()}`, webgl: '1', gfx: '3', world: 'alpine.1518~bots.count=0' }).toString()
      await bounded(page.goto(url.href), 60000)
      await wait(() => window.syn3h?.shell.playing && syn3h.game.tick > 30 && !syn3h.game.quality.isLoading, null, 60000)
      await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: budget(30000) })
      assert.equal(await page.evaluate(() => syn3h.game.backend), 'webgl')
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
        row.lost = true
        row.loss = await page.evaluate(() => {
          const g = syn3h.game, gl = g.canvas.getContext('webgl2')
          if (!gl || gl.isContextLost()) throw new Error('live WebGL2 context required')
          const ext = gl.getExtension('WEBGL_lose_context')
          if (!ext) throw new Error('WEBGL_lose_context unavailable')
          const identity = { timeOrigin: performance.timeOrigin, rendererClass: g.renderer.constructor.name, tick: g.tick, backend: g.backend }
          window.__rendererBeforeLoss = g.renderer
          window.__contextLossEvent = null
          g.canvas.addEventListener('webglcontextlost', e => { window.__contextLossEvent = { trusted: e.isTrusted, lost: gl.isContextLost(), time: performance.now() } }, { once: true })
          ext.loseContext()
          return identity
        })
        await page.locator('#syn3h-device-lost').waitFor({ state: 'visible', timeout: budget(15000) })
        row.lossEvent = await page.evaluate(() => window.__contextLossEvent)
        assert.equal(row.lossEvent?.trusted, true); assert.equal(row.lossEvent.lost, true)
        assert.match(await page.locator('#syn3h-device-lost').innerText(), /WebGL context was lost/)
        await persist()
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
      assert.ok(row.rendererModules.length >= (choice === 'keep' ? 1 : 2), 'actual pinned renderer module per document')
      assert.ok(row.documents.length >= (choice === 'keep' ? 1 : 2))
      for (const path of sources) assert.ok(row.executed[path], `executed ${path}`)
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
  if (report.errors.length) report.status = 'failed'
  await attempt('final receipt', persist)
}
if (primary || report.errors.length) process.exitCode = 1
