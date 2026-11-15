/**
 * The loading veil (from terranlabs.com): it is on screen from the first paint, before the
 * bundle has run; its light moves forward and never back; it lifts when the world is ready
 * and is out of the way of the lobby afterwards.
 *
 *   tools/heavy.sh node tests/ui/boot-veil.mjs
 *
 * Needs the lane dev server on 5187.
 */
import { chromium, devices, webkit } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
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
    await page.route(/\/src\/main\.ts/, async route => { await held; await route.continue() })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.goto(`http://127.0.0.1:5187/?room=boot-${view.name}-${Date.now()}`, { waitUntil: 'commit' })
    const state = () => page.evaluate(() => ({ boot: document.documentElement.dataset.boot, progress: Number(getComputedStyle(document.documentElement).getPropertyValue('--boot-progress')), veil: getComputedStyle(document.querySelector('.boot-veil')).opacity, game: Boolean(window.syn3h) }))
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'loading' && document.querySelector('.boot-mark'))
    await page.waitForTimeout(1200)
    const early = await state()
    assert.equal(early.game, false, `${view.name}: the veil is up before the game's code has run`)
    assert.equal(early.veil, '1'); assert.ok(early.progress > 0.05 && early.progress < 0.45, `${view.name}: the light is already moving (${early.progress})`)
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
    assert.equal(lifted.boot, 'done'); assert.ok(lifted.progress > 0.95, `${view.name}: lifted with the lap unfinished (${lifted.progress})`)
    await page.screenshot({ path: `${out}/${view.name}-lifting.png` })
    await page.waitForTimeout(1300)
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.boot-veil')).visibility), 'hidden')
    // The lobby underneath takes the taps.
    await page.waitForFunction(() => document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 60000 })
    assert.equal(await page.evaluate(() => { const b = document.querySelector('.galaxy-links button').getBoundingClientRect(); return document.elementFromPoint(b.left + 12, b.top + 12)?.closest('.galaxy-links') !== null }), true)
    await page.screenshot({ path: `${out}/${view.name}-lobby.png` })
    await context.close()
  }
  // Safari on a phone and a tablet over a slow link: the bundle is held back.
  // The veil must be unmistakably a loading screen the whole time: the name, a ring of real
  // size, a word of status, and after eight seconds a line that says it is still working.
  const safari = await webkit.launch()
  for (const name of ['iPhone 14', 'iPad Pro 11 landscape']) {
    const context = await safari.newContext({ ...devices[name] }), page = await context.newPage()
    page.on('pageerror', e => { if (!/image\.complete/.test(e.message)) errors.push(`${name}: ${e.message}`) })
    // Held until released below: a link as slow as it needs to be. No screenshots here: WebKit
    // cannot take one while the page's module script is pending. The Chrome pass above has them.
    let arrive; const slow = new Promise(resolve => { arrive = resolve })
    await page.route(/\/src\/main\.ts/, async route => { await slow; await route.continue() })
    await page.goto(`http://127.0.0.1:5187/?room=boot-${name.replace(/\W+/g, '-')}-${Date.now()}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'loading' && document.querySelector('.boot-status'))
    await page.waitForTimeout(1500)
    const seen = () => page.evaluate(() => {
      const box = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(), style = getComputedStyle(el); return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, opacity: Number(style.opacity), text: el.textContent.trim(), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth } }
      return { wordmark: box('.boot-wordmark'), mark: box('.boot-mark'), status: box('.boot-status'), still: box('.boot-still'), game: Boolean(window.syn3h) }
    })
    const first = await seen()
    assert.equal(first.game, false)
    assert.ok(first.wordmark.width >= 180 && first.wordmark.inView, `${name}: the name is on the veil (${Math.round(first.wordmark.width)} px)`)
    assert.ok(first.mark.width >= 100 && first.mark.opacity > 0.9 && first.mark.inView, `${name}: the ring is a real size (${Math.round(first.mark.width)} px)`)
    assert.equal(first.status.text, 'Loading the engine'); assert.ok(first.status.inView && first.status.opacity > 0.9)
    assert.ok(first.still.opacity < 0.1, `${name}: the still-working line waits`)
    assert.ok(first.wordmark.bottom <= first.mark.top && first.mark.bottom <= first.status.top, `${name}: name, ring, status in that order without overlap`)
    await page.waitForTimeout(7600)
    const later = await seen()
    assert.equal(later.game, false, `${name}: still waiting for the bundle ${JSON.stringify(later)}`)
    assert.ok(later.still.opacity > 0.9 && later.still.inView && /still working/i.test(later.still.text), `${name}: after eight seconds it says it is still working`)
    // The bundle arrives: the word changes with the phases, then the veil lifts.
    arrive()
    await page.waitForFunction(() => document.querySelector('.boot-status').textContent !== 'Loading the engine', null, { timeout: 30000 })
    await page.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 90000 })
    await page.waitForTimeout(1300)
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.boot-veil')).visibility), 'hidden')
    await context.close()
  }
  await safari.close()
  // A failure at startup is shown at once, not hidden behind the veil.
  const broken = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await broken.addInitScript(() => { Object.defineProperty(navigator, 'gpu', { get() { throw new Error('graphics refused for this test') } }); HTMLCanvasElement.prototype.getContext = () => { throw new Error('graphics refused for this test') } })
  await broken.goto(`http://127.0.0.1:5187/?room=boot-broken-${Date.now()}`, { waitUntil: 'load' })
  await broken.waitForFunction(() => document.documentElement.dataset.boot === 'done', null, { timeout: 20000 })
  await broken.waitForTimeout(1200)
  assert.equal(await broken.evaluate(() => getComputedStyle(document.querySelector('.boot-veil')).visibility), 'hidden', 'the veil is out of the way of a startup failure')
  await broken.screenshot({ path: `${out}/startup-failure.png` })
  await broken.close()
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
