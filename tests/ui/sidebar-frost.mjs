import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
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
  await page.goto(`${process.env.MIRA_URL}?tap=0&intro=0&autoplay=1&room=frost-${phase}-${mode}-${Date.now()}`)
  await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
  const rail = page.locator('.world-inspector')
  if (mode === 'phone' && !await rail.isVisible()) await page.locator('.inspector-toggle').tap()
  else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
  await rail.waitFor({ state: 'visible' })
  await page.evaluate(async () => { (await import('/src/ui/quality/ladder.ts')).setQualityChoice('full'); mira.game.quality.setAuto(false); mira.game.quality.setLevel(3) })
  await page.waitForFunction(() => Number(document.documentElement.dataset.gfx) > 0 && document.querySelector('.mira-shell').dataset.uiFrost === 'on')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.glassMaterial), 'flat')
  // The foot is no longer a glass surface: it holds one button, which carries its own backing.
  const surfaces = '.wi-cards > [data-section]'
  const readSurfaces = () => rail.locator(surfaces).evaluateAll(es => es.map(el => { const s = getComputedStyle(el); return { card: el.dataset.section || 'bottom', open: el.classList.contains('is-open'), background: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter } }))
  const checkSurfaces = (rows, off = false) => {
   assert.deepEqual(rows.map(r => r.card), ['you', 'game', 'players', 'vehicles', 'world', 'performance', 'chat'])
   for (const row of rows) assert.equal(row.blur, off || !row.open ? 'none' : 'blur(4px)', row.card)
  }
  const results = []
  for (const [planet, hour] of [['ice', 12], ['volcanic', 0], ['desert', 12]]) {
   await page.evaluate(async ({ planet, hour }) => {
    const { applyPlanet } = await import('/src/world/planets.ts'), { params } = await import('/shared/params.ts')
    applyPlanet(planet, 12345); params.set('sun.dayLength', 0); params.set('sun.timeOfDay', hour)
    mira.shell.inspector.revealCard('game')
   }, { planet, hour })
   await page.waitForTimeout(1500)
   const game = rail.locator('[data-section=game]'), options = game.locator('[data-id="game.mode"] .wi-seg button')
   await game.locator('.wi-head').scrollIntoViewIfNeeded()
   await page.screenshot({ path: `${out}/${mode}-${planet}-game.png` })
   const bounds = await options.evaluateAll(es => es.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
   const frost = await game.evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter } })
   if (!baseline) {
    assert.equal(bounds.length, 3)
    // Each mode can be seen and chosen: inside the card, clear of the others, and a press at its
    // centre lands on it. (Segments are content-width pills since v26.11.2202; equal widths and
    // a 44 px drawn height are no longer the design, so they are not pinned.)
    const card = await game.evaluate(el => el.getBoundingClientRect().toJSON())
    assert.ok(bounds.every(b => b.width > 0 && b.x >= card.x - 1 && b.x + b.width <= card.x + card.width + 1), `each game mode option is inside the card (${JSON.stringify(bounds)})`)
    assert.ok(bounds.every((b, i) => bounds.every((o, j) => i === j || b.x + b.width <= o.x + 0.5 || o.x + o.width <= b.x + 0.5 || b.y + b.height <= o.y + 0.5 || o.y + o.height <= b.y + 0.5)), 'game mode options do not overlap')
    assert.ok(await options.evaluateAll(es => es.every(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })), 'a press at each game mode option lands on it')
    assert.ok(Number(/,\s*([\d.]+)\)$/.exec(frost.background)?.[1] ?? 1) >= .6, `card body dense enough to read over a bright world (${frost.background})`)
    const cards = await readSurfaces(); console.log(JSON.stringify({ mode, planet, cards })); checkSurfaces(cards)
    assert.equal(await rail.locator('[data-section=sky]').count(), 0)
    for (const group of ['Tag', 'Tag beams', 'Zorb']) {
     const fold = game.locator(`[data-group="${group}"]`)
     assert.equal(await fold.count(), 1); assert.equal(await fold.evaluate(el => el.open), false)
    }
    await page.evaluate(() => mira.shell.inspector.revealCard('you'))
    const me = rail.locator('[data-section=you]'); await me.locator('.wi-head').scrollIntoViewIfNeeded()
    assert.equal(await me.locator('h3').textContent(), 'Me')
    assert.equal(await me.locator('.wi-swatch').count(), 2)
    for (const swatch of await me.locator('.wi-swatch').all()) { const r = await swatch.boundingBox(); assert.ok(r.width >= 44 && r.height >= 44) }
    await page.screenshot({ path: `${out}/${mode}-${planet}-me.png` })
   }
   if (baseline) {
    await page.evaluate(() => mira.shell.inspector.revealCard('vehicles'))
    await rail.locator('[data-section=vehicles] .wi-head').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${mode}-${planet}-vehicle.png` })
   }
   results.push({ planet, hour, bounds, frost })
  }
  if (!baseline) {
   const gameTint = (await readSurfaces()).find(row => row.card === 'you').background
   const filters = await page.evaluate(() => {
    const root = document.documentElement, shell = document.querySelector('.mira-shell')
    const card = shell.querySelector('.wi-card.is-open')
    const filter = el => getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter
    const toggle = (node, name, value) => {
     const saved = node.getAttribute(name)
     node.setAttribute(name, value)
     const off = filter(card)
     if (saved === null) node.removeAttribute(name)
     else node.setAttribute(name, saved)
     return off
    }
    return {
     card: filter(card),
     controls: [...shell.querySelectorAll('.touch-controls .liquid-glass, .hud-navigation .liquid-glass, .rail-command button, .rail-command input, .wi-card button')].map(filter),
     shed: toggle(shell, 'data-ui-frost', 'off'),
     driveShed: toggle(root, 'data-drive-glass', 'shed'),
    }
   })
   assert.equal(filters.card, 'blur(4px)')
   assert.ok(filters.controls.every(value => value === 'none'), `${mode}: Flat controls have no filter`)
   assert.deepEqual([filters.shed, filters.driveShed], ['none', 'none'])
   await page.evaluate(() => mira.game.quality.setLevel(0))
   await page.waitForFunction(() => document.documentElement.dataset.gfx === '0' && document.querySelector('.mira-shell').dataset.uiFrost === 'off')
   const minimal = await rail.locator('[data-section=you]').evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter } })
   assert.equal(minimal.blur, 'none'); assert.equal(minimal.background, gameTint)
   const cards = await readSurfaces(); console.log(JSON.stringify({ mode, minimalCards: cards })); checkSurfaces(cards, true)
   await page.screenshot({ path: `${out}/${mode}-minimal.png` })
   results.push({ minimal })
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ phase, mode, results, errors }))
 } finally { await browser.close() }
}
