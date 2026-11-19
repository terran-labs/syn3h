// The HUD's left column (src/ui/hud-column.css): what must stay true.
//   SYN3H_URL=http://127.0.0.1:5213/ node tests/ui/hud-column.mjs
// 1. One edge distance: the column's line (the gear's spine) sits as far from the left as the
//    minimap's ring and the right panel from the right (1 px). Gear selector, accessories and
//    chat share one left edge, stacked over the minimap in that order without overlapping, at
//    1440x900 and 1280x800, both cursor modes. The drum is three rows and the same height in
//    both modes, and the Wings, Zorb and Chat keys show in both.
// 2. Nothing in the column covers the speed or height readouts (at a three-digit speed) or the reticle.
// 3. Each vehicle lists the accessories it exposes: wings where it has wings, a mode where it hovers.
// 4. A key and a click switch the same state.
// 5. On a phone the accessories stay with the thumb buttons: the column's rows are not shown.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []

async function open(options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}?autoplay=1&room=hud-column-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 180000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
  await page.evaluate(() => window.syn3h.params.set('bots.count', 0))
  return { context, page }
}

/** Boxes of the column's parts and of what it must not cover. */
const measure = (page) => page.evaluate(() => {
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null }
  // The readout as it is at speed: three digits.
  for (const b of document.querySelectorAll('.fh-read.fh-left b')) b.textContent = '188'
  const ink = (root) => [...root.querySelectorAll('*')].filter((e) => !e.children.length && e.textContent.trim() && e.checkVisibility?.({ opacityProperty: true })).map((e) => e.getBoundingClientRect()).filter((r) => r.width)
  const detail = document.querySelector('.gear-selector .gs-detail')
  return {
    minimap: box('.shell-minimap'), gear: box('.gear-selector'), drum: box('.gear-selector .gs-drum'), spine: box('.gear-selector .gs-spine'),
    panel: box('.world-inspector'), keys: [...document.querySelectorAll('.hud-accessories kbd, .hud-chat kbd')].map((k) => k.checkVisibility() && k.textContent),
    accessories: box('.hud-accessories'), chat: box('.hud-chat'),
    detail: detail ? ink(detail).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })) : [],
    readouts: [...document.querySelectorAll('.focus-hud .fh-read')].filter((e) => getComputedStyle(e).opacity !== '0').flatMap((e) => ink(e)).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
    w: innerWidth, h: innerHeight,
  }
})
const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1

try {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const { context, page } = await open({ viewport: { width: w, height: h } })
    let drumFree = null
    for (const mode of ['free', 'focus']) {
      if (mode === 'focus') { await page.mouse.click(w / 2, h * .3); await page.waitForFunction(() => document.querySelector('.syn3h-shell').classList.contains('is-focus'), null, { timeout: 5000 }) }
      await page.waitForTimeout(500)
      const m = await measure(page), at = `${w}x${h} ${mode}`
      // 1. One edge distance, one left edge, in order.
      const ring = m.minimap.left + (m.minimap.right - m.minimap.left) * .115
      assert.ok(Math.abs(m.spine.left - ring) <= 1, `${at}: the column's line sits on the minimap ring's edge ${JSON.stringify([m.spine, ring])}`)
      if (mode === 'free' && m.panel) assert.ok(Math.abs((w - m.panel.right) - m.spine.left) <= 1, `${at}: the right panel keeps the same edge distance ${JSON.stringify([m.panel, m.spine])}`)
      for (const [name, part] of [['accessories', m.accessories], ['chat', m.chat]]) {
        assert.ok(part, `${at}: ${name} shown`)
        assert.ok(Math.abs(part.left - m.gear.left) <= 1, `${at}: ${name} shares the gear's left edge ${JSON.stringify([part, m.gear])}`)
      }
      assert.ok(Math.abs((m.drum.bottom - m.drum.top) - 3 * 36) <= 1, `${at}: the drum is three rows ${JSON.stringify(m.drum)}`)
      if (mode === 'free') drumFree = m.drum
      else assert.ok(Math.abs(m.drum.top - drumFree.top) <= 1 && Math.abs(m.drum.bottom - drumFree.bottom) <= 1, `${at}: capturing the cursor moves nothing in the drum ${JSON.stringify([drumFree, m.drum])}`)
      assert.ok(m.keys.length >= 3 && m.keys.every(Boolean), `${at}: the Wings, Zorb and Chat keys show ${JSON.stringify(m.keys)}`)
      assert.ok(m.gear.bottom <= m.accessories.top + 1 && m.accessories.bottom <= m.chat.top + 1 && m.chat.bottom <= m.minimap.top + 1, `${at}: gear, accessories, chat, minimap from the top, apart ${JSON.stringify(m)}`)
      // 2. Clear of the readouts and the reticle.
      const reticle = { left: w / 2 - 40, right: w / 2 + 40, top: h / 2 - 40, bottom: h / 2 + 40 }
      for (const part of [m.accessories, m.chat, m.drum, ...m.detail]) {
        for (const r of m.readouts) assert.ok(!hit(part, r), `${at}: the column clears the readouts ${JSON.stringify([part, r])}`)
        assert.ok(!hit(part, reticle), `${at}: the column clears the reticle`)
      }
    }
    // 3 and 4, in the free cursor mode.
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    if (w === 1440) {
      for (const kind of ['buggy', 'jet', 'hovercraft']) {
        await page.evaluate((k) => window.syn3h.swapVehicle(k), kind)
        // Asking for the buggy keeps a Syn3h buggy: compare by family.
        await page.waitForFunction((k) => window.syn3h.player.kind.startsWith(k) && document.querySelector('.hud-accessories').dataset.count, kind, { timeout: 30000 })
        await page.waitForTimeout(300)
        const seen = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.hud-accessories .acc-row')].map((e) => e.dataset.id), wings: 'wingState' in window.syn3h.player, hover: 'hoverMode' in window.syn3h.player }))
        assert.equal(seen.rows.includes('wings'), seen.wings, `${kind}: a Wings row exactly when it has wings ${JSON.stringify(seen)}`)
        assert.equal(seen.rows.includes('flight'), seen.hover, `${kind}: a Flight row exactly when it hovers ${JSON.stringify(seen)}`)
        assert.ok(seen.rows.includes('zorb'), `${kind}: Zorb`)
      }
      await page.evaluate(() => window.syn3h.swapVehicle('buggy'))
      await page.waitForFunction(() => document.querySelector('.hud-accessories [data-id=wings]'), null, { timeout: 30000 })
      const state = () => page.evaluate(() => ({ special: window.syn3h.game.input.state.special, zorb: window.syn3h.game.input.state.zorb, wings: document.querySelector('.hud-accessories [data-id=wings]').getAttribute('aria-pressed'), zorbRow: document.querySelector('.hud-accessories [data-id=zorb]').getAttribute('aria-pressed') }))
      const before = await state()
      await page.keyboard.press('Space'); await page.waitForTimeout(200)
      let s = await state()
      assert.equal(s.special, !before.special, 'Space switches the wings'); assert.equal(s.wings, String(s.special), 'the Wings row shows it')
      await page.locator('.hud-accessories [data-id=wings]').click(); await page.waitForTimeout(200)
      s = await state()
      assert.equal(s.special, before.special, 'a click switches the same state back'); assert.equal(s.wings, String(s.special))
      await page.keyboard.press('KeyX'); await page.waitForTimeout(200)
      s = await state(); assert.equal(s.zorb, !before.zorb, 'X switches Zorb'); assert.equal(s.zorbRow, String(s.zorb))
      await page.locator('.hud-accessories [data-id=zorb]').click(); await page.waitForTimeout(200)
      s = await state(); assert.equal(s.zorb, before.zorb, 'a click switches Zorb back'); assert.equal(s.zorbRow, String(s.zorb))
    }
    await context.close()
    console.log(`${w}x${h}: ok`)
  }
  // 5. Phones keep the thumb buttons.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const { context, page } = await open({ viewport, isMobile: true, hasTouch: true })
    assert.equal(await page.locator('.hud-accessories').isVisible(), false, `${viewport.width}x${viewport.height}: no accessory rows on a phone`)
    await context.close()
  }
  assert.deepEqual(errors, [], 'no page errors')
  console.log('hud-column: ok')
} finally { await browser.close() }
