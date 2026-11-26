/**
 * The loading veil (from terranlabs.com): it is on screen from the first paint, before the
 * bundle has run; its light moves forward and never back; it lifts when the world is ready
 * and is out of the way of the lobby afterwards.
 *
 *   tools/heavy.sh node tests/ui/boot-veil.mjs
 *
 * Needs the lane dev server on 5187.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, devices, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
/** The dev server to check (default the lane's old port). */
const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'
const out = 'tests/ui/artifacts/boot-veil'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  for (const view of [{ name: 'desktop', viewport: { width: 1280, height: 720 } }, { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext(view), page = await context.newPage(), cdp = await context.newCDPSession(page)
    page.on('pageerror', e => errors.push(`${view.name}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${view.name}: ${m.text()}`) })
    // Hold the bundle back so the veil is seen on its own, as on a slow connection.
    let release; const held = new Promise(resolve => { release = resolve })
    await page.route(/\/(src\/main\.ts|assets\/index-[\w-]+\.js)(\?|$)/, async route => { await held; await route.continue() })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.goto(`${base}?room=boot-${view.name}-${Date.now()}`, { waitUntil: 'commit' })
    const state = () => page.evaluate(() => ({ boot: document.documentElement.dataset.boot, progress: Number(getComputedStyle(document.documentElement).getPropertyValue('--boot-progress')), veil: getComputedStyle(document.querySelector('.boot-veil')).opacity, game: Boolean(window.mira) }))
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'loading' && document.querySelector('.boot-mark'))
    await page.waitForTimeout(1200)
    const early = await state()
    assert.equal(early.game, false, `${view.name}: the veil is up before the game's code has run`)
    assert.ok(Number(early.veil) > 0 && early.progress > 0 && early.progress < 1, `${view.name}: the loading indicator is visible and incomplete before the bundle arrives`)
    await page.screenshot({ path: `${out}/${view.name}-early.png` })
    release()
    // Sample the light while the game loads: it only ever goes forward.
    const samples = [early.progress]
    for (let i = 0; i < 400; i++) {
      const now = await state(); samples.push(now.progress)
      if (i === 6) await page.screenshot({ path: `${out}/${view.name}-loading.png` })
      if (now.boot === 'done') break
      await page.waitForTimeout(100)
    }
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1] - 1e-6, `${view.name}: the light went backwards (${samples[i - 1]} to ${samples[i]})`)
    const lifted = await state()
    assert.equal(lifted.boot, 'done'); assert.ok(lifted.progress > early.progress, `${view.name}: loading progress advances before the veil lifts`)
    await page.screenshot({ path: `${out}/${view.name}-lifting.png` })
    await page.locator('.boot-veil').waitFor({ state: 'hidden' })
    // The lobby underneath takes the taps, once the opening (src/ui/galaxy/opening.ts) has
    // brought its controls in.
    await page.waitForFunction(() => document.querySelector('.lobby-panels')?.dataset.busy === 'false' && !document.documentElement.dataset.opening, null, { timeout: 60000 })
    await page.locator('.lobby-gear-dock .lobby-gear').click({ trial: true })
    await page.screenshot({ path: `${out}/${view.name}-lobby.png` })
    await context.close()
  }
  // Safari on a phone and a tablet over a slow link: the bundle is held back.
  // The indicator is visible before the bundle and a slow load shows status and progress.
  const safari = await webkit.launch()
  for (const name of ['iPhone 14', 'iPad Pro 11 landscape']) {
    const context = await safari.newContext({ ...devices[name] }), page = await context.newPage()
    page.on('pageerror', e => { if (!/image\.complete/.test(e.message)) errors.push(`${name}: ${e.message}`) })
    // Held until released below: a link as slow as it needs to be. No screenshots here: WebKit
    // cannot take one while the page's module script is pending. The Chrome pass above has them.
    let arrive; const slow = new Promise(resolve => { arrive = resolve })
    await page.route(/\/(src\/main\.ts|assets\/index-[\w-]+\.js)(\?|$)/, async route => { await slow; await route.continue() })
    await page.goto(`${base}?room=boot-${name.replace(/\W+/g, '-')}-${Date.now()}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'loading' && document.querySelector('.boot-status'))
    await page.waitForTimeout(1500)
    const seen = () => page.evaluate(() => {
      const box = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(), style = getComputedStyle(el); return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, opacity: Number(style.opacity), text: (el.dataset.numbers || el.textContent).trim(), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth } }
      return { point: box('.boot-point'), status: box('.boot-status'), still: box('.boot-still'), game: Boolean(window.mira) }
    })
    const first = await seen()
    assert.equal(first.game, false)
    assert.ok(first.point.width > 0 && first.point.height > 0 && first.point.opacity > 0 && first.point.inView, `${name}: the loading indicator is visible`)
    await page.waitForFunction(() => ['.boot-status', '.boot-still'].every(selector => Number(getComputedStyle(document.querySelector(selector)).opacity) > 0))
    const later = await seen()
    assert.equal(later.game, false, `${name}: still waiting for the bundle ${JSON.stringify(later)}`)
    assert.ok(later.status.inView && later.status.text, `${name}: the status is visible on a slow load`)
    assert.ok(later.still.inView && later.still.text, `${name}: the progress line is visible on a slow load`)
    assert.ok(later.point.bottom <= later.status.top && later.status.bottom <= later.still.top, `${name}: loading information stays clear of the indicator`)
    // The bundle arrives: the line stays, then the veil lifts.
    arrive()
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 90000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden' })
    await context.close()
  }
  await safari.close()
  // A failure at startup is shown at once, not hidden behind the veil.
  const broken = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await broken.addInitScript(() => { Object.defineProperty(navigator, 'gpu', { get() { throw new Error('graphics refused for this test') } }); HTMLCanvasElement.prototype.getContext = () => { throw new Error('graphics refused for this test') } })
  await broken.goto(`${base}?room=boot-broken-${Date.now()}`, { waitUntil: 'load' })
  await broken.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 20000 })
  await broken.locator('.boot-veil').waitFor({ state: 'hidden' })
  await broken.locator('#fatal[role="alert"]').waitFor({ state: 'visible' })
  await broken.screenshot({ path: `${out}/startup-failure.png` })
  await broken.close()
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
