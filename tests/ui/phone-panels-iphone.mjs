// The panels on an iPhone, upright and on its side (the owner's review, 26 November 2026).
// Invariants, each a bug the owner hit:
// - the list does not draw at full strength under the search field: it fades once scrolled;
// - Close panels has no glass; upright it sits directly under the last name, on its side it is a
//   rotated label left of the names;
// - Chat alone: the field sits at the card's foot (no empty space under it) and, growing as a
//   long draft wraps, never leaves the card;
// - on its side, a tap on the game beside the panels closes them and fires nothing; a drag that
//   starts inside the panels closes nothing.
// Frames: the list, a card open and Chat open, both ways up.
//   MIRA_URL=http://127.0.0.1:5173/ tools/heavy.sh node tests/ui/phone-panels-iphone.mjs
import '../../tools/lib/legacy-env.mjs'
import { webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { serverUrl } from './lib/server.mjs'

const base = serverUrl('phone-panels-iphone')
const shots = 'tests/ui/artifacts/phone-panels-iphone'
await mkdir(shots, { recursive: true })
const browser = await webkit.launch()
try {
  for (const [name, device] of [['portrait', 'iPhone 14'], ['landscape', 'iPhone 14 landscape']]) {
    const context = await browser.newContext({ ...devices[device] })
    await context.addInitScript(() => localStorage.setItem('mira.chat.overlay', '1'))
    const page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}?autoplay=1&room=phone-panels-${name}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30 && window.mira.shell.playing, null, { timeout: 180000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 180000 })
    // Daydream (the idle autopilot) closes the panels; this check sits still between steps.
    await page.evaluate(() => { window.mira.params.set('daydream.seconds', 0, 'local'); window.mira.params.set('bots.count', 3) })
    const rail = page.locator('.world-inspector')
    const settled = () => page.waitForFunction(() => !document.querySelector('.world-inspector').getAnimations({ subtree: true }).some(a => a.playState === 'running'), null, { timeout: 15000 }).then(() => page.waitForTimeout(250))
    const openPanels = async () => { if (!(await rail.isVisible())) await page.locator('.inspector-toggle').tap(); await rail.waitFor({ state: 'visible' }); await settled() }
    await openPanels()

    // ---- The list ----
    const close = page.locator('.world-inspector > .panels-close')
    const look = await page.evaluate(() => {
      const el = document.querySelector('.world-inspector > .panels-close'), s = getComputedStyle(el), box = el.getBoundingClientRect()
      const cards = [...document.querySelectorAll('.wi-cards > .wi-card')].filter(c => !c.hidden), last = cards.at(-1).getBoundingClientRect(), rail = document.querySelector('.world-inspector').getBoundingClientRect()
      return { background: s.backgroundColor, image: s.backgroundImage, backdrop: s.backdropFilter || s.webkitBackdropFilter || 'none', writing: s.writingMode, box: box.toJSON(), lastBottom: last.bottom, railLeft: rail.left, railRight: rail.right, firstTop: cards[0].getBoundingClientRect().top }
    })
    assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(look.background) && look.image === 'none' && look.backdrop === 'none', `${name}: Close panels has no glass (${JSON.stringify(look)})`)
    if (name === 'portrait') {
      assert.ok(look.box.top >= look.lastBottom - 1 && look.box.top - look.lastBottom <= 20, `${name}: Close panels sits directly under the last name (${look.box.top} vs ${look.lastBottom})`)
    } else {
      assert.ok(look.writing.startsWith('vertical'), `${name}: Close panels is rotated (${look.writing})`)
      assert.ok(look.box.right <= look.railLeft + 1 && look.box.left >= 0, `${name}: Close panels stands left of the names, on screen (${JSON.stringify(look.box)} rail ${look.railLeft})`)
    }
    // At rest every row draws at full strength across its whole height, the last included: no
    // mask and no transparency on the stack or anything round the last row (the owner: "show all
    // the buttons"). On its side the list runs to the screen's bottom edge.
    const rest = await page.evaluate(() => {
      const stack = document.querySelector('.wi-cards'), last = [...stack.children].filter(c => !c.hidden).at(-1)
      const faded = []
      for (let el = last; el && el !== document.body; el = el.parentElement) {
        const s = getComputedStyle(el), mask = s.maskImage || s.webkitMaskImage || 'none'
        if (mask !== 'none' || Number(s.opacity) < 1) faded.push(`${el.className}: ${mask} ${s.opacity}`)
      }
      return { scrollTop: stack.scrollTop, faded, stackBottom: stack.getBoundingClientRect().bottom, viewport: innerHeight }
    })
    assert.equal(rest.scrollTop, 0)
    assert.deepEqual(rest.faded, [], `${name}: at rest the last row draws at full strength (${JSON.stringify(rest.faded)})`)
    if (name === 'landscape') assert.ok(Math.abs(rest.stackBottom - rest.viewport) <= 1, `${name}: the list runs to the bottom edge (${rest.stackBottom} of ${rest.viewport})`)
    await page.screenshot({ path: `${shots}/${name}-list.png` })
    // Scrolled, the list fades under the search field instead of a hard cut.
    const fade = await page.evaluate(() => { const s = document.querySelector('.wi-cards'); s.scrollTop = 40; return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ scrolled: s.scrollTop, mask: getComputedStyle(s).maskImage || getComputedStyle(s).webkitMaskImage || 'none' })))) })
    if (fade.scrolled > 0) assert.match(fade.mask, /gradient/, `${name}: the scrolled list fades under the search field (${fade.mask})`)
    await page.screenshot({ path: `${shots}/${name}-list-scrolled.png` })
    await page.evaluate(() => { document.querySelector('.wi-cards').scrollTop = 0 })

    // ---- A card open ----
    await page.locator('.wi-card[data-section=world] > .wi-head').tap(); await settled()
    await page.waitForFunction(() => document.querySelector('.wi-card[data-section=world]').classList.contains('is-open'), null, { timeout: 10000 })
    await page.screenshot({ path: `${shots}/${name}-card.png` })
    await page.locator('.wi-card[data-section=world] > .wi-head').tap(); await settled()

    // ---- Chat open: the field at the card's foot, and inside it as a draft grows ----
    await page.locator('.wi-card[data-section=chat] > .wi-head').tap(); await settled()
    await page.waitForFunction(() => document.querySelector('.wi-card[data-section=chat]').classList.contains('is-open'), null, { timeout: 10000 })
    const chat = () => page.evaluate(() => {
      const card = document.querySelector('.wi-card[data-section=chat]').getBoundingClientRect(), body = document.querySelector('.wi-card[data-section=chat] > .wi-body').getBoundingClientRect(), form = document.querySelector('.chat-form').getBoundingClientRect(), field = document.querySelector('.chat-field').getBoundingClientRect()
      return { cardBottom: card.bottom, bodyBottom: body.bottom, formBottom: form.bottom, formTop: form.top, fieldBottom: field.bottom, fieldHeight: field.height }
    })
    // A phone has no Y key: the empty chat points at the field instead.
    const empty = await page.locator('.chat-log .chat-empty').textContent().catch(() => null)
    if (empty !== null) assert.equal(empty, 'Nothing said yet. Say hello below.', `${name}: the empty chat names no key on a phone`)
    const one = await chat()
    assert.ok(one.formBottom <= one.bodyBottom + 1 && one.bodyBottom - one.formBottom <= 24, `${name}: the field sits at the card's foot (${JSON.stringify(one)})`)
    await page.screenshot({ path: `${shots}/${name}-chat.png` })
    await page.locator('.chat-field').fill('A long line to wrap: '.repeat(14))
    await page.locator('.chat-field').dispatchEvent('input'); await page.waitForTimeout(300)
    const grown = await chat()
    assert.ok(grown.fieldHeight > one.fieldHeight, `${name}: the field grows as the draft wraps (${one.fieldHeight} to ${grown.fieldHeight})`)
    assert.ok(grown.fieldBottom <= grown.bodyBottom + 1 && grown.formBottom <= grown.cardBottom + 1, `${name}: the grown field stays inside the card (${JSON.stringify(grown)})`)
    await page.screenshot({ path: `${shots}/${name}-chat-draft.png` })
    await page.locator('.chat-field').fill(''); await page.locator('.chat-field').dispatchEvent('input')
    await page.locator('.wi-card[data-section=chat] > .wi-head').tap(); await settled()

    // ---- On its side: a tap beside the panels closes them and fires nothing ----
    if (name === 'landscape') {
      await page.evaluate(() => { const input = window.mira.game.input, poll = input.poll.bind(input); window.__fires = []; input.poll = () => { const s = poll(); window.__fires.push(s.fire ? 1 : 0); return s } })
      // A drag that starts inside the panels and ends beside them closes nothing.
      const rect = await rail.boundingBox()
      await page.evaluate(([x0, y, x1]) => {
        const at = (x, yy) => document.elementFromPoint(x, yy) ?? document.body
        const fire = (type, x, yy) => at(x, yy).dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: yy, bubbles: true, cancelable: true, composed: true }))
        fire('pointerdown', x0, y); fire('pointermove', (x0 + x1) / 2, y); fire('pointermove', x1, y); fire('pointerup', x1, y)
      }, [rect.x + 40, rect.y + rect.height / 2, 60])
      await page.waitForTimeout(400)
      assert.ok(await rail.isVisible(), `${name}: a drag from inside the panels does not close them`)
      await page.touchscreen.tap(Math.round(rect.x / 3), Math.round(rect.y + rect.height / 2))
      await page.waitForFunction(() => !window.mira.shell.inspector.open, null, { timeout: 5000 })
      await page.waitForTimeout(300)
      assert.equal((await page.evaluate(() => window.__fires)).reduce((a, b) => a + b, 0), 0, `${name}: the closing tap fires nothing`)
      await page.screenshot({ path: `${shots}/${name}-closed-by-tap.png` })
    }
    assert.deepEqual(errors, [], `${name}: no page errors`)
    console.log(`${name}: ok`)
    await context.close()
  }
} finally { await browser.close() }
