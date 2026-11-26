// The in-play panels do their jobs, on a desktop and on a phone. Bugs caught: a section missing
// from the panels or not found by search; Reset world wiping the world on one press; Pause not
// pausing or not resuming; open cards lost when a desktop's panels close and reopen; the panels unable
// to open or close with the controls a player has (the Panels button while they are closed;
// Close panels, or on a phone with one panel open that panel's X, while they are open); motion
// played under reduced motion. Layout (sizes, order, rows) is the owner's to tune and is not
// pinned here; touch layout lives in phone-panels.mjs. Also: a bot's row without the bot mark.
//   MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/sidebar.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'

const SECTIONS = ['game', 'players', 'world', 'performance', 'chat']
const openSections = page => page.evaluate(() => [...document.querySelectorAll('.world-inspector .wi-card.is-open')].map(c => c.dataset.section))
const settled = page => page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations().some(a => a.playState === 'running'))

for (const mode of ['desktop', 'phone']) {
  const touch = mode === 'phone'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${process.env.MIRA_URL}?autoplay=1&room=sidebar-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
    await page.waitForTimeout(800)
    const rail = page.locator('.world-inspector')
    const press = locator => touch ? locator.tap() : locator.click()
    // Whatever close control the player can see: the open panel's own X (a phone with one panel
    // open, from v26.11.2202), else Close panels.
    const closePanels = async () => {
      for (const selector of ['.world-inspector .wi-card.is-open > .wi-card-close', '.world-inspector .panels-close']) {
        const control = page.locator(selector).first()
        if (await control.isVisible()) { await press(control); await rail.waitFor({ state: 'hidden' }); return }
      }
      assert.fail(`${mode}: no visible control closes the open panels`)
    }
    const openPanels = async () => { await press(page.locator('.inspector-toggle')); await rail.waitFor({ state: 'visible' }); await settled(page) }

    if (touch) { if (await rail.isVisible()) await closePanels(); await openPanels() }
    else {
      if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
      await rail.waitFor({ state: 'visible' }); await settled(page)
    }

    // Every section is there, and survives a rebuild of the parameter registry.
    const present = () => page.locator('.wi-cards > [data-section]').evaluateAll(es => es.map(e => e.dataset.section).sort())
    assert.deepEqual(await present(), [...SECTIONS].sort(), `${mode}: every section is in the panels`)
    await page.evaluate(() => mira.shell.inspector.rebuild())
    assert.deepEqual(await present(), [...SECTIONS].sort(), `${mode}: every section survives a registry rebuild`)

    // Search finds each section, and the vehicle controls by what a player would type.
    const header = rail.locator('.rail-command'), search = header.locator('.wi-search')
    for (const section of SECTIONS) {
      // Old card names still find the card that took them over.
      await search.fill(section === 'players' ? 'Players' : section)
      assert.ok(await page.locator(`.wi-cards > [data-section=${section}]`).isVisible(), `${mode}: ${section} is found by search`)
    }
    await search.fill('vehicle')
    assert.ok(await page.locator('.wi-vehicle-picker').first().isVisible(), `${mode}: "vehicle" finds the vehicle picker`)
    await search.fill(''); await search.blur()
    if (!touch) {
      await page.keyboard.press('Control+f')
      assert.ok(await search.evaluate(el => el === document.activeElement), 'Ctrl+F reaches the search')
      await search.blur()
    }

    // Reset world asks before it wipes anything.
    const seedBefore = await page.evaluate(() => mira.params.get('world.seed').value)
    await page.evaluate(() => { mira.params.set('world.seed', 4242, 'local'); document.querySelector('.wi-card[data-section=world] [data-wi=reset]').click() })
    assert.equal(await page.evaluate(() => mira.params.get('world.seed').value), 4242, `${mode}: one press on Reset world only asks`)
    await page.evaluate(seed => mira.params.set('world.seed', seed, 'local'), seedBefore)

    // A card opens from its header. On a desktop it is still open after the panels close and
    // reopen; on a phone Show panels always opens the list (the owner, 19 November 2026,
    // Inspector.open), so there the check is that the player's own controls close and reopen them.
    // World starts closed; Game starts open for a new desktop player.
    await press(page.locator('.wi-cards > [data-section=world] > .wi-head')); await settled(page)
    const open = await openSections(page)
    assert.ok(open.includes('world'), `${mode}: a card opens from its header (${JSON.stringify(open)})`)
    if (touch) { await closePanels(); await openPanels() }
    else {
      await page.evaluate(() => { const i = mira.shell.inspector; i.open = false; i.open = true }); await settled(page)
      assert.deepEqual(await openSections(page), open, `${mode}: open cards survive closing the panels`)
    }

    // A bot's row in Players carries the bot mark, and no row spells out "bot".
    if (!touch) {
      await page.waitForFunction(() => [...(window.miraNet?.players?.values() ?? [])].some(p => p.bot), null, { timeout: 60000 })
      await page.evaluate(() => mira.shell.inspector.revealCard('players')); await settled(page)
      const rows = await page.evaluate(() => {
        const bots = new Set([...miraNet.players.values()].filter(p => p.bot).map(p => miraNet.displayName(p.id)))
        return [...document.querySelectorAll('.wi-card[data-section=players] .score-row')].map(r => { const n = r.querySelector('.score-name'); return { bot: bots.has(n.dataset.name ?? n.title), mark: !!n.querySelector('svg.bot-mark[aria-label=Bot]'), text: r.textContent } })
      })
      assert.ok(rows.some(r => r.bot), `${mode}: a bot is listed in Players (${JSON.stringify(rows)})`)
      for (const r of rows) assert.equal(r.mark, r.bot, `${mode}: the bot mark is on bots' rows only (${JSON.stringify(r)})`)
      assert.ok(rows.every(r => !/\bbot\b/i.test(r.text)), `${mode}: no row spells out "bot"`)
    }

    // Changing the interface Style leaves every other card's groups as the player left them.
    // Bug caught: the first style change loaded the glass code, its settings rebuilt the panels
    // and every open group closed (the Game card's Bots, for one).
    // Desktop: a phone shows one card alone, and the rebuild that closed the groups is the same code there.
    if (!touch) {
    await page.evaluate(() => mira.shell.inspector.revealCard('world')); await settled(page)
    const bots = () => page.evaluate(() => { const g = document.querySelector('.wi-card[data-section=world]'); return { card: g.classList.contains('is-open'), group: g.querySelector('.wi-group[data-group=Bots]')?.open } })
    await page.evaluate(() => { document.querySelector('.wi-card[data-section=world] .wi-group[data-group=Bots]').open = true })
    const style = await page.evaluate(() => mira.params.get('hud.glass').value)
    for (const value of [0, 1, 2, style]) {
      await page.evaluate((v) => mira.params.set('hud.glass', v, 'local'), value)
      await page.waitForFunction(() => mira.params.get('glass.thickness') !== undefined || mira.params.get('hud.glass').value !== 0, null, { timeout: 20000 })
      await page.waitForTimeout(400)
      assert.deepEqual(await bots(), { card: true, group: true }, `${mode}: the World card and its Bots section stay open when Style becomes ${value}`)
    }
    }

    // Pause pauses, and the veil resumes.
    await press(header.locator('.rail-pause'))
    await page.waitForFunction(() => mira.game.input.suspended)
    await page.locator('.pause-veil').click()
    await page.waitForFunction(() => !mira.game.input.suspended)

    // Reduced motion: the panels appear without animating. (On a phone Resume returns to
    // driving, closing the panels; they are opened again with the Panels button.)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    if (touch) { await rail.waitFor({ state: 'hidden' }); await press(page.locator('.inspector-toggle')); await rail.waitFor({ state: 'visible' }) }
    else await page.evaluate(() => { const i = mira.shell.inspector; i.open = false; i.open = true })
    assert.equal(await rail.evaluate(el => el.getAnimations().length), 0, `${mode}: reduced motion skips the panels' animation`)
    assert.deepEqual(errors, [], `${mode}: no page errors`)
    console.log(`${mode}: sidebar ok`)
  } finally { await browser.close() }
}

// A wide sidebar never covers the rest of the play HUD (the Foreman, 25 November 2026: at 552 px
// it covered the new-build notice, the world name and the altitude readout). At its widest, with
// the new-build notice and the running-slow offer showing (made the way the game makes them, as in
// bottom-stack.mjs), the column's box meets none of: the bottom stack, the world name, the speed
// and altitude readouts, the gear column, the minimap.
for (const [width, height] of [[1280, 800], [1440, 900], [1700, 1100]]) {
  const tag = `${width}x${height}`
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width, height } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(() => { try { localStorage.setItem('mira.sidebar.width', '10000') } catch { /* storage optional */ } })
    await page.goto(`${process.env.MIRA_URL}?autoplay=1&room=sidebar-wide-${tag}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForFunction(() => document.querySelector('.mira-shell')?.classList.contains('is-playing') && !document.querySelector('.mira-shell').classList.contains('is-descending'), null, { timeout: 120000 })
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const rail = page.locator('.world-inspector'); await rail.waitFor({ state: 'visible' }); await settled(page)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mira:new-build')))
    await page.evaluate(() => {
      const quality = window.mira.game.quality, history = quality.history, level = quality.governor.level
      const offer = Object.freeze({ level, targetLevel: Math.max(0, level - 1), observedFps: 24, bots: 4, fewerBots: false })
      const sample = history.sample.bind(history)
      history.sample = (...args) => { const changed = sample(...args); history.recommendation = offer; return changed }
      history.recommendation = offer
      quality.publishPerformance()
    })
    await page.waitForFunction(() => ['#mira-build-notice', '.bottom-stack > .performance-recommendation'].every(s => { const el = document.querySelector(s); return el && !el.hidden && Number(getComputedStyle(el).opacity) === 1 }), null, { timeout: 30000 })
    // The widest the handle allows now that everything is showing (End on the handle).
    await page.locator('.rail-resize').focus(); await page.keyboard.press('End'); await page.waitForTimeout(300)
    const found = await page.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
      // Painted, counting its ancestors: the instruments' readouts keep their own opacity while their display fades.
      const shown = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      const others = [...document.querySelectorAll('.bottom-stack > *, .focus-hud .fh-top, .focus-hud .fh-left, .focus-hud .fh-right, .gear-selector, .shell-minimap')].filter(shown).map(el => ({ name: el.id || el.className.split(' ').slice(0, 2).join('.'), ...box(el) }))
      return { rail: box(document.querySelector('.world-inspector')), width: Math.round(document.querySelector('.world-inspector').getBoundingClientRect().width), others }
    })
    const meets = (a, b) => a.right > b.left + 0.5 && a.left < b.right - 0.5 && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5
    for (const other of found.others) assert.ok(!meets(found.rail, other), `${tag}: the sidebar at its widest (${found.width}px) covers ${other.name} ${JSON.stringify([found.rail, other])}`)
    assert.ok(found.others.some(o => o.name === 'mira-build-notice'), `${tag}: the notice was measured (${found.others.map(o => o.name)})`)
    // Beside the column the instruments are gone (they show only with the cursor captured).
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.focus-hud')).opacity), '0', `${tag}: no instruments beside the sidebar`)
    // Incoming chat in the driving view (the cursor captured, the sidebar gone): the notification
    // cards at the upper right meet neither the world name nor the sidebar, at the width the
    // player chose (ui/hud-messages-and-help moved them there, 25 November 2026).
    await page.evaluate(() => window.miraNet.chat.receive({ type: 'chat', from: 4242, text: 'race you to the volcano, then back round the long way' }))
    await page.evaluate(() => window.mira.params.set('hud.mode', 1))
    await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-focus') && [...document.querySelectorAll('.chat-strip .chat-line')].some(l => l.checkVisibility({ opacityProperty: true })), null, { timeout: 15000 })
    await page.waitForTimeout(800)
    const driving = await page.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
      const seen = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      const rail = document.querySelector('.world-inspector'), name = document.querySelector('.focus-hud .fh-top')
      return { lines: [...document.querySelectorAll('.chat-strip .chat-line')].filter(seen).map(box), rail: seen(rail) ? box(rail) : null, name: name && seen(name) ? box(name) : null }
    })
    assert.ok(driving.lines.length > 0, `${tag}: a chat card shows in the driving view`)
    for (const line of driving.lines) {
      if (driving.rail) assert.ok(!meets(line, driving.rail), `${tag}: a chat card meets the sidebar ${JSON.stringify([line, driving.rail])}`)
      if (driving.name) assert.ok(!meets(line, driving.name), `${tag}: a chat card meets the world name ${JSON.stringify([line, driving.name])}`)
    }
    await page.evaluate(() => window.mira.params.set('hud.mode', 0))
    await page.waitForFunction(() => !document.querySelector('.mira-shell').classList.contains('is-focus'), null, { timeout: 15000 })
    await settled(page)
    // At its narrowest, with the running-slow offer making Performance's value its longest, no
    // card header's value is cut short.
    await page.locator('.rail-resize').focus(); await page.keyboard.press('Home'); await page.waitForTimeout(300)
    const cut = await page.evaluate(() => [...document.querySelectorAll('.wi-cards > .wi-card .wi-sum')].filter(s => s.scrollWidth > s.clientWidth + 1).map(s => `${s.closest('.wi-card').dataset.section}: ${s.textContent}`))
    assert.deepEqual(cut, [], `${tag}: at its narrowest every card header's value reads whole`)
    assert.deepEqual(errors, [], `${tag}: no page errors`)
    console.log(`${tag}: widest sidebar ${found.width}px clear of the play HUD; narrowest reads whole`)
  } finally { await browser.close() }
}
