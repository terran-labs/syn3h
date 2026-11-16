/**
 * The loading veil's fun lines, seen over a slow link: a line from the first paint, new lines
 * as the phases pass, the plain phase in the live region, a host's markup shown as text, and
 * the longest line on a 320 px phone in two lines at most. Screenshots go to the artifacts
 * folder; look at them.
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
const read = page => page.evaluate(() => ({ boot: document.documentElement.dataset.boot, line: document.querySelector('.boot-status').textContent, height: document.querySelector('.boot-status').getBoundingClientRect().height, still: document.querySelector('.boot-still').getBoundingClientRect().top, phase: document.querySelector('.syn3h-loading .loading-phase')?.textContent ?? null }))
try {
  for (const view of [{ name: 'desktop', options: { viewport: { width: 1280, height: 720 } } }, { name: 'iphone14', options: { ...devices['iPhone 14'], defaultBrowserType: undefined } }]) {
    const context = await browser.newContext(view.options), page = await context.newPage(), cdp = await context.newCDPSession(page)
    page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`))
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 8_000_000 / 8, uploadThroughput: 500_000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    // Physics arrives late, as on a slow phone, so the veil waits in a phase long enough to read.
    await page.route(/\.wasm(\?|$)/, async route => { await new Promise(r => setTimeout(r, 7000)); await route.continue() })
    await page.goto(`${base}?room=lines-${view.name}-${Date.now()}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelector('.boot-status'))
    const samples = []; let shot = 0, last = '', layout = new Set()
    const started = Date.now()
    while (Date.now() - started < 90000) {
      const now = await read(page)
      if (now.boot === 'done') break
      samples.push(now); layout.add(`${Math.round(now.height)}:${Math.round(now.still)}`)
      if (now.line !== last && shot < 5 && !(await page.evaluate(() => 'fade' in document.querySelector('.boot-status').dataset))) {
        await page.screenshot({ path: `${out}/${view.name}-${shot++}.png` }); last = now.line
      }
      await page.waitForTimeout(250)
    }
    // Custom lines from a host are text, never markup (only while the veil is still up).
    const lines = [...new Set(samples.map(s => s.line))], phases = [...new Set(samples.map(s => s.phase).filter(Boolean))]
    for (let i = 1; i < samples.length; i++) if (samples[i].line !== samples[i - 1].line) assert.notEqual(samples[i].line, samples[i - 1].line)
    assert.ok(lines.length >= 3, `${view.name}: lines rotate (${lines.length})`)
    assert.ok(!lines.some(line => /Loading the engine|Checking your device|Preparing/.test(line)), `${view.name}: no plain phase labels on the veil`)
    assert.equal(layout.size, 1, `${view.name}: the status line never moves the veil (${[...layout]})`)
    report[view.name] = { seconds: (Date.now() - started) / 1000, lines, phases, screenshots: shot }
    await context.close()
  }
  // A host's markup is shown as text. Hold the game in its world phase so the veil stays up.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.route(/\/src\/world\//, async route => { await new Promise(r => setTimeout(r, 6000)); await route.continue() })
    await page.goto(`${base}?room=lines-markup-${Date.now()}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelector('.syn3h-loading'), null, { timeout: 60000 })
    const markup = await page.evaluate(async () => {
      // The exact URL the app loaded, so this is the app's own instance, not a second one.
      const url = performance.getEntriesByType('resource').map(e => e.name).find(name => name.includes('/src/ui/LoadingScreen.ts'))
      const { bootLoading } = await import(url)
      if (document.querySelectorAll('.syn3h-loading').length !== 1) return { instances: document.querySelectorAll('.syn3h-loading').length }
      if (document.documentElement.dataset.boot !== 'loading') return null
      bootLoading.setMessages(['<b>Bold</b> & <img src=x onerror="window.__owned=1">'])
      await new Promise(r => setTimeout(r, 400))
      const status = document.querySelector('.boot-status')
      const result = { text: status.textContent, children: status.children.length, owned: Boolean(window.__owned) }
      bootLoading.setMessages([])
      return result
    })
    if (markup) { assert.equal(markup.instances, undefined); assert.equal(markup.children, 0); assert.equal(markup.owned, false); assert.match(markup.text, /^<b>Bold<\/b>/) }
    report.markup = markup ?? 'veil lifted before the check could run'
    await page.close()
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
