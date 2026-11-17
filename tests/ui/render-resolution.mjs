// The Performance card's Render resolution: Auto by default, a percentage of native when set,
// applied once on release without changing the canvas's displayed size, and back to Auto.
// Screenshots at Auto and 75%, desktop (Chrome) and an iPhone 14 (WebKit).
//   SYN3H_URL=http://127.0.0.1:5173/ node tests/ui/render-resolution.mjs
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5173/'
const out = 'tests/ui/artifacts/render-resolution'
await mkdir(out, { recursive: true })

for (const mode of (process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'phone'])) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&room=resolution-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.evaluate(() => window.syn3h.game.quality.setResolution(null))
    if (touch) await page.locator('.inspector-toggle').tap()
    else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const rail = page.locator('.world-inspector'); await rail.waitFor({ state: 'visible' })
    const perf = rail.locator('.wi-card[data-section=performance]')
    if (!(await perf.evaluate(c => c.classList.contains('is-open')))) await (touch ? perf.locator('.wi-head').tap() : perf.locator('.wi-head').click())
    const row = perf.locator('.wi-resolution'); await row.waitFor({ state: 'visible' })
    await row.evaluate(r => r.scrollIntoView({ block: 'center' })); await page.waitForTimeout(600)
    const state = () => page.evaluate(() => { const s = window.syn3h.game.quality.getQualityState(), c = document.querySelector('canvas'); return { resolution: s.resolution, pixelRatio: s.pixelRatio, dpr: s.devicePixelRatio, css: [c.clientWidth, c.clientHeight], buffer: [c.width, c.height] } })

    const before = await state()
    assert.equal(before.resolution, null, `${mode}: Auto by default`)
    assert.match(await row.locator('.wi-res-value').innerText(), /^\d+%$/)
    assert.equal(await row.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed'), 'true')
    assert.match(await row.locator('.wi-res-size').innerText(), /^\d+ × \d+ px · set by Auto$/)
    await page.screenshot({ path: `${out}/${mode}-auto.png` })

    // Dragging previews the value and resizes nothing; release applies it once. (Same-value
    // calls to setPixelRatio are free in three.js, so only real changes are counted.)
    const range = row.locator('input[type=range]')
    let resizes = 0
    await page.exposeFunction('noteResize', () => { resizes++ }).catch(() => {})
    await page.evaluate(() => { const r = window.syn3h.game.renderer, set = r.setPixelRatio.bind(r); r.setPixelRatio = v => { if (v !== r.getPixelRatio()) window.noteResize(); return set(v) } })
    await range.evaluate(input => { for (const v of [95, 90, 85, 80, 75]) { input.value = String(v); input.dispatchEvent(new Event('input', { bubbles: true })) } })
    assert.equal(await row.locator('.wi-res-value').innerText(), '75%', `${mode}: dragging shows the value`)
    assert.equal((await state()).resolution, null, `${mode}: not applied mid-drag`)
    await range.evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })))
    await page.waitForTimeout(300)
    const at75 = await state()
    assert.equal(at75.resolution, 0.75)
    assert.ok(at75.pixelRatio <= at75.dpr * 0.75 + 0.005, `${mode}: ratio within the choice ${JSON.stringify(at75)}`)
    assert.deepEqual(at75.css, before.css, `${mode}: the canvas's displayed size is unchanged`)
    assert.ok(resizes <= 1, `${mode}: one resize on release, saw ${resizes}`)
    assert.equal(await page.evaluate(k => localStorage.getItem(k), 'syn3h.graphics.resolution'), '0.75', `${mode}: remembered`)
    assert.match(await row.locator('.wi-res-size').innerText(), new RegExp(`^${at75.buffer[0]} × ${at75.buffer[1]} px$`), `${mode}: shows the render size`)
    assert.match(await perf.locator('.performance-quality-detail').innerText(), /Pixel ratio \d/)
    await row.evaluate(r => r.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${mode}-75.png` })

    // Back to Auto.
    await (touch ? row.getByRole('button', { name: 'Auto' }).tap() : row.getByRole('button', { name: 'Auto' }).click())
    await page.waitForTimeout(300)
    assert.equal((await state()).resolution, null, `${mode}: Auto again`)
    assert.equal(await page.evaluate(k => localStorage.getItem(k), 'syn3h.graphics.resolution'), null)
    assert.deepEqual(errors, [], `${mode}: no page errors`)
    console.log(`${mode}: ok ${JSON.stringify({ before, at75 })}`)
  } finally { await browser.close() }
}
