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
const started = Date.now(), deadline = started + 240000
let phase = 'source and browser', phaseEnd = started + 10000
const budget = cap => {
  const left = Math.floor(Math.min(cap, phaseEnd - Date.now(), deadline - Date.now()))
  assert.ok(left > 0, `budget exhausted: ${phase}`)
  return left
}
function milestone(name, seconds, maxMs = Infinity) {
  budget(Infinity) // A missed preceding milestone cannot be rescued by advancing the phase.
  phase = name; phaseEnd = Math.min(started + seconds * 1000, Date.now() + maxMs, started + 230000)
  report.milestones.push({ phase, elapsedMs: Date.now() - started, endsAtMs: phaseEnd - started })
  budget(Infinity)
}
async function bounded(start, cap = 15000) {
  assert.equal(typeof start, 'function', 'deferred operation required')
  const admitted = budget(cap), end = Date.now() + admitted, admittedPhase = phase
  let timer
  try {
    const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`bounded operation expired: ${admittedPhase}`)), admitted) })
    const result = await Promise.race([Promise.resolve().then(() => {
      assert.ok(Date.now() < end, 'deferred operation admission expired')
      return start()
    }), expired])
    assert.ok(Date.now() <= end, 'operation exceeded admitted deadline')
    return result
  } finally { clearTimeout(timer) }
}
// Each cleanup task receives a separate share; a failed snapshot cannot spend restoration's share.
async function cleanupGroup(label, end, tasks) {
  for (let i = 0; i < tasks.length; i++) {
    const [name, fn] = tasks[i]
    phase = `${label}: ${name}`
    phaseEnd = Math.min(deadline, end, Date.now() + Math.max(0, Math.floor((end - Date.now()) / (tasks.length - i))))
    const receipt = { phase, beganAtMs: Date.now() - started, endsAtMs: phaseEnd - started, status: 'attempting' }
    report.cleanup.push(receipt)
    const errorsBefore = report.errors.length
    await attempt(phase, () => bounded(fn, Infinity))
    receipt.status = report.errors.length === errorsBefore ? 'completed' : 'failed'
    receipt.finishedAtMs = Date.now() - started
  }
}
const hash = b => createHash('sha256').update(b).digest('hex')
function verifyWindows(trace) {
  assert.equal(trace.observationErrorCount, 0)
  assert.equal(trace.transitionOverflow, false)
  assert.equal(trace.exhausted, false)
  assert.ok(trace.eligibleCalls >= 200, 'original minimum retained, not internal eligibility proof')
  assert.ok(trace.delivery && trace.delivery.call === 220, 'fixed ordinary-call boundary observed')
  const counts = trace.delivery.counters
  for (const field of ['judgeFalse', 'hiddenCalls', 'loadingCalls']) assert.equal(counts[field], 0, `delivery ${field}`)
  assert.equal(counts.substituted, 220); assert.equal(counts.eligibleCalls, 220)
  assert.ok(trace.delivery.context.now - trace.installation.now <= 30000, 'delivery within 30 seconds')
  const key = state => `${state.level}:${state.rung}:${state.auto}:${state.targetFps}`
  const initial = trace.installation.performance, stableKey = key(initial)
  assert.equal(initial.level, 3); assert.equal(initial.auto, false)
  assert.notEqual(trace.installation.ignore, '1')
  assert.ok(50 > 1000 / initial.targetFps / .8, 'strict slow threshold')
  const baseline = initial.lastPoint?.timeMs ?? null
  if (baseline !== null) assert.ok(Number.isFinite(baseline))
  const distinct = [], seen = new Map()
  if (baseline !== null) seen.set(baseline, initial.lastPoint)
  let previousCall = 0
  for (const entry of trace.transitions) {
    if (entry.call > 220) break // Later publication cannot repair the fixed boundary.
    assert.ok(Number.isInteger(entry.call) && entry.call >= previousCall)
    previousCall = entry.call
    assert.equal(key(entry.state), stableKey, 'stable public quality key')
    const point = entry.state.lastPoint
    if (!point) { assert.equal(baseline, null); assert.equal(distinct.length, 0); continue }
    assert.ok(Number.isFinite(point.timeMs))
    if (seen.has(point.timeMs)) {
      assert.deepEqual(point, seen.get(point.timeMs), 'conflicting duplicate public point')
      assert.equal(point.timeMs, distinct.at(-1)?.point.timeMs ?? baseline, 'out-of-order repeat')
      continue
    }
    assert.ok(entry.call > 0, 'installation callback is not a new sample')
    assert.ok(baseline === null || point.timeMs > baseline, 'point newer than installation')
    const previous = distinct.at(-1)
    if (previous) {
      assert.equal(entry.call - previous.call, 20, 'no omitted ordinary-call window')
      let expectedTime = previous.point.timeMs
      for (let frame = 0; frame < 20; frame++) expectedTime += 50
      assert.equal(point.timeMs, expectedTime, 'consecutive public windows using policy clock arithmetic')
      assert.equal(entry.state.historyCount, Math.min(120, previous.historyCount + 1), 'no missing publication')
    } else {
      assert.ok(entry.call <= 20, 'first genuinely new publication within one window')
      assert.equal(entry.state.historyCount, Math.min(120, initial.historyCount + 1))
    }
    seen.set(point.timeMs, point)
    distinct.push({ call: entry.call, point, historyCount: entry.state.historyCount, recommendation: entry.state.recommendation })
  }
  assert.equal(distinct.length, 11, 'discard first new point, then require ten complete windows by call 220')
  const [discarded, ...windows] = distinct
  for (const { point } of windows) {
    assert.equal(point.frames, 20)
    for (const field of ['frameMs', 'p50Ms', 'p90Ms', 'p95Ms']) assert.equal(point[field], 50)
  }
  const tenth = windows[9]
  assert.equal(tenth.recommendation?.level, 3)
  assert.equal(tenth.recommendation?.targetLevel, 2)
  assert.equal(key(trace.delivery.context.performance), stableKey)
  assert.deepEqual(trace.delivery.context.performance.lastPoint, tenth.point)
  assert.deepEqual(trace.delivery.context.performance.recommendation, tenth.recommendation)
  return { stableKey, installationTimeMs: baseline, discarded, windows, tenth, boundary: trace.delivery }
}
const sources = ['src/main.ts', 'src/core/Game.ts', 'src/core/quality.ts', 'src/core/performanceHistory.ts', 'src/core/diagnostics.ts', 'src/ui/PerformancePanel.ts']
const report = { source: expected, stimulus: '50ms frame samples substituted on actual ordinary quality.frame calls, maximum 600 calls; not measured FPS', cases: [], errors: [], milestones: [], cleanup: [], status: 'in_progress' }
const persist = () => bounded(() => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)), 3000)
function clean() {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), expected)
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: budget(5000) }).trim(), '')
}
let browser, primary, local, rendererManifest
const contexts = [], finalDrains = []
async function attempt(label, fn) { try { await fn() } catch (e) { report.errors.push({ label, error: String(e) }) } }
try {
  await bounded(() => mkdir(out, { recursive: false }))
  clean()
  local = Object.fromEntries(await bounded(() => Promise.all(sources.map(async p => [p, await bounded(() => readFile(new URL(`../../${p}`, import.meta.url), 'utf8'))]))))
  rendererManifest = JSON.parse(await bounded(() => readFile(process.env.UX_RENDERER_MANIFEST, 'utf8')))
  assert.ok(Array.isArray(rendererManifest.chunks) && rendererManifest.chunks.length > 0)
  assert.ok(rendererManifest.chunks.every(c => typeof c.path === 'string' && c.path.startsWith('/') && /^[0-9a-f]{64}$/.test(c.sha256)))
  assert.equal(new Set(rendererManifest.chunks.map(c => c.path)).size, rendererManifest.chunks.length)
  assert.equal(rendererManifest.chunks.length, 3)
  assert.ok(Array.isArray(rendererManifest.allowedChunks) && rendererManifest.allowedChunks.length >= 3)
  assert.ok(rendererManifest.allowedChunks.every(c => c.path.startsWith(rendererManifest.cachePrefix) && /^[0-9a-f]{64}$/.test(c.sha256)))
  assert.equal(new Set(rendererManifest.allowedChunks.map(c => c.path)).size, rendererManifest.allowedChunks.length)
  for (const c of rendererManifest.chunks) assert.ok(rendererManifest.allowedChunks.some(a => a.path === c.path && a.sha256 === c.sha256))
  assert.match(rendererManifest.browserHash, /^[0-9a-f]{8}$/)
  report.rendererManifestSha256 = hash(await bounded(() => readFile(process.env.UX_RENDERER_MANIFEST)))
  report.sourceHashes = Object.fromEntries(sources.map(p => [p, hash(local[p])]))
  browser = await bounded(() => chromium.launch({ channel: 'chrome', headless: true }), 30000)
  for (const choice of ['keep', 'switch-and-recover']) {
    milestone(`${choice} setup`, choice === 'keep' ? 45 : 140)
    const row = { choice, epochs: [], expectedLossErrors: [] }
    report.cases.push(row)
    const context = await bounded(() => browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }))
    contexts.push(context)
    const page = await bounded(() => context.newPage())
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
    await bounded(() => page.exposeBinding('__recoveryDocumentReady', ({ frame }, identity) => {
      if (frame !== page.mainFrame() || !epoch || epoch.identity) { responseErrors.push('unexpected document identity'); return }
      epoch.identity = identity
    }))
    await bounded(() => page.addInitScript(() => {
      const identity = { token: crypto.randomUUID(), timeOrigin: performance.timeOrigin }
      window.__recoveryDocument = identity
      void window.__recoveryDocumentReady(identity)
    }))
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
      const task = bounded(async () => {
        const url = new URL(response.url())
        if (request.resourceType() !== 'document' && request.resourceType() !== 'script') return
        assert.equal(request.frame(), page.mainFrame(), 'main-frame response only')
        assert.ok(owner, 'request bound to a navigation epoch')
        assert.equal(url.origin, new URL(origin).origin, 'same-origin executed code')
        assert.equal(response.fromServiceWorker(), false)
        assert.equal(request.redirectedFrom(), null)
        assert.ok([200, 304].includes(response.status()))
        const bytes = await bounded(() => response.body()) // Status alone is never evidence.
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
      }).catch(e => responseErrors.push(String(e)))
      pending.push(task)
    })
    async function drain() { for (let i = 0; i < pending.length;) { const end = pending.length; await bounded(() => Promise.all(pending.slice(i, end))); i = end } }
    finalDrains.push({ drain, responseErrors })
    async function verifyEpoch(expectedSequence) {
      await drain()
      assert.equal(epoch.sequence, expectedSequence)
      assert.ok(epoch.committed && epoch.identity && epoch.document)
      assert.deepEqual(await bounded(() => page.evaluate(() => window.__recoveryDocument)), epoch.identity)
      for (const path of sources) assert.ok(epoch.executed[path], `epoch ${expectedSequence} source ${path}`)
      for (const chunk of rendererManifest.chunks) assert.equal(epoch.rendererModules[chunk.path], chunk.sha256)
      assert.deepEqual(responseErrors, [])
    }
    const wait = (fn, arg, ms = 15000) => bounded(() => page.waitForFunction(fn, arg, { timeout: budget(ms) }), ms)
    const state = () => bounded(() => page.evaluate(() => syn3h.game.quality.getQualityState()))
    try {
      const url = new URL(origin)
      url.search = new URLSearchParams({ autoplay: '1', room: `recovery-${randomUUID()}`, webgl: '1', gfx: '3', world: 'alpine.1518~bots.count=0' }).toString()
      await bounded(() => page.goto(url.href), 60000)
      await wait(() => window.syn3h?.shell.playing && syn3h.game.tick > 30 && !syn3h.game.quality.isLoading, null, 60000)
      await bounded(() => page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: budget(30000) }))
      assert.equal(await bounded(() => page.evaluate(() => syn3h.game.backend)), 'webgl')
      await verifyEpoch(1)
      if (await bounded(() => page.evaluate(() => !!document.pointerLockElement))) await bounded(() => page.keyboard.press('Escape'))
      const card = page.locator('.wi-card[data-section=performance]')
      await bounded(() => card.locator('.wi-head').click())
      const select = card.getByRole('combobox', { name: 'Quality level' })
      await bounded(() => select.selectOption('3'))
      const auto = card.locator('.wi-auto input')
      if (await bounded(() => auto.isChecked())) await bounded(() => auto.click())
      await wait(() => syn3h.game.quality.getQualityState().level === 3 && !syn3h.game.quality.getQualityState().auto)
      const particle = card.locator('.wi-row[data-id="lava.particleBudget"]')
      // Open the real details element with its summary, not a private UI mutation.
      if (await bounded(() => particle.evaluate(el => !!el.closest('details') && !el.closest('details').open))) await bounded(() => particle.locator('xpath=ancestor::details[1]').locator('summary').click())
      await bounded(() => particle.locator('.wi-num').click()); await bounded(() => page.keyboard.type('1200')); await bounded(() => page.keyboard.press('Enter'))
      await wait(() => syn3h.game.quality.getQualityState().overrides['lava.particleBudget'] === 1200)
      row.before = await state()
      milestone(`${choice} sample delivery`, choice === 'keep' ? 75 : 170, 30000)
      row.stimulus = await bounded(() => page.evaluate(() => {
        const q = syn3h.game.quality, original = q.frame
        const trace = { calls: 0, eligibleCalls: 0, substituted: 0, exhausted: false, tick: syn3h.game.tick,
          judgeFalse: 0, hiddenCalls: 0, loadingCalls: 0, firstCall: null, lastCall: null, exhaustion: null,
          observationErrors: [], observationErrorCount: 0, transitions: [], transitionOverflow: false }
        const secondary = code => { trace.observationErrorCount++; if (trace.observationErrors.length < 16) trace.observationErrors.push(code) }
        const observe = (code, read) => { try { return read() } catch { secondary(code); return null } }
        const scalar = snapshot => ({ level: snapshot.quality.level, rung: snapshot.quality.rung,
          auto: snapshot.quality.auto, targetFps: snapshot.quality.targetFps,
          historyCount: snapshot.history.length, lastPoint: snapshot.history.at(-1) ? { ...snapshot.history.at(-1) } : null,
          recommendation: snapshot.recommendation ? { ...snapshot.recommendation } : null })
        const context = () => ({ tick: syn3h.game.tick, frames: syn3h.game.frames, now: performance.now(),
          paused: syn3h.game.isPaused, loading: q.isLoading, hidden: document.hidden, visibility: document.visibilityState,
          playing: syn3h.shell.playing, shellClasses: document.querySelector('.syn3h-shell')?.className ?? null,
          ignore: sessionStorage.getItem('syn3h.performance.ignore'), performance: scalar(q.getPerformanceSnapshot()) })
        trace.installation = observe('installation snapshot', context)
        let priorTransition, unsubscribe, installed = false
        function wrapped(metrics, ...args) {
          trace.calls++
          observe('pre-call scalars', () => {
            const hidden = document.hidden, loading = q.isLoading, judge = args[0] !== false
            if (!judge) trace.judgeFalse++
            if (hidden) trace.hiddenCalls++
            if (loading) trace.loadingCalls++
            if (judge && !hidden && !loading) trace.eligibleCalls++
            const point = { call: trace.calls, tick: syn3h.game.tick, frames: syn3h.game.frames, now: performance.now() }
            if (!trace.firstCall) trace.firstCall = point
            trace.lastCall = point
          })
          const use = trace.substituted < 600
          if (use) trace.substituted++
          else {
            trace.exhausted = true
            if (!trace.exhaustion) trace.exhaustion = observe('exhaustion snapshot', () => ({ call: trace.calls, tick: syn3h.game.tick, now: performance.now() }))
          }
          // Observation cannot throw across this boundary. Original forwarding and throws stay intact.
          const result = Reflect.apply(original, this, [use ? { ...metrics, frameMs: 50, fps: 20 } : metrics, ...args])
          if (trace.calls === 220) trace.delivery = observe('fixed delivery boundary', () => ({
            call: trace.calls, context: context(), counters: Object.freeze({
              judgeFalse: trace.judgeFalse, hiddenCalls: trace.hiddenCalls, loadingCalls: trace.loadingCalls,
              substituted: trace.substituted, eligibleCalls: trace.eligibleCalls,
            }),
          }))
          return result
        }
        window.__recoveryTest = { trace,
          snapshot() { trace.final = observe('final snapshot', context); return trace },
          restore() {
            try {
              if (installed) {
                if (q.frame !== wrapped) throw new Error('sample wrapper replaced')
                q.frame = original; installed = false
              }
            }
            finally { if (unsubscribe) unsubscribe() }
          } }
        // Register failure snapshot/restoration before any validation or subscription can fail.
        const initial = trace.installation, quality = initial?.performance
        if (!initial || !quality ||
            ![initial.tick, initial.frames, initial.now, quality.level, quality.rung, quality.targetFps, quality.historyCount].every(Number.isFinite) ||
            (quality.lastPoint !== null && !Number.isFinite(quality.lastPoint?.timeMs)) ||
            initial.playing !== true || initial.paused !== false || initial.hidden !== false ||
            initial.visibility !== 'visible' || initial.loading !== false ||
            quality.level !== 3 || quality.auto !== false || quality.targetFps <= 0 || initial.ignore === '1')
          throw new Error('invalid public stimulus installation state')
        // Published public snapshots only. Never copy history arrays on each frame.
        observe('subscribe performance', () => {
          unsubscribe = q.subscribePerformance(snapshot => observe('public snapshot transition', () => {
            const state = scalar(snapshot), signature = JSON.stringify(state)
            if (signature === priorTransition) return
            priorTransition = signature
            if (trace.transitions.length >= 64) { trace.transitionOverflow = true; return }
            trace.transitions.push({ call: trace.calls, tick: syn3h.game.tick, now: performance.now(), state })
          }))
        })
        if (trace.observationErrorCount) throw new Error('stimulus subscription observation failed')
        q.frame = wrapped; installed = true
        return { maximumCalls: 600, sampleMs: 50, startTick: trace.tick, installation: trace.installation }

      }))
      await wait(() => {
        const t = window.__recoveryTest.trace
        if (t.exhausted || t.observationErrorCount || t.transitionOverflow ||
            t.judgeFalse || t.hiddenCalls || t.loadingCalls) throw new Error('sample evidence failed')
        return !!t.delivery
      }, null, 30000)
      row.delivery = await bounded(() => page.evaluate(() => window.__recoveryTest.snapshot()))
      row.windowProof = verifyWindows(row.delivery)
      row.offer = row.windowProof.tenth.recommendation
      milestone(`${choice} native controls`, choice === 'keep' ? 95 : 180)
      const offer = page.locator('.performance-recommendation')
      row.beforeActionOffer = await bounded(() => page.evaluate(() => syn3h.game.quality.getPerformanceSnapshot().recommendation))
      assert.deepEqual(row.beforeActionOffer, row.offer, 'tenth-window offer still present immediately before native action')
      if (choice === 'keep') {
        await bounded(() => offer.getByRole('button', { name: 'Keep High', exact: true }).click())
        const calls = await bounded(() => page.evaluate(() => window.__recoveryTest.trace.calls))
        await wait(n => window.__recoveryTest.trace.calls >= n + 60 && !window.__recoveryTest.trace.exhausted, calls)
        assert.deepEqual(await state(), row.before)
        assert.equal(await bounded(() => page.evaluate(() => syn3h.game.quality.getPerformanceSnapshot().recommendation)), null)
        assert.equal(await bounded(() => page.evaluate(() => sessionStorage.getItem('syn3h.performance.ignore'))), '1')
      } else {
        await bounded(() => offer.getByRole('button', { name: 'Switch to Medium', exact: true }).click())
        await wait(() => syn3h.game.quality.getQualityState().level === 2)
        const after = await state()
        assert.equal(after.auto, false); assert.equal(after.pinned, true); assert.deepEqual(after.overrides, {})
        assert.equal(await bounded(() => page.evaluate(() => syn3h.params.get('lava.particleBudget').value)), 960)
      }
      row.after = await state()
      row.samples = await bounded(() => page.evaluate(() => window.__recoveryTest.snapshot()))
      await persist()
      await bounded(() => page.evaluate(() => { const t = window.__recoveryTest; t.restore(); t.restored = true }))
      assert.ok(row.samples.eligibleCalls >= 200); assert.equal(row.samples.exhausted, false)
      if (choice === 'switch-and-recover') {
        milestone('real context loss', 195)
        await drain(); assert.deepEqual(responseErrors, [])
        lossWindow = { epoch: epoch.sequence, errors: [] }
        row.loss = await bounded(() => page.evaluate(() => {
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
        }))
        await bounded(() => page.locator('#syn3h-device-lost').waitFor({ state: 'visible', timeout: budget(15000) }))
        row.lossEvent = await bounded(() => page.evaluate(() => window.__contextLossEvent))
        assert.equal(row.lossEvent?.trusted, true); assert.equal(row.lossEvent.lost, true)
        assert.match(await bounded(() => page.locator('#syn3h-device-lost').innerText()), /WebGL context was lost/)
        await drain()
        // Pinned Three build: three.webgpu.js:23861 includes THREE.; three.core.js:2037 prefixes it again.
        const expectedLoss = `THREE.THREE.WebGPURenderer: WebGL Device Lost:\n\nMessage: ${row.lossEvent.statusMessage || 'Unknown reason'}` + (row.lossEvent.reason ? `\nReason: ${row.lossEvent.reason}` : '')
        assert.equal(lossWindow.errors.length, 1)
        assert.equal(lossWindow.errors[0].text, expectedLoss)
        row.expectedLossErrors = lossWindow.errors
        lossWindow = null // Close expectation before native Reload; recovery errors cannot qualify.
        await persist()
        milestone('native Reload and working renderer', 225)
        allowedNavigations = 2
        await bounded(() => Promise.all([page.waitForEvent('load', { timeout: budget(30000) }), page.locator('#syn3h-device-lost').getByRole('button', { name: 'Reload', exact: true }).click()]), 30000)
        await wait(() => window.syn3h?.shell.playing && syn3h.game.tick > 30 && syn3h.game.performance.drawCalls > 0, null, 60000)
        row.reloaded = await bounded(() => page.evaluate(() => ({ timeOrigin: performance.timeOrigin, rendererClass: syn3h.game.renderer.constructor.name, tick: syn3h.game.tick, backend: syn3h.game.backend, live: !syn3h.game.canvas.getContext('webgl2').isContextLost(), staleReferenceAbsent: !('__rendererBeforeLoss' in window) })))
        assert.notEqual(row.reloaded.timeOrigin, row.loss.timeOrigin)
        assert.equal(row.reloaded.staleReferenceAbsent, true); assert.equal(row.reloaded.backend, 'webgl'); assert.equal(row.reloaded.live, true)
        await wait(tick => syn3h.game.tick > tick + 30 && syn3h.game.performance.drawCalls > 0, row.reloaded.tick)
        assert.equal(await bounded(() => page.locator('#syn3h-device-lost').count()), 0)
        assert.equal(row.expectedLossErrors.length, 1)
      }
      milestone(`${choice} final proof`, choice === 'keep' ? 105 : 230)
      await drain(); assert.deepEqual(responseErrors, [])
      await verifyEpoch(choice === 'keep' ? 1 : 2)
      assert.equal(row.epochs.length, choice === 'keep' ? 1 : 2)
      if (row.epochs.length === 2) {
        assert.notEqual(row.epochs[0].identity.token, row.epochs[1].identity.token)
        assert.notEqual(row.epochs[0].identity.timeOrigin, row.epochs[1].identity.timeOrigin)
      }
      row.status = 'passed'; await persist()
    } catch (e) { row.status = 'failed'; row.error = String(e); primary ??= e; report.primary ??= String(e); throw e }
    finally {
      const cleanupEnd = Math.min(deadline - 5000, choice === 'keep' ? started + 105000 : started + 235000,
        Date.now() + 5000)
      await cleanupGroup(`${choice} cleanup`, cleanupEnd, [
        ['final stimulus snapshot', async () => {
          if (!page.isClosed()) {
            const samples = await bounded(() => page.evaluate(() => {
              const t = window.__recoveryTest
              return t && !t.restored ? t.snapshot() : null
            }))
            if (samples) row.samples = samples
            if (row.samples?.observationErrorCount || row.samples?.transitionOverflow)
              report.errors.push({ label: 'secondary stimulus observations', count: row.samples.observationErrorCount,
                codes: row.samples.observationErrors, transitionOverflow: row.samples.transitionOverflow })
          }
        }],
        ['pre-restore case receipt', persist],
        ['restore stimulus', async () => {
          if (!page.isClosed()) await bounded(() => page.evaluate(() => {
            if (window.__recoveryTest && !window.__recoveryTest.restored) {
              window.__recoveryTest.restore(); window.__recoveryTest.restored = true
            }
          }))
        }],
        ['partial case receipt', persist],
        ['context close', () => bounded(() => context.close(), 5000)],
        ['final response drain', drain],
      ])
      row.responseErrors = responseErrors
      if (responseErrors.length) report.errors.push({ label: 'response/page errors', errors: responseErrors })
    }
    assert.deepEqual(report.errors, [], 'case cleanup and late errors')
    phaseEnd = choice === 'keep' ? started + 105000 : started + 230000
  }
  report.status = 'passed_pending_closure'
} catch (e) { primary ??= e; report.status = 'failed'; report.primary ??= String(e) }
finally {
  await cleanupGroup('final cleanup', Math.min(deadline, Date.now() + 10000), [
    ...contexts.map((context, i) => [`context ${i} final close`, () => context.close()]),
    ['browser close', async () => { if (browser) await bounded(() => browser.close(), 5000) }],
    ['source after', async () => clean()],
    ...finalDrains.map(({ drain }, i) => [`post-browser drain ${i}`, drain]),
    ['final verdict and receipt', async () => {
      for (const { responseErrors } of finalDrains) {
        if (responseErrors.length) report.errors.push({ label: 'post-browser late response/page errors', errors: responseErrors })
      }
      report.status = primary || report.errors.length ? 'failed' : 'passed'
      await persist()
    }],
  ])
}
if (primary || report.errors.length) process.exitCode = 1
