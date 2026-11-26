/**
 * The loading veil over a slow link: one fun line from the first paint, kept until loading
 * ends; after three seconds a quiet progress line naming the real step with a measure that moves, never
 * read aloud as it ticks; the plain step in the live region; a host's markup shown as text;
 * and the longest line on a 320 px phone in two lines at most. Screenshots go to the
 * artifacts folder; look at them.
 *
 *   tools/heavy.sh node tests/ui/loading-lines.mjs http://127.0.0.1:5291/
 */
import { chromium, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base = process.argv[2] ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/loading-lines'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = [], report = {}
const read = page => page.evaluate(() => { const still = document.querySelector('.boot-still'); return { boot: document.documentElement.dataset.boot, line: document.querySelector('.boot-status').textContent, height: document.querySelector('.boot-status').getBoundingClientRect().height, still: still.getBoundingClientRect().top, second: document.documentElement.hasAttribute('data-boot-late') ? (still.dataset.numbers || still.textContent) : '', funShown: +getComputedStyle(document.querySelector('.boot-status')).opacity > 0.05, secondHidden: still.getAttribute('aria-hidden'), phase: document.querySelector('.mira-loading .loading-phase')?.textContent ?? null, at: performance.now() } })
try {
  for (const view of [{ name: 'desktop', options: { viewport: { width: 1280, height: 720 } } }, { name: 'iphone14', options: { ...devices['iPhone 14'], defaultBrowserType: undefined } }]) {
    const context = await browser.newContext(view.options), page = await context.newPage(), cdp = await context.newCDPSession(page)
    page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`))
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 8_000_000 / 8, uploadThroughput: 500_000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    // Physics arrives late, as on a slow phone, so loading passes several seconds.
    await page.route(/\.wasm(\?|$)/, async route => { await new Promise(r => setTimeout(r, 14000)); await route.continue() })
    await page.goto(`${base}?room=lines-${view.name}-${Date.now()}`, { waitUntil: 'commit' })
    // From when the veil's own script has run (the canvas after it is parsed): on a slow link the
    // document arrives in pieces, and before that script the status line holds its no-script
    // default, which is never seen (the line is transparent for the first three seconds).
    await page.waitForFunction(() => document.querySelector('.boot-status') && document.getElementById('game'))
    const samples = []; let shot = 0, last = '', layout = new Set()
    const started = Date.now()
    while (Date.now() - started < 90000) {
      const now = await read(page)
      if (now.boot === 'done') break
      samples.push(now); layout.add(`${Math.round(now.height)}:${Math.round(now.still)}`)
      if (now.second !== last && shot < 5) { await page.screenshot({ path: `${out}/${view.name}-${shot++}.png` }); last = now.second }
      await page.waitForTimeout(250)
    }
    // Custom lines from a host are text, never markup (only while the veil is still up).
    const lines = [...new Set(samples.map(s => s.line))], phases = [...new Set(samples.map(s => s.phase).filter(Boolean))]
    assert.equal(lines.length, 1, `${view.name}: one line for the whole load (${lines})`)
    const seconds = samples.filter(s => s.second)
    assert.ok(seconds.length > 0, `${view.name}: the progress line appears on a load past three seconds`)
    assert.ok(samples.filter(s => s.at < 2900).every(s => !s.second), `${view.name}: and not before three seconds into the visit`)
    // The fun line comes with it, never before: nothing but the point of light for the first three seconds.
    assert.ok(samples.filter(s => s.at < 2900).every(s => !s.funShown), `${view.name}: no fun line before three seconds`)
    for (const s of seconds) { assert.match(s.second, /^\d+ s \u00b7 \d+\.\d MB$/, `${view.name}: the seconds and the megabytes, nothing else (${s.second})`); assert.equal(s.secondHidden, 'true', 'the ticking line is never read aloud') }
    // The megabytes never go down.
    const mbs = seconds.map(s => Number(s.second.split(' \u00b7 ')[1].replace(' MB', '')))
    for (let i = 1; i < mbs.length; i++) assert.ok(mbs[i] >= mbs[i - 1], `${view.name}: the megabytes never go down`)
    const steps = [...new Set(mbs)]
    // Something on it moves: the seconds tick (and the step, as phases pass).
    assert.ok(new Set(seconds.map(s => s.second)).size > 1, `${view.name}: the line moves`)
    assert.ok(!lines.some(line => /Loading the engine|Checking your device|Preparing/.test(line)), `${view.name}: no plain phase labels on the veil`)
    assert.equal(layout.size, 1, `${view.name}: the status line never moves the veil (${[...layout]})`)
    report[view.name] = { seconds: (Date.now() - started) / 1000, lines, steps, phases, screenshots: shot }
    await context.close()
  }
  // A host's markup is shown as text. Hold the game in its world phase so the veil stays up.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), cdp = await page.context().newCDPSession(page)
    // Throttled as the views above are, so the veil is certainly still up when the check runs.
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 8_000_000 / 8, uploadThroughput: 500_000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.route(/\.wasm(\?|$)/, async route => { await new Promise(r => setTimeout(r, 14000)); await route.continue() })
    // The dev server loads hundreds of modules: past the default 250 resource entries the
    // LoadingScreen module's own entry, which the check finds it by, may not be recorded.
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
    await page.goto(`${base}?room=lines-markup-${Date.now()}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelector('.mira-loading'), null, { timeout: 60000 })
    const markup = await page.evaluate(async () => {
      // The exact URL the app loaded, so this is the app's own instance, not a second one.
      const url = performance.getEntriesByType('resource').map(e => e.name).find(name => name.includes('/src/ui/LoadingScreen.ts'))
      // Only the dev server serves the module on its own; a production build has no handle on it.
      if (!url) return { skipped: 'production build: run against the dev server for this case' }
      const { bootLoading } = await import(url)
      if (document.querySelectorAll('.mira-loading').length !== 1) return { instances: document.querySelectorAll('.mira-loading').length }
      if (document.documentElement.dataset.boot !== 'loading') return null
      if (bootLoading.done) return null
      // The line changes at once (no fade, no rotation), so it is read in the same task.
      bootLoading.setMessages(['<b>Bold</b> & <img src=x onerror="window.__owned=1">'])
      const status = document.querySelector('.boot-status')
      const result = { text: status.textContent, children: status.children.length, owned: Boolean(window.__owned) }
      bootLoading.setMessages([])
      return result
    })
    if (markup && !markup.skipped) { assert.equal(markup.instances, undefined); assert.equal(markup.children, 0); assert.equal(markup.owned, false); assert.match(markup.text, /^<b>Bold<\/b>/) }
    report.markup = markup ?? 'veil lifted before the check could run'
    await page.close()
  }
  // The fast path: a warm cache, on a desktop and on a phone at 4x CPU. The rule for the loading
  // lines (index.html, LoadingScreen LATE_MIN_MS): they appear three seconds into a load only
  // while the veil is up and loading, and once shown the veil stays at least 800 ms, so they
  // never flash (a line appearing as the lift began would break the 800 ms too). A load that ends before three seconds never shows them.
  for (const [name, view, cpu] of [['desktop', { viewport: { width: 1280, height: 720 } }, 1], ['phone 4x CPU', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, 4]]) {
    const context = await browser.newContext(view)
    for (let load = 0; load < 2; load++) {
      const page = await context.newPage()
      if (cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu })
      await page.addInitScript(() => {
        window.__shownAt = null; window.__readyAt = null
        addEventListener('mira:loading', e => { if (e.detail.phase === 'ready' && window.__readyAt === null) window.__readyAt = performance.now() })
        new MutationObserver(() => {
          const root = document.documentElement
          if (root.hasAttribute('data-boot-late') && window.__shownAt === null) window.__shownAt = performance.now()
          if (root.dataset.boot === 'done' && window.__doneAt === undefined) window.__doneAt = performance.now()
        }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-boot-late', 'data-boot'] })
      })
      await page.goto(`${base}?room=lines-warm-${Date.now()}`)
      await page.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
      const r = await page.evaluate(() => ({ shownAt: window.__shownAt && Math.round(window.__shownAt), readyAt: window.__readyAt && Math.round(window.__readyAt), doneAt: Math.round(window.__doneAt) }))
      if (load === 1) {
        report[`warm ${name}`] = r
        if (r.doneAt < 3000) assert.equal(r.shownAt, null, `${name}: a warm load under three seconds never shows the lines`)
        if (r.shownAt !== null) {
          // shownAt >= 3000 and the hold; readyAt is reported only: the lobby can lift the veil before the game's first frame.
          assert.ok(r.shownAt >= 3000, `${name}: the lines never appear before three seconds (${r.shownAt})`)
          assert.ok(r.doneAt - r.shownAt >= 800, `${name}: once shown, the lines stay at least 800 ms (${JSON.stringify(r)})`)
        }
      }
      await page.close()
    }
    await context.close()
  }
  // The longest line on a 320 px phone: two lines at most, and the veil does not move.
  {
    const { loadingMessages, phaseMessages } = await import('../../src/ui/data/loadingMessages.ts').catch(() => ({}))
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.route(/\/(src\/main\.ts|assets\/index-[\w-]+\.js)(\?|$)/, () => {})
    await page.goto(`${base}?room=lines-narrow-${Date.now()}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelector('.boot-status'))
    await page.waitForTimeout(1500)
    const all = loadingMessages ? [...loadingMessages, ...Object.values(phaseMessages).flat()] : null
    const fit = await page.evaluate(lines => {
      const status = document.querySelector('.boot-status'), lineHeight = parseFloat(getComputedStyle(status).lineHeight)
      const reserved = status.getBoundingClientRect().height
      let worst = { line: '', rows: 0 }
      for (const line of lines ?? [status.textContent]) { status.textContent = line; const rows = Math.round(status.scrollHeight / lineHeight); if (rows > worst.rows || (rows === worst.rows && line.length > worst.line.length)) worst = { line, rows } }
      status.textContent = worst.line
      return { ...worst, reserved, after: status.getBoundingClientRect().height }
    }, all)
    assert.ok(fit.rows <= 2, `320 px: "${fit.line}" wraps to ${fit.rows} lines`)
    assert.equal(fit.after, fit.reserved)
    await page.screenshot({ path: `${out}/narrow-320-longest.png` })
    report.narrow = fit
    await page.close()
  }
  console.log(JSON.stringify({ ok: true, report, errors }, null, 1))
} finally { await browser.close() }
if (errors.length) process.exitCode = 1
