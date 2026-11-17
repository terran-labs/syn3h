import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const baseline = process.env.UX_BASELINE === '1', phase = baseline ? 'before' : 'after'
const out = `tests/ui/artifacts/sidebar-frost/${phase}`
await mkdir(out, { recursive: true })
for (const mode of ['desktop', 'phone']) {
 const browser = await (mode === 'phone' ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
 try {
  const page = await browser.newPage(mode === 'phone' ? devices['iPhone 14'] : { viewport: { width: 1440, height: 1000 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${process.env.SYN3H_URL}?autoplay=1&room=frost-${phase}-${mode}-${Date.now()}`)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden' })
  const rail = page.locator('.world-inspector')
  if (mode === 'phone' && !await rail.isVisible()) await page.locator('.inspector-toggle').tap()
  else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
  await rail.waitFor({ state: 'visible' })
  await page.evaluate(async () => { (await import('/src/ui/quality/ladder.ts')).setQualityChoice('full'); syn3h.game.quality.setAuto(false); syn3h.game.quality.setLevel(3) })
  // The foot is no longer a glass surface: it holds one button, which carries its own backing.
  const surfaces = '.wi-cards > [data-section]'
  const readSurfaces = () => rail.locator(surfaces).evaluateAll(es => es.map(el => { const s = getComputedStyle(el); return { card: el.dataset.section || 'bottom', background: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter } }))
  const checkSurfaces = (rows, off = false) => {
   assert.deepEqual(rows.map(r => r.card), ['you', 'game', 'players', 'vehicles', 'world', 'performance'])
   for (const r of rows) { if (off) assert.equal(r.blur, 'none', r.card); else assert.match(r.blur, /blur\(28px\)/, r.card); assert.match(r.background, off ? /0\.94\)/ : /0\.65\)/, r.card) }
  }
  const results = []
  for (const [planet, hour] of [['ice', 12], ['volcanic', 0], ['desert', 12]]) {
   await page.evaluate(async ({ planet, hour }) => {
    const { applyPlanet } = await import('/src/world/planets.ts'), { params } = await import('/shared/params.ts')
    applyPlanet(planet, 12345); params.set('sun.dayLength', 0); params.set('sun.timeOfDay', hour)
    syn3h.shell.inspector.revealCard('game')
   }, { planet, hour })
   await page.waitForTimeout(1500)
   const game = rail.locator('[data-section=game]'), options = game.locator('[data-id="game.mode"] .wi-seg button')
   await game.locator('.wi-head').scrollIntoViewIfNeeded()
   await page.screenshot({ path: `${out}/${mode}-${planet}-game.png` })
   const bounds = await options.evaluateAll(es => es.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
   const frost = await game.evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter } })
   if (!baseline) {
    assert.equal(bounds.length, 3)
    assert.ok(bounds.every(b => Math.abs(b.y - bounds[0].y) < 1 && Math.abs(b.width - bounds[0].width) < 1 && b.height >= 44), 'mode segments share one equal row')
    assert.match(frost.blur, /blur\(28px\)/)
    assert.match(frost.background, /0\.65\)/)
    const cards = await readSurfaces(); console.log(JSON.stringify({ mode, planet, cards })); checkSurfaces(cards)
    assert.equal(await rail.locator('[data-section=sky]').count(), 0)
    for (const group of ['Tag', 'Tag beams', 'Zorb']) {
     const fold = game.locator(`[data-group="${group}"]`)
     assert.equal(await fold.count(), 1); assert.equal(await fold.evaluate(el => el.open), false)
    }
    await page.evaluate(() => syn3h.shell.inspector.revealCard('you'))
    const me = rail.locator('[data-section=you]'); await me.locator('.wi-head').scrollIntoViewIfNeeded()
    assert.equal(await me.locator('h3').textContent(), 'Me')
    assert.equal(await me.locator('.wi-swatch').count(), 2)
    for (const swatch of await me.locator('.wi-swatch').all()) { const r = await swatch.boundingBox(); assert.ok(r.width >= 44 && r.height >= 44) }
    await page.screenshot({ path: `${out}/${mode}-${planet}-me.png` })
   }
   if (baseline) {
    await page.evaluate(() => syn3h.shell.inspector.revealCard('vehicles'))
    await rail.locator('[data-section=vehicles] .wi-head').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${mode}-${planet}-vehicle.png` })
   }
   results.push({ planet, hour, bounds, frost })
  }
  if (!baseline) {
   await page.evaluate(() => syn3h.game.quality.setLevel(0))
   await page.waitForFunction(() => document.querySelector('.syn3h-shell').dataset.uiFrost === 'off')
   const minimal = await rail.locator('[data-section=you]').evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter } })
   assert.equal(minimal.blur, 'none'); assert.match(minimal.background, /0\.94\)/)
   const cards = await readSurfaces(); console.log(JSON.stringify({ mode, minimalCards: cards })); checkSurfaces(cards, true)
   await page.screenshot({ path: `${out}/${mode}-minimal.png` })
   results.push({ minimal })
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ phase, mode, results, errors }))
 } finally { await browser.close() }
}
