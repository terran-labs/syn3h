/**
 * Choosing another vehicle in the lobby and pressing play reloads the page (see `join` in
 * src/main.ts). The page being unloaded saves a resume record for the OLD vehicle on pagehide
 * and again on visibilitychange; if that record survives, the reload resumes the old vehicle
 * and the player's choice is lost. This check picks each vehicle in a fresh lobby, plays, and
 * asserts the reloaded page is in the world in the chosen vehicle with no page errors.
 *
 *   SYN3H_URL=http://127.0.0.1:5199/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/lobby-vehicle-reload.mjs
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5187/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const ready = page => page.waitForFunction(() => window.syn3h?.game?.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: 120000 })
const report = []
try {
  for (const kind of ['jet', 'hovercraft']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    // This check runs without a room server, so its refused connections are not game faults.
    const offline = /WebSocket connection|Bad Gateway|ERR_CONNECTION_REFUSED/
    page.on('console', m => { if (m.type() === 'error' && !offline.test(m.text())) errors.push(m.text()) })
    await page.goto(`${base}?room=lobbyveh-${kind}-${Date.now()}`, { waitUntil: 'load' }); await ready(page)
    const before = await page.evaluate(() => window.syn3h.player.kind)
    assert.notEqual(before, kind, `the default vehicle must differ from ${kind} for this check to mean anything`)
    await page.evaluate(() => window.syn3h.shell.showPanel('vehicle'))
    await page.waitForFunction(() => document.querySelector('.lobby-panels').dataset.activePanel === 'vehicle')
    await page.locator(`[name=vehicle][value=${kind}]`).check()
    await page.waitForFunction(k => window.syn3h.shell.vehicleKind === k, kind)
    // Marks this document, so the assertion below can tell the reloaded page from this one.
    await page.evaluate(() => { window.__beforeReload = true; window.syn3h.shell.play() })
    await page.waitForFunction(() => !window.__beforeReload && window.syn3h?.game?.tick > 25, null, { timeout: 120000 })
    await page.waitForFunction(() => document.querySelector('.syn3h-shell')?.classList.contains('is-playing'), null, { timeout: 60000 })
    const after = await page.evaluate(() => ({ kind: window.syn3h.player.kind, autoplay: new URL(location.href).searchParams.get('autoplay'), tick: window.syn3h.game.tick }))
    report.push({ chosen: kind, before, ...after, errors })
    assert.equal(after.kind, kind, `chose ${kind} in the lobby, reloaded into ${after.kind}`)
    assert.equal(after.autoplay, '1')
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log(JSON.stringify(report, null, 2)); console.log('LOBBY VEHICLE RELOAD OK')
} catch (error) { console.log(JSON.stringify(report, null, 2)); throw error } finally { await browser.close() }
