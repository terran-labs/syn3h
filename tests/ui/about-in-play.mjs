/**
 * The Welcome guide (it was About) opened in play: from the sidebar it shows over the world, cancels held
 * fire, closes on Escape without firing, and leaves the address and the room alone. No image
 * loads before it opens; after, only the Welcome pictures (src/ui/welcome/welcome.ts).
 *
 *   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/about-in-play.mjs
 */
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = 'tests/ui/artifacts/about-in-play'
await mkdir(out, { recursive: true })
for (const mode of process.env.MODES ? process.env.MODES.split(',') : ['desktop', 'phone', 'landscape']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? devices[mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    // The owner's rule (AGENTS.md): no image in ordinary play. The Welcome pictures are the one
    // exception, and only once the player opens the guide: none before, and only those after.
    const images = []; let opened = false
    page.on('request', r => { if (r.resourceType() === 'image') images.push({ url: new URL(r.url()).pathname, opened }) })
    await page.goto(`${process.env.MIRA_URL}?autoplay=1&room=about-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForFunction(() => window.mira.shell.playing && !window.mira.shell.transitioning)
    if (touch) await page.locator('.inspector-toggle').tap()
    else if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    await page.locator('[data-section=players] > .wi-head').click()

    // Hold fire (L), then open the guide with it still down.
    await page.keyboard.down('l')
    await page.waitForFunction(() => mira.game.input.state.fire)
    assert.deepEqual(images, [], 'no image request before the guide opens')
    const { url, room } = await page.evaluate(() => ({ url: location.href, room: mira.shell.room }))
    opened = true
    // Where the interface stood before the guide opened: none of it may take a tap while it is open.
    const hud = await page.evaluate(() => ['.world-inspector', '.shell-minimap', '.hud-navigation', '.gear-selector', '.touch-controls'].map(sel => { const e = document.querySelector(sel), b = e?.getBoundingClientRect(); return b && b.width > 4 && b.height > 4 ? { sel, x: b.left + b.width / 2, y: b.top + b.height / 2 } : null }).filter(Boolean))
    await page.locator('.rail-about').click()
    const guide = page.locator('.in-play-about')
    await guide.waitFor({ state: 'visible' })
    // Bugs caught (the owner, 25 November 2026): tabs or a title bar back in the guide; the player
    // left driving under it; the interface around it still taking taps.
    assert.equal(await guide.getByRole('tab').count(), 0, 'no tabs')
    assert.equal(await guide.getAttribute('aria-label'), 'Welcome to Mira', 'the guide is named for screen readers')
    await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-paused'), null, { timeout: 5000 })
    for (const h of hud) assert.ok(await page.evaluate(({ sel, x, y }) => { const hit = document.elementFromPoint(x, y); return !hit || !hit.closest(sel) }, h), `${mode}: ${h.sel} takes no tap while Welcome is open`)
    // No visible title: headings start at h3 under the guide's name, and every picture says what it shows.
    const outline = await guide.evaluate(d => ({ levels: [...d.querySelectorAll('h2, h3, h4')].filter(h => h.getClientRects().length).map(h => Number(h.tagName[1])), alts: [...d.querySelectorAll('.welcome-shot img')].map(i => i.alt.trim().length) }))
    assert.equal(outline.levels[0], 3, 'the guide\'s sections start at h3')
    assert.ok(outline.levels.every((level, i) => i === 0 || level <= outline.levels[i - 1] + 1), `headings never skip a level ${outline.levels}`)
    assert.ok(outline.alts.length >= 5 && outline.alts.every(n => n > 20), 'every picture has alt text')
    assert.ok(await guide.evaluate(d => d.open && d.matches(':modal')), 'the guide is a modal')
    assert.equal(await page.evaluate(() => mira.game.input.state.fire), false, 'held fire is cancelled on open')
    assert.ok(await page.evaluate(() => document.activeElement?.closest('.in-play-about') !== null), 'focus moves into the guide')
    await page.screenshot({ path: `${out}/${mode}.png` })
    if (touch) {
      // Only the X at the top right, a full tap target.
      const box = await guide.boundingBox(), back = await guide.locator('.about-back').boundingBox()
      assert.ok(back.height >= 44 && back.width >= 44 && back.x > box.x + box.width / 2 && back.y < box.y + 80, `${mode}: the X is a full target at the top right ${JSON.stringify({ box, back })}`)
    }
    if (!touch) {
      // Keyboard only: Tab stays inside the guide and reaches Back.
      for (let i = 0; i < 3; i++) await page.keyboard.press('Tab')
      assert.ok(await page.evaluate(() => document.activeElement?.closest('.in-play-about') !== null), 'Tab stays in the guide')
    }

    // Escape closes it and does nothing else; the still-held L does not fire.
    await page.keyboard.press('Escape')
    await guide.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => mira.game.input.suspended), false, 'play resumes')
    assert.equal(await page.evaluate(() => document.querySelector('.mira-shell').classList.contains('is-paused')), false, 'the pause Welcome made is lifted on close')
    const tick = await page.evaluate(() => mira.game.tick)
    await page.waitForFunction(t => mira.game.tick > t + 10, tick)
    assert.equal(await page.evaluate(() => mira.game.input.state.fire), false, 'nothing fires on close')
    await page.keyboard.up('l')
    // A fresh press fires again.
    await page.keyboard.down('l')
    await page.waitForFunction(() => mira.game.input.state.fire)
    await page.keyboard.up('l')
    if (!touch) {
      // From the Paused veil: the guide opens over it, and closing leaves the world paused.
      await page.locator('.rail-pause').click()
      // If the pause does not take, say what the page was doing instead of timing out on the button.
      const pauseState = () => page.evaluate(() => ({ paused: document.querySelector('.mira-shell').classList.contains('is-paused'), lock: !!document.pointerLockElement, guide: document.querySelector('.in-play-about').open, suspended: mira.game.input.suspended, focus: document.activeElement?.className, buttonHidden: document.querySelector('.pause-about').hidden }))
      await page.waitForFunction(() => document.querySelector('.mira-shell').classList.contains('is-paused'), null, { timeout: 5000 }).catch(async () => { throw new Error(`Pause did not take: ${JSON.stringify(await pauseState())}`) })
      await page.locator('.pause-about').click()
      await guide.waitFor({ state: 'visible' })
      await page.screenshot({ path: `${out}/desktop-paused.png` })
      await page.keyboard.press('Escape')
      await guide.waitFor({ state: 'hidden' })
      assert.ok(await page.evaluate(() => mira.game.input.suspended), 'still paused after the guide closes')
      await page.locator('.pause-veil').click()
      await page.waitForFunction(() => !mira.game.input.suspended)
    }
    assert.equal(page.url(), url, 'the address is unchanged')
    assert.equal(await page.evaluate(() => mira.shell.room), room, 'the room is unchanged')
    const strays = images.filter(i => !/^\/welcome\/[\w-]+-(640|960|1280|1920)\.webp$/.test(i.url))
    assert.deepEqual(strays, [], 'after opening, only the Welcome pictures load')
    assert.ok(images.length > 0, 'the Welcome pictures load once the guide is open')
    assert.deepEqual(errors, [])
    console.log(mode, 'ok')
  } finally { await browser.close() }
}
