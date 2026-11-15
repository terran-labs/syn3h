/**
 * The loading veil (from terranlabs.com): it is on screen from the first paint, before the
 * bundle has run; its light moves forward and never back; it lifts when the world is ready
 * and is out of the way of the lobby afterwards.
 *
 *   tools/heavy.sh node tests/ui/boot-veil.mjs
 *
 * Needs the lane dev server on 5187.
 */
import { chromium } from 'playwright-core'
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
    assert.equal(await page.evaluate(() => { const b = document.querySelector('.lobby-index .planet-card').getBoundingClientRect(); return document.elementFromPoint(b.left + 20, b.top + 20)?.closest('.planet-card') !== null }), true)
    await page.screenshot({ path: `${out}/${view.name}-lobby.png` })
    await context.close()
  }
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
