// Diagnostic only. Run exclusively through deadline.py after slot allocation.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
const require = createRequire('/Users/vtn/dev/Syn3h/package.json')
const { chromium } = require('playwright-core')
const out = resolve(process.argv[2])
const phases = process.argv.includes('--phases')
const frozen = '/Users/vtn/dev/Syn3h-stable/20261115-185356-214c3c96/dist'
const commit = '214c3c9672b91571ea370fd80b13c85f1fcb4b6d'
const version = '26.11.1518'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
await mkdir(out, { recursive: true })
const save = (name, data) => writeFile(join(out, name), JSON.stringify(data, null, 2))
const localBuild = JSON.parse(await readFile(join(frozen, 'build.json')))
assert.equal(localBuild.commit, commit)
const manifest = { commit, version, phases, frozen, node: process.version, started: new Date().toISOString(), cases: [], status: 'incomplete', limitations: ['Frozen client, current production room backend.', 'Cold means fresh browser context; OS, driver and CDN caches are not reset.', 'Warm means repeated recipe in one page; normal UI chooses a new seed.', 'CPU samples and renderer counters are not GPU timings.'] }
manifest.sourceMap = { path: 'assets/index-Bb0aBZfo.js.map', sha256: sha(await readFile(join(frozen, 'assets/index-Bb0aBZfo.js.map'))), bundleSha256: sha(await readFile(join(frozen, 'assets/index-Bb0aBZfo.js'))) }
let browser, page, cdp
const pending = new Set(), failures = [], resources = []
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
  manifest.browser = browser.version()
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', e => failures.push({ type: 'pageerror', message: e.message }))
  page.on('console', m => { if (/terrain regenerated/.test(m.text())) failures.push({ type: 'terrain-console', message: m.text() }) })
  // Hash the actual decoded response bytes, not just URLs or self-reported metadata.
  page.on('response', response => {
    const u = new URL(response.url())
    if (u.origin !== 'https://www.syn3h.com' || !/\.(?:js|wasm|css)$/.test(u.pathname)) return
    const p = (async () => {
      const relative = u.pathname.replace(/^\/v\/26\.11\.1518\//, '').replace(/^\//, '')
      assert(!relative.includes('..'))
      const expected = await readFile(join(frozen, relative))
      const actual = await response.body()
      const row = { path: relative, status: response.status(), bytes: actual.length, sha256: sha(actual), expectedSha256: sha(expected) }
      resources.push(row)
      assert.equal(row.sha256, row.expectedSha256, `frozen resource mismatch: ${relative}`)
    })().catch(e => { failures.push({ type: 'provenance', message: String(e) }) })
    pending.add(p); p.finally(() => pending.delete(p))
  })
  cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  await page.addInitScript(() => {
    window.__entryDiag = { frames: [], long: [], events: [], spans: [], errors: [], recording: false }
    const d = window.__entryDiag
    for (const type of ['longtask', 'long-animation-frame']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
      new PerformanceObserver(list => { if (d.recording) for (const e of list.getEntries()) if (d.long.length < 4000) d.long.push(e.toJSON()) }).observe({ type, buffered: true })
    }
    for (const type of ['visibilitychange', 'pagehide', 'pageshow']) addEventListener(type, () => d.events.push({ type, at: performance.now(), hidden: document.hidden }))
    const tick = at => {
      const s = window.syn3h
      if (d.recording && s && d.frames.length < 12000) d.frames.push({ raf: at, observed: performance.now(), last: s.game.last, frame: s.game.frames, tick: s.game.tick, metrics: { ...s.game.performance }, hidden: document.hidden, descending: s.shell.dropping, playing: s.shell.playing, terrainVersion: s.terrain.version, seed: s.terrain.seed, backend: s.game.backend, level: s.params.get('gfx.quality')?.value })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const response = await page.goto(`https://www.syn3h.com/?v=${version}&room=entry-diag-${Date.now()}`, { waitUntil: 'load', timeout: 45000 })
  assert.equal(response.headers()['x-syn3h-version'], version)
  assert.equal(sha(await response.body()), sha(await readFile(join(frozen, 'index.html'))), 'document bytes differ')
  await page.waitForFunction(() => window.syn3h && document.documentElement.dataset.boot === 'done' && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 60000 })
  await Promise.all([...pending])
  assert(!failures.some(x => x.type === 'provenance'), 'resource preflight failed')
  assert(resources.some(x => x.path === 'assets/index-Bb0aBZfo.js'), 'expected main bundle absent')
  manifest.initial = await page.evaluate(() => ({ backend: syn3h.game.backend, planet: syn3h.planets.currentPlanet().id, seed: syn3h.terrain.seed, settings: syn3h.params.snapshot?.() ?? null }))
  if (phases) await page.evaluate(() => {
    const s = window.syn3h, d = window.__entryDiag, t = s.terrain
    const wrap = (o, key, label) => {
      if (!o || typeof o[key] !== 'function') throw Error(`missing phase hook ${label}`)
      const original = o[key]
      o[key] = function (...args) {
        const start = performance.now()
        try { return original.apply(this, args) }
        finally { if (d.recording && d.spans.length < 8000) d.spans.push({ label, start, end: performance.now(), seed: t.seed, terrainVersion: t.version }) }
      }
    }
    // Synchronous boundaries only. Never substitute generation, physics or rendering.
    for (const name of ['regenerate', 'generate', 'lightLake']) wrap(t, name, `terrain.${name}`)
    wrap(t.meshes, 'update', 'meshes.update')
    for (const name of ['volcanics', 'trees', 'cover']) wrap(t[name], 'rebuild', `${name}.rebuild`)
    wrap(s.game.world, 'removeCollider', 'physics.removeCollider')
    wrap(s.game.world, 'createCollider', 'physics.createCollider')
    let i = 0
    for (const listener of [...t.listeners]) {
      const label = `regeneration.listener.${i++}`
      const holder = { run: listener }; wrap(holder, 'run', label)
      t.listeners.delete(listener); t.listeners.add(holder.run)
    }
  })
  // Actual UI actions preserve normal recipe, room, animation and regeneration paths.
  const startPlanet = manifest.initial.planet
  const first = startPlanet === 'alpine' ? 'volcanic' : 'alpine'
  const second = first === 'alpine' ? 'volcanic' : 'alpine'
  for (const [label, planet] of [['cold-entry', first], ['world-switch', second], ['warm-recipe-return', first]]) {
    if (manifest.cases.length) await page.evaluate(() => syn3h.shell.openMenu('index'))
    await page.waitForFunction(() => document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 20000 })
    await page.waitForFunction(() => syn3h.shell.graphics.planetMaps >= syn3h.planets.PLANETS.length, null, { timeout: 30000 })
    await page.evaluate(() => { const d = __entryDiag; d.frames = []; d.spans = []; d.long = []; d.events = []; d.recording = true; d.tapAt = performance.now() })
    await cdp.send('Profiler.start')
    const before = await page.evaluate(() => ({ version: syn3h.terrain.version, seed: syn3h.terrain.seed, planet: syn3h.planets.currentPlanet().id }))
    await page.locator(`.galaxy-label[data-world="${planet}"]`).dispatchEvent('click')
    await page.waitForFunction(v => syn3h.terrain.version > v && syn3h.shell.playing && !syn3h.shell.dropping, before.version, { timeout: 45000 })
    await page.evaluate(() => { __entryDiag.landedAt = performance.now() })
    await page.waitForTimeout(5000)
    const trace = await page.evaluate(() => { __entryDiag.recording = false; return { ...__entryDiag, generationPasses: syn3h.terrain.data.timings, final: { seed: syn3h.terrain.seed, version: syn3h.terrain.version, planet: syn3h.planets.currentPlanet().id } } })
    const { profile } = await cdp.send('Profiler.stop')
    await save(`${label}.cpuprofile`, profile)
    await save(`${label}.json`, { label, planet, before, ...trace })
    await page.screenshot({ path: join(out, `${label}.png`), timeout: 10000 })
    manifest.cases.push({ label, planet, frames: trace.frames.length, totalEntryMs: trace.landedAt - trace.tapAt, spans: trace.spans.length })
    await save('report.json', manifest)
  }
  await Promise.all([...pending])
  assert(!failures.some(x => x.type === 'provenance' || x.type === 'pageerror'), 'browser/provenance errors')
  manifest.status = 'captured-not-analyzed'
} catch (e) {
  manifest.status = 'failed'; manifest.error = String(e); process.exitCode = 1
} finally {
  // A watchdog outside this process handles an unresponsive browser or CDP command.
  if (page) await page.evaluate(() => { if (window.__entryDiag) window.__entryDiag.recording = false }).catch(() => {})
  if (browser) await browser.close().catch(e => { manifest.cleanupError = String(e) })
  await save('resources.json', resources)
  await save('events.json', failures)
  manifest.finished = new Date().toISOString()
  await save('report.json', manifest)
}
