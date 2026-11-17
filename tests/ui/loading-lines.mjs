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
const read = page => page.evaluate(() => { const still = document.querySelector('.boot-still'); return { boot: document.documentElement.dataset.boot, line: document.querySelector('.boot-status').textContent, height: document.querySelector('.boot-status').getBoundingClientRect().height, still: still.getBoundingClientRect().top, second: still.hasAttribute('data-shown') ? still.textContent : '', secondHidden: still.getAttribute('aria-hidden'), phase: document.querySelector('.syn3h-loading .loading-phase')?.textContent ?? null, at: performance.now() } })
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
    await page.waitForFunction(() => document.querySelector('.boot-status'))
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
    for (const s of seconds) { assert.match(s.second, /^[A-Z][^\u00b7]* \u00b7 .+ \u00b7 \d+ s$/, `${view.name}: a plain step, a measure and the seconds (${s.second})`); assert.equal(s.secondHidden, 'true', 'the ticking line is never read aloud') }
    const steps = [...new Set(seconds.map(s => s.second.split(' \u00b7 ')[0]))]
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
    await page.goto(`${base}?room=lines-markup-${Date.now()}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelector('.syn3h-loading'), null, { timeout: 60000 })
    const markup = await page.evaluate(async () => {
      // The exact URL the app loaded, so this is the app's own instance, not a second one.
      const url = performance.getEntriesByType('resource').map(e => e.name).find(name => name.includes('/src/ui/LoadingScreen.ts'))
      const { bootLoading } = await import(url)
      if (document.querySelectorAll('.syn3h-loading').length !== 1) return { instances: document.querySelectorAll('.syn3h-loading').length }
      if (document.documentElement.dataset.boot !== 'loading') return null
      if (bootLoading.done) return null
      // The line changes at once (no fade, no rotation), so it is read in the same task.
      bootLoading.setMessages(['<b>Bold</b> & <img src=x onerror="window.__owned=1">'])
      const status = document.querySelector('.boot-status')
      const result = { text: status.textContent, children: status.children.length, owned: Boolean(window.__owned) }
      bootLoading.setMessages([])
      return result
    })
    if (markup) { assert.equal(markup.instances, undefined); assert.equal(markup.children, 0); assert.equal(markup.owned, false); assert.match(markup.text, /^<b>Bold<\/b>/) }
    report.markup = markup ?? 'veil lifted before the check could run'
    await page.close()
  }
  // The fast path: a warm cache. A load that ends before three seconds never shows the line.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    for (let load = 0; load < 2; load++) {
      const page = await context.newPage()
      await page.addInitScript(() => { window.__shownAt = null; const watch = () => { const w = document.querySelector('.boot-still'); if (w?.hasAttribute('data-shown') && window.__shownAt === null) window.__shownAt = performance.now(); if (document.documentElement?.dataset.boot !== 'done') requestAnimationFrame(watch); else window.__doneAt = performance.now() }; requestAnimationFrame(watch) })
      await page.goto(`${base}?room=lines-warm-${Date.now()}`)
      await page.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 120000 })
      const r = await page.evaluate(() => ({ shownAt: window.__shownAt, doneAt: Math.round(window.__doneAt) }))
      if (load === 1) {
        report.warm = r
        if (r.doneAt < 3000) assert.equal(r.shownAt, null, 'a warm load under three seconds never shows the progress line')
      }
      await page.close()
    }
    await context.close()
  }
  // The longest line on a 320 px phone: two lines at most, and the veil does not move.
  {
    const { loadingMessages, phaseMessages } = await import('../../src/ui/data/loadingMessages.ts').catch(() => ({}))
    const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.route(/\/src\/main\.ts/, () => {})
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
