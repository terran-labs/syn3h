/**
 * The focus display in play. Bugs caught: the panels staying up while the player drives with
 * the cursor captured, the aiming display missing in one of its three looks, the aiming
 * display staying over a menu while input is suspended, the panels not coming back when the
 * cursor is let go, and the instruments showing with the cursor free (they show only captured).
 *
 *   MIRA_URL=http://127.0.0.1:5173/ /Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/inspector.mjs
 *
 * The cards, search and folds are checked by sidebar.mjs and inspector-edit.mjs, the vehicle
 * picker by discoverability.mjs, and a world's JSON (copy, paste, limits) by inspector.test.ts.
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/inspector'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${process.env.MIRA_URL ?? 'http://127.0.0.1:5187/'}?room=inspector-${Date.now()}&autoplay=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.mira?.game?.tick > 40, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  // On arrival the browser may or may not have granted the cursor. Either way the panels
  // show exactly when it is free.
  assert.equal(await page.evaluate(() => document.querySelector('.world-inspector').hidden), await page.evaluate(() => !!document.pointerLockElement))
  if (await page.evaluate(() => !!document.pointerLockElement)) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.world-inspector').hidden) }
  // With the cursor free the instruments are gone (the owner, 25 November 2026: they show only
  // when the cursor is locked); the display fades, so this waits for it.
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.focus-hud')).opacity === '0', null, { timeout: 5000 })
  // Capture the cursor: the cards fade away and the focus display fades in, in three looks.
  await page.mouse.click(500, 420)
  await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-focus'), null, { timeout: 5000 })
  await page.waitForTimeout(900)
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.world-inspector')).opacity), '0')
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.focus-hud')).opacity), '1')
  await page.keyboard.down('w')
  for (const [style, name, reticle] of [[0, 'arc', 1], [1, 'horizon', 0], [2, 'telemetry', 2]]) {
    await page.evaluate(([style, reticle]) => { window.mira.params.set('hud.focusStyle', style); window.mira.params.set('hud.reticle', reticle) }, [style, reticle])
    await page.waitForTimeout(1200)
    assert.equal(await page.locator(`.focus-hud [data-style="${style}"]`).first().evaluate(el => getComputedStyle(el).display !== 'none'), true, `${name} look shows`)
    await page.screenshot({ path: `${out}/focus-${name}.png` })
  }
  await page.keyboard.up('w')
  // Each crescent's bold part is one run from the crescent's bottom end, as long as its share of
  // the scale (the owner, 25 November 2026: two bold runs showed, one at the top, even at zero).
  // The fill is drawn as its own arc, never as a dash: a dash on a non-scaling stroke is measured
  // in screen pixels, so it repeated once a unit was larger than a pixel. Values are set through
  // the display itself with the shell's own updates held, at two window sizes (the second scales
  // a unit above a pixel, where the old dash broke).
  await page.evaluate(() => { window.mira.params.set('hud.focusStyle', 0) })
  await page.evaluate(() => { const hud = window.mira.shell.focusHud; hud.__update = hud.update.bind(hud); hud.update = () => {} })
  for (const [width, height] of [[1280, 800], [1700, 1100]]) {
    await page.setViewportSize({ width, height })
    for (const fraction of [0, .25, .5, 1]) {
      // The current full scales: 140 mph (in m/s) and 600 m.
      await page.evaluate(f => window.mira.shell.focusHud.__update(true, { speed: (140 / 2.23694) * f, altitude: 600 * f, heading: 0, world: 'Arc check', hour: 12 }), fraction)
      const arcs = await page.evaluate(() => {
        const faint = [...document.querySelectorAll('.focus-hud [data-style="0"] .fh-faint')]
        return ['speed', 'altitude'].map((name, i) => {
          const fill = document.querySelector(`.focus-hud [data-arc="${name}"]`), track = faint[i], d = fill.getAttribute('d') ?? ''
          const length = d ? fill.getTotalLength() : 0, start = d ? fill.getPointAtLength(0) : null, bottom = track.getPointAtLength(0)
          return { name, d, runs: (d.match(/M/g) ?? []).length, dash: getComputedStyle(fill).strokeDasharray, share: length / track.getTotalLength(), start: start && [start.x, start.y], bottom: [bottom.x, bottom.y] }
        })
      })
      for (const arc of arcs) {
        const at = `${width}x${height} ${arc.name} at ${fraction}`
        assert.equal(arc.dash, 'none', `${at}: the fill is drawn, not dashed`)
        if (fraction === 0) { assert.equal(arc.d, '', `${at}: nothing is drawn at zero`); continue }
        assert.equal(arc.runs, 1, `${at}: one bold run ${arc.d}`)
        assert.ok(Math.hypot(arc.start[0] - arc.bottom[0], arc.start[1] - arc.bottom[1]) < 0.5, `${at}: the run starts at the crescent's bottom end ${JSON.stringify(arc)}`)
        assert.ok(Math.abs(arc.share - fraction) < 0.01, `${at}: the run is ${fraction} of the crescent ${JSON.stringify(arc)}`)
      }
    }
  }
  await page.evaluate(() => { const hud = window.mira.shell.focusHud; hud.update = hud.__update })
  await page.setViewportSize({ width: 1440, height: 900 })
  // Suspended input hides the aiming display even if the browser still holds the cursor.
  await page.evaluate(() => { window.mira.game.input.suspended = true })
  await page.waitForFunction(() => !document.querySelector('.mira-shell').classList.contains('is-focus'))
  await page.evaluate(() => { window.mira.game.input.suspended = false })
  await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-focus'))
  // Letting the cursor go brings the full interface back.
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForFunction(() => !document.querySelector('.mira-shell').classList.contains('is-focus'))
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.world-inspector')).opacity === '1')
  // and losing the lock takes the instruments away.
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.focus-hud')).opacity === '0', null, { timeout: 5000 })
  console.log(JSON.stringify({ ok: true, errors }))
} finally { await browser.close() }
if (errors.length) { console.log(errors); process.exitCode = 1 }
