// Run against a local game build with the opt-in lobby compositor.
// node tools/glass-reference/lobby-layer.mjs ORIGIN EVIDENCE_DIRECTORY
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const [origin, output] = process.argv.slice(2)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  for (const [device, width, height, ratio] of [['phone', 390, 844, 3], ['desktop', 1440, 900, 1]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, deviceScaleFactor: ratio, isMobile: device === 'phone' })
    await page.goto(new URL('/?glass=inline', origin).href)
    const gear = page.locator('.lobby-gear[data-glass-surface="shader"]')
    await gear.waitFor({timeout: 60000})
    await gear.tap()
    const card = page.locator('#lobby-settings[data-glass-surface="shader"]')
    await card.waitFor()
    await page.waitForTimeout(300)
    // Observe a real frame. The default framebuffer must contain the galaxy
    // when glass copies it; the galaxy must not overwrite the composite later.
    const order = await page.evaluate(async () => {
      const galaxy = window.syn3h.shell.galaxy, gl = galaxy.gl
      const draw = gl.drawArrays, copy = gl.copyTexSubImage2D, events = []
      gl.drawArrays = function (...args) {
        if (!gl.getParameter(gl.FRAMEBUFFER_BINDING)) events.push(gl.getParameter(gl.CURRENT_PROGRAM) === galaxy.program ? 'galaxy' : 'layer')
        return draw.apply(this, args)
      }
      gl.copyTexSubImage2D = function (...args) { events.push('copy'); return copy.apply(this, args) }
      try {
        for (let frame = 0; frame < 30; frame++) {
          events.length = 0
          await new Promise(requestAnimationFrame)
          if (events.includes('copy')) return [...events]
        }
        return []
      } finally { gl.drawArrays = draw; gl.copyTexSubImage2D = copy }
    })
    assert(order.includes('galaxy') && order.lastIndexOf('galaxy') < order.indexOf('copy') && order.at(-1) === 'layer')
    await page.screenshot({path: join(output, device + '-open.png')})
    // Normal Settings opens one section at a time. Exercise the same controls and
    // animations with every section expanded to stress clipping and scrolling.
    await page.evaluate(() => {
      const inspector = window.syn3h.shell.lobbySettings.inspector
      inspector.options.oneOpen = () => false
      inspector.fit = () => {}
    })
    assert.equal(await page.locator('.glass-setting-reset').count(), 9)
    const heads = card.locator('.wi-cards > .wi-card:visible > .wi-head')
    for (const head of await heads.all()) {
      if (await head.getAttribute('aria-expanded') !== 'true') await head.tap()
    }
    await page.waitForTimeout(600)
    assert.equal(await card.locator('.wi-cards > .wi-card.is-open:visible').count(), await heads.count())
    const frost = card.locator('.wi-row[data-id="glass.frostWidth"]')
    await frost.locator('input[type=range]').tap()
    const value = () => page.evaluate(() => window.syn3h.params.get('glass.frostWidth').value)
    const measured = await page.evaluate(() => window.syn3h.params.get('glass.frostWidth').def.default)
    assert.notEqual(await value(), measured)
    await frost.locator('.glass-setting-reset').tap()
    assert.equal(await value(), measured)
    const layers = await page.evaluate(() => {
      const galaxy = window.syn3h.shell.galaxy
      const crisp = galaxy.markCrisp?.canvas, flat = galaxy.markOverlay?.element
      return {
        crisp: !!crisp && getComputedStyle(crisp).visibility !== 'hidden',
        flat: !!flat && Number(getComputedStyle(flat).opacity) > 0,
        captionsClipped: getComputedStyle(document.querySelector('.galaxy-ui')).clipPath !== 'none',
      }
    })
    assert.deepEqual(layers, { crisp: false, flat: false, captionsClipped: true })
    await page.screenshot({path: join(output, device + '-expanded.png')})
    // Confirm trusted pointer delivery. Cancel actions during this sweep so Close,
    // presentation and quality switches do not dismantle the fixture mid-audit.
    const controls = card.locator('button:visible:enabled, input:visible:enabled, select:visible:enabled')
    await page.evaluate(() => {
      window.cancelAuditAction = event => { event.preventDefault(); event.stopImmediatePropagation() }
      window.addEventListener('click', window.cancelAuditAction, true)
    })
    let taps = 0
    for (const control of await controls.all()) {
      await control.evaluate(el => {
        el.addEventListener('pointerdown', event => { if (event.isTrusted) el.dataset.auditTap = 'yes' }, { once: true })
      })
      await control.tap({timeout: 4000})
      assert.equal(await control.getAttribute('data-audit-tap'), 'yes')
      taps++
    }
    await page.evaluate(() => window.removeEventListener('click', window.cancelAuditAction, true))
    console.log(device, { sections: await heads.count(), taps, resetVerified: true, order, layers })
    await card.locator('.lobby-settings-close').tap()
    await page.locator('#lobby-settings').waitFor({state: 'detached'})
    assert.equal(await page.locator('.wi-group[data-group="Glass"] .glass-setting-reset').count(), 9)
    await page.close()
  }
} finally { await browser.close() }
