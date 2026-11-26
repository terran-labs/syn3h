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
// 10. The column sits as far below the top edge as its line's nodes sit right of the left edge,
//     with the cursor free and captured (the owner, 25 November 2026).
// 9. While a Grapple cord is attached its status and the way to let go are shown whole, clear
//    of every gear name, the world name and the description: on a desktop beside the selected
//    name (the hint, its key a keycap, with the cursor captured; with it free the hints say it),
//    on touch the status under the name with the LET GO thumb button (the owner, 25 November 2026).
// 8. One name column: every visible gear name starts at the same x, the selected one's larger
//    type included, and the charge bar (the meter) starts at the selected name's left edge, in
//    both cursor modes and on phones (the owner, 25 November 2026).
// 7. The charge ring (Plasma Thunder's charge here) is absent at rest, and sweeps from 12 o'clock
//    the level's share of the circle round the lit node; there is no charge bar (the owner, 25
//    November 2026).
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
    gear: { line: { x: spine.left + spine.width / 2, top: spine.top, bottom: spine.bottom, fade: getComputedStyle(document.querySelector('.gear-selector .gs-spine')).backgroundImage }, nodes: gear },
    rows: rows && { line: rows, nodes: [...document.querySelectorAll(':is(.hud-accessories, .hud-chat) .acc-row:not([hidden]) .acc-pip')].filter((p) => p.checkVisibility()).map((p) => centre(p)) },
  }
})
const onLines = (m, at, ends = true) => {
  for (const [name, group] of Object.entries(m)) {
    if (!group) continue
    assert.ok(group.nodes.length, `${at}: ${name} has circles`)
    for (const n of group.nodes) assert.ok(Math.abs(n.x - group.line.x) <= .5, `${at}: a ${name} circle is centred on its line ${JSON.stringify(group)}`)
    if (!ends) continue
    if (name === 'gear') {
      // The drum's line runs on past its first and last circle and fades to nothing at both
      // ends: a longer list turning through the rows shown (the owner, 25 November 2026).
      const pitch = group.nodes.length > 1 ? (group.nodes.at(-1).y - group.nodes[0].y) / (group.nodes.length - 1) : 0
      assert.ok(group.line.top <= group.nodes[0].y - pitch / 2 && group.line.bottom >= group.nodes.at(-1).y + pitch / 2, `${at}: the gear line runs past both end circles ${JSON.stringify(group)}`)
      assert.match(group.line.fade, /^linear-gradient\(rgba\(0, 0, 0, 0\).*rgba\(0, 0, 0, 0\)\)$/, `${at}: the gear line fades to nothing at both ends`)
      continue
    }
    assert.ok(Math.abs(group.line.top - group.nodes[0].y) <= .5, `${at}: the ${name} line starts at its first circle ${JSON.stringify(group)}`)
    assert.ok(Math.abs(group.line.bottom - group.nodes.at(-1).y) <= .5, `${at}: the ${name} line ends at its last circle ${JSON.stringify(group)}`)
  }
}
/** Left edges of the drum's visible names and of the selected row's meter (status and bar). */
const names = (page) => page.evaluate(() => {
  const drum = document.querySelector('.gear-selector .gs-drum').getBoundingClientRect()
  const rows = [...document.querySelectorAll('.gear-selector .gs-drum button.gs-item')].filter((b) => b.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map((b) => ({ selected: b.classList.contains('is-active'), box: b.querySelector('.gs-text').getBoundingClientRect() }))
    .filter((r) => r.box.top + r.box.height / 2 > drum.top && r.box.top + r.box.height / 2 < drum.bottom)
  const meter = document.querySelector('.gear-selector .gs-meter:not(.is-leaving)')
  const bar = meter && [...meter.children].find((e) => !e.hidden && e.getBoundingClientRect().width > 0)
  return { lefts: rows.map((r) => +r.box.left.toFixed(2)), selected: rows.find((r) => r.selected)?.box.left, meter: bar ? bar.getBoundingClientRect().left : null }
})
const oneColumn = (m, at) => {
  assert.ok(m.lefts.length >= 2, `${at}: names shown ${JSON.stringify(m)}`)
  assert.ok(Math.max(...m.lefts) - Math.min(...m.lefts) <= 1, `${at}: the gear names share one left edge ${JSON.stringify(m)}`)
  if (m.meter !== null) assert.ok(Math.abs(m.meter - m.selected) <= 1, `${at}: the meter starts under the selected name ${JSON.stringify(m)}`)
}
/**
 * What the gear holds and how to let go: on a desktop the line beside the selected name
 * (.gs-held, its hint .gs-release), on touch the status under the name. Each drawn whole (in the
 * window, and inside the drum where it sits in a row), overlapping no gear name, the world name
 * or the description.
 */
const releaseHint = (page) => page.evaluate(() => {
  const box = (e) => e && !e.hidden && e.checkVisibility({ visibilityProperty: true, opacityProperty: true }) ? e.getBoundingClientRect() : null
  const touch = document.querySelector('.mira-shell').classList.contains('has-touch')
  const meter = document.querySelector('.gear-selector .gs-meter:not(.is-leaving)')
  const status = box(touch ? meter?.querySelector('.gs-status') : document.querySelector('.gear-selector .gs-held'))
  const hint = box(document.querySelector('.gear-selector .gs-release'))
  const drum = document.querySelector('.gear-selector .gs-drum').getBoundingClientRect()
  const others = [...document.querySelectorAll('.gear-selector .gs-drum .gs-text, .focus-hud .fh-top, .gear-selector .gs-desc')].map(box).filter(Boolean)
  const overlaps = (r) => others.some((o) => r.left < o.right - 1 && r.right > o.left + 1 && r.top < o.bottom - 1 && r.bottom > o.top + 1)
  const whole = (r) => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && (!touch || (r.left >= drum.left && r.right <= drum.right && r.top >= drum.top && r.bottom <= drum.bottom))
  const letGo = [...document.querySelectorAll('.gear-actions button[data-action=release]')].some((b) => b.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
  return {
    status: status && { whole: whole(status), clear: !overlaps(status) },
    shown: !!hint, hint: hint && { whole: whole(hint), clear: !overlaps(hint) },
    key: hint ? document.querySelector('.gear-selector .gs-release kbd.keycap')?.textContent ?? null : null,
    text: hint ? document.querySelector('.gear-selector .gs-release').textContent : '', letGo,
  }
})
/**
 * The column's insets: the first visible row's letters from the top edge, and its node's ring from
 * the left edge (the owner, 25 November 2026: "farther down from the top than they are from the
 * left"). The letters' box top stands for their ink: at line-height 1 the two differ by under a pixel.
 */
const insets = (page) => page.evaluate(() => {
  const drum = document.querySelector('.gear-selector .gs-drum').getBoundingClientRect()
  const inDrum = (y) => y > drum.top && y < drum.bottom
  const text = [...document.querySelectorAll('.gear-selector .gs-drum button.gs-item .gs-text')].map((t) => t.getBoundingClientRect()).filter((r) => inDrum(r.top + r.height / 2)).sort((a, b) => a.top - b.top)[0]
  const node = [...document.querySelectorAll('.gear-selector .gs-drum button.gs-item')].map((b) => { const c = getComputedStyle(b, '::before'), r = b.getBoundingClientRect(); return { left: r.left + parseFloat(c.left), y: r.top + r.height / 2 } }).filter((n) => inDrum(n.y)).sort((a, b) => a.y - b.y)[0]
  return { top: text.top, left: node.left }
})
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
      // The column starts at the top left; its top inset matches its left (10, below), which
      // replaced the shared top edge (the owner, 25 November 2026).
      if (mode === 'free') drumFree = m.drum
      else assert.ok(Math.abs(m.drum.top - drumFree.top) <= 1 && Math.abs(m.drum.bottom - drumFree.bottom) <= 1, `${at}: capturing the cursor moves nothing in the drum ${JSON.stringify([drumFree, m.drum])}`)
      assert.ok(m.keys.length >= 3 && m.keys.every(Boolean), `${at}: the Wings, Zorb and Chat keys are laid out ${JSON.stringify(m.keys)}`)
      await page.waitForTimeout(400)
      const shown = await page.evaluate(() => ['.hud-accessories', '.hud-chat', '.gear-selector .gs-detail .gs-keyhint', '.gear-selector .gs-drum'].map((s) => document.querySelector(s).checkVisibility({ opacityProperty: true, visibilityProperty: true })))
      assert.deepEqual(shown, mode === 'free' ? [true, true, true, true] : [false, false, false, true], `${at}: rows, detail and drum shown ${JSON.stringify(shown)}`)
      onLines(await lines(page), at)
      await page.waitForFunction(() => document.querySelector('.gear-selector').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), null, { timeout: 10000 })
      oneColumn(await names(page), at)
      // 10. The top inset equals the left.
      const inset = await insets(page)
      assert.ok(Math.abs(inset.top - inset.left) <= 2, `${at}: the column is as far from the top as from the left ${JSON.stringify(inset)}`)
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
        // Measured once that gear is selected (the game takes the key on its next frame, later on
        // a loaded machine) and the drum has stopped turning.
        await page.waitForFunction((g) => document.querySelectorAll('.gear-selector .gs-drum button.gs-item')[g]?.classList.contains('is-active'), g, { timeout: 10000 })
        await page.waitForFunction(() => document.querySelector('.gear-selector').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), null, { timeout: 10000 })
        onLines(await lines(page), `${w}x${h} gear ${g + 1}`)
        oneColumn(await names(page), `${w}x${h} gear ${g + 1}`)
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
      // 7. The charge ring, driven through Plasma Thunder's own charge (0 to 1; below 0 is idle).
      await page.keyboard.press('2')
      await page.waitForFunction(() => document.querySelector('.gear-selector')?.dataset.gear === 'red', null, { timeout: 10000 })
      const ring = async (charge) => {
        await page.evaluate((c) => { window.miraChat.net.bigRed.charge = c }, charge)
        // Measured once the ring carries this level (the game hands it over on its next frame,
        // later on a loaded machine) and its sweep has finished moving.
        await page.waitForFunction((c) => {
          const svg = document.querySelector('.gear-selector .gs-window .gs-ring')
          return Math.abs(parseFloat(svg.style.getPropertyValue('--level') || '0') - Math.max(0, c)) < .01
            && [svg, svg.querySelector('circle')].every((e) => e.getAnimations().every((a) => a.playState !== 'running' || a.animationName === 'gs-ring-full'))
        }, charge, { timeout: 10000 })
        await page.waitForTimeout(200)
        return page.evaluate(() => {
          const svg = document.querySelector('.gear-selector .gs-window .gs-ring'), r = svg.getBoundingClientRect(), s = getComputedStyle(svg)
          const node = getComputedStyle(document.querySelector('.gear-selector .gs-window'), '::before'), w = document.querySelector('.gear-selector .gs-window').getBoundingClientRect()
          const nodeX = w.left + parseFloat(node.left) + parseFloat(node.width) / 2, nodeY = w.top + parseFloat(node.top) + parseFloat(node.marginTop) + parseFloat(node.height) / 2
          // The swept angle: the drawn share of the circle's pathLength of 100, in degrees.
          // (Computed as "calc(66.67)" or "66.67px": the number is what counts.)
          const offset = Number(/-?\d+(\.\d+)?/.exec(getComputedStyle(svg.querySelector('circle')).strokeDashoffset)?.[0])
          return { opacity: +s.opacity, angle: (100 - offset) * 3.6, full: svg.classList.contains('is-full'), centred: Math.hypot(r.left + r.width / 2 - nodeX, r.top + r.height / 2 - nodeY), bars: document.querySelectorAll('.gear-selector .gs-level').length }
        })
      }
      const idle = await ring(-1)
      assert.ok(idle.opacity === 0 && idle.bars === 0, `no ring at rest, and no charge bar anywhere ${JSON.stringify(idle)}`)
      for (const charge of [1 / 3, 1]) {
        const part = await ring(charge)
        assert.ok(part.opacity === 1 && Math.abs(part.angle - charge * 360) <= 4 && part.full === (charge >= 1) && part.centred <= .5, `the ring ${charge.toFixed(2)} charged sweeps that share of the circle round the lit node ${JSON.stringify(part)}`)
        oneColumn(await names(page), `charge ${charge.toFixed(2)}`)
      }
      await ring(-1)
      // 9. A cord launched straight down (Bungee.launch's direction is for automated checks).
      await page.evaluate(() => window.miraNet.gear.select('bungee'))
      assert.equal((await releaseHint(page)).shown, false, 'no release hint without a cord')
      await page.waitForFunction(() => window.miraNet.bungee.launch([0, -1, 0]), null, { timeout: 20000, polling: 250 })
      await page.waitForFunction(() => window.miraNet.bungee.attached && window.miraNet.gear.controls().status, null, { timeout: 20000 })
      await page.waitForTimeout(300)
      const free = await releaseHint(page)
      assert.ok(free.status?.whole && free.status.clear && !free.shown, `cursor free: the status beside the name, the way to let go said once, by the hints ${JSON.stringify(free)}`)
      await page.mouse.click(w / 2, h * .3)
      await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-focus'), null, { timeout: 5000 })
      await page.waitForTimeout(100)
      await page.waitForFunction(() => document.querySelector('.gear-selector').getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.animationName === 'gs-ring-full'), null, { timeout: 10000 })
      const locked = await releaseHint(page)
      assert.ok(locked.status?.whole && locked.status.clear && locked.hint?.whole && locked.hint.clear && locked.key && /let go/i.test(locked.text), `captured with a cord: status and release hint whole and clear ${JSON.stringify(locked)}`)
      // Captured, the line follows the selected name: within 20 px of its last letter, on its baseline.
      const follows = await page.evaluate(() => {
        const name = document.querySelector('.gear-selector .gs-drum button.gs-item.is-active .gs-text').getBoundingClientRect(), line = document.querySelector('.gear-selector .gs-held').getBoundingClientRect()
        return { gap: line.left - name.right, baseline: line.bottom - name.bottom }
      })
      assert.ok(follows.gap >= 0 && follows.gap <= 20 && Math.abs(follows.baseline) <= 3, `captured: the Grapple line follows its name ${JSON.stringify(follows)}`)
      await page.keyboard.press(`Key${locked.key}`)
      await page.waitForFunction(() => !window.miraNet.bungee.attached, null, { timeout: 5000 })
      await page.waitForTimeout(200)
      assert.equal((await releaseHint(page)).shown, false, 'the hint goes with the cord')
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      await page.keyboard.press('1')
      await page.waitForTimeout(50)
      await page.waitForFunction(() => document.querySelector('.gear-selector').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), null, { timeout: 10000 })
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
    oneColumn(await names(page), `${viewport.width}x${viewport.height}`)
    // 9. On touch the release hint names the gesture, and it and the status are drawn whole.
    await page.evaluate(() => window.miraNet.gear.select('bungee'))
    await page.waitForFunction(() => window.miraNet.bungee.attached || window.miraNet.bungee.launch([0, -1, 0]), null, { timeout: 20000, polling: 250 })
    await page.waitForFunction(() => window.miraNet.bungee.attached && window.miraNet.gear.controls().status, null, { timeout: 20000 })
    await page.waitForTimeout(400)
    const touchHint = await releaseHint(page)
    // A visible LET GO thumb button says how to let go; without one the hint must show.
    assert.ok(touchHint.status?.whole && touchHint.status.clear && (touchHint.letGo ? !touchHint.shown : touchHint.hint?.whole && touchHint.hint.clear), `${viewport.width}x${viewport.height}: the status under the name, and a way to let go shown ${JSON.stringify(touchHint)}`)
    assert.ok(touchHint.letGo, `${viewport.width}x${viewport.height}: the LET GO thumb button shows while a cord is attached`)
    await context.close()
  }
  assert.deepEqual(errors, [], 'no page errors')
  console.log('hud-column: ok')
} finally { await browser.close() }
