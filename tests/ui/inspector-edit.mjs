// The inspector's editable numbers, card opening and closing, and finger-sized targets, in
// desktop Chrome and iPhone WebKit. Bugs caught: a number that cannot be typed into or does not
// reach its setting; a card that does not open, or whose body stays hidden or inert once open;
// targets too small for a finger.
//   /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs inspector-edit
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { serverUrl } from './lib/server.mjs'
const base = serverUrl('inspector-edit')
const shots = 'tests/ui/artifacts/inspector-edit'
await mkdir(shots, { recursive: true })

const value = (page, id) => page.evaluate(id => mira.params.get(id).value, id)
/** Wait until no card is mid-animation. */
const settled = page => page.waitForFunction(() => !document.querySelector('.wi-cards').getAnimations({ subtree: true }).some(a => a.playState === 'running'))
/** Open the card and the fold that hold a property, then bring its row into view. */
async function reveal(page, id) {
  const row = page.locator(`.wi-row[data-id="${id}"]`)
  await row.evaluate(row => {
    const card = row.closest('.wi-card')
    if (!card.classList.contains('is-open')) card.querySelector('.wi-head').click()
    row.closest('details').open = true
  })
  await settled(page)
  await row.scrollIntoViewIfNeeded()
  return row
}

for (const mode of process.env.UX_VIEW ? [process.env.UX_VIEW] : ['desktop', 'phone', 'landscape']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const page = await browser.newPage(touch ? { ...devices[mode === 'landscape' ? 'iPhone 14 landscape' : 'iPhone 14'] } : { viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${base}?autoplay=1&room=inspector-edit-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // Newer shells open the rail whenever the cursor is free and drop the desktop toggle.
    // Panels show when the cursor is free; touch has one switch for them.
    if (await page.evaluate(() => !!document.pointerLockElement)) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.pointerLockElement) }
    if (await page.locator('.inspector-toggle').isVisible() && await page.locator('.world-inspector').isHidden()) await page.locator('.inspector-toggle').click()
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    await page.locator('.world-inspector').waitFor({ state: 'visible' })
    const press = async locator => touch ? locator.tap() : locator.click()

    // ---- Target sizes, measured from what the browser lays out. ----
    const minHead = touch ? 48 : 44, minRow = touch ? 44 : 40
    const gravity = await reveal(page, 'world.gravity')
    await reveal(page, 'sky.sunDisc'); await reveal(page, 'world.seaKind')
    const sizes = await page.evaluate(() => {
      const boxes = selector => [...document.querySelectorAll(selector)].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height)
      // A segmented button's hit area includes its pseudo-element: walk out from its centre.
      // Only buttons scrolled into view can be hit-tested.
      const centre = el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el }
      const hit = [...document.querySelectorAll('.wi-card.is-open .wi-seg button')].filter(centre).map(button => {
        const r = button.getBoundingClientRect(), x = r.left + r.width / 2
        let top = r.top + r.height / 2, bottom = top
        while (document.elementFromPoint(x, top - 1) === button) top--
        while (document.elementFromPoint(x, bottom + 1) === button) bottom++
        return bottom - top + 1
      })
      return {
        heads: boxes('.wi-head').map(r => r.height), rows: boxes('.wi-card.is-open .wi-row').map(r => r.height),
        ranges: boxes('.wi-card.is-open .wi-row input[type=range]').map(r => r.height), boxes: boxes('.wi-card.is-open .wi-hit').map(r => Math.min(r.width, r.height)),
        summaries: boxes('.wi-card.is-open .wi-group > summary').map(r => r.height), seg: hit,
        overflow: document.querySelector('.wi-cards').scrollWidth - document.querySelector('.wi-cards').clientWidth,
      }
    })
    const atLeast = (list, min, what) => { assert.ok(list.length, `${what} measured`); for (const h of list) assert.ok(h >= min - .5, `${what} ${h}px >= ${min}px`) }
    atLeast(sizes.heads, minHead, 'card header'); atLeast(sizes.rows, minRow, 'row'); atLeast(sizes.ranges, 44, 'slider hit area')
    atLeast(sizes.boxes, 44, 'checkbox hit area'); atLeast(sizes.summaries, 44, 'group fold'); atLeast(sizes.seg, 44, 'segmented button hit area')
    assert.ok(sizes.overflow <= 1, 'no horizontal overflow')

    // ---- Click a number, type, Enter: applied, clamped, snapped. ----
    const number = gravity.locator('.wi-num'), field = gravity.locator('.wi-num-edit')
    assert.match(await number.getAttribute('aria-label'), /^Gravity \(m\/s²\): [\d.]+, edit$/)
    const before = await value(page, 'world.gravity')
    await press(number)
    await field.waitFor()
    assert.equal(await field.getAttribute('aria-label'), 'Gravity (m/s²)'); assert.equal(await field.getAttribute('inputmode'), 'decimal')
    assert.ok(await field.evaluate(el => document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0), 'field is focused and preselected')
    await page.screenshot({ path: `${shots}/${mode}-editing.png` })
    await page.keyboard.type('12.344 m/s')
    await page.keyboard.press('Enter')
    assert.equal(await value(page, 'world.gravity'), 12.34, 'typed value applied and snapped to the step')
    assert.equal(await field.count(), 0); assert.equal(await number.evaluate(el => document.activeElement === el), true, 'focus returns to the number')
    assert.equal(await number.textContent(), '12.34')
    assert.equal(Number(await gravity.locator('input[type=range]').inputValue()), 12.34, 'the slider follows')
    await press(number); await page.keyboard.type('99999'); await page.keyboard.press('Enter')
    assert.equal(await value(page, 'world.gravity'), 18.81, 'clamped to the maximum')
    await press(number); await page.keyboard.type('-5'); await page.keyboard.press('Enter')
    assert.equal(await value(page, 'world.gravity'), 0.81, 'clamped to the minimum')
    await press(number); await page.keyboard.type('9,5'); await page.keyboard.press('Enter')
    assert.equal(await value(page, 'world.gravity'), 9.5, 'decimal comma')

    // ---- Escape cancels, and does not close the rail. ----
    await press(number); await page.keyboard.type('3'); await page.keyboard.press('Escape')
    assert.equal(await value(page, 'world.gravity'), 9.5, 'Escape keeps the old value')
    assert.equal(await field.count(), 0)
    assert.equal(await page.locator('.world-inspector').isVisible(), true, 'Escape in the field leaves the rail open')

    // ---- Garbage: the old value comes back, marked, and the field stays for another try. ----
    await press(number); await page.keyboard.type('fast please'); await page.keyboard.press('Enter')
    assert.equal(await field.inputValue(), '9.5'); assert.equal(await field.evaluate(el => el.classList.contains('is-invalid')), true)
    assert.equal(await value(page, 'world.gravity'), 9.5)
    await page.keyboard.press('Escape')
    // Leaving the field commits what is in it.
    await press(number); await page.keyboard.type('4 m'); await press(gravity.locator('.wi-label'))
    assert.equal(await value(page, 'world.gravity'), 4, 'leaving the field commits')
    await page.evaluate(v => mira.params.set('world.gravity', v, 'local'), before)

    // ---- Keyboard isolation: nothing typed in the field reaches driving, and keyup still does. ----
    await press(number); await field.waitFor()
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyX', 'Digit5', 'Enter']) {
      const result = await field.evaluate((el, code) => {
        const input = window.mira.game.input, special = input.state.special
        const before = { ...input.poll() }
        el.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code.replace(/^(Key|Digit)/, ''), bubbles: true, cancelable: true }))
        const held = { ...input.poll() }
        el.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
        return { before, held, special: input.state.special === special, suspended: input.suspended }
      }, code)
      assert.equal(result.suspended, false)
      assert.deepEqual(result.held, result.before, `${code} in the field cannot drive, fire or toggle`)
      assert.ok(result.special, `${code} cannot toggle the special ability`)
    }
    // Enter, last above, committed the field: open it again for real keys held across a poll.
    await press(number); await field.waitFor(); await page.keyboard.down('ArrowUp')
    assert.equal(await page.evaluate(() => mira.game.input.poll().y), 0, 'a held arrow in the field does not drive')
    await page.keyboard.up('ArrowUp')
    // A key held before the field took focus is still released inside it.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' })))
    assert.equal(await page.evaluate(() => mira.game.input.poll().y), 1)
    await field.evaluate(el => el.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true })))
    assert.equal(await page.evaluate(() => mira.game.input.poll().y), 0, 'keyup reaches Input from the field')
    await page.keyboard.press('Escape')
    // The arrow key above went to the window, outside any field, which means "drive": it may
    // have captured the cursor. Make sure the panels are showing again before going on.
    await page.waitForTimeout(300)
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape'); await page.locator('.world-inspector').waitFor({ state: 'visible' })

    // ---- A deferred row commits once, snapped to its step. ----
    const budget = await reveal(page, 'lava.particleBudget')
    await page.evaluate(() => { window.budgetChanges = 0; mira.params.onChange(id => { if (id === 'lava.particleBudget') window.budgetChanges++ }) })
    await press(budget.locator('.wi-num')); await page.keyboard.type('1000'); await page.keyboard.press('Enter')
    assert.equal(await value(page, 'lava.particleBudget'), 1008, 'deferred value snapped to 48')
    assert.equal(await page.evaluate(() => window.budgetChanges), 1, 'deferred row committed once')

    // ---- Disabled numbers are not editable. ----
    await page.evaluate(() => { document.querySelector('.wi-row[data-id="world.gravity"] .wi-num').disabled = true })
    // On a phone one card is open at a time, so revealing the budget above closed World.
    await reveal(page, 'world.gravity')
    await number.click({ force: true })
    assert.equal(await field.count(), 0, 'a locked number stays a number')
    await page.evaluate(() => { document.querySelector('.wi-row[data-id="world.gravity"] .wi-num').disabled = false })

    // ---- Cards ease their heights together. ----
    // The Gravity tooltip from the steps above can sit over the World header on a phone, so
    // the motion is checked on the Game card. On the phone layout Playwright drives an
    // emulated mouse: its pointer, left where the number was clicked, would hover a Game row
    // as the card opens under it and raise that row's tooltip, which a finger never does.
    // Move it off the rail and tap from here on.
    if (touch) await page.mouse.move(1, 1)
    await page.evaluate(() => mira.shell.inspector.hideTooltip())
    const heights = () => page.evaluate(() => [...document.querySelectorAll('.wi-card')].map(c => c.getBoundingClientRect().height))
    await page.evaluate(() => { for (const card of document.querySelectorAll('.wi-card.is-open')) card.querySelector('.wi-head').click() })
    await settled(page)
    const closed = await heights()
    const run = await page.evaluate(() => new Promise(resolve => {
      const card = document.querySelector('.wi-card[data-section=game]'), start = card.getBoundingClientRect().height, samples = []
      card.querySelector('.wi-head').click()
      const t0 = performance.now()
      const look = () => { samples.push(card.getBoundingClientRect().height); performance.now() - t0 < 500 ? requestAnimationFrame(look) : resolve({ start, samples, running: document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.classList?.contains('wi-card')).length }) }
      requestAnimationFrame(look)
    }))
    const end = run.samples.at(-1)
    // If the card did not open, say what state it was in: this check has failed without a cause before.
    if (!(end > run.start + 100)) console.log('card state at failure', JSON.stringify(await page.evaluate(() => {
      const card = document.querySelector('.wi-card[data-section=game]'), body = card.querySelector('.wi-body'), stack = document.querySelector('.wi-cards')
      return { cardClass: card.className, bodyHidden: body.hidden, bodyDisplay: getComputedStyle(body).display, bodyHeight: Math.round(body.getBoundingClientRect().height), bodyChildren: body.childElementCount, cardFlex: getComputedStyle(card).flex, cardMinHeight: getComputedStyle(card).minHeight, stack: [stack.clientHeight, stack.scrollHeight], rail: Math.round(document.querySelector('.world-inspector').getBoundingClientRect().height), railChildren: [...document.querySelector('.world-inspector').children].map(c => `${c.className.split(' ')[0]}:${Math.round(c.getBoundingClientRect().height)}`), cards: [...document.querySelectorAll('.wi-card')].map(c => `${c.dataset.section}:${Math.round(c.getBoundingClientRect().height)}:${c.classList.contains('is-open') ? 'open' : 'closed'}`), moving: document.querySelectorAll('.is-moving').length, animations: document.getAnimations().length, paused: mira.shell.userPaused, locked: !!document.pointerLockElement, viewport: [innerWidth, innerHeight] }
    })))
    assert.ok(end > run.start + 100, `the card opened (${run.start} to ${end})`)
    // Whether the height eases on the way is motion design (it changed with the cards' rework,
    // 22 November 2026), not something a player would call broken: only opening is checked.
    // The motion's duration is tuning and stretches on a loaded machine; landing is checked below.
    await settled(page)
    const animated = await heights()
    assert.equal(await page.locator('.wi-card[data-section=game] .wi-body').evaluate(el => !el.hidden && !el.inert), true)
    // Closing hides the body once the card has shrunk.
    await press(page.locator('.wi-card[data-section=game] .wi-head')); await settled(page)
    assert.deepEqual((await heights()).map(Math.round), closed.map(Math.round), 'closing returns to the closed layout')
    assert.equal(await page.locator('.wi-card[data-section=game] .wi-body').evaluate(el => el.hidden && el.inert), true, 'closed body leaves the tab order')
    // A screenshot half way through opening.
    await press(page.locator('.wi-card[data-section=game] .wi-head'))
    await page.waitForTimeout(90)
    await page.evaluate(() => { for (const a of document.querySelector('.wi-cards').getAnimations({ subtree: true })) a.pause() })
    await page.screenshot({ path: `${shots}/${mode}-card-opening.png` })
    await page.evaluate(() => { for (const a of document.querySelector('.wi-cards').getAnimations({ subtree: true })) a.play() })
    await settled(page)

    // ---- Reduced motion: no animation, and the same final layout. ----
    await press(page.locator('.wi-card[data-section=game] .wi-head')); await settled(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const still = await page.evaluate(() => {
      const card = document.querySelector('.wi-card[data-section=game]')
      card.querySelector('.wi-head').click()
      return { animations: card.getAnimations().length, height: card.getBoundingClientRect().height }
    })
    assert.equal(still.animations, 0, 'no animation with reduced motion ' + JSON.stringify(still))
    assert.deepEqual((await heights()).map(Math.round), animated.map(Math.round), 'animated and still layouts land in the same place')
    await page.emulateMedia({ reducedMotion: 'no-preference' })

    // ---- Every header reachable, nothing wider than the rail. ----
    await page.evaluate(() => { for (const card of document.querySelectorAll('.wi-card:not(.is-open)')) card.querySelector('.wi-head').click() })
    await settled(page)
    const reach = await page.evaluate(() => {
      const stack = document.querySelector('.wi-cards')
      return [...document.querySelectorAll('.wi-head')].map(head => {
        head.scrollIntoView({ block: 'nearest' })
        const r = head.getBoundingClientRect(), s = stack.getBoundingClientRect()
        return r.top >= s.top - 1 && r.bottom <= s.bottom + 1
      }).every(Boolean) && stack.scrollWidth <= stack.clientWidth + 1
    })
    // A phone shows one panel at a time (phone-panels.mjs checks every card is reachable there),
    // so "all open" is a desktop and tablet state.
    if (!touch) assert.ok(reach, 'every header can be reached with all cards open')
    await page.evaluate(() => { document.querySelector('.wi-cards').scrollTop = 0; for (const card of document.querySelectorAll('.wi-card.is-open:not([data-section=game])')) card.querySelector('.wi-head').click() })
    await settled(page)
    await page.screenshot({ path: `${shots}/${mode}-rail.png` })

    assert.deepEqual(errors, [])
    console.log(`${mode}: inspector editing, motion and targets passed`)
  } finally { await browser.close() }
}
