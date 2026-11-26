import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { waitForPanelMotion } from './panel-motion.mjs'
// The HUD's left column (src/ui/hud-column.css): what must stay true.
//   MIRA_URL=http://127.0.0.1:5213/ node tests/ui/hud-column.mjs
// 1. One edge distance: the column's line (the gear's spine) sits as far from the left as the
//    minimap's ring and the right panel from the right (1 px). Gear selector, accessories and
//    chat share one left edge, stacked over the minimap in that order without overlapping, at
//    1440x900 and 1280x800, both cursor modes. The drum is three rows and the same height in
//    both modes. With the cursor free the Wings, Zorb and Chat rows show with their keys;
//    captured, only the drum shows (the rows and the gear's detail fade out, in place).
// 2. Nothing in the column covers the speed or height readouts (at a three-digit speed) or the reticle.
// 3. Each vehicle lists the accessories it exposes: wings where it has wings, a mode where it hovers.
// 4. A key and a click switch the same state.
// 5. On a phone the accessories stay with the thumb buttons: the column's rows are not shown.
// 7. The charge bar (Plasma Thunder's charge here) paints nothing when idle, keeping its place,
//    and part filled paints only its filled length (the owner, 25 November 2026).
// 6. Every node sits on its line: each circle's centre x is its line's centre x (half a pixel),
//    and each line runs from its first circle's centre to its last's (the owner, 25 November
//    2026: the line ran past Wings and the circles sat left of it). Chat's unread count never
//    moves the key column, and with chat off (chat.on or chat.show) the line ends at the last row
//    left. At 1280x800 and on a phone, where only the drum's lit node shows.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []

async function open(options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}?autoplay=1&room=hud-column-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 180000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
  await page.waitForFunction(() => window.mira.shell.playing && !window.mira.shell.transitioning, null, { timeout: 90000 })
  await page.evaluate(() => window.mira.params.set('bots.count', 0))
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
    pitch: parseFloat(getComputedStyle(document.querySelector('.gear-selector')).getPropertyValue('--gs-pitch')),
    edgeTop: parseFloat(getComputedStyle(document.querySelector('.mira-shell')).getPropertyValue('--edge')),
    minimap: box('.shell-minimap'), gear: box('.gear-selector'), drum: box('.gear-selector .gs-drum'), spine: box('.gear-selector .gs-spine'),
    panel: box('.world-inspector'), // Rows showing only: Flip upright is in the column only while it can act, and takes no row while hidden.
    keys: [...document.querySelectorAll('.hud-accessories .acc-row:not([hidden]) kbd, .hud-chat kbd')].map((k) => k.checkVisibility() && k.textContent),
    accessories: box('.hud-accessories'), chat: box('.hud-chat'),
    // The detail beside the gear and the meter (status and bar) under its name.
    detail: [detail, document.querySelector('.gear-selector .gs-meter')].filter(Boolean).flatMap((e) => ink(e)).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
    readouts: [...document.querySelectorAll('.focus-hud .fh-read')].filter((e) => getComputedStyle(e).opacity !== '0').flatMap((e) => ink(e)).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
    w: innerWidth, h: innerHeight,
  }
})
/** Each line (the drum's spine, the rows' hairline) with the centres of the circles on it. */
const lines = (page) => page.evaluate(() => {
  const r = (e) => e.getBoundingClientRect()
  const node = (e) => { const c = getComputedStyle(e, '::before'); if (c.content === 'none' || c.display === 'none') return null; const b = r(e); return { x: b.left + parseFloat(c.left) + parseFloat(c.width) / 2, y: b.top + parseFloat(c.top) + parseFloat(c.marginTop) + parseFloat(c.height) / 2 } }
  const centre = (e) => { const b = r(e); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }
  const drum = document.querySelector('.gear-selector .gs-drum'), d = r(drum), spine = r(document.querySelector('.gear-selector .gs-spine'))
  // The drum's circles in its three visible rows: the selected one's (on the window) and its neighbours'.
  // (A circle left of the drum's clip, as on touch, is not drawn.)
  const gear = [node(document.querySelector('.gear-selector .gs-window')), ...[...drum.querySelectorAll('button.gs-item:not(.is-active)')].map(node)
    .filter((n) => n && n.y > d.top && n.y < d.bottom && n.x >= d.left)].sort((a, b) => a.y - b.y)
  const acc = document.querySelector('.hud-accessories'), rows = acc && acc.checkVisibility() && (() => { const c = getComputedStyle(acc, '::before'), b = r(acc); return { x: b.left + parseFloat(c.left) + parseFloat(c.width) / 2, top: b.top + parseFloat(c.top), bottom: b.bottom - parseFloat(c.bottom) } })()
  return {
    gear: { line: { x: spine.left + spine.width / 2, top: spine.top, bottom: spine.bottom }, nodes: gear },
    rows: rows && { line: rows, nodes: [...document.querySelectorAll(':is(.hud-accessories, .hud-chat) .acc-row:not([hidden]) .acc-pip')].filter((p) => p.checkVisibility()).map((p) => centre(p)) },
  }
})
const onLines = (m, at, ends = true) => {
  for (const [name, group] of Object.entries(m)) {
    if (!group) continue
    assert.ok(group.nodes.length, `${at}: ${name} has circles`)
    for (const n of group.nodes) assert.ok(Math.abs(n.x - group.line.x) <= .5, `${at}: a ${name} circle is centred on its line ${JSON.stringify(group)}`)
    if (!ends) continue
    assert.ok(Math.abs(group.line.top - group.nodes[0].y) <= .5, `${at}: the ${name} line starts at its first circle ${JSON.stringify(group)}`)
    assert.ok(Math.abs(group.line.bottom - group.nodes.at(-1).y) <= .5, `${at}: the ${name} line ends at its last circle ${JSON.stringify(group)}`)
  }
}
const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1

try {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const { context, page } = await open({ viewport: { width: w, height: h } })
    let drumFree = null
    for (const mode of ['free', 'focus']) {
      if (mode === 'focus') { await page.mouse.click(w / 2, h * .3); await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-focus'), null, { timeout: 5000 }) }
      await waitForPanelMotion(page)
      const m = await measure(page), at = `${w}x${h} ${mode}`
      // 1. One edge distance, one left edge, in order.
      const ring = m.minimap.left + (m.minimap.right - m.minimap.left) * .115
      assert.ok(Math.abs(m.spine.left - ring) <= 1, `${at}: the column's line sits on the minimap ring's edge ${JSON.stringify([m.spine, ring])}`)
      if (mode === 'free' && m.panel) assert.ok(Math.abs((w - m.panel.right) - m.spine.left) <= 1, `${at}: the right panel keeps the same edge distance ${JSON.stringify([m.panel, m.spine])}`)
      for (const [name, part] of [['accessories', m.accessories], ['chat', m.chat]]) {
        assert.ok(part, `${at}: ${name} shown`)
        assert.ok(Math.abs(part.left - m.gear.left) <= 1, `${at}: ${name} shares the gear's left edge ${JSON.stringify([part, m.gear])}`)
      }
      assert.ok(m.pitch > 0 && Math.abs((m.drum.bottom - m.drum.top) - 3 * m.pitch) <= 1, `${at}: the drum is three rows ${JSON.stringify([m.drum, m.pitch])}`)
      // The column starts at the top left, on the shared top edge (the owner, 21 November 2026).
      assert.ok(Math.abs(m.drum.top - m.edgeTop) <= 1, `${at}: the gear sits at the top left ${JSON.stringify([m.drum, m.edgeTop])}`)
      if (mode === 'free') drumFree = m.drum
      else assert.ok(Math.abs(m.drum.top - drumFree.top) <= 1 && Math.abs(m.drum.bottom - drumFree.bottom) <= 1, `${at}: capturing the cursor moves nothing in the drum ${JSON.stringify([drumFree, m.drum])}`)
      assert.ok(m.keys.length >= 3 && m.keys.every(Boolean), `${at}: the Wings, Zorb and Chat keys are laid out ${JSON.stringify(m.keys)}`)
      await page.waitForTimeout(400)
      const shown = await page.evaluate(() => ['.hud-accessories', '.hud-chat', '.gear-selector .gs-detail', '.gear-selector .gs-drum'].map((s) => document.querySelector(s).checkVisibility({ opacityProperty: true, visibilityProperty: true })))
      assert.deepEqual(shown, mode === 'free' ? [true, true, true, true] : [false, false, false, true], `${at}: rows, detail and drum shown ${JSON.stringify(shown)}`)
      onLines(await lines(page), at)
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
    if (w === 1280) {
      // 6. Circles on their lines, with each gear selected (first, last and between), and Chat's
      // key column still with an unread count of 1 and 9+.
      const gears = await page.locator('.gear-selector .gs-drum button.gs-item').count()
      for (let g = 0; g < gears; g++) {
        await page.keyboard.press(String(g + 1))
        // Measured once the drum has stopped turning (its transitions run slower on a loaded machine).
        await page.waitForTimeout(50)
        await page.waitForFunction(() => document.querySelector('.gear-selector').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), null, { timeout: 10000 })
        onLines(await lines(page), `${w}x${h} gear ${g + 1}`)
      }
      const keyX = () => page.evaluate(() => [...document.querySelectorAll(':is(.hud-accessories, .hud-chat) .acc-row:not([hidden]) kbd')].map((k) => k.getBoundingClientRect().left))
      const still = await keyX()
      assert.ok(still.every((x) => Math.abs(x - still[0]) <= .5), `the keys share one column ${JSON.stringify(still)}`)
      for (const n of [1, 12, 0]) {
        await page.evaluate(async (n) => { const { chatLink } = await import('/src/ui/chat/chatLink.ts'); chatLink.setUnread(n, false) }, n)
        await page.waitForTimeout(250)
        assert.deepEqual(await keyX(), still, `an unread count of ${n} moves no key`)
        onLines(await lines(page), `${w}x${h} unread ${n}`)
      }
      // 7. The charge bar, driven through Plasma Thunder's own charge (0 to 1; below 0 is idle).
      await page.keyboard.press('2')
      await page.waitForFunction(() => document.querySelector('.gear-selector')?.dataset.gear === 'red' && !document.querySelector('.gear-selector .gs-level').hidden, null, { timeout: 10000 })
      const bar = async (charge) => {
        await page.evaluate((c) => { window.miraChat.net.bigRed.charge = c }, charge)
        await page.waitForTimeout(500)
        return page.evaluate(() => {
          const level = document.querySelector('.gear-selector .gs-meter:not(.is-leaving) .gs-level'), fill = level.querySelector('i'), s = getComputedStyle(level)
          return { opacity: +s.opacity, track: [s.backgroundColor, s.boxShadow, s.filter], width: level.getBoundingClientRect().width, fill: fill.getBoundingClientRect().width }
        })
      }
      const idle = await bar(-1)
      assert.ok(idle.opacity === 0 && idle.width > 0, `an idle bar paints nothing and keeps its place ${JSON.stringify(idle)}`)
      assert.deepEqual(idle.track, ['rgba(0, 0, 0, 0)', 'none', 'none'], 'no track, outline or shadow along the bar')
      for (const charge of [1 / 3, 1]) {
        const part = await bar(charge)
        assert.ok(part.opacity === 1 && Math.abs(part.fill - charge * part.width) <= 1, `a bar ${charge.toFixed(2)} charged paints that share of its length ${JSON.stringify(part)}`)
      }
      await bar(-1)
      await page.keyboard.press('1')
      // Room chat off (the host's chat.on): no Chat row, and the line ends at the last row left.
      for (const [id, value] of [['chat.on', false], ['chat.show', false]]) {
        await page.evaluate(([id, value]) => window.mira.params.set(id, value), [id, value])
        await page.waitForTimeout(250)
        assert.equal(await page.locator('.hud-chat').isVisible(), false, `${id} off hides the Chat row`)
        onLines(await lines(page), `${w}x${h} ${id} off`)
        await page.evaluate((id) => window.mira.params.set(id, true), id)
        await page.waitForTimeout(250)
        assert.equal(await page.locator('.hud-chat').isVisible(), true, `${id} back on shows the Chat row`)
      }
    }
    if (w === 1440) {
      for (const kind of ['buggy', 'jet', 'hovercraft']) {
        await page.evaluate((k) => window.mira.swapVehicle(k), kind)
        // Asking for the buggy keeps a Mira buggy: compare by family.
        await page.waitForFunction((k) => window.mira.player.kind.startsWith(k) && document.querySelector('.hud-accessories').dataset.count, kind, { timeout: 30000 })
        await page.waitForTimeout(300)
        const seen = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.hud-accessories .acc-row')].map((e) => e.dataset.id), wings: 'wingState' in window.mira.player, hover: 'hoverMode' in window.mira.player }))
        assert.equal(seen.rows.includes('wings'), seen.wings, `${kind}: a Wings row exactly when it has wings ${JSON.stringify(seen)}`)
        assert.equal(seen.rows.includes('flight'), seen.hover, `${kind}: a Flight row exactly when it hovers ${JSON.stringify(seen)}`)
        assert.ok(seen.rows.includes('zorb'), `${kind}: Zorb`)
      }
      await page.evaluate(() => window.mira.swapVehicle('buggy'))
      await page.waitForFunction(() => document.querySelector('.hud-accessories [data-id=wings]'), null, { timeout: 30000 })
      const state = () => page.evaluate(() => ({ special: window.mira.game.input.state.special, zorb: window.mira.game.input.state.zorb, wings: document.querySelector('.hud-accessories [data-id=wings]').getAttribute('aria-pressed'), zorbRow: document.querySelector('.hud-accessories [data-id=zorb]').getAttribute('aria-pressed') }))
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
    // 6. The drum's lit node on its line (touch hides the other circles, and its line fades out
    // past the rows as the drum scrolls, so only the centre is checked).
    onLines(await lines(page), `${viewport.width}x${viewport.height}`, false)
    await context.close()
  }
  assert.deepEqual(errors, [], 'no page errors')
  console.log('hud-column: ok')
} finally { await browser.close() }
