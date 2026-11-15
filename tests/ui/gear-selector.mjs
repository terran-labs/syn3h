// The gear selector in isolation: tests/ui/gear-selector.html with a fake rack and a fake
// controls() state machine. Desktop Chrome and an iPhone in WebKit. Run through
// tests/ui/run-gear-selector.sh, which serves the page on 5212.
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const out = 'tests/ui/artifacts/gear-selector'
await mkdir(out, { recursive: true })
const base = process.env.SYN3H_URL ?? 'http://127.0.0.1:5212/'
const page_ = (query) => new URL(`tests/ui/gear-selector.html?${query}`, base).href

const watch = (page) => {
  const errors = []
  page.on('pageerror', (error) => { errors.push(error.message); console.error('page error:', error.message) })
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}
const ready = async (page) => {
  await page.waitForFunction(() => window.gearHarness && !document.querySelector('.gear-selector').hidden)
  await page.evaluate(() => document.fonts.ready)
}
const current = (page) => page.evaluate(() => gearHarness.rack.current)
const settle = (page) => page.waitForTimeout(320)
const active = (page) => page.locator('.gs-item.is-active')
/** The centre of the active item, in the drum's frame: it must sit at the drum's middle. */
const centred = (page) => page.evaluate(() => {
  const drum = document.querySelector('.gs-drum').getBoundingClientRect(), item = document.querySelector('.gs-item.is-active').getBoundingClientRect()
  return Math.abs(item.top + item.height / 2 - (drum.top + drum.height / 2))
})

// ---------------------------------------------------------------------------------- desktop
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = watch(page)
    await page.goto(page_('bg=bright'))
    await ready(page)

    // Semantics and target sizes.
    assert.equal(await page.getByRole('listbox', { name: 'Gear' }).count(), 1)
    assert.equal(await page.getByRole('option').count(), 5)
    assert.equal(await page.getByRole('option', { name: 'Plasma Tag' }).getAttribute('aria-selected'), 'true')
    for (const box of await page.locator('.gs-item').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) assert.ok(box >= 44, `item ${box} px tall`)
    const drum = await page.locator('.gs-drum').boundingBox()
    assert.ok(Math.abs(drum.x - 56) <= 1 && Math.abs(drum.y + drum.height / 2 - 450) < 4, `crescent on the left, at mid-height: ${JSON.stringify(drum)}`)
    // The arc is concentric with the focus display's speed arc: its circle is centred on the view.
    const ring = await page.locator('.gs-arc').first().boundingBox()
    assert.ok(Math.abs(ring.x + ring.width / 2 - 720) < 2 && Math.abs(ring.y + ring.height / 2 - 450) < 2, `arc centred on the view: ${JSON.stringify(ring)}`)
    // Neighbours sit along the curve: the ones above and below are turned toward the centre.
    const turned = await page.locator('.gs-item[data-id=red]').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).b)
    assert.ok(turned < -0.01, `item below is turned along the arc (${turned})`)
    assert.ok(await centred(page) < 1)
    assert.match(await page.locator('.gs-drum').evaluate(el => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage), /linear-gradient/)
    await page.screenshot({ path: `${out}/desktop-unlocked-bright.png` })

    // Click a neighbour: it eases into the centre (mid-flight it is not yet there).
    await page.getByRole('option', { name: 'Plasma Thunder' }).click()
    assert.equal(await current(page), 'red')
    const mid = await page.waitForTimeout(60).then(() => centred(page))
    assert.ok(mid > 2, `drum animates rather than jumping (${mid} px off at 60 ms)`)
    await settle(page)
    assert.ok(await centred(page) < 1)
    assert.equal(await page.locator('.gs-item.is-active').getAttribute('data-id'), 'red')
    assert.equal(await page.locator('.gs-item[data-id=red]').evaluate(el => getComputedStyle(el).transitionTimingFunction.split(', cubic')[0]), 'cubic-bezier(0.2, 0.8, 0.2, 1)')

    // Wraps: from Plasma Tag, the item above is Yoink.
    await page.evaluate(() => gearHarness.rack.select('beam')); await settle(page)
    const above = await page.evaluate(() => { const r = (id) => document.querySelector(`.gs-item[data-id=${id}]`).getBoundingClientRect().top; return r('yoink') < r('beam') && r('red') > r('beam') })
    assert.ok(above, 'Yoink sits above Plasma Tag on the ring')

    // Wheel over the drum steps one gear per notch, both ways, and wraps.
    await page.mouse.move(drum.x + 60, drum.y + drum.height / 2)
    await page.mouse.wheel(0, 100); await settle(page)
    assert.equal(await current(page), 'red')
    await page.mouse.wheel(0, -100); await settle(page)
    await page.mouse.wheel(0, -100); await settle(page)
    assert.equal(await current(page), 'yoink', 'wheel wraps backwards')

    // Drag up pulls the next gear in; a drag is not also a click on the item under it.
    await page.evaluate(() => gearHarness.rack.select('beam')); await settle(page)
    const cy = drum.y + drum.height / 2
    await page.mouse.move(drum.x + 70, cy); await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(drum.x + 70, cy - i * 9)
    await page.mouse.up(); await settle(page)
    assert.equal(await current(page), 'pester', 'a 72 px drag up steps two gears')
    await page.mouse.move(drum.x + 70, cy); await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(drum.x + 70, cy + i * 9)
    await page.mouse.up(); await settle(page)
    assert.equal(await current(page), 'red', 'a drag down steps back')

    // Arrow keys move through the ring while it has focus, and do not leak to gameplay;
    // key up always passes.
    await active(page).focus()
    const seen = await page.evaluate(() => {
      const keys = []; const on = (e) => keys.push(`${e.type}:${e.code}`)
      window.addEventListener('keydown', on); window.addEventListener('keyup', on); window.__keys = keys
      return true
    })
    assert.ok(seen)
    await page.keyboard.press('ArrowDown'); await settle(page)
    assert.equal(await current(page), 'pester')
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await settle(page)
    assert.equal(await current(page), 'beam')
    await page.keyboard.press('ArrowUp'); await settle(page)
    assert.equal(await current(page), 'yoink', 'arrow keys wrap')
    await page.keyboard.press('Home'); await settle(page)
    assert.equal(await current(page), 'beam')
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), 'beam', 'focus follows the active gear')
    const keys = await page.evaluate(() => window.__keys)
    assert.ok(!keys.some(k => k.startsWith('keydown:Arrow') || k === 'keydown:Home'), `handled keys leaked: ${keys}`)
    assert.ok(keys.includes('keyup:ArrowDown') && keys.includes('keyup:ArrowUp'), `key up must pass: ${keys}`)
    // A driving key held before focus arrived still releases.
    const released = await active(page).evaluate(el => {
      let up = false; window.addEventListener('keyup', e => { if (e.code === 'KeyW') up = true }, { once: true })
      el.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
      return up
    })
    assert.ok(released)
    // Digits and T are the rack's keys: they pass through untouched.
    const digit = await active(page).evaluate(el => {
      let got = false; window.addEventListener('keydown', e => { if (e.code === 'Digit3') got = true }, { once: true })
      el.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', bubbles: true }))
      return got
    })
    assert.ok(digit)
    assert.deepEqual(await page.evaluate(() => gearHarness.selected.slice(0, 1)), ['red'], 'onSelect reports picks made here')

    // Hints follow the Grapple's states: idle, flying, attached to a vehicle, back to idle.
    const hints = () => page.locator('.gs-hints li').evaluateAll(els => els.map(li => `${[...li.querySelectorAll('kbd')].map(k => k.textContent).join('/')} ${li.querySelector('.gs-act').textContent}`))
    // Actions started from the page land on the next frame's update(); poll briefly.
    const hintsBe = async (want) => {
      for (let i = 0; i < 40 && JSON.stringify(await hints()) !== JSON.stringify(want); i++) await page.waitForTimeout(50)
      assert.deepEqual(await hints(), want)
    }
    await page.getByRole('option', { name: 'Grapple' }).click(); await settle(page)
    assert.equal(await page.locator('.gs-desc').textContent(), 'Throw a cord, hook a vehicle or the ground, then reel in or let out.')
    assert.deepEqual(await hints(), ['Click/L Launch'])
    await page.evaluate(() => gearHarness.rack.controls().actions[0].start())
    await hintsBe(['G/Double tap Let go'])
    assert.equal(await page.locator('.gs-status').textContent(), 'Cord flying')
    await page.evaluate(() => gearHarness.setGrapple('vehicle'))
    assert.deepEqual(await hints(), ['Hold click Reel in', 'V/Wheel down Let out', 'G/Double tap Let go'])
    assert.equal(await page.locator('.gs-status').textContent(), 'Cord 42 m')
    assert.equal(await page.locator('.gs-level').isVisible(), true)
    assert.equal(await page.locator('.gs-level i').evaluate(el => el.style.transform), 'scaleX(0.7)')
    // The level is read live each frame, without a new controls() object.
    await page.evaluate(() => gearHarness.setLiveLevel(0.25))
    await page.waitForFunction(() => document.querySelector('.gs-level i').style.transform === 'scaleX(0.25)')
    await page.evaluate(() => gearHarness.setLiveLevel(null))
    assert.equal(await page.locator('.gear-actions').isVisible(), false, 'no touch buttons on desktop')
    await page.screenshot({ path: `${out}/desktop-unlocked-grapple-bright.png` })
    // A status change keeps the hint lines (same nodes) and updates the status alone.
    const firstHint = await page.locator('.gs-hints li').first().elementHandle()
    await page.evaluate(() => gearHarness.setCord(30))
    assert.equal(await page.locator('.gs-status').textContent(), 'Cord 30 m')
    assert.equal(await firstHint.evaluate(el => el.isConnected), true)
    await page.evaluate(() => gearHarness.rack.controls().actions[2].start())
    await hintsBe(['Click/L Launch'])
    assert.equal(await page.locator('.gs-status').isVisible(), false)
    // Yoink: grab, then fling.
    await page.getByRole('option', { name: 'Yoink' }).click(); await settle(page)
    assert.deepEqual(await hints(), ['Hold click Grab'])
    await page.evaluate(() => gearHarness.setYoink('holding'))
    assert.deepEqual(await hints(), ['Release click Fling'])
    await page.evaluate(() => gearHarness.setYoink('idle'))

    // update() does no DOM work when nothing changed.
    assert.equal(await page.evaluate(() => gearHarness.idleMutations(400)), 0, 'idle updates mutate the DOM')
    await page.evaluate(() => gearHarness.setFocused(true))
    assert.equal(await page.evaluate(() => gearHarness.idleMutations(400)), 0, 'idle locked updates mutate the DOM')

    // Locked: the pointer passes through; the drum still shows the gear and a key hint.
    await page.evaluate(() => { gearHarness.rack.select('bungee'); gearHarness.setGrapple('vehicle') })
    await settle(page)
    assert.equal(await page.locator('.gear-selector').getAttribute('data-mode'), 'locked')
    assert.equal(await page.locator('.gs-drum').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    assert.equal(await page.locator('.gs-keyhint').textContent(), 'T next · 1 to 5')
    assert.equal(await page.locator('.gs-desc').isVisible(), false, 'description only when unlocked')
    assert.equal(await page.locator('.gs-hints').isVisible(), true, 'hints stay while driving')
    const lockedBox = await page.locator('.gs-item[data-id=red]').boundingBox()
    const before = await current(page)
    await page.mouse.click(lockedBox.x + 40, lockedBox.y + lockedBox.height / 2)
    await page.mouse.move(drum.x + 60, drum.y + drum.height / 2); await page.mouse.wheel(0, 200)
    await settle(page)
    assert.equal(await current(page), before, 'locked drum ignores the pointer')
    assert.ok(await centred(page) < 1)
    await page.screenshot({ path: `${out}/desktop-locked-bright.png` })
    await page.evaluate(() => gearHarness.setBackdrop('dark'))
    await page.screenshot({ path: `${out}/desktop-locked-dark.png` })
    // Focus inside the drum is dropped when the cursor is captured, so driving keys are free.
    await page.evaluate(() => gearHarness.setFocused(false)); await settle(page)
    await active(page).focus()
    await page.evaluate(() => gearHarness.setFocused(true))
    assert.equal(await page.evaluate(() => document.querySelector('.gear-selector').contains(document.activeElement)), false)
    await page.evaluate(() => gearHarness.setFocused(false)); await settle(page)
    await page.mouse.move(1000, 800)
    await page.screenshot({ path: `${out}/desktop-unlocked-grapple-dark.png` })

    // Hidden without a rack or with a single gear.
    await page.evaluate(() => gearHarness.setAllowed(['beam']))
    assert.equal(await page.locator('.gear-selector').isVisible(), false)
    await page.evaluate(() => gearHarness.setAllowed(['beam', 'yoink']))
    assert.equal(await page.locator('.gear-selector').isVisible(), true)
    assert.equal(await page.getByRole('option').count(), 2)
    assert.equal(await page.locator('.gs-keyhint').textContent(), 'T next · 1 or 2')
    await page.evaluate(() => gearHarness.setPresent(false))
    assert.equal(await page.locator('.gear-selector').isVisible(), false)

    // Reduced motion: no transition at all.
    const calm = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
    const calmErrors = watch(calm)
    await calm.goto(page_('bg=dark')); await ready(calm)
    assert.equal(await calm.locator('.gs-item').first().evaluate(el => getComputedStyle(el).transitionDuration.split(',').every(d => parseFloat(d) === 0)), true)
    await calm.getByRole('option', { name: 'Plasma Thunder' }).click()
    await calm.waitForTimeout(30)
    assert.ok(await centred(calm) < 1, 'reduced motion moves at once')
    assert.deepEqual(calmErrors, [])
    assert.deepEqual(errors, [])
    console.log('desktop: gear selector passed')
  } finally { await browser.close() }
}

// ---------------------------------------------------------------------------------- phone
{
  const browser = await webkit.launch()
  try {
    for (const bg of ['bright', 'dark']) {
      const context = await browser.newContext({ ...devices['iPhone 14'] })
      const page = await context.newPage()
      const errors = watch(page)
      await page.goto(page_(`touch=1&bg=${bg}&gear=bungee`))
      await ready(page)
      for (const h of await page.locator('.gs-item').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) assert.ok(h >= 48, `touch item ${h} px`)
      assert.equal(await page.locator('.gs-hints').isVisible(), false, 'no key caps on touch')

      if (bg === 'bright') {
        // Tap a neighbour.
        await page.locator('.gs-item[data-id=yoink]').tap(); await settle(page)
        assert.equal(await current(page), 'yoink')
        // Swipe up steps forward, swipe down steps back (touch pointer events).
        const box = await page.locator('.gs-drum').boundingBox()
        const swipe = async (dy) => {
          const x = box.x + 60, y = box.y + box.height / 2
          const cdp = (type, py) => page.evaluate(({ type, x, py }) => {
            const el = document.elementFromPoint(x, py) ?? document.querySelector('.gs-drum')
            el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: py, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
          }, { type, x, py })
          await cdp('pointerdown', y)
          for (let i = 1; i <= 6; i++) await cdp('pointermove', y + (dy * i) / 6)
          await cdp('pointerup', y + dy)
          await settle(page)
        }
        await swipe(-44)
        assert.equal(await current(page), 'beam', 'swipe up wraps forward to Plasma Tag')
        await swipe(44)
        assert.equal(await current(page), 'yoink', 'swipe down steps back')
        await page.locator('.gs-item[data-id=bungee]').tap(); await settle(page)
      }
      assert.equal(await current(page), 'bungee')

      // Extra action buttons only while they apply.
      const shown = () => page.locator('.gear-actions button').evaluateAll(els => els.filter(e => e.offsetParent !== null).map(e => e.dataset.action))
      assert.deepEqual(await shown(), [], 'idle Grapple: launch is the TAG button')
      await page.evaluate(() => gearHarness.setGrapple('flying'))
      assert.deepEqual(await shown(), [], 'flying: release is the primary action')
      await page.evaluate(() => gearHarness.setGrapple('vehicle'))
      assert.deepEqual(await shown(), ['payOut', 'release'])
      const fit = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect()
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        const buttons = [...document.querySelectorAll('.gear-actions button')].map(b => b.getBoundingClientRect())
        const theirs = [...document.querySelectorAll('.touch-controls button:not([hidden])')].map(b => b.getBoundingClientRect())
        return {
          sizes: buttons.every(b => b.width >= 56 && b.height >= 56),
          onScreen: buttons.every(b => b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight),
          clearStick: buttons.every(b => !overlap(b, r('.touch-stick'))),
          clearMap: buttons.every(b => !overlap(b, r('.shell-minimap'))),
          clearButtons: buttons.every(b => theirs.every(t => !overlap(b, t))),
          drumClearStick: !overlap(r('.gs-drum'), r('.touch-stick')),
          // Reported, not asserted: on a 664 px tall phone the minimap reaches into the left
          // column; the shell decides between moving it and setting --gear-top.
          drumMapOverlap: Math.max(0, Math.min(r('.gs-drum').bottom, r('.shell-minimap').bottom) - Math.max(r('.gs-drum').top, r('.shell-minimap').top)),
        }
      })
      console.log(`phone ${bg}: crescent and minimap overlap ${Math.round(fit.drumMapOverlap)} px vertically`)
      delete fit.drumMapOverlap
      assert.deepEqual(fit, { sizes: true, onScreen: true, clearStick: true, clearMap: true, clearButtons: true, drumClearStick: true })
      await page.screenshot({ path: `${out}/phone-grapple-${bg}.png` })

      if (bg === 'bright') {
        // Hold: start on pointer down, stop exactly once on up; same for cancel and leave.
        const payOut = page.locator('.gear-actions [data-action=payOut]')
        const fire = (type, id = 3) => payOut.evaluate((el, { type, id }) => {
          const r = el.getBoundingClientRect()
          el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: r.x + 20, clientY: r.y + 20, bubbles: true, cancelable: true, buttons: 1 }))
        }, { type, id })
        const log = () => page.evaluate(() => gearHarness.log.splice(0))
        await log()
        for (const ending of ['pointerup', 'pointercancel', 'pointerleave']) {
          await fire('pointerdown')
          assert.deepEqual(await log(), ['start:payOut'])
          assert.equal(await payOut.evaluate(el => el.classList.contains('held')), true)
          // A cord-length change mid-hold neither stops nor restarts it.
          await page.evaluate(() => gearHarness.setCord(gearHarness.state.cord + 3))
          assert.deepEqual(await log(), [])
          await fire(ending)
          await fire('pointerup')
          await fire('lostpointercapture')
          assert.deepEqual(await log(), ['stop:payOut'], `${ending} stops once`)
        }
        // Real taps through WebKit.
        await payOut.tap()
        assert.deepEqual(await log(), ['start:payOut', 'stop:payOut'])
        // The state moves on while held: the button lets go before it disappears.
        await fire('pointerdown')
        await page.evaluate(() => gearHarness.setGrapple('idle'))
        assert.deepEqual(await log(), ['start:payOut', 'stop:payOut'])
        assert.deepEqual(await shown(), [])
        // Dispose while held.
        await page.evaluate(() => gearHarness.setGrapple('vehicle'))
        await fire('pointerdown')
        await page.evaluate(() => gearHarness.selector.dispose())
        assert.deepEqual(await log(), ['start:payOut', 'stop:payOut'])
        assert.equal(await page.locator('.gear-selector, .gear-actions').count(), 0)
        // Tapping Let go releases the Grapple.
        await page.reload(); await ready(page)
        await page.evaluate(() => { gearHarness.rack.select('bungee'); gearHarness.setGrapple('vehicle'); gearHarness.log.splice(0) })
        await page.locator('.gear-actions [data-action=release]').tap()
        assert.deepEqual(await page.evaluate(() => gearHarness.log), ['start:release'])
        assert.deepEqual(await shown(), [])
      }
      assert.deepEqual(errors, [])
      await context.close()
    }
    console.log('phone: gear selector passed')
  } finally { await browser.close() }
}
