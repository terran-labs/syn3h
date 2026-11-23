// The loading view's progress line on slow links, for review: Slow 4G and Fast 3G with a 4x
// CPU throttle, at 1 s, 3.5 s, 6 s and 12 s, desktop and phone; and a warm load, where it must
// never appear. Best against a production build (npm run build; vite preview).
//   tools/heavy.sh node tests/ui/loading-progress.mjs http://127.0.0.1:5253/
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
const base = process.argv[2] ?? 'http://127.0.0.1:5253/'
const out = 'tests/ui/artifacts/loading-progress'
await mkdir(out, { recursive: true })
// Chrome's presets: Slow 4G 1.6 Mbit/s down, 562.5 ms; Fast 3G (its older name) 1.44 Mbit/s, 562.5 ms.
const links = { 'slow-4g': { latency: 562.5, downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8 }, 'fast-3g': { latency: 562.5, downloadThroughput: 1.44e6 / 8, uploadThroughput: 0.675e6 / 8 } }
const views = { desktop: { viewport: { width: 1280, height: 800 } }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const read = page => page.evaluate(() => { const w = document.querySelector('.boot-still'), s = document.querySelector('.boot-status'); return { boot: document.documentElement.dataset.boot, shown: document.documentElement.hasAttribute('data-boot-late'), opacity: w ? +getComputedStyle(w).opacity : 0, funOpacity: s ? +getComputedStyle(s).opacity : 0, fun: s?.textContent ?? '', line: w?.textContent ?? '', statusTop: Math.round(s?.getBoundingClientRect().top ?? 0), live: document.querySelector('.mira-loading .loading-phase')?.textContent ?? null } })
try {
  for (const [link, conditions] of Object.entries(links)) for (const [name, view] of Object.entries(views)) {
    const context = await browser.newContext(view), page = await context.newPage(), cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...conditions }); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const started = Date.now()
    await page.goto(`${base}?room=lp-${Date.now()}`, { waitUntil: 'commit' })
    for (const at of [1, 3.5, 6, 12]) {
      await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - started)))
      const r = await read(page)
      console.log(link, name, `${at}s`, JSON.stringify(r))
      if (r.boot === 'done') break
      await page.screenshot({ path: `${out}/${link}-${name}-${String(at).replace('.', '_')}s.png` })
    }
    await context.close()
  }
  // Warm: a second load from the cache.
  const context = await browser.newContext(views.desktop)
  for (let i = 0; i < 2; i++) {
    const page = await context.newPage()
    await page.addInitScript(() => { window.__shown = false; const w = () => { if (document.documentElement.hasAttribute('data-boot-late')) window.__shown = true; if (document.documentElement?.dataset.boot !== 'done') requestAnimationFrame(w); else window.__done = performance.now() }; requestAnimationFrame(w) })
    await page.goto(`${base}?room=lp-warm-${Date.now()}`); await page.waitForFunction(() => window.__done, null, { timeout: 120000 })
    if (i === 1) console.log('warm', JSON.stringify(await page.evaluate(() => ({ doneMs: Math.round(window.__done), shown: window.__shown }))))
    await page.close()
  }
  await context.close()
} finally { await browser.close() }
